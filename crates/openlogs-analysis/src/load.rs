use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs::File;
use std::io;
use std::path::Path;

use openlogs_index::{FightSummary, MapBounds, Outcome};
use openlogs_parser::{
    CombatEvent, CombatKind, EncounterEnd, EncounterStart, Event as LogEvent, HealVia, Lines,
    LogLine, Spell, Timestamp, parse_line,
};

use crate::actors::{ActorId, ActorKind, Actors, NOBODY, npc_logged_friendly};
use crate::fight::{
    Absorbed, Damage, DamageVia, Energize, Event, EventKind, FailReason, Fight, FightKind, Heal,
    HealAbsorbed, LANDED_MATCH_MS, MarkerInterval, MissType, Missed, NO_SPELL, POWER_SAMPLE_MS,
    PositionSample, PowerSample, RunEncounter, SpellId, SpellInfo, UnitHp, WorldMarkerInterval,
};
use crate::granted::note_heal_grants;
use crate::turned::logger_turned_spans;

/// Loads one fight, including its prelude, from the complete log bytes.
pub fn load_fight(data: &[u8], summary: &FightSummary) -> Fight {
    load_fight_slice(data, 0, summary)
}

/// How far past a fight's end a part of the log should reach, so that the landed copies of
/// its last swings are in it.
pub const LANDED_TAIL_BYTES: u64 = 2 * 1024 * 1024;

/// Loads one fight from a part of the log that starts at byte `base_offset` and covers the
/// fight from its prelude to its end, plus up to [`LANDED_TAIL_BYTES`] after it.
pub fn load_fight_slice(data: &[u8], base_offset: u64, summary: &FightSummary) -> Fight {
    load_slice(data, base_offset, summary, Actors::new(), true)
}

/// Like [`load_fight_slice`] for one pull of a set: interns into `actors` so that units already
/// in it keep their ids, and keeps no position samples, which only the replay draws.
pub fn load_fight_slice_with(
    data: &[u8],
    base_offset: u64,
    summary: &FightSummary,
    actors: Actors,
) -> Fight {
    load_slice(data, base_offset, summary, actors, false)
}

fn load_slice(
    data: &[u8],
    base_offset: u64,
    summary: &FightSummary,
    actors: Actors,
    keep_positions: bool,
) -> Fight {
    let clamp = |offset: u64| {
        usize::try_from(offset.saturating_sub(base_offset))
            .map_or(data.len(), |o| o.min(data.len()))
    };
    let start = clamp(summary.prelude_offset);
    let end = clamp(summary.end_offset).max(start);
    let mut builder = FightBuilder::new(summary, actors, keep_positions);
    let mut fields = Vec::with_capacity(64);
    for raw in Lines::new(&data[start..end]) {
        if raw.bytes.is_empty() {
            continue;
        }
        match raw.text().and_then(|text| parse_line(text, &mut fields)) {
            Ok(line) => builder.push(&line),
            Err(_) => builder.fight.broken_lines += 1,
        }
    }
    let late = builder.landed_after_end(&data[end..], &mut fields);
    let mut fight = builder.finish();
    let unpaired = pair_landed_copies(&mut fight);
    mark_swings_landing_after_end(&mut fight, unpaired, &late);
    fight
}

/// A `SWING_DAMAGE_LANDED` logged after the fight's end, of units the fight knows.
struct LateLanded {
    t: i32,
    source: ActorId,
    target: ActorId,
    melee_total: u64,
}

enum MeleeLine {
    /// `SWING_DAMAGE`, or `SWING_MISSED` ABSORB for a hit a shield took whole.
    Attacker,
    Landed,
}

fn melee_line(event: &Event) -> Option<(MeleeLine, u64)> {
    match event.kind {
        EventKind::Damage(d) if d.supporter == NOBODY => match d.via {
            DamageVia::Swing => Some((MeleeLine::Attacker, d.melee_total())),
            DamageVia::SwingLanded => Some((MeleeLine::Landed, d.melee_total())),
            _ => None,
        },
        EventKind::Missed(m) if m.via == DamageVia::Swing && m.miss_type == MissType::Absorb => {
            Some((MeleeLine::Attacker, m.amount_missed))
        }
        _ => None,
    }
}

/// Pairs each melee hit's landed copy with its attacker-side line, as loading does, for a
/// fight built without loading it. A landed copy left without one is the hit itself.
pub fn pair_melee_lines(fight: &mut Fight) {
    pair_landed_copies(fight);
}

