use std::collections::{HashMap, HashSet};

use crate::ability::unit_name;
use crate::actors::{ActorId, ActorKind};
use crate::fight::{EventKind, Fight};
use crate::filter::{Overkill, ReportFilter};
use crate::reports::damage::damage_done_in;
use crate::reports::{Share, damage_share, keeps_own};
use crate::scope::{Scope, UnitRef};
use crate::timeline::boss_units;
use openlogs_index::Outcome;

/// Units first hit less than this after the previous unit belong to the same wave.
pub const WAVE_GAP_MS: i32 = 6_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnemyGroup {
    pub name: String,
    pub units: u32,
    /// Damage done to these units in the range.
    pub damage_taken: u64,
    pub is_boss: bool,
    /// The encounter's main boss (named like the fight, else the boss unit with the most HP):
    /// the boss portrait belongs to this group.
    pub primary: bool,
    /// Same max HP as the primary boss: probably a shared health pool.
    pub shares_boss_hp: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnitLife {
    pub actor: ActorId,
    pub first_hit: i32,
    pub last_hit: i32,
    pub death: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Wave {
    pub start_ms: i32,
    pub units: u32,
    pub killed: u32,
    /// From the wave's first hit to its last death (or last hit).
    pub clear_ms: i32,
    /// Mean lifetime of the killed units.
    pub avg_life_ms: Option<i32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TargetDetail {
    pub name: String,
    pub start_ms: i32,
    pub end_ms: i32,
    pub damage_taken: u64,
    /// Damage done to all enemies in the range.
    pub raid_damage: u64,
    pub max_hp: Option<u64>,
    pub is_boss: bool,
    /// The encounter's main boss (named like the fight, else the boss unit with the most HP):
    /// the boss portrait belongs to this group.
    pub primary: bool,
    pub shares_boss_hp: bool,
    pub units: Vec<UnitLife>,
    pub waves: Vec<Wave>,
    /// Damage on this enemy by player in the current mode; empty while a source is selected.
    pub by_player: Vec<(ActorId, u64)>,
}

/// Damage done per unit with its first and last hit, for events the filter and `scope` keep.
pub(crate) fn hits_by_unit(
    fight: &Fight,
    keep: impl Fn(i32) -> bool,
    overkill: Overkill,
    scope: &Scope,
) -> HashMap<ActorId, (u64, i32, i32)> {
    let mut units: HashMap<ActorId, (u64, i32, i32)> = HashMap::new();
    for event in fight.events.iter().filter(|e| keep(e.t)) {
        if let Some(Share::Own {
            amount,
            actor,
            spell,
            ..
        }) = damage_share(fight, event, overkill)
            && keeps_own(fight, scope, actor, spell, event.target)
        {
            let entry = units.entry(event.target).or_insert((0, event.t, event.t));
            entry.0 += amount;
            entry.1 = entry.1.min(event.t);
            entry.2 = entry.2.max(event.t);
        }
    }
    units
}

fn max_hp_by_unit(fight: &Fight) -> HashMap<ActorId, u64> {
    let mut hp: HashMap<ActorId, u64> = HashMap::new();
    for snapshot in fight.events.iter().filter_map(|e| e.unit_hp) {
        let entry = hp.entry(snapshot.actor).or_default();
        *entry = (*entry).max(snapshot.max);
    }
    hp
}

struct Bosses {
    units: Vec<ActorId>,
    names: HashSet<String>,
    primary_name: Option<String>,
    primary_hp: Option<u64>,
}

impl Bosses {
    /// Same max HP as the primary boss but another unit: probably a shared health pool.
    fn shares_hp(&self, name: &str, max_hp: Option<u64>) -> bool {
        max_hp.is_some() && max_hp == self.primary_hp && self.primary_name.as_deref() != Some(name)
    }
}

fn bosses(fight: &Fight, hp: &HashMap<ActorId, u64>) -> Bosses {
    let units = boss_units(fight);
    let names: HashSet<String> = units.iter().map(|&u| unit_name(fight, u)).collect();
    let primary = units
        .iter()
        .copied()
        .find(|&u| unit_name(fight, u) == fight.name)
        .or_else(|| {
            units
                .iter()
                .copied()
                .max_by_key(|u| (hp.get(u).copied().unwrap_or(0), std::cmp::Reverse(*u)))
        });
    Bosses {
        names,
        primary_name: primary.map(|u| unit_name(fight, u)),
        primary_hp: primary.and_then(|u| hp.get(&u).copied()),
        units,
    }
}

fn group_max_hp(units: impl Iterator<Item = ActorId>, hp: &HashMap<ActorId, u64>) -> Option<u64> {
    units.filter_map(|u| hp.get(&u).copied()).max()
}

pub fn enemy_groups(fight: &Fight, filter: &ReportFilter) -> Vec<EnemyGroup> {
    let hits = hits_by_unit(
        fight,
        |t| filter.contains(t),
        filter.overkill,
        &Scope::default(),
    );
    let hp = max_hp_by_unit(fight);
    let bosses = bosses(fight, &hp);
    let mut groups: HashMap<String, (Vec<ActorId>, u64)> = HashMap::new();
    for (&unit, &(damage, _, _)) in &hits {
        let entry = groups.entry(unit_name(fight, unit)).or_default();
        entry.0.push(unit);
        entry.1 += damage;
    }
    let mut out: Vec<EnemyGroup> = groups
        .into_iter()
        .map(|(name, (units, damage_taken))| {
            let is_boss = bosses.names.contains(&name);
            let max_hp = group_max_hp(units.iter().copied(), &hp);
            let primary = bosses.primary_name.as_deref() == Some(name.as_str());
            EnemyGroup {
                primary,
                shares_boss_hp: bosses.shares_hp(&name, max_hp),
                is_boss,
                units: units.len() as u32,
                damage_taken,
                name,
            }
        })
        .collect();
    out.sort_by(|a, b| {
        b.damage_taken
            .cmp(&a.damage_taken)
            .then_with(|| a.name.cmp(&b.name))
    });
    out
}

fn waves(units: &[UnitLife]) -> Vec<Wave> {
    let mut out = Vec::new();
    let mut start = 0;
    for i in 1..=units.len() {
        if i < units.len() && units[i].first_hit - units[i - 1].first_hit < WAVE_GAP_MS {
            continue;
        }
        let wave = &units[start..i];
        let lives: Vec<i32> = wave
            .iter()
            .filter_map(|u| u.death.map(|d| d - u.first_hit))
            .collect();
        let first = wave[0].first_hit;
        out.push(Wave {
            start_ms: first,
            units: wave.len() as u32,
            killed: lives.len() as u32,
            clear_ms: wave
                .iter()
                .map(|u| u.death.unwrap_or(u.last_hit))
                .max()
                .unwrap_or(first)
                - first,
            avg_life_ms: (!lives.is_empty()).then(|| {
                (lives.iter().map(|&l| i64::from(l)).sum::<i64>() / lives.len() as i64) as i32
            }),
        });
        start = i;
    }
    out
}

/// The page's subject is every enemy of one name; of `scope`, the source and ability selections
/// apply to the damage taken, its share of the raid's and the by-player block.
pub fn target_detail(
    fight: &Fight,
    name: &str,
    filter: &ReportFilter,
    scope: &Scope,
) -> Option<TargetDetail> {
    let known = fight
        .actors
        .iter()
        .any(|a| a.kind != ActorKind::Player && a.name.as_deref() == Some(name));
    if !known {
        return None;
    }
    let (start_ms, end_ms) = filter.clipped(fight);
    let pull_end = fight.duration_ms.min(i32::MAX as u64) as i32;
    let hp = max_hp_by_unit(fight);
    let bosses = bosses(fight, &hp);
    let rest = Scope {
        target: Vec::new(),
        ..scope.clone()
    };
    let in_range = hits_by_unit(fight, |t| filter.contains(t), filter.overkill, &rest);
    let whole = hits_by_unit(fight, |t| t >= 0, filter.overkill, &Scope::default());

    let mut deaths: HashMap<ActorId, i32> = HashMap::new();
    for event in &fight.events {
        if matches!(event.kind, EventKind::Died { .. }) && whole.contains_key(&event.target) {
            deaths.entry(event.target).or_insert(event.t);
        }
    }
    let mut units: Vec<UnitLife> = whole
        .iter()
        .filter(|&(&unit, _)| unit_name(fight, unit) == name)
        .map(|(&actor, &(_, first_hit, last_hit))| UnitLife {
            actor,
            first_hit,
            last_hit,
            // A boss's UNIT_DIED is logged just after ENCOUNTER_END, outside the slice.
            death: deaths
                .get(&actor)
                .copied()
                .filter(|&d| d >= first_hit)
                .or_else(|| {
                    (fight.outcome == Outcome::Kill && bosses.units.contains(&actor))
                        .then_some(pull_end)
                }),
        })
        .filter(|u| u.first_hit < end_ms && u.death.unwrap_or(u.last_hit) >= start_ms)
        .collect();
    units.sort_by_key(|u| (u.first_hit, u.actor));

    let ours: HashSet<ActorId> = whole
        .keys()
        .copied()
        .filter(|&u| unit_name(fight, u) == name)
        .collect();
    let damage_taken = in_range
        .iter()
        .filter(|(u, _)| ours.contains(u))
        .map(|(_, &(d, _, _))| d)
        .sum();
    let raid_damage = in_range.values().map(|&(d, _, _)| d).sum();

    let on_this = Scope {
        target: vec![UnitRef::Unit(name.to_string())],
        ..rest
    };
    let by_player = if scope.source.is_empty() {
        damage_done_in(fight, filter, &on_this)
            .players
            .iter()
            .map(|p| (p.player, p.total))
            .collect()
    } else {
        Vec::new()
    };

    let is_boss = bosses.names.contains(name);
    let max_hp = group_max_hp(ours.iter().copied(), &hp);
    Some(TargetDetail {
        primary: bosses.primary_name.as_deref() == Some(name),
        name: name.to_string(),
        start_ms,
        end_ms,
        damage_taken,
        raid_damage,
        max_hp,
        is_boss,
        shares_boss_hp: bosses.shares_hp(name, max_hp),
        waves: waves(&units),
        units,
        by_player,
    })
}
