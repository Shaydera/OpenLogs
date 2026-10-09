use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::io;
use std::path::Path;

use openlogs_index::FightSummary;
use openlogs_parser::{
    CombatEvent, CombatKind, Event as LogEvent, HealVia, Lines, LogLine, Spell, Timestamp,
    parse_line,
};

use crate::actors::{ActorId, ActorKind, Actors, NOBODY};
use crate::fight::{
    Absorbed, Damage, Energize, Event, EventKind, Fight, Heal, MissType, Missed, NO_SPELL,
    POWER_SAMPLE_MS, PowerSample, SpellId, SpellInfo, UnitHp,
};

/// Loads one fight, including its prelude, from the complete log bytes.
pub fn load_fight(data: &[u8], summary: &FightSummary) -> Fight {
    let clamp = |offset: u64| usize::try_from(offset).map_or(data.len(), |o| o.min(data.len()));
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
}

impl FightBuilder {
    fn new(summary: &FightSummary) -> Self {
        Self {
            start: summary.start,
            fight: Fight {
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
            },
            last_power: HashMap::new(),
        }
    }

    fn push(&mut self, line: &LogLine<'_>) {
        match &line.event {
            LogEvent::CombatantInfo(info) => {
                let id = self.fight.actors.intern_guid(info.guid);
                self.fight.actors.set_spec(id, info.spec_id);
            }
            LogEvent::Combat(event) => {
                let t = self.relative_ms(line.timestamp);
                let converted = self.convert(t, event);
                self.fight.events.push(converted);
            }
            _ => {}
        }
    }

    fn finish(mut self) -> Fight {
        self.fight.events.sort_by_key(|event| event.t);
        self.fight.power.sort_by_key(|p| p.t);
        self.fight
    }

    fn relative_ms(&self, timestamp: Timestamp) -> i32 {
        ((timestamp.0 - self.start.0) / 1_000).clamp(i64::from(i32::MIN), i64::from(i32::MAX))
            as i32
    }

    fn convert(&mut self, t: i32, event: &CombatEvent<'_>) -> Event {
        let actors = &mut self.fight.actors;
        let source = actors.intern(&event.source);
        let target = actors.intern(&event.target);
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
            CombatKind::CastFailed { .. } => EventKind::CastFailed,
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