/// Pairs each landed copy with its attacker-side line, which the log writes up to
/// [`LANDED_MATCH_MS`] before or after it, and records that line in the copy. Returns the
/// attacker-side lines of the last [`LANDED_MATCH_MS`] that are still unpaired.
fn pair_landed_copies(fight: &mut Fight) -> VecDeque<(usize, u64)> {
    let mut attackers: VecDeque<(usize, u64)> = VecDeque::new();
    let mut landed: VecDeque<(usize, u64)> = VecDeque::new();
    let mut pairs = Vec::new();
    for index in 0..fight.events.len() {
        let event = &fight.events[index];
        let expired = |&(line, _): &(usize, u64)| event.t - fight.events[line].t > LANDED_MATCH_MS;
        while attackers.front().is_some_and(expired) {
            attackers.pop_front();
        }
        while landed.front().is_some_and(expired) {
            landed.pop_front();
        }
        let Some((side, total)) = melee_line(event) else {
            continue;
        };
        let (unpaired, other_side) = match side {
            MeleeLine::Attacker => (&mut attackers, &mut landed),
            MeleeLine::Landed => (&mut landed, &mut attackers),
        };
        let pair = |&(line, other_total): &(usize, u64)| {
            let other = &fight.events[line];
            other_total == total && other.source == event.source && other.target == event.target
        };
        match other_side.iter().position(pair) {
            Some(position) => {
                let (other, _) = other_side.remove(position).expect("found above");
                pairs.push(match side {
                    MeleeLine::Attacker => (other, index),
                    MeleeLine::Landed => (index, other),
                });
            }
            None => unpaired.push_back((index, total)),
        }
    }
    for (copy, attacker) in pairs {
        if let EventKind::Damage(damage) = &mut fight.events[copy].kind {
            damage.attacker_line = u32::try_from(attacker).ok();
        }
    }
    attackers
}

/// Flags the swings among `unpaired` whose landed copy is one of `late`.
fn mark_swings_landing_after_end(
    fight: &mut Fight,
    mut unpaired: VecDeque<(usize, u64)>,
    late: &[LateLanded],
) {
    for copy in late {
        let landed_after = |&(line, total): &(usize, u64)| {
            let swing = &fight.events[line];
            total == copy.melee_total
                && swing.source == copy.source
                && swing.target == copy.target
                && copy.t - swing.t <= LANDED_MATCH_MS
        };
        if let Some(position) = unpaired.iter().position(landed_after)
            && let Some((swing, _)) = unpaired.remove(position)
            && let EventKind::Damage(damage) = &mut fight.events[swing].kind
        {
            damage.lands_after_end = true;
        }
    }
}

/// Memory-maps `path` and loads one fight from it.
pub fn load_fight_file(path: &Path, summary: &FightSummary) -> io::Result<Fight> {
    let file = File::open(path)?;
    if file.metadata()?.len() == 0 {
        return Ok(load_fight(&[], summary));
    }
    // SAFETY: read-only map of a file WoW only appends to (see `openlogs_index::index_file`).
    let map = unsafe { memmap2::Mmap::map(&file)? };
    Ok(load_fight(&map, summary))
}

struct FightBuilder {
    start: Timestamp,
    fight: Fight,
    /// Last kept power sample per (player, power type).
    last_power: HashMap<(ActorId, i32), i32>,
    /// Time of the latest line: where a run's encounter without `ENCOUNTER_END` ends.
    last_t: i32,
    /// Whether the last of `fight.encounters` still waits for its `ENCOUNTER_END`.
    encounter_open: bool,
    /// The run's instance; a `CHALLENGE_MODE_END` of another one is not its end.
    instance_id: u32,
    /// Time of the last line before the run's `CHALLENGE_MODE_END`: where an encounter
    /// still open at the end of the run ends unless its `ENCOUNTER_END` follows.
    run_end_t: Option<i32>,
    /// Time of the last line before the run's key was started again (reconnect, /reload)
    /// while an encounter was open: where that encounter ends unless its `ENCOUNTER_END`
    /// follows, as the index ends its pull.
    resume_t: Option<i32>,
    /// Position samples per map, for `Fight::ui_map_id`.
    map_samples: HashMap<u32, usize>,
    keep_positions: bool,
    /// Index into `fight.raid_markers` of each actor's interval still open.
    open_raid_markers: HashMap<ActorId, usize>,
    /// Index into `fight.world_markers` of each marker's interval still open.
    open_world_markers: HashMap<u8, usize>,
    /// Lines that logged an NPC-controlled unit friendly, for `Fight::logger_turned`.
    friendly_npc_lines: Vec<(i32, ActorId)>,
}

