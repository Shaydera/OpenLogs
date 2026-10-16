use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::io;
use std::path::Path;

use openlogs_index::{FightSummary, Outcome};
use openlogs_parser::{
    CombatEvent, CombatKind, EncounterEnd, EncounterStart, Event as LogEvent, HealVia, Lines,
    LogLine, Spell, Timestamp, parse_line,
};

use crate::actors::{ActorId, ActorKind, Actors, NOBODY};
use crate::fight::{
    Absorbed, Damage, Energize, Event, EventKind, FailReason, Fight, FightKind, Heal,
    MarkerInterval, MissType, Missed, NO_SPELL, POWER_SAMPLE_MS, PositionSample, PowerSample,
    RunEncounter, SpellId, SpellInfo, UnitHp, WorldMarkerInterval,
};

/// Loads one fight, including its prelude, from the complete log bytes.
pub fn load_fight(data: &[u8], summary: &FightSummary) -> Fight {
    load_fight_slice(data, 0, summary)
}

/// Loads one fight from a part of the log that starts at byte `base_offset` and covers the
/// fight from its prelude to its end.
pub fn load_fight_slice(data: &[u8], base_offset: u64, summary: &FightSummary) -> Fight {
    let clamp = |offset: u64| {
        usize::try_from(offset.saturating_sub(base_offset))
            .map_or(data.len(), |o| o.min(data.len()))
    };
    let start = clamp(summary.prelude_offset);
    let end = clamp(summary.end_offset).max(start);
    let mut builder = FightBuilder::new(summary);
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
    builder.finish()
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
    /// Index into `fight.raid_markers` of each actor's interval still open.
    open_raid_markers: HashMap<ActorId, usize>,
    /// Index into `fight.world_markers` of each marker's interval still open.
    open_world_markers: HashMap<u8, usize>,
}

impl FightBuilder {
    fn new(summary: &FightSummary) -> Self {
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
                actors: Actors::new(),
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
            },
            last_power: HashMap::new(),
            last_t: i32::MIN,
            encounter_open: false,
            instance_id: summary.instance_id,
            run_end_t: None,
            resume_t: None,
            map_samples: HashMap::new(),
            open_raid_markers: HashMap::new(),
            open_world_markers: summary
                .world_markers
                .iter()
                .enumerate()
                .map(|(index, marker)| (marker.marker, index))
                .collect(),
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
        self.fight.positions.sort_by_key(|p| p.t);
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

    fn relative_ms(&self, timestamp: Timestamp) -> i32 {
        ((timestamp.0 - self.start.0) / 1_000).clamp(i64::from(i32::MIN), i64::from(i32::MAX))
            as i32
    }

    fn convert(&mut self, t: i32, event: &CombatEvent<'_>) -> Event {
        let actors = &mut self.fight.actors;
        let source = actors.intern(&event.source);
        let target = actors.intern(&event.target);
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
            && self.fight.actors.get(hp.actor).kind == ActorKind::Player
        {
            for power in info.powers() {
                self.note_power(t, hp.actor, power);
            }
        }
        if let (Some(info), Some(hp)) = (event.advanced, unit_hp)
            && hp.actor != NOBODY
            && (info.x != 0.0 || info.y != 0.0 || info.ui_map_id != 0)
        {
            self.fight.positions.push(PositionSample {
                t,
                actor: hp.actor,
                x: info.x,
                y: info.y,
                facing: info.facing,
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

    fn note_power(&mut self, t: i32, actor: ActorId, power: openlogs_parser::Power) {
        let key = (actor, power.power_type);
        if self
            .last_power
            .get(&key)
            .is_some_and(|&last| (t - last).abs() < POWER_SAMPLE_MS)
        {
            return;
        }
        self.last_power.insert(key, t);
        self.fight.power.push(PowerSample {
            t,
            actor,
            power_type: power.power_type,
            current: power.current,
            max: power.max,
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
            }),
            CombatKind::Missed(m) => EventKind::Missed(Missed {
                via: m.via,
                miss_type: MissType::from_log(m.miss_type),
                amount_missed: m.amount_missed.unwrap_or(0),
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
                    absorb_spell: self.spell(a.absorb_spell),
                    amount: a.amount,
                    supporter: self.actor(a.supporter),
                })
            }
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
