use std::collections::{BTreeMap, HashMap, VecDeque};

use openlogs_parser::{
    ChallengeModeEnd, ChallengeModeStart, CombatEvent, CombatKind, CombatantInfo, DamageVia,
    EncounterEnd, EncounterStart, Event, LogLine, Timestamp,
};

use crate::model::{
    ChallengeMode, END_GRACE_LINES, END_GRACE_MICROS, FightSummary, LogIndex,
    MYTHIC_KEYSTONE_DIFFICULTY, Outcome, PRELUDE_MICROS, RESUME_MAX_GAP_MICROS, RosterEntry,
    SUPPORTED_LOG_VERSION,
};

/// Byte range of one line in the log file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineSpan {
    pub offset: u64,
    pub next_offset: u64,
}

/// Builds a [`LogIndex`] from lines fed in file order.
pub struct IndexBuilder {
    index: LogIndex,
    open: Option<OpenFight>,
    /// The Mythic+ run in progress; boss pulls opened meanwhile belong to it.
    run: Option<OpenRun>,
    /// The run's `CHALLENGE_MODE_END`, held while its open boss pull may still end.
    held_end: Option<HeldEnd>,
    /// Lines of the last [`PRELUDE_MICROS`], oldest first, as (timestamp, offset).
    recent: VecDeque<(Timestamp, u64)>,
    /// `end_offset` of the last closed fight or run; preludes never reach back past it.
    last_fight_end: u64,
    /// Zone of the latest `ZONE_CHANGE`.
    zone: Option<String>,
    /// `index` of the latest fight or run. Entries are numbered by their start line, so a
    /// run comes right before its boss pulls.
    last_index: u32,
}

impl Default for IndexBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl IndexBuilder {
    pub fn new() -> Self {
        Self {
            index: LogIndex::empty(),
            open: None,
            run: None,
            held_end: None,
            recent: VecDeque::new(),
            last_fight_end: 0,
            zone: None,
            last_index: 0,
        }
    }

    /// Whether a fight is open. Outside fights, callers may feed lines via
    /// [`Self::push_skipped`] instead of parsing them, also while a run is open.
    pub fn in_fight(&self) -> bool {
        self.open.is_some()
    }

    /// Records a line outside fights that was only parsed up to its event name.
    pub fn push_skipped(&mut self, span: LineSpan, timestamp: Timestamp) {
        self.release_end(None);
        self.index.line_count += 1;
        self.remember(span, timestamp);
        if let Some(run) = &mut self.run {
            extend(&mut run.summary, span, timestamp);
        }
    }

    /// Records a line that failed to parse.
    pub fn push_broken(&mut self, span: LineSpan) {
        self.release_end(None);
        self.index.line_count += 1;
        self.index.broken_lines += 1;
        if let Some(fight) = &mut self.open {
            fight.summary.broken_lines += 1;
            fight.summary.end_offset = span.next_offset;
        }
        if let Some(run) = &mut self.run {
            run.summary.broken_lines += 1;
            run.summary.end_offset = span.next_offset;
        }
    }