impl FightBuilder {
    fn new(summary: &FightSummary, actors: Actors, keep_positions: bool) -> Self {
        Self {
            start: summary.start,
            fight: Fight {
                kind: if summary.is_run() {
                    FightKind::Run
                } else {
                    FightKind::Pull
                },
                encounter_id: summary.encounter_id,
                name: summary.name.clone(),
                difficulty: summary.difficulty,
                outcome: summary.outcome,
                duration_ms: summary.duration_ms,
                events: Vec::new(),
                power: Vec::new(),
                npc_power: Vec::new(),
                actors,
                spells: BTreeMap::new(),
                broken_lines: 0,
                encounters: Vec::new(),
                fail_reasons: Vec::new(),
                positions: Vec::new(),
                raid_markers: Vec::new(),
                world_markers: summary
                    .world_markers
                    .iter()
                    .map(|marker| WorldMarkerInterval {
                        marker: marker.marker,
                        x: marker.x,
                        y: marker.y,
                        start_ms: 0,
                        end_ms: 0,
                    })
                    .collect(),
                ui_map_id: None,
                map_bounds: summary.map_bounds.clone(),
                logger_turned: Vec::new(),
                heal_grants: Vec::new(),
            },
            last_power: HashMap::new(),
            last_t: i32::MIN,
            encounter_open: false,
            instance_id: summary.instance_id,
            run_end_t: None,
            resume_t: None,
            map_samples: HashMap::new(),
            keep_positions,
            open_raid_markers: HashMap::new(),
            open_world_markers: summary
                .world_markers
                .iter()
                .enumerate()
                .map(|(index, marker)| (marker.marker, index))
                .collect(),
            friendly_npc_lines: Vec::new(),
        }
    }

    fn push(&mut self, line: &LogLine<'_>) {
        let t = self.relative_ms(line.timestamp);
        let run = self.fight.kind == FightKind::Run;
        match &line.event {
            LogEvent::CombatantInfo(info) => {
                let id = self.fight.actors.intern_guid(info.guid);
                self.fight.actors.set_spec(id, info.spec_id);
            }
            LogEvent::Combat(event) => {
                let converted = self.convert(t, event);
                self.fight.events.push(converted);
            }
            // The summary already holds the markers placed before the start line.
            LogEvent::WorldMarkerPlaced { marker, x, y, .. } if t >= 0 => {
                self.remove_world_marker(t, *marker);
                self.open_world_markers
                    .insert(*marker, self.fight.world_markers.len());
                self.fight.world_markers.push(WorldMarkerInterval {
                    marker: *marker,
                    x: *x,
                    y: *y,
                    start_ms: t,
                    end_ms: t,
                });
            }
            LogEvent::WorldMarkerRemoved { marker } if t >= 0 => {
                self.remove_world_marker(t, *marker);
            }
            // The summary already holds the bounds written before the start line.
            LogEvent::MapChange {
                ui_map_id,
                max_x,
                min_x,
                max_y,
                min_y,
                ..
            } if t >= 0 => self.note_map_bounds(MapBounds {
                ui_map_id: *ui_map_id,
                min_x: *min_x,
                max_x: *max_x,
                min_y: *min_y,
                max_y: *max_y,
            }),
            LogEvent::EncounterStart(start) if run => self.start_encounter(t, start),
            LogEvent::EncounterEnd(end) if run => self.end_encounter(t, end),
            // The index ends a run's range right after an `ENCOUNTER_END` that follows its
            // END within `END_GRACE_MICROS`, so the encounter stays open until then.
            LogEvent::ChallengeModeEnd(end) if run && end.instance_id == self.instance_id => {
                self.run_end_t.get_or_insert(self.last_t);
            }
            LogEvent::ChallengeModeStart(start)
                if run && self.encounter_open && start.instance_id == self.instance_id =>
            {
                self.resume_t.get_or_insert(self.last_t);
            }
            _ => {}
        }
        self.last_t = self.last_t.max(t);
    }

