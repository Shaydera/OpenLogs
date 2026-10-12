use std::collections::HashMap;

use crate::actors::{ActorId, ActorKind, NOBODY};
use crate::fight::{Damage, DamageVia, Event, EventKind, Fight, FightKind};
use openlogs_gamedata::Curated;
use openlogs_index::Outcome;

/// Gaps in the boss HP data at least this long are intermissions.
pub const MIN_INTERMISSION_MS: u32 = 15_000;

/// Whether a damage event counts as damage done: support shares repeat the buffed
/// player's hit, the landed melee copy repeats the swing, and splits move damage around.
pub fn counts_as_damage_done(damage: &Damage) -> bool {
    damage.supporter == NOBODY && !matches!(damage.via, DamageVia::SwingLanded | DamageVia::Split)
}

/// Damage done counts absorbed damage as well.
pub fn damage_done_amount(damage: &Damage) -> u64 {
    damage.amount + damage.absorbed
}

fn is_npc(fight: &Fight, actor: ActorId) -> bool {
    !matches!(
        fight.actors.get(actor).kind,
        ActorKind::Player | ActorKind::Nobody
    )
}

/// Whether the event's target was a hostile, non-player unit when the event happened.
pub fn hits_hostile_npc(fight: &Fight, event: &Event) -> bool {
    event.target_hostile
        && is_npc(fight, event.target)
        && fight.actors.credited_player(event.target).is_none()
}

/// Non-kills shorter than this are aborted pulls: no boss, no phases.
pub const ABORTED_PULL_MS: u64 = 10_000;

/// Whether the pull was aborted: not a kill and shorter than [`ABORTED_PULL_MS`]. The UI
/// uses the same rule for its "Aborted" chip and the "Hide aborted pulls" toggle.
pub fn is_aborted(fight: &Fight) -> bool {
    fight.outcome != Outcome::Kill && fight.duration_ms < ABORTED_PULL_MS
}

/// Boss candidates: hostile units that took at least a fifth of the damage of the
/// most-damaged unit and have at least a quarter of the largest max HP. Councils yield
/// several bosses; untouched encounter NPCs and small adds are excluded. A Mythic+ run has
/// none: its boss pulls do.
pub fn boss_units(fight: &Fight) -> Vec<ActorId> {
    if is_aborted(fight) || fight.kind == FightKind::Run {
        return Vec::new();
    }
    let mut taken: HashMap<ActorId, u64> = HashMap::new();
    let mut max_hp: HashMap<ActorId, u64> = HashMap::new();
    for event in &fight.events {
        if let EventKind::Damage(damage) = event.kind
            && counts_as_damage_done(&damage)
            && hits_hostile_npc(fight, event)
        {
            *taken.entry(event.target).or_default() += damage.amount;
        }
        if let Some(hp) = event.unit_hp
            && is_npc(fight, hp.actor)
        {
            let entry = max_hp.entry(hp.actor).or_default();
            *entry = (*entry).max(hp.max);
        }
    }
    let Some(top_damage) = taken.values().copied().max().filter(|&d| d > 0) else {
        return Vec::new();
    };
    // Only units hit while hostile compete for the largest max HP.
    let top_max = taken
        .keys()
        .filter_map(|actor| max_hp.get(actor))
        .copied()
        .max()
        .unwrap_or(0);
    let mut bosses: Vec<ActorId> = taken
        .iter()
        .filter(|&(actor, &damage)| {
            let max = max_hp.get(actor).copied().unwrap_or(0);
            max > 0 && damage.saturating_mul(5) >= top_damage && max.saturating_mul(4) >= top_max
        })
        .map(|(&actor, _)| actor)
        .collect();
    bosses.sort_unstable();
    bosses
}

fn step_count(duration_ms: u64, step_ms: u32) -> usize {
    (duration_ms.div_ceil(u64::from(step_ms))).max(1) as usize
}