    pub fn push(&mut self, span: LineSpan, line: &LogLine<'_>) {
        self.index.line_count += 1;
        self.remember(span, line.timestamp);
        self.release_end(Some(line));
        // A repeated START of the open key (reconnect, /reload) continues its run.
        let resumes_run = matches!(&line.event, Event::ChallengeModeStart(start) if self.is_same_key(start, line.timestamp));
        // A boss pull open across a reconnect may have ended while the player was offline.
        if resumes_run
            && let Some(fight) = &mut self.open
            && fight.resume.is_none()
        {
            fight.resume = Some(fight.snapshot(&self.index.unhandled_in_fights));
        }
        self.close_before(span, line);
        let starts_fight = matches!(line.event, Event::EncounterStart(_));
        let starts_run = matches!(line.event, Event::ChallengeModeStart(_)) && !resumes_run;
        if !starts_fight && let Some(fight) = &mut self.open {
            extend(&mut fight.summary, span, line.timestamp);
        }
        if !starts_run && let Some(run) = &mut self.run {
            extend(&mut run.summary, span, line.timestamp);
        }
        match &line.event {
            Event::CombatLogVersion {
                version,
                advanced,
                build,
            } => self.on_version(*version, *advanced, build),
            Event::EncounterStart(start) => self.open_fight(span, line.timestamp, start),
            Event::EncounterEnd(end) => self.end_fight(end),
            Event::ChallengeModeStart(start) if !resumes_run => {
                self.open_run(span, line.timestamp, start)
            }
            Event::ChallengeModeStart(_) => {}
            Event::ChallengeModeEnd(end) => self.end_run(end),
            Event::CombatantInfo(info) => {
                if let Some(fight) = &mut self.open {
                    add_combatant(&mut fight.summary.roster, info);
                }
                if let Some(run) = &mut self.run {
                    add_combatant(&mut run.summary.roster, info);
                }
            }
            Event::Combat(event) => {
                if let Some(fight) = &mut self.open {
                    fight.observe(event);
                }
            }
            Event::Unhandled { name } => {
                if self.open.is_some() {
                    *self
                        .index
                        .unhandled_in_fights
                        .entry((*name).to_string())
                        .or_default() += 1;
                }
            }
            Event::ZoneChange { name, .. } => self.zone = Some((*name).to_string()),
        }
    }

    /// Closes a still-open fight and run as incomplete and returns the index.
    pub fn finish(mut self) -> LogIndex {
        self.release_end(None);
        self.close_open(Outcome::Incomplete);
        self.close_run(Outcome::Incomplete);
        // A run closes after its boss pulls but is numbered before them.
        self.index.fights.sort_by_key(|fight| fight.index);
        self.index
    }

    /// Ends, at the previous line, what this line leaves behind: leaving the instance or
    /// another key ends the open pull and run; a run's END is held while a pull is open.
    fn close_before(&mut self, span: LineSpan, line: &LogLine<'_>) {
        match &line.event {
            Event::ZoneChange { zone_id, .. } => {
                if self
                    .open
                    .as_ref()
                    .is_some_and(|fight| fight.summary.instance_id != *zone_id)
                {
                    self.close_open(Outcome::Incomplete);
                }
                if self
                    .run
                    .as_ref()
                    .is_some_and(|run| run.summary.instance_id != *zone_id)
                {
                    self.close_run(Outcome::Incomplete);
                }
            }
            Event::ChallengeModeStart(start) if !self.is_same_key(start, line.timestamp) => {
                self.close_open(Outcome::Incomplete);
                self.close_run(Outcome::Incomplete);
            }
            Event::ChallengeModeEnd(end) if self.is_open_run(end.instance_id) => {
                self.hold_end(span, line.timestamp, end);
            }
            _ => {}
        }
    }

    /// The open pull's `ENCOUNTER_END` may follow its run's END in the same moment.
    fn hold_end(&mut self, span: LineSpan, timestamp: Timestamp, end: &ChallengeModeEnd) {
        let (Some(fight), Some(run)) = (&self.open, &self.run) else {
            return;
        };
        self.held_end = Some(HeldEnd {
            end: *end,
            at: timestamp,
            lines: 0,
            pull: fight.snapshot(&self.index.unhandled_in_fights),
            run_end: run.summary.end.max(timestamp),
            run_end_offset: span.next_offset,
        });
    }