    fn finish(mut self) -> Fight {
        self.close_encounter();
        let end_ms = i32::try_from(self.fight.duration_ms).unwrap_or(i32::MAX);
        for &index in self.open_raid_markers.values() {
            self.fight.raid_markers[index].end_ms = end_ms;
        }
        for &index in self.open_world_markers.values() {
            self.fight.world_markers[index].end_ms = end_ms;
        }
        self.fight
            .world_markers
            .sort_by_key(|marker| marker.start_ms);
        self.fight
            .raid_markers
            .sort_by_key(|marker| marker.start_ms);
        self.fight.ui_map_id = self
            .map_samples
            .iter()
            .max_by_key(|&(&map, &count)| (count, std::cmp::Reverse(map)))
            .map(|(&map, _)| map);
        self.fight.events.sort_by_key(|event| event.t);
        self.fight.power.sort_by_key(|p| p.t);
        self.fight.npc_power.sort_by_key(|p| p.t);
        self.fight.positions.sort_by_key(|p| p.t);
        self.friendly_npc_lines.sort_by_key(|&(t, _)| t);
        self.fight.logger_turned = logger_turned_spans(&self.fight, &self.friendly_npc_lines);
        note_heal_grants(&mut self.fight);
        self.fight
    }

    /// A boss encounter of a run; one still waiting for its end ends at the line before.
    fn start_encounter(&mut self, t: i32, start: &EncounterStart<'_>) {
        self.close_encounter();
        self.fight.encounters.push(RunEncounter {
            encounter_id: start.encounter_id,
            name: start.name.to_string(),
            start_ms: t.max(0),
            end_ms: t.max(0),
            outcome: Outcome::Incomplete,
        });
        self.encounter_open = true;
    }

    fn end_encounter(&mut self, t: i32, end: &EncounterEnd<'_>) {
        if !self.encounter_open {
            return;
        }
        if let Some(encounter) = self.fight.encounters.last_mut()
            && encounter.encounter_id == end.encounter_id
        {
            encounter.end_ms = t.max(encounter.start_ms);
            encounter.outcome = if end.success {
                Outcome::Kill
            } else {
                Outcome::Wipe
            };
            self.encounter_open = false;
            self.resume_t = None;
        }
    }

    /// An encounter without `ENCOUNTER_END` ends at the line before whatever ended it, as
    /// an incomplete pull does in the index: the key started again while it was open, the
    /// next encounter, or the run's `CHALLENGE_MODE_END`.
    fn close_encounter(&mut self) {
        if self.encounter_open
            && let Some(encounter) = self.fight.encounters.last_mut()
        {
            encounter.end_ms = self
                .resume_t
                .or(self.run_end_t)
                .unwrap_or(self.last_t)
                .max(encounter.start_ms);
        }
        self.encounter_open = false;
        self.resume_t = None;
    }

    fn note_map_bounds(&mut self, bounds: MapBounds) {
        let all = &mut self.fight.map_bounds;
        match all.binary_search_by_key(&bounds.ui_map_id, |b| b.ui_map_id) {
            Ok(index) => all[index] = bounds,
            Err(index) => all.insert(index, bounds),
        }
    }

    fn remove_world_marker(&mut self, t: i32, marker: u8) {
        if let Some(index) = self.open_world_markers.remove(&marker) {
            self.fight.world_markers[index].end_ms = t;
        }
    }

    fn note_raid_marker(&mut self, t: i32, actor: ActorId, raid_flags: u32) {
        if actor == NOBODY {
            return;
        }
        let marker = match (raid_flags & 0xFF).trailing_zeros() {
            bit @ 0..8 => Some(bit as u8 + 1),
            _ => None,
        };
        if let Some(&index) = self.open_raid_markers.get(&actor) {
            if Some(self.fight.raid_markers[index].marker) == marker {
                return;
            }
            self.fight.raid_markers[index].end_ms = t;
            self.open_raid_markers.remove(&actor);
        }
        if let Some(marker) = marker {
            self.open_raid_markers
                .insert(actor, self.fight.raid_markers.len());
            self.fight.raid_markers.push(MarkerInterval {
                actor,
                marker,
                start_ms: t,
                end_ms: t,
            });
        }
    }

