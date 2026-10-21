use std::collections::{HashMap, HashSet};

use crate::actors::{ActorId, ActorKind};
use crate::fight::{DamageVia, Event, EventKind, Fight, FightKind, SpellId, UnitHp};
use crate::phases::run_phases;
use crate::timeline::is_distinct_hit;

/// Look-back window of the death context.
pub const DEATH_WINDOW_MS: i32 = 5_000;

/// Hits of the killing spell at most this far apart belong to the lethal burst.
pub const BURST_GAP_MS: i32 = 2_000;

/// Spells a dead player casts to revive themselves; they log no `SPELL_RESURRECT`.
const SELF_RESURRECTS: &[SpellId] = &[
    21169, // Reincarnation
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hit {
    pub t: i32,
    /// `NO_SPELL` for melee.
    pub spell: SpellId,
    /// `NOBODY` for environmental or source-less damage.
    pub source: ActorId,
    pub amount: u64,
    pub overkill: u64,
    /// Falling, lava, drowning and other world damage.
    pub environmental: bool,
    /// A damage-over-time tick (`SPELL_PERIODIC_DAMAGE`): without a source it is a debuff whose
    /// caster is gone (Deadly Venom).
    pub periodic: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AbilityAmount {
    pub spell: SpellId,
    pub amount: u64,
    /// Falling, lava, drowning and other world damage; kept apart from melee (both spell 0).
    pub environmental: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Resurrection {
    pub spell: SpellId,
    /// The caster; the player itself for Reincarnation, `NOBODY` when the log names none.
    pub source: ActorId,
}

/// The killing blow's spell hitting in a row before the death ("2× Virulent Spit within 1.0 s").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LethalBurst {
    pub spell: SpellId,
    /// Hits of the spell in the burst, the killing blow included.
    pub count: u32,
    /// From the burst's first hit to the killing blow.
    pub window_ms: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Death {
    pub player: ActorId,
    pub t: i32,
    /// When this life began: 0, a run segment's start or the return from a previous death.
    pub life_start_ms: i32,
    /// The player's last sample at full HP within this life; `None` without one.
    pub last_full_hp_ms: Option<i32>,
    /// `None` when the log holds no lethal hit (no overkill, no 0 HP, no instakill).
    pub killing_blow: Option<Hit>,
    /// Damage taken in the last 5 s by spell, largest first.
    pub damage_last_5s: Vec<AbilityAmount>,
    pub damage_taken_5s: u64,
    /// Effective healing (without overheal) in the last 5 s.
    pub healing_taken_5s: u64,
    pub hp_5s_before_pct: Option<f32>,
    pub resurrected_at: Option<i32>,
    /// The spell and caster that ended this death.
    pub resurrected_by: Option<Resurrection>,
    /// When the player was alive again: the resurrect, else (a released Mythic+ player logs
    /// none) the first own HP snapshot above 0 or the next run segment's start, whichever comes
    /// first. `None`: dead to the end of the fight.
    pub dead_until: Option<i32>,
    /// `None` without a killing blow or for an instakill.
    pub lethal_burst: Option<LethalBurst>,
}

/// Player deaths from `ENCOUNTER_START` on, one per life.
pub fn deaths(fight: &Fight) -> Vec<Death> {
    let mut result: Vec<Death> = Vec::new();
    let mut dead: HashSet<ActorId> = HashSet::new();
    let mut last_death: HashMap<ActorId, usize> = HashMap::new();
    // When the current life began: the last resurrect (0 for the first life).
    let mut alive_since: HashMap<ActorId, i32> = HashMap::new();
    // Segment starts of a run (boss and trash phases); a pull has one segment from 0.
    let segment_starts: Vec<i32> = if fight.kind == FightKind::Run {
        run_phases(fight)
            .iter()
            .map(|phase| phase.start_ms as i32)
            .filter(|&start| start > 0)
            .collect()
    } else {
        Vec::new()
    };
    let mut next_segment = 0;
    for event in &fight.events {
        while next_segment < segment_starts.len() && segment_starts[next_segment] <= event.t {
            let at = segment_starts[next_segment];
            for player in dead.drain() {
                alive_since.insert(player, at);
                if let Some(&index) = last_death.get(&player) {
                    revive(&mut result[index], at);
                }
            }
            next_segment += 1;
        }
        // Damage and casts of a dead player still land (projectiles, queued casts); only a
        // snapshot with HP shows him alive.
        if let Some(hp) = event.unit_hp
            && hp.current > 0
            && dead.remove(&hp.actor)
        {
            alive_since.insert(hp.actor, event.t);
            if let Some(&index) = last_death.get(&hp.actor) {
                revive(&mut result[index], event.t);
            }
        }
        let is_player = fight.actors.get(event.target).kind == ActorKind::Player;
        match event.kind {
            // Feign Death logs an "unconscious" death; the hunter is still alive.
            EventKind::Died { unconscious: false }
                if is_player && event.t >= 0 && dead.insert(event.target) =>
            {
                last_death.insert(event.target, result.len());
                let life_start = alive_since.get(&event.target).copied().unwrap_or(0);
                result.push(death_at(fight, event.target, event.t, life_start));
            }
            EventKind::Resurrect if is_player && dead.remove(&event.target) => {
                alive_since.insert(event.target, event.t);
                if let Some(&index) = last_death.get(&event.target) {
                    resurrect(&mut result[index], event.t, event.spell, event.source);
                }
            }
            EventKind::CastSuccess
                if SELF_RESURRECTS.contains(&event.spell) && dead.remove(&event.source) =>
            {
                alive_since.insert(event.source, event.t);
                if let Some(&index) = last_death.get(&event.source) {
                    resurrect(&mut result[index], event.t, event.spell, event.source);
                }
            }
            _ => {}
        }
    }
    if let Some(&at) = segment_starts.get(next_segment) {
        for player in dead {
            if let Some(&index) = last_death.get(&player) {
                revive(&mut result[index], at);
            }
        }
    }
    result
}

/// The first resurrect of a death wins.
fn resurrect(death: &mut Death, t: i32, spell: SpellId, source: ActorId) {
    if death.resurrected_at.is_none() {
        death.resurrected_at = Some(t);
        death.resurrected_by = Some(Resurrection { spell, source });
        revive(death, t);
    }
}

/// The first sign of life ends a death.
fn revive(death: &mut Death, t: i32) {
    death.dead_until.get_or_insert(t);
}

pub(crate) fn death_at(fight: &Fight, player: ActorId, t: i32, life_start: i32) -> Death {
    let window_start = t - DEATH_WINDOW_MS;
    let first = fight
        .events
        .partition_point(|event| event.t <= window_start);
    let end = fight.events.partition_point(|event| event.t <= t);

    // The last lethal hit is the killing blow. 12.x logs often omit the lethal event;
    // the last hit before the death is then an innocent one and no killing blow.
    let mut killing_blow = None;
    let mut by_spell: HashMap<(SpellId, bool), u64> = HashMap::new();
    let mut healing = 0;
    let mut hits: Vec<(i32, SpellId, bool)> = Vec::new();
    for event in &fight.events[first..end] {
        if event.target != player {
            continue;
        }
        match event.kind {
            EventKind::Damage(damage) if is_distinct_hit(&damage) => {
                *by_spell
                    .entry((event.spell, damage.via == DamageVia::Environmental))
                    .or_default() += damage.amount;
                hits.push((event.t, event.spell, damage.via == DamageVia::Environmental));
                let left_at_zero = event
                    .unit_hp
                    .is_some_and(|hp| hp.actor == player && hp.current == 0);
                if damage.overkill > 0 || left_at_zero {
                    killing_blow = Some(Hit {
                        t: event.t,
                        spell: event.spell,
                        source: event.source,
                        amount: damage.amount,
                        overkill: damage.overkill,
                        environmental: damage.via == DamageVia::Environmental,
                        periodic: damage.via == DamageVia::Periodic,
                    });
                }
            }
            EventKind::Instakill => {
                killing_blow = Some(Hit {
                    t: event.t,
                    spell: event.spell,
                    source: event.source,
                    amount: 0,
                    overkill: 0,
                    environmental: false,
                    periodic: false,
                });
            }
            EventKind::Heal(heal) => healing += heal.amount.saturating_sub(heal.overheal),
            _ => {}
        }
    }

    // Walk back from the killing blow over hits of its spell that come close together.
    let lethal_burst = killing_blow.filter(|kb| kb.amount > 0).map(|kb| {
        let mut first = kb.t;
        let mut count = 0;
        for &(t, spell, environmental) in hits.iter().rev() {
            if t > kb.t || spell != kb.spell || environmental != kb.environmental {
                continue;
            }
            if first - t > BURST_GAP_MS {
                break;
            }
            first = t;
            count += 1;
        }
        LethalBurst {
            spell: kb.spell,
            count: count.max(1),
            window_ms: kb.t - first,
        }
    });

    let mut damage_last_5s: Vec<AbilityAmount> = by_spell
        .into_iter()
        .map(|((spell, environmental), amount)| AbilityAmount {
            spell,
            amount,
            environmental,
        })
        .collect();
    damage_last_5s.sort_by(|a, b| {
        b.amount
            .cmp(&a.amount)
            .then(a.spell.cmp(&b.spell))
            .then(a.environmental.cmp(&b.environmental))
    });
    let damage_taken_5s = damage_last_5s.iter().map(|a| a.amount).sum();

    // The last sample before the window within this life, else the first one inside it.
    let sample = |event: &Event| event.unit_hp.filter(|hp| hp.actor == player && hp.max > 0);
    let hp_5s_before_pct = fight.events[..first]
        .iter()
        .rev()
        .take_while(|event| event.t >= life_start)
        .find_map(sample)
        .or_else(|| {
            fight.events[first..end]
                .iter()
                .filter(|event| event.t >= life_start)
                .find_map(sample)
        })
        .map(hp_pct);
    let last_full_hp_ms = fight.events[..end]
        .iter()
        .rev()
        .take_while(|event| event.t >= life_start)
        .find(|event| sample(event).is_some_and(|hp| hp.current >= hp.max))
        .map(|event| event.t);

    Death {
        player,
        t,
        life_start_ms: life_start,
        last_full_hp_ms,
        killing_blow,
        damage_last_5s,
        damage_taken_5s,
        healing_taken_5s: healing,
        hp_5s_before_pct,
        resurrected_at: None,
        resurrected_by: None,
        dead_until: None,
        lethal_burst,
    }
}

/// HP percent of a snapshot, clamped: snapshots after a max-HP buff drops exceed 100 %.
pub(crate) fn hp_pct(hp: UnitHp) -> f32 {
    (hp.current as f64 * 100.0 / hp.max as f64).clamp(0.0, 100.0) as f32
}
