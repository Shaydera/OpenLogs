use std::collections::{HashMap, HashSet};

use crate::actors::{ActorId, ActorKind, NOBODY};
use crate::fight::{DamageVia, Event, EventKind, Fight, MissType, SpellId};
use crate::filter::{Overkill, ReportFilter};
use crate::links::{SpellKey, spell_key};
use crate::reports::per_second;
use crate::timeline::{damage_done_amount, is_distinct_hit};

#[derive(Debug, Clone, PartialEq)]
pub struct TakenAbility {
    /// The ID with the most damage; same-name IDs of one source are one row.
    pub spell: SpellId,
    /// Falling, lava, drowning and other world damage; kept apart from melee (both spell 0).
    pub environmental: bool,
    /// `None` for environmental or source-less damage.
    pub source_name: Option<String>,
    /// The source when it is a player (friendly fire, a player's debuff); `None` otherwise.
    pub source_player: Option<ActorId>,
    /// `amount + absorbed`.
    pub amount: u64,
    pub absorbed: u64,
    pub hits: u32,
    pub players_hit: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TakenPlayer {
    pub player: ActorId,
    pub amount: u64,
    pub absorbed: u64,
    pub per_second: f64,
    pub share: f64,
    /// The player's damage taken by spell and source, largest first (`players_hit` is 1).
    pub abilities: Vec<TakenAbility>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DamageTakenReport {
    pub duration_ms: u64,
    pub total: u64,
    pub by_ability: Vec<TakenAbility>,
    pub by_player: Vec<TakenPlayer>,
}

/// Spell name (ID without a known name), world-damage flag and source name: adds of one kind
/// share a row, and a spell logged under several IDs (Volatile Purge) is one row.
type AbilityKey<'a> = (SpellKey<'a>, bool, Option<String>);

#[derive(Default)]
struct AbilityAcc {
    amount: u64,
    absorbed: u64,
    hits: u32,
    victims: HashSet<ActorId>,
    source_player: Option<ActorId>,
    by_spell: HashMap<SpellId, u64>,
}

impl AbilityAcc {
    fn add(
        &mut self,
        spell: SpellId,
        amount: u64,
        absorbed: u64,
        victim: ActorId,
        source_player: Option<ActorId>,
    ) {
        *self.by_spell.entry(spell).or_default() += amount;
        self.amount += amount;
        self.absorbed += absorbed;
        self.hits += 1;
        self.victims.insert(victim);
        self.source_player = self.source_player.or(source_player);
    }
}

#[derive(Default)]
struct PlayerAcc<'a> {
    amount: u64,
    absorbed: u64,
    abilities: HashMap<AbilityKey<'a>, AbilityAcc>,
}

pub fn damage_taken(fight: &Fight, filter: &ReportFilter) -> DamageTakenReport {
    let mut abilities: HashMap<AbilityKey<'_>, AbilityAcc> = HashMap::new();
    let mut players: HashMap<ActorId, PlayerAcc<'_>> = HashMap::new();
    for event in fight.events.iter().filter(|e| filter.contains(e.t)) {
        let Some((amount, absorbed)) = taken_amount(event, filter.overkill) else {
            continue;
        };
        if fight.actors.get(event.target).kind != ActorKind::Player {
            continue;
        }
        let source = (event.source != NOBODY).then(|| fight.actors.get(event.source));
        let source_name = source.and_then(|actor| actor.name.clone());
        let source_player = source
            .filter(|actor| actor.kind == ActorKind::Player)
            .map(|_| event.source);
        let environmental =
            matches!(event.kind, EventKind::Damage(d) if d.via == DamageVia::Environmental);
        let key = (spell_key(fight, event.spell), environmental, source_name);
        abilities.entry(key.clone()).or_default().add(
            event.spell,
            amount,
            absorbed,
            event.target,
            source_player,
        );
        let player = players.entry(event.target).or_default();
        player.amount += amount;
        player.absorbed += absorbed;
        player.abilities.entry(key).or_default().add(
            event.spell,
            amount,
            absorbed,
            event.target,
            source_player,
        );
    }

    let duration_ms = filter.duration_ms(fight);
    let total: u64 = players.values().map(|p| p.amount).sum();
    let mut by_player: Vec<TakenPlayer> = players
        .into_iter()
        .map(|(player, p)| TakenPlayer {
            player,
            amount: p.amount,
            absorbed: p.absorbed,
            per_second: per_second(p.amount, duration_ms),
            share: if total > 0 {
                p.amount as f64 / total as f64
            } else {
                0.0
            },
            abilities: ability_rows(p.abilities),
        })
        .collect();
    by_player.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.player.cmp(&b.player)));
    DamageTakenReport {
        duration_ms,
        total,
        by_ability: ability_rows(abilities),
        by_player,
    }
}

/// Largest first; equal rows in a fixed order (spell, world damage first, source name).
fn ability_rows(map: HashMap<AbilityKey<'_>, AbilityAcc>) -> Vec<TakenAbility> {
    let mut rows: Vec<TakenAbility> = map
        .into_iter()
        .map(|((_, environmental, source_name), a)| TakenAbility {
            // The ID with the most damage, the lowest on a tie.
            spell: a
                .by_spell
                .iter()
                .max_by(|x, y| x.1.cmp(y.1).then(y.0.cmp(x.0)))
                .map_or(0, |(&spell, _)| spell),
            environmental,
            source_name,
            source_player: a.source_player,
            amount: a.amount,
            absorbed: a.absorbed,
            hits: a.hits,
            players_hit: a.victims.len() as u32,
        })
        .collect();
    rows.sort_by(|a, b| {
        b.amount
            .cmp(&a.amount)
            .then(a.spell.cmp(&b.spell))
            .then(b.environmental.cmp(&a.environmental))
            .then_with(|| a.source_name.cmp(&b.source_name))
    });
    rows
}

/// Damage an event deals to its target as `(amount + absorbed, absorbed)`. Hits a shield
/// swallowed completely are logged as ABSORB misses; they still hit.
pub(crate) fn taken_amount(event: &Event, overkill: Overkill) -> Option<(u64, u64)> {
    match event.kind {
        EventKind::Damage(damage) if is_distinct_hit(&damage) => {
            Some((damage_done_amount(&damage, overkill), damage.absorbed))
        }
        EventKind::Missed(missed)
            if missed.miss_type == MissType::Absorb
                && !matches!(missed.via, DamageVia::SwingLanded | DamageVia::Split) =>
        {
            Some((missed.amount_missed, missed.amount_missed))
        }
        _ => None,
    }
}