    fn fail_reason(&mut self, reason: &str) -> FailReason {
        if reason == FailReason::INTERRUPTED {
            return FailReason::Interrupted;
        }
        let reasons = &mut self.fight.fail_reasons;
        let index = match reasons.iter().position(|known| known == reason) {
            Some(index) => index,
            None => {
                reasons.push(reason.to_string());
                reasons.len() - 1
            }
        };
        FailReason::Other(u16::try_from(index).unwrap_or(u16::MAX))
    }

    /// The landed copies in `tail`, the lines after the fight, until they could no longer
    /// belong to one of its swings.
    fn landed_after_end<'a>(&self, tail: &'a [u8], fields: &mut Vec<&'a str>) -> Vec<LateLanded> {
        let end = i32::try_from(self.fight.duration_ms).unwrap_or(i32::MAX);
        let actors = &self.fight.actors;
        let mut late = Vec::new();
        for raw in Lines::new(tail) {
            let Ok(line) = raw.text().and_then(|text| parse_line(text, fields)) else {
                continue;
            };
            let t = self.relative_ms(line.timestamp);
            if t > end.saturating_add(LANDED_MATCH_MS) {
                break;
            }
            let LogEvent::Combat(event) = &line.event else {
                continue;
            };
            let CombatKind::Damage(damage) = event.kind else {
                continue;
            };
            if damage.via != DamageVia::SwingLanded || damage.supporter.is_some() {
                continue;
            }
            if let (Some(source), Some(target)) =
                (actors.id(event.source.guid), actors.id(event.target.guid))
            {
                late.push(LateLanded {
                    t,
                    source,
                    target,
                    melee_total: damage.amount + damage.absorbed,
                });
            }
        }
        late
    }

    fn relative_ms(&self, timestamp: Timestamp) -> i32 {
        ((timestamp.0 - self.start.0) / 1_000).clamp(i64::from(i32::MIN), i64::from(i32::MAX))
            as i32
    }

    fn convert(&mut self, t: i32, event: &CombatEvent<'_>) -> Event {
        let actors = &mut self.fight.actors;
        let source = actors.intern(&event.source);
        let target = actors.intern(&event.target);
        for (id, unit) in [(source, &event.source), (target, &event.target)] {
            if npc_logged_friendly(unit) {
                self.friendly_npc_lines.push((t, id));
            }
        }
        self.note_raid_marker(t, source, event.source.raid_flags);
        self.note_raid_marker(t, target, event.target.raid_flags);
        let actors = &mut self.fight.actors;
        let unit_hp = event.advanced.map(|info| {
            let unit = actors.intern_guid(info.info_guid);
            actors.note_advanced(unit, info.level, info.max_hp);
            if let Some(owner) = info.owner_guid {
                let owner = actors.intern_guid(owner);
                actors.set_owner(unit, owner);
            }
            UnitHp {
                actor: unit,
                current: info.current_hp,
                max: info.max_hp,
            }
        });
        if let CombatKind::Summon = event.kind {
            actors.set_owner(target, source);
        }
        // `unit_hp.actor` is the advanced block's unit, interned above.
        if let (Some(info), Some(hp)) = (event.advanced, unit_hp)
            && hp.actor != NOBODY
        {
            let player = self.fight.actors.get(hp.actor).kind == ActorKind::Player;
            for (position, power) in info.powers().enumerate() {
                self.note_power(t, hp.actor, power, position == 0, player);
            }
        }
        if let (Some(info), Some(hp)) = (event.advanced, unit_hp)
            && self.keep_positions
            && hp.actor != NOBODY
            && (info.x != 0.0 || info.y != 0.0 || info.ui_map_id != 0)
        {
            self.fight.positions.push(PositionSample {
                t,
                actor: hp.actor,
                x: info.x,
                y: info.y,
                facing: info.facing,
                ui_map_id: info.ui_map_id,
            });
            *self.map_samples.entry(info.ui_map_id).or_default() += 1;
        }
        let spell = event.spell.map_or(NO_SPELL, |spell| self.spell(spell));
        let kind = self.kind(event.kind);
        Event {
            t,
            source,
            target,
            spell,
            kind,
            source_hostile: event.source.is_hostile(),
            target_hostile: event.target.is_hostile(),
            unit_hp,
        }
    }

    fn note_power(
        &mut self,
        t: i32,
        actor: ActorId,
        power: openlogs_parser::Power,
        primary: bool,
        player: bool,
    ) {
        let key = (actor, power.power_type);
        if self
            .last_power
            .get(&key)
            .is_some_and(|&last| (t - last).abs() < POWER_SAMPLE_MS)
        {
            return;
        }
        self.last_power.insert(key, t);
        let samples = if player {
            &mut self.fight.power
        } else {
            &mut self.fight.npc_power
        };
        samples.push(PowerSample {
            t,
            actor,
            power_type: power.power_type,
            current: power.current,
            max: power.max,
            primary,
        });
    }

    fn spell(&mut self, spell: Spell<'_>) -> SpellId {
        self.fight
            .spells
            .entry(spell.id)
            .or_insert_with(|| SpellInfo {
                name: spell.name.to_string(),
                school: spell.school,
            });
        spell.id
    }

    fn actor(&mut self, guid: Option<&str>) -> ActorId {
        guid.map_or(NOBODY, |guid| self.fight.actors.intern_guid(guid))
    }

    fn kind(&mut self, kind: CombatKind<'_>) -> EventKind {
        match kind {
            CombatKind::Damage(d) => EventKind::Damage(Damage {
                via: d.via,
                amount: d.amount,
                overkill: d.overkill,
                school: d.school,
                resisted: d.resisted,
                blocked: d.blocked,
                absorbed: d.absorbed,
                critical: d.critical,
                supporter: self.actor(d.supporter),
                attacker_line: None,
                lands_after_end: false,
            }),
            CombatKind::Missed(m) => EventKind::Missed(Missed {
                via: m.via,
                miss_type: MissType::from_log(m.miss_type),
                amount_missed: m.amount_missed.unwrap_or(0),
                critical: m.critical,
            }),
            CombatKind::Heal(h) => EventKind::Heal(Heal {
                periodic: h.via == HealVia::Periodic,
                amount: h.amount,
                overheal: h.overheal,
                absorbed: h.absorbed,
                critical: h.critical,
                supporter: self.actor(h.supporter),
            }),
            CombatKind::Absorbed(a) => {
                let absorber = self.fight.actors.intern(&a.absorber);
                EventKind::Absorbed(Absorbed {
                    absorber,
                    absorber_hostile: a.absorber.is_hostile(),
                    absorb_spell: self.spell(a.absorb_spell),
                    amount: a.amount,
                    supporter: self.actor(a.supporter),
                })
            }
            CombatKind::HealAbsorbed(h) => EventKind::HealAbsorbed(HealAbsorbed {
                healer: self.fight.actors.intern(&h.healer),
                heal_spell: self.spell(h.heal_spell),
                amount: h.amount,
            }),
            CombatKind::Energize(e) => EventKind::Energize(Energize {
                power_type: e.power_type,
                amount: e.amount,
                over_energize: e.over_energize,
            }),
            CombatKind::CastStart => EventKind::CastStart,
            CombatKind::CastSuccess => EventKind::CastSuccess,
            CombatKind::CastFailed { reason } => EventKind::CastFailed {
                reason: self.fail_reason(reason),
            },
            CombatKind::Aura(a) => EventKind::Aura {
                action: a.action,
                aura_type: a.aura_type,
                stacks: a.stacks,
                broken_by: a.broken_by.map_or(NO_SPELL, |spell| self.spell(spell)),
            },
            CombatKind::Interrupt { interrupted } => EventKind::Interrupt {
                interrupted: self.spell(interrupted),
            },
            CombatKind::Dispel { removed, aura_type } => EventKind::Dispel {
                removed: self.spell(removed),
                aura_type,
            },
            CombatKind::Stolen { removed, aura_type } => EventKind::Stolen {
                removed: self.spell(removed),
                aura_type,
            },
            CombatKind::Summon => EventKind::Summon,
            CombatKind::Create => EventKind::Create,
            CombatKind::Resurrect => EventKind::Resurrect,
            CombatKind::Instakill => EventKind::Instakill,
            CombatKind::EmpowerStart => EventKind::EmpowerStart,
            CombatKind::EmpowerEnd { stage } => EventKind::EmpowerEnd { stage },
            CombatKind::EmpowerInterrupt { stage } => EventKind::EmpowerInterrupt { stage },
            CombatKind::UnitDied { unconscious } => EventKind::Died { unconscious },
            CombatKind::UnitDestroyed => EventKind::Destroyed,
            CombatKind::PartyKill => EventKind::PartyKill,
        }
    }
}