/// Aggregated boss HP percent per step; `None` where no boss reported HP in that step.
/// A living boss that has not reported HP for [`MIN_INTERMISSION_MS`] drops out of the
/// aggregate (it despawned or went inactive); dead bosses keep counting as 0 %.
pub fn boss_hp_series(fight: &Fight, bosses: &[ActorId], step_ms: u32) -> Vec<Option<f32>> {
    let mut values = vec![None; step_count(fight.duration_ms, step_ms)];
    // Per boss: current HP, max HP and when it last reported.
    let mut latest: HashMap<ActorId, (u64, u64, i32)> = HashMap::new();
    for event in &fight.events {
        let mut changed = false;
        if let Some(hp) = event.unit_hp
            && bosses.contains(&hp.actor)
        {
            latest.insert(hp.actor, (hp.current, hp.max, event.t));
            changed = true;
        }
        if let EventKind::Died { .. } = event.kind
            && let Some(hp) = latest.get_mut(&event.target)
        {
            hp.0 = 0;
            changed = true;
        }
        if !changed || event.t < 0 {
            continue;
        }
        let index = (event.t as u64 / u64::from(step_ms)) as usize;
        if index >= values.len() {
            continue;
        }
        let stale_before = event.t.saturating_sub(MIN_INTERMISSION_MS as i32);
        let (current, max) = latest
            .values()
            .filter(|&&(cur, _, seen)| cur == 0 || seen >= stale_before)
            .fold((0u64, 0u64), |(c, m), &(cur, mx, _)| (c + cur, m + mx));
        if max > 0 {
            values[index] = Some((current as f64 * 100.0 / max as f64) as f32);
        }
    }
    values
}

/// Damage per second credited to players (including their pets) against hostile units.
pub fn raid_dps_series(fight: &Fight, step_ms: u32) -> Vec<f64> {
    let mut totals = vec![0u64; step_count(fight.duration_ms, step_ms)];
    for event in &fight.events {
        let EventKind::Damage(damage) = event.kind else {
            continue;
        };
        if event.t < 0 || !counts_as_damage_done(&damage) || !hits_hostile_npc(fight, event) {
            continue;
        }
        if fight.actors.credited_player(event.source).is_none() {
            continue;
        }
        let index = (event.t as u64 / u64::from(step_ms)) as usize;
        if let Some(total) = totals.get_mut(index) {
            *total += damage_done_amount(&damage);
        }
    }
    // The last bucket is only as long as what is left of the pull.
    let step = u64::from(step_ms);
    totals
        .into_iter()
        .enumerate()
        .map(|(i, total)| {
            let len = step
                .min(fight.duration_ms.saturating_sub(i as u64 * step))
                .max(1);
            total as f64 * 1000.0 / len as f64
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhaseKind {
    Boss,
    Intermission,
    /// Time between the boss pulls of a Mythic+ run.
    Trash,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Phase {
    pub kind: PhaseKind,
    /// 1-based, counted per kind: Boss 1, Intermission 1, Boss 2, …
    pub number: u32,
    pub start_ms: u32,
    pub end_ms: u32,
    /// Name from a phase config, or the boss of a run's boss phase; `None` for detected
    /// phases and trash.
    pub name: Option<String>,
}

/// Splits the fight at gaps of at least [`MIN_INTERMISSION_MS`] in the boss HP data that
/// have data on both sides: an untargetable boss means an intermission.
pub fn detect_phases(boss_hp: &[Option<f32>], step_ms: u32, duration_ms: u32) -> Vec<Phase> {
    let Some(first) = boss_hp.iter().position(Option::is_some) else {
        return Vec::new();
    };
    let last = boss_hp.iter().rposition(Option::is_some).unwrap_or(first);
    let min_steps = MIN_INTERMISSION_MS.div_ceil(step_ms) as usize;

    let mut gaps = Vec::new();
    let mut index = first;
    while index <= last {
        if boss_hp[index].is_none() {
            let start = index;
            while index <= last && boss_hp[index].is_none() {
                index += 1;
            }
            if index - start >= min_steps {
                gaps.push((start as u32 * step_ms, index as u32 * step_ms));
            }
        } else {
            index += 1;
        }
    }

    let mut phases = Vec::new();
    let mut cursor = 0;
    for (number, (start, end)) in gaps.into_iter().enumerate() {
        let number = number as u32 + 1;
        phases.push(Phase {
            kind: PhaseKind::Boss,
            number,
            start_ms: cursor,
            end_ms: start,
            name: None,
        });
        phases.push(Phase {
            kind: PhaseKind::Intermission,
            number,
            start_ms: start,
            end_ms: end,
            name: None,
        });
        cursor = end;
    }
    let boss_phases = phases.len() as u32 / 2 + 1;
    phases.push(Phase {
        kind: PhaseKind::Boss,
        number: boss_phases,
        start_ms: cursor,
        end_ms: duration_ms,
        name: None,
    });
    phases
}

/// Detected phases with the configured names of their encounter (`phase_names.json`, empty
/// unless the user fills it in the override folder): every intermission takes the encounter's
/// intermission name; boss phases keep their number.
pub fn name_detected_phases(
    mut phases: Vec<Phase>,
    encounter_id: u32,
    curated: &Curated,
) -> Vec<Phase> {
    if let Some(name) = curated.intermission_name(encounter_id) {
        for phase in phases
            .iter_mut()
            .filter(|phase| phase.kind == PhaseKind::Intermission)
        {
            phase.name = Some(name.to_string());
        }
    }
    phases
}