    /// Keeps a held END waiting for combat, unhandled or `ENCOUNTER_END` lines within
    /// [`END_GRACE_MICROS`] and [`END_GRACE_LINES`]; anything else ends the pull before it.
    fn release_end(&mut self, line: Option<&LogLine<'_>>) {
        let Some(held) = &mut self.held_end else {
            return;
        };
        let at = held.at;
        let same_moment = line.is_some_and(|line| {
            line.timestamp.0 <= at.0 + END_GRACE_MICROS
                && matches!(
                    line.event,
                    Event::Combat(_) | Event::EncounterEnd(_) | Event::Unhandled { .. }
                )
        });
        if same_moment && held.lines < END_GRACE_LINES {
            held.lines += 1;
            return;
        }
        let Some(held) = self.held_end.take() else {
            return;
        };
        self.restore(held.pull);
        if let Some(run) = &mut self.run {
            run.summary.end = held.run_end;
            run.summary.end_offset = held.run_end_offset;
        }
        self.close_open(Outcome::Incomplete);
        self.close_run_at_end(&held.end);
    }

    /// Cuts the open pull back to `snapshot`, undoing what later lines did to it.
    fn restore(&mut self, snapshot: PullSnapshot) {
        if let Some(fight) = &mut self.open {
            fight.summary = snapshot.summary;
            fight.hostile = snapshot.hostile;
            fight.player_names = snapshot.player_names;
            self.index.unhandled_in_fights = snapshot.unhandled_in_fights;
        }
    }

    fn remember(&mut self, span: LineSpan, timestamp: Timestamp) {
        self.recent.push_back((timestamp, span.offset));
        while let Some(&(oldest, _)) = self.recent.front() {
            if timestamp.0 - oldest.0 > PRELUDE_MICROS {
                self.recent.pop_front();
            } else {
                break;
            }
        }
    }

    fn on_version(&mut self, version: u32, advanced: bool, build: &str) {
        match self.index.log_version {
            None => {
                self.index.log_version = Some(version);
                self.index.build = Some(build.to_string());
                self.index.advanced_logging = advanced;
                if version != SUPPORTED_LOG_VERSION {
                    self.warn(format!(
                        "Combat log version {version} is not supported (expected {SUPPORTED_LOG_VERSION}); some events may be missing."
                    ));
                }
                if !advanced {
                    self.warn(
                        "Advanced combat logging is disabled; HP, resources and positions are unavailable."
                            .to_string(),
                    );
                }
            }
            Some(first) if first != version => self.warn(format!(
                "Combat log version changes from {first} to {version} within the file."
            )),
            Some(_) => {}
        }
    }

    fn warn(&mut self, message: String) {
        if !self.index.warnings.contains(&message) {
            self.index.warnings.push(message);
        }
    }

    fn next_index(&mut self) -> u32 {
        self.last_index += 1;
        self.last_index
    }

    /// First line within [`PRELUDE_MICROS`] before `span`, never before the end of the last
    /// closed fight or run.
    fn prelude_offset(&self, span: LineSpan) -> u64 {
        self.recent
            .front()
            .map_or(span.offset, |&(_, offset)| offset)
            .max(self.last_fight_end)
    }

    fn is_open_run(&self, instance_id: u32) -> bool {
        self.run
            .as_ref()
            .is_some_and(|run| run.summary.instance_id == instance_id)
    }

    /// Whether `start`, logged at `timestamp`, repeats the key of the open run: same
    /// dungeon, key and level, at most [`RESUME_MAX_GAP_MICROS`] after the run's last line.
    fn is_same_key(&self, start: &ChallengeModeStart<'_>, timestamp: Timestamp) -> bool {
        self.run.as_ref().is_some_and(|run| {
            run.summary.instance_id == start.instance_id
                && timestamp.0 - run.summary.end.0 <= RESUME_MAX_GAP_MICROS
                && run.summary.challenge.as_ref().is_some_and(|key| {
                    key.challenge_mode_id == start.challenge_mode_id
                        && key.keystone_level == start.keystone_level
                })
        })
    }

