use std::collections::{HashMap, HashSet};

use openlogs_parser::{CombatEvent, CombatKind, DamageVia, Timestamp, Unit};

use crate::builder::LineSpan;
use crate::model::{
    COMBAT_QUIET_MICROS, CombatPull, DEAD_ENEMY_MEMORY_MICROS, FightSummary, Outcome, RosterEntry,
};

/// A combat pull still going on.
#[derive(Clone)]
pub(crate) struct OpenCombat {
    pub(crate) summary: FightSummary,
    /// Enemies that traded damage or misses with the group, by GUID.
    enemies: HashMap<String, Enemy>,
    /// The group's players seen in the pull, by GUID, and whether they died.
    players: HashMap<String, bool>,
    in_roster: HashSet<String>,
    /// Where an `Ended` pull ends: its last exchange, just past that line, and the broken lines,
    /// roster entries and group players up to it.
    last_exchange: Timestamp,
    last_exchange_end_offset: u64,
    broken_at_last_exchange: u64,
    roster_at_last_exchange: usize,
    players_at_last_exchange: usize,
}

#[derive(Clone)]
struct Enemy {
    name: String,
    damage_taken: u64,
    dead: bool,
    /// Order in which the enemies were engaged; the first one wins a tie on damage.
    engaged: usize,
}

impl OpenCombat {
    /// A pull whose first exchange is the line at the start of `summary`.
    pub(crate) fn new(summary: FightSummary) -> Self {
        Self {
            last_exchange: summary.start,
            last_exchange_end_offset: summary.end_offset,
            broken_at_last_exchange: 0,
            roster_at_last_exchange: 0,
            players_at_last_exchange: 0,
            summary,
            enemies: HashMap::new(),
            players: HashMap::new(),
            in_roster: HashSet::new(),
        }
    }

    /// A `spent` enemy, dead or trailing the last boss pull, never keeps the pull going: one the
    /// pull engaged counts as dead, an exchange with any other is ignored.
    pub(crate) fn observe(
        &mut self,
        event: &CombatEvent<'_>,
        span: LineSpan,
        timestamp: Timestamp,
        spent: bool,
    ) {
        let exchange = exchange(event);
        if spent
            && exchange
                .as_ref()
                .is_some_and(|exchange| !self.enemies.contains_key(exchange.enemy.guid))
        {
            return;
        }
        for unit in [&event.source, &event.target] {
            if unit.is_player()
                && unit.is_group_combatant()
                && !self.players.contains_key(unit.guid)
            {
                self.players.insert(unit.guid.to_string(), false);
            }
        }
        if !matches!(event.kind, CombatKind::Damage(_) | CombatKind::Missed(_)) {
            return;
        }
        for (player, other) in [
            (&event.source, &event.target),
            (&event.target, &event.source),
        ] {
            if player.is_player() && other.is_enemy_npc() {
                self.add_to_roster(player);
            }
        }
        let Some(Exchange { enemy, .. }) = exchange else {
            return;
        };
        if !spent {
            self.last_exchange = self.last_exchange.max(timestamp);
            self.last_exchange_end_offset = span.next_offset;
            self.broken_at_last_exchange = self.summary.broken_lines;
            self.roster_at_last_exchange = self.summary.roster.len();
            self.players_at_last_exchange = self.players.len();
        }
        let damage = if enemy.guid == event.target.guid {
            counted_damage(event).unwrap_or(0)
        } else {
            0
        };
        if !self.enemies.contains_key(enemy.guid) {
            let engaged = self.enemies.len();
            self.enemies.insert(
                enemy.guid.to_string(),
                Enemy {
                    name: enemy.name.unwrap_or(enemy.guid).to_string(),
                    damage_taken: 0,
                    dead: false,
                    engaged,
                },
            );
        }
        let engaged = self.enemies.get_mut(enemy.guid).expect("inserted above");
        engaged.damage_taken += damage;
        engaged.dead |= spent;
    }

    /// The outcome when the death of `guid` ends the pull: all engaged enemies or all of the
    /// group's players seen are dead.
    pub(crate) fn on_death(&mut self, guid: &str) -> Option<Outcome> {
        if let Some(enemy) = self.enemies.get_mut(guid) {
            enemy.dead = true;
            return self
                .enemies
                .values()
                .all(|enemy| enemy.dead)
                .then_some(Outcome::Kill);
        }
        let dead = self.players.get_mut(guid)?;
        *dead = true;
        self.players
            .values()
            .all(|&dead| dead)
            .then_some(Outcome::Wipe)
    }

