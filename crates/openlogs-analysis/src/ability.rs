use std::collections::HashMap;

use openlogs_gamedata::Curated;

use crate::actors::ActorId;
use crate::auras::{aura_intervals, union_ms};
use crate::casts::non_press_casts;
use crate::deaths::deaths;
use crate::fight::{EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::links::spell_key;
use crate::player::{Metric, is_player};
use crate::reports::damage::damage_done_in;
use crate::reports::healing::healing_in;
use crate::reports::{Share, damage_share, healing_share};
use crate::scope::{Scope, unit_of};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AbilityHit {
    pub t: i32,
    pub target: ActorId,
    pub amount: u64,
    pub critical: bool,
    pub periodic: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetHits {
    pub name: String,
    pub hits: u32,
    pub crits: u32,
    pub amount: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AbilityDetail {
    pub player: ActorId,
    pub spell: SpellId,
    /// Pet name for pet abilities; `None` for the player's own.
    pub pet: Option<String>,
    pub metric: Metric,
    pub start_ms: i32,
    pub end_ms: i32,
    pub total: u64,
    /// The player's total in the current mode; the base of the ability's share.
    pub player_total: u64,
    pub casts: Vec<i32>,
    pub hits: Vec<AbilityHit>,
    /// Hits grouped by target name, largest first; empty while a target is selected.
    pub by_target: Vec<TargetHits>,
    pub median: u64,
    /// Aura uptime on any target, for abilities that mostly tick (DoTs, HoTs).
    pub uptime: Option<f64>,
    /// The player's dead phases, clipped to the range.
    pub dead: Vec<(i32, i32)>,
}

/// The unit's name, or its GUID when the log had none.
pub(crate) fn unit_name(fight: &Fight, id: ActorId) -> String {
    let actor = fight.actors.get(id);
    actor.name.clone().unwrap_or_else(|| actor.guid.clone())
}

/// The player itself (`pet = None`) or the player's pets of that name.
fn caster_matches(fight: &Fight, player: ActorId, actor: ActorId, pet: Option<&str>) -> bool {
    match pet {
        None => actor == player,
        Some(name) => {
            actor != player
                && fight.actors.credited_player(actor) == Some(player)
                // Nameless pets arrive as `""` (their row's actor name).
                && fight.actors.get(actor).name.as_deref().unwrap_or("") == name
        }
    }
}

/// The page's subject is the player's ability; of `scope`, only the target selection applies:
/// to the hits, the player's total and the by-target block.
#[allow(clippy::too_many_arguments)]
pub fn ability_detail(
    fight: &Fight,
    curated: &Curated,
    player: ActorId,
    spell: SpellId,
    pet: Option<&str>,
    metric: Metric,
    filter: &ReportFilter,
    scope: &Scope,
) -> Option<AbilityDetail> {
    if !is_player(fight, player) {
        return None;
    }
    let targets = Scope {
        target: scope.target.clone(),
        ..Scope::default()
    };
    let (start_ms, end_ms) = filter.clipped(fight);
    // The player's own ability is every spell of its name (the merged row of the player page);
    // a pet's stays its one ID.
    let key = spell_key(fight, spell);
    let same_spell = |other: SpellId| {
        if pet.is_none() {
            spell_key(fight, other) == key
        } else {
            other == spell
        }
    };
    // The player's own casts count presses (no procs, no follow-up casts of multi-ID spells).
    let not_pressed = if pet.is_none() {
        non_press_casts(fight, curated, player)
    } else {
        Default::default()
    };
    let mut hits = Vec::new();
    let mut casts = Vec::new();
    for (i, event) in fight
        .events
        .iter()
        .enumerate()
        .filter(|(_, e)| filter.contains(e.t))
    {
        if matches!(event.kind, EventKind::CastSuccess) {
            if same_spell(event.spell)
                && caster_matches(fight, player, event.source, pet)
                && !not_pressed.contains(&i)
            {
                casts.push(event.t);
            }
            continue;
        }
        let share = match metric {
            Metric::Damage => damage_share(fight, event, filter.overkill),
            Metric::Healing => healing_share(fight, event),
        };
        if let Some(Share::Own {
            player: p,
            actor,
            spell: s,
            amount,
            critical,
            periodic,
            ..
        }) = share
            && p == player
            && same_spell(s)
            && caster_matches(fight, player, actor, pet)
            && targets.accepts(fight, None, None, Some(&unit_of(fight, event.target)))
        {
            hits.push(AbilityHit {
                t: event.t,
                target: event.target,
                amount,
                critical,
                periodic,
            });
        }
    }

    let total = hits.iter().map(|h| h.amount).sum();
    let player_total = match metric {
        Metric::Damage => damage_done_in(fight, filter, &targets)
            .players
            .iter()
            .find(|p| p.player == player)
            .map_or(0, |p| p.total),
        Metric::Healing => healing_in(fight, filter, &targets)
            .players
            .iter()
            .find(|p| p.player == player)
            .map_or(0, |p| p.total),
    };

    let mut groups: HashMap<String, TargetHits> = HashMap::new();
    for hit in &hits {
        let name = unit_name(fight, hit.target);
        let entry = groups.entry(name.clone()).or_insert(TargetHits {
            name,
            hits: 0,
            crits: 0,
            amount: 0,
        });
        entry.hits += 1;
        entry.crits += u32::from(hit.critical);
        entry.amount += hit.amount;
    }
    let mut by_target: Vec<TargetHits> = if targets.selects_all() {
        groups.into_values().collect()
    } else {
        Vec::new()
    };
    by_target.sort_by(|a, b| b.amount.cmp(&a.amount).then_with(|| a.name.cmp(&b.name)));

    let mut amounts: Vec<u64> = hits.iter().map(|h| h.amount).collect();
    amounts.sort_unstable();
    let median = match amounts.len() {
        0 => 0,
        n if n % 2 == 1 => amounts[n / 2],
        n => (amounts[n / 2 - 1] + amounts[n / 2]) / 2,
    };

    let periodic = hits.iter().filter(|h| h.periodic).count();
    // Ticks without an aura (totems, ground effects) have no uptime at all.
    let uptime = (periodic * 2 > hits.len() && end_ms > start_ms)
        .then(|| {
            let intervals: Vec<(i32, i32)> = aura_intervals(fight)
                .into_iter()
                .filter(|i| i.spell == spell && caster_matches(fight, player, i.source, pet))
                .map(|i| (i.start_ms, i.end_ms))
                .collect();
            (!intervals.is_empty()).then(|| {
                union_ms(&intervals, start_ms, end_ms) as f64 / f64::from(end_ms - start_ms)
            })
        })
        .flatten();

    let dead = deaths(fight)
        .into_iter()
        .filter(|d| d.player == player)
        .map(|d| {
            (
                d.t.max(start_ms),
                d.dead_until.unwrap_or(end_ms).min(end_ms),
            )
        })
        .filter(|(a, b)| b > a)
        .collect();

    Some(AbilityDetail {
        player,
        spell,
        pet: pet.map(str::to_string),
        metric,
        start_ms,
        end_ms,
        total,
        player_total,
        casts,
        hits,
        by_target,
        median,
        uptime,
        dead,
    })
}