    fn open_fight(&mut self, span: LineSpan, timestamp: Timestamp, start: &EncounterStart<'_>) {
        self.close_open(Outcome::Incomplete);
        let index = self.next_index();
        let prelude_offset = self.prelude_offset(span);
        self.open = Some(OpenFight {
            summary: FightSummary {
                index,
                encounter_id: start.encounter_id,
                name: start.name.to_string(),
                difficulty: start.difficulty,
                group_size: start.group_size,
                instance_id: start.instance_id,
                zone: self.zone.clone(),
                outcome: Outcome::Incomplete,
                start: timestamp,
                end: timestamp,
                duration_ms: 0,
                prelude_offset,
                start_offset: span.offset,
                end_offset: span.next_offset,
                boss_hp_percent: None,
                roster: Vec::new(),
                broken_lines: 0,
                challenge: None,
                run_index: self.run.as_ref().map(|run| run.summary.index),
            },
            hostile: HashMap::new(),
            player_names: HashMap::new(),
            resume: None,
        });
    }

    fn end_fight(&mut self, end: &EncounterEnd<'_>) {
        let Some(fight) = &mut self.open else { return };
        if fight.summary.encounter_id != end.encounter_id {
            return;
        }
        fight.summary.duration_ms = u64::from(end.duration_ms);
        self.close_open(if end.success {
            Outcome::Kill
        } else {
            Outcome::Wipe
        });
        // The pull ended right after its run's end: the run's range ends with it, while
        // the run still ends at its END.
        if let Some(held) = self.held_end.take() {
            if let Some(run) = &mut self.run {
                run.summary.end = held.run_end;
            }
            self.close_run_at_end(&held.end);
        }
    }

    /// Opens a run; [`Self::close_before`] has already ended what was open.
    fn open_run(&mut self, span: LineSpan, timestamp: Timestamp, start: &ChallengeModeStart<'_>) {
        let index = self.next_index();
        let prelude_offset = self.prelude_offset(span);
        self.run = Some(OpenRun {
            summary: FightSummary {
                index,
                encounter_id: 0,
                name: start.zone_name.to_string(),
                difficulty: MYTHIC_KEYSTONE_DIFFICULTY,
                group_size: 0,
                instance_id: start.instance_id,
                zone: Some(start.zone_name.to_string()),
                outcome: Outcome::Incomplete,
                start: timestamp,
                end: timestamp,
                duration_ms: 0,
                prelude_offset,
                start_offset: span.offset,
                end_offset: span.next_offset,
                boss_hp_percent: None,
                roster: Vec::new(),
                broken_lines: 0,
                challenge: Some(ChallengeMode {
                    challenge_mode_id: start.challenge_mode_id,
                    keystone_level: start.keystone_level,
                    affix_ids: start.affix_ids(),
                    total_time_ms: None,
                }),
                run_index: None,
            },
            player_names: HashMap::new(),
            last_pull: None,
        });
    }

    /// An end for another instance leaves the open run alone, and a held end waits for
    /// the run's open boss pull.
    fn end_run(&mut self, end: &ChallengeModeEnd) {
        if self.held_end.is_none() && self.is_open_run(end.instance_id) {
            self.close_run_at_end(end);
        }
    }

    /// Closes the open run at its `CHALLENGE_MODE_END`, with the result the log shows.
    fn close_run_at_end(&mut self, end: &ChallengeModeEnd) {
        let Some(run) = &mut self.run else { return };
        if let Some(challenge) = &mut run.summary.challenge {
            challenge.total_time_ms = Some(end.total_time_ms);
        }
        let outcome = run_outcome(end, run.last_pull);
        self.close_run(outcome);
    }