    /// Whether more than [`COMBAT_QUIET_MICROS`] passed since the last exchange.
    pub(crate) fn quiet_since(&self, timestamp: Timestamp) -> bool {
        timestamp.0 - self.last_exchange.0 > COMBAT_QUIET_MICROS
    }

    /// An `Ended` pull ends at its last exchange, any other at its latest line.
    pub(crate) fn finish(mut self, outcome: Outcome, specs: &HashMap<String, u32>) -> FightSummary {
        let summary = &mut self.summary;
        summary.outcome = outcome;
        if outcome == Outcome::Ended {
            summary.end = self.last_exchange;
            summary.end_offset = self.last_exchange_end_offset;
            summary.broken_lines = self.broken_at_last_exchange;
            summary.roster.truncate(self.roster_at_last_exchange);
        }
        summary.duration_ms = u64::try_from(summary.end.millis_since(summary.start)).unwrap_or(0);
        if let Some(top) = self
            .enemies
            .values()
            .max_by_key(|enemy| (enemy.damage_taken, std::cmp::Reverse(enemy.engaged)))
        {
            summary.name.clone_from(&top.name);
        }
        summary.combat = Some(CombatPull {
            enemy_count: self.enemies.len() as u32,
        });
        summary.group_size = if outcome == Outcome::Ended {
            self.players_at_last_exchange
        } else {
            self.players.len()
        } as u32;
        for entry in &mut summary.roster {
            entry.spec_id = specs.get(&entry.guid).copied().unwrap_or(0);
        }
        self.summary
    }

    fn add_to_roster(&mut self, player: &Unit<'_>) {
        if !self.in_roster.contains(player.guid) {
            self.in_roster.insert(player.guid.to_string());
            self.summary.roster.push(RosterEntry {
                guid: player.guid.to_string(),
                name: player.name.map(str::to_string),
                spec_id: 0,
            });
        }
    }
}

/// A damage or miss between the group and an enemy NPC.
pub(crate) struct Exchange<'e, 'a> {
    /// The group's player, pet or guardian.
    pub(crate) ours: &'e Unit<'a>,
    pub(crate) enemy: &'e Unit<'a>,
}

pub(crate) fn exchange<'e, 'a>(event: &'e CombatEvent<'a>) -> Option<Exchange<'e, 'a>> {
    if !matches!(event.kind, CombatKind::Damage(_) | CombatKind::Missed(_)) {
        return None;
    }
    let (source, target) = (&event.source, &event.target);
    if source.is_group_combatant() && target.is_enemy_npc() {
        Some(Exchange {
            ours: source,
            enemy: target,
        })
    } else if target.is_group_combatant() && source.is_enemy_npc() {
        Some(Exchange {
            ours: target,
            enemy: source,
        })
    } else {
        None
    }
}

/// Enemy NPCs whose death the log showed, by GUID, with the latest death or exchange naming them
/// outside boss pulls. One is forgotten [`DEAD_ENEMY_MEMORY_MICROS`] after that line.
#[derive(Clone, Default)]
pub(crate) struct DeadEnemies(HashMap<String, Timestamp>);

impl DeadEnemies {
    pub(crate) fn record(&mut self, guid: &str, timestamp: Timestamp) {
        self.0.retain(|_, seen| !forgotten(*seen, timestamp));
        self.0.insert(guid.to_string(), timestamp);
    }

    /// Whether `guid` died, which a line at `timestamp` names.
    pub(crate) fn named(&mut self, guid: &str, timestamp: Timestamp) -> bool {
        let Some(seen) = self.0.get_mut(guid) else {
            return false;
        };
        if forgotten(*seen, timestamp) {
            self.0.remove(guid);
            return false;
        }
        *seen = (*seen).max(timestamp);
        true
    }
}

fn forgotten(seen: Timestamp, now: Timestamp) -> bool {
    now.0 - seen.0 > DEAD_ENEMY_MEMORY_MICROS
}

/// The damage of a hit, `None` for support events and the victim-side melee copy, which
/// repeat hits already counted.
pub(crate) fn counted_damage(event: &CombatEvent<'_>) -> Option<u64> {
    match event.kind {
        CombatKind::Damage(damage)
            if damage.supporter.is_none() && damage.via != DamageVia::SwingLanded =>
        {
            Some(damage.amount)
        }
        _ => None,
    }
}
