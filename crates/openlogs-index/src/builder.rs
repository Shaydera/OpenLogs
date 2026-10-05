use std::collections::{HashMap, VecDeque};

use openlogs_parser::{
    CombatEvent, CombatKind, CombatantInfo, DamageVia, EncounterEnd, EncounterStart, Event,
    LogLine, Timestamp,
};

use crate::model::{
    FightSummary, LogIndex, Outcome, PRELUDE_MICROS, RosterEntry, SUPPORTED_LOG_VERSION,
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
    /// Lines of the last [`PRELUDE_MICROS`], oldest first, as (timestamp, offset).
    recent: VecDeque<(Timestamp, u64)>,
    /// `end_offset` of the last closed fight; preludes never reach back past it.
    last_fight_end: u64,
    /// Zone of the latest `ZONE_CHANGE`.
    zone: Option<String>,
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
            recent: VecDeque::new(),
            last_fight_end: 0,
            zone: None,
        }
    }

    /// Whether a fight is open. Outside fights, callers may feed lines via
    /// [`Self::push_skipped`] instead of parsing them.
    pub fn in_fight(&self) -> bool {
        self.open.is_some()
    }

    /// Records a line outside fights that was only parsed up to its event name.
    pub fn push_skipped(&mut self, span: LineSpan, timestamp: Timestamp) {
        self.index.line_count += 1;
        self.remember(span, timestamp);
    }

    /// Records a line that failed to parse.
    pub fn push_broken(&mut self, span: LineSpan) {
        self.index.line_count += 1;
        self.index.broken_lines += 1;
        if let Some(fight) = &mut self.open {
            fight.summary.broken_lines += 1;
            fight.summary.end_offset = span.next_offset;
        }
    }

    pub fn push(&mut self, span: LineSpan, line: &LogLine<'_>) {
        self.index.line_count += 1;
        self.remember(span, line.timestamp);
        self.close_before(line);
        let starts_fight = matches!(line.event, Event::EncounterStart(_));
        if !starts_fight && let Some(fight) = &mut self.open {
            extend(&mut fight.summary, span, line.timestamp);
        }
        match &line.event {
            Event::CombatLogVersion {
                version,
                advanced,
                build,
            } => self.on_version(*version, *advanced, build),
            Event::EncounterStart(start) => self.open_fight(span, line.timestamp, start),
            Event::EncounterEnd(end) => self.end_fight(end),
            Event::ChallengeModeStart(_) | Event::ChallengeModeEnd(_) => {}
            Event::CombatantInfo(info) => {
                if let Some(fight) = &mut self.open {
                    add_combatant(&mut fight.summary.roster, info);
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

    /// Closes a still-open fight as incomplete and returns the index.
    pub fn finish(mut self) -> LogIndex {
        self.close_open(Outcome::Incomplete);
        self.index
    }

    /// Leaving the instance (release, disconnect, hearth) ends an open fight at the
    /// previous line, even without `ENCOUNTER_END`.
    fn close_before(&mut self, line: &LogLine<'_>) {
        if let Event::ZoneChange { zone_id, .. } = &line.event
            && self
                .open
                .as_ref()
                .is_some_and(|fight| fight.summary.instance_id != *zone_id)
        {
            self.close_open(Outcome::Incomplete);
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

    /// First line within [`PRELUDE_MICROS`] before `span`, never before the end of the last
    /// closed fight.
    fn prelude_offset(&self, span: LineSpan) -> u64 {
        self.recent
            .front()
            .map_or(span.offset, |&(_, offset)| offset)
            .max(self.last_fight_end)
    }

    fn open_fight(&mut self, span: LineSpan, timestamp: Timestamp, start: &EncounterStart<'_>) {
        self.close_open(Outcome::Incomplete);
        let prelude_offset = self.prelude_offset(span);
        self.open = Some(OpenFight {
            summary: FightSummary {
                index: self.index.fights.len() as u32 + 1,
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
            },
            hostile: HashMap::new(),
            player_names: HashMap::new(),
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
    }

    fn close_open(&mut self, outcome: Outcome) {
        if let Some(fight) = self.open.take() {
            self.last_fight_end = fight.summary.end_offset;
            self.index.fights.push(fight.finish(outcome));
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
}

#[derive(Debug, Clone, Copy, Default)]
struct HostileUnit {
    current_hp: u64,
    max_hp: u64,
    damage_taken: u64,
}

impl OpenFight {
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