    /// Closes the open pull. One that ends without its `ENCOUNTER_END` after its key was
    /// started again ends at the line before that START.
    fn close_open(&mut self, outcome: Outcome) {
        if outcome == Outcome::Incomplete
            && let Some(resume) = self.open.as_mut().and_then(|fight| fight.resume.take())
        {
            self.restore(resume);
        }
        if let Some(fight) = self.open.take() {
            self.last_fight_end = fight.summary.end_offset;
            // The index reads only boss pulls in full, so a run's names come from them.
            if let Some(run) = &mut self.run {
                for (guid, name) in &fight.player_names {
                    run.player_names
                        .entry(guid.clone())
                        .or_insert_with(|| name.clone());
                }
                if fight.summary.run_index == Some(run.summary.index) {
                    run.last_pull = Some(outcome);
                }
            }
            self.index.fights.push(fight.finish(outcome));
        }
    }

    fn close_run(&mut self, outcome: Outcome) {
        if let Some(run) = self.run.take() {
            self.last_fight_end = self.last_fight_end.max(run.summary.end_offset);
            self.index.fights.push(run.finish(outcome));
        }
    }
}

/// Moves an open entry's end to this line; out-of-order timestamps never shrink it.
fn extend(summary: &mut FightSummary, span: LineSpan, timestamp: Timestamp) {
    summary.end = summary.end.max(timestamp);
    summary.end_offset = span.next_offset;
}

fn add_combatant(roster: &mut Vec<RosterEntry>, info: &CombatantInfo<'_>) {
    if roster.iter().all(|entry| entry.guid != info.guid) {
        roster.push(RosterEntry {
            guid: info.guid.to_string(),
            name: None,
            spec_id: info.spec_id,
        });
    }
}

struct OpenFight {
    summary: FightSummary,
    /// Every hostile NPC seen in advanced info or hit by damage, by GUID.
    hostile: HashMap<String, HostileUnit>,
    player_names: HashMap<String, String>,
    /// The pull before its key was started again (reconnect, /reload): its `ENCOUNTER_END`
    /// may have been missed offline, so an incomplete pull ends here.
    resume: Option<PullSnapshot>,
}

#[derive(Debug, Clone, Copy, Default)]
struct HostileUnit {
    current_hp: u64,
    max_hp: u64,
    damage_taken: u64,
}

impl OpenFight {
    /// The pull as of now, to cut it back to later; `unhandled` is the index's count.
    fn snapshot(&self, unhandled: &BTreeMap<String, u64>) -> PullSnapshot {
        PullSnapshot {
            summary: self.summary.clone(),
            hostile: self.hostile.clone(),
            player_names: self.player_names.clone(),
            unhandled_in_fights: unhandled.clone(),
        }
    }

    fn observe(&mut self, event: &CombatEvent<'_>) {
        for unit in [&event.source, &event.target] {
            if unit.is_player()
                && let Some(name) = unit.name
                && !self.player_names.contains_key(unit.guid)
            {
                self.player_names
                    .insert(unit.guid.to_string(), name.to_string());
            }
        }
        if let Some(info) = &event.advanced {
            let unit = [&event.target, &event.source]
                .into_iter()
                .find(|unit| unit.guid == info.info_guid);
            if let Some(unit) = unit
                && unit.is_hostile()
                && !unit.is_player()
            {
                let unit = self.hostile_unit(info.info_guid);
                unit.current_hp = info.current_hp;
                unit.max_hp = info.max_hp;
            }
        }
        // Support events and the victim-side melee copy repeat hits already counted.
        if let CombatKind::Damage(damage) = event.kind
            && damage.supporter.is_none()
            && damage.via != DamageVia::SwingLanded
            && event.target.is_hostile()
            && !event.target.is_player()
        {
            self.hostile_unit(event.target.guid).damage_taken += damage.amount;
        }
        if let CombatKind::UnitDied { .. } = event.kind
            && let Some(unit) = self.hostile.get_mut(event.target.guid)
        {
            unit.current_hp = 0;
        }
    }

    fn hostile_unit(&mut self, guid: &str) -> &mut HostileUnit {
        if !self.hostile.contains_key(guid) {
            self.hostile
                .insert(guid.to_string(), HostileUnit::default());
        }
        self.hostile.get_mut(guid).expect("inserted above")
    }

    fn finish(mut self, outcome: Outcome) -> FightSummary {
        let summary = &mut self.summary;
        summary.outcome = outcome;
        if outcome == Outcome::Incomplete {
            summary.duration_ms =
                u64::try_from(summary.end.millis_since(summary.start)).unwrap_or(0);
        }
        summary.boss_hp_percent = match outcome {
            Outcome::Kill => Some(0.0),
            Outcome::Wipe | Outcome::Incomplete => boss_hp_percent(&self.hostile),
        };
        for entry in &mut summary.roster {
            entry.name = self.player_names.get(&entry.guid).cloned();
        }
        self.summary
    }
}

/// An open pull as of an earlier line: everything later lines may change in its summary,
/// including the index's count of unhandled events, which only the open pull adds to.
struct PullSnapshot {
    summary: FightSummary,
    hostile: HashMap<String, HostileUnit>,
    player_names: HashMap<String, String>,
    unhandled_in_fights: BTreeMap<String, u64>,
}

/// A run's `CHALLENGE_MODE_END` that came while one of its boss pulls was open.
struct HeldEnd {
    end: ChallengeModeEnd,
    at: Timestamp,
    /// Lines seen since the END.
    lines: u32,
    /// The pull as of the line before the END: where it ends if its `ENCOUNTER_END` does
    /// not come in time, without what the lines meanwhile did to it.
    pull: PullSnapshot,
    /// The run's end at its END, whenever the pull ends.
    run_end: Timestamp,
    run_end_offset: u64,
}

struct OpenRun {
    summary: FightSummary,
    /// Player names seen in the run's boss pulls.
    player_names: HashMap<String, String>,
    /// Outcome of the run's latest boss pull so far.
    last_pull: Option<Outcome>,
}

/// `success` may mean "in time" or only "finished", so a completed key is told by its last
/// boss pull being a kill; the flag decides only when no pull tells.
fn run_outcome(end: &ChallengeModeEnd, last_pull: Option<Outcome>) -> Outcome {
    let completed = match last_pull {
        _ if end.total_time_ms == 0 => false,
        Some(Outcome::Kill) => true,
        Some(Outcome::Wipe) => false,
        Some(Outcome::Incomplete) | None => end.success,
    };
    if completed {
        Outcome::Kill
    } else {
        Outcome::Wipe
    }
}

impl OpenRun {
    /// A run lasts from its start line to its last line, `CHALLENGE_MODE_END` included.
    fn finish(mut self, outcome: Outcome) -> FightSummary {
        let summary = &mut self.summary;
        summary.outcome = outcome;
        summary.duration_ms = u64::try_from(summary.end.millis_since(summary.start)).unwrap_or(0);
        summary.group_size = summary.roster.len() as u32;
        for entry in &mut summary.roster {
            entry.name = self.player_names.get(&entry.guid).cloned();
        }
        self.summary
    }
}

/// Bosses are the units with at least a fifth of the top damage taken and a quarter of the
/// top max HP, so councils count every boss but idle encounter NPCs and adds do not.
fn boss_hp_percent(units: &HashMap<String, HostileUnit>) -> Option<f32> {
    let top_damage = units
        .values()
        .map(|unit| unit.damage_taken)
        .max()
        .filter(|&damage| damage > 0)?;
    let top_max_hp = units.values().map(|unit| unit.max_hp).max()?;
    let (current, max) = units
        .values()
        .filter(|unit| {
            unit.max_hp > 0
                && unit.damage_taken.saturating_mul(5) >= top_damage
                && unit.max_hp.saturating_mul(4) >= top_max_hp
        })
        .fold((0u64, 0u64), |(c, m), unit| {
            (c + unit.current_hp, m + unit.max_hp)
        });
    (max > 0).then(|| (current as f64 * 100.0 / max as f64) as f32)
}
