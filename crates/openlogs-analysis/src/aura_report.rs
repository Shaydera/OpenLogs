use std::collections::{HashMap, HashSet};

use crate::ability::unit_name;
use crate::actors::{ActorId, ActorKind};
use crate::auras::{aura_intervals, merged, union_ms};
use crate::fight::{AuraType, Fight, SpellId};
use crate::filter::ReportFilter;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuraScope {
    BuffsOnPlayers,
    DebuffsOnPlayers,
    /// Debuffs players (or their pets) put on hostile units, grouped by unit name.
    DebuffsOnEnemies,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuraTarget {
    pub name: String,
    /// The player for player targets; `None` for an enemy group.
    pub player: Option<ActorId>,
    pub uptime: f64,
    /// Merged and clipped to the range.
    pub intervals: Vec<(i32, i32)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuraRow {
    /// The row's spell ID with the most applications: its icon, name and identity.
    pub spell: SpellId,
    /// Every spell ID of the row's name (Blessing of the Bronze logs 381750 and 381758), most
    /// applications first.
    pub spells: Vec<SpellId>,
    /// The players who applied it (pets credited to their owner), most applications first.
    pub sources: Vec<ActorId>,
    /// Intervals overlapping the range.
    pub applications: u32,
    /// Mean uptime over the targets.
    pub uptime: f64,
    pub targets: Vec<AuraTarget>,
}

/// The spec of the player behind an aura's source; `None` for no player or an unknown spec.
type SourceSpec = Option<u32>;

/// Spells of one name share a row when the specs that applied them overlap (Blessing of the
/// Bronze logs 13 IDs), but not across unrelated specs (mage and druid Clearcasting).
fn row_keys(
    fight: &Fight,
    specs: &HashMap<SpellId, HashSet<SourceSpec>>,
) -> HashMap<SpellId, String> {
    let mut by_name: HashMap<&str, Vec<SpellId>> = HashMap::new();
    let mut keys = HashMap::new();
    for &spell in specs.keys() {
        match fight.spells.get(&spell) {
            Some(info) if !info.name.is_empty() => {
                by_name.entry(info.name.as_str()).or_default().push(spell)
            }
            _ => {
                keys.insert(spell, format!("id:{spell}"));
            }
        }
    }
    for (name, mut spells) in by_name {
        spells.sort_unstable();
        // Union of IDs whose source specs overlap, as clusters of spec sets.
        let mut clusters: Vec<(Vec<SpellId>, HashSet<SourceSpec>)> = Vec::new();
        for spell in spells {
            let mut ids = vec![spell];
            let mut set = specs[&spell].clone();
            let mut rest = Vec::new();
            for (c_ids, c_set) in clusters {
                if c_set.is_disjoint(&set) {
                    rest.push((c_ids, c_set));
                } else {
                    ids.extend(c_ids);
                    set.extend(c_set);
                }
            }
            rest.push((ids, set));
            clusters = rest;
        }
        for (ids, _) in clusters {
            let first = ids.iter().min().copied().unwrap_or_default();
            for id in ids {
                keys.insert(id, format!("name:{name}#{first}"));
            }
        }
    }
    keys
}

/// The spell IDs and appliers of one row, with their application counts.
#[derive(Default)]
struct RowMeta {
    spells: HashMap<SpellId, u32>,
    sources: HashMap<ActorId, u32>,
}

/// Keys of a count map, most counted first, ties by the smaller key.
fn by_count<K: Copy + Ord>(counts: &HashMap<K, u32>) -> Vec<K> {
    let mut keys: Vec<(K, u32)> = counts.iter().map(|(&k, &n)| (k, n)).collect();
    keys.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    keys.into_iter().map(|(k, _)| k).collect()
}

/// A target's player (if any), intervals and application count.
type Group = (Option<ActorId>, Vec<(i32, i32)>, u32);

pub fn auras_report(fight: &Fight, filter: &ReportFilter, scope: AuraScope) -> Vec<AuraRow> {
    let (start, end) = filter.clipped(fight);
    let len = end - start;
    if len <= 0 {
        return Vec::new();
    }
    // Reaction changes during a pull (adds turn neutral), so a unit counts as an enemy
    // when any event saw it hostile, not by its latest flags.
    let hostile: HashSet<ActorId> = if scope == AuraScope::DebuffsOnEnemies {
        fight
            .events
            .iter()
            .flat_map(|e| {
                [
                    e.source_hostile.then_some(e.source),
                    e.target_hostile.then_some(e.target),
                ]
            })
            .flatten()
            .collect()
    } else {
        HashSet::new()
    };
    let intervals: Vec<_> = aura_intervals(fight)
        .into_iter()
        .filter(|i| i.end_ms > start && i.start_ms < end)
        .filter(|interval| {
            let is_player = fight.actors.get(interval.target).kind == ActorKind::Player;
            match scope {
                AuraScope::BuffsOnPlayers => is_player && interval.aura_type == AuraType::Buff,
                AuraScope::DebuffsOnPlayers => is_player && interval.aura_type == AuraType::Debuff,
                AuraScope::DebuffsOnEnemies => {
                    !is_player
                        && interval.aura_type == AuraType::Debuff
                        && hostile.contains(&interval.target)
                        && fight.actors.credited_player(interval.source).is_some()
                }
            }
        })
        .collect();
    let mut specs: HashMap<SpellId, HashSet<SourceSpec>> = HashMap::new();
    for interval in &intervals {
        let spec = fight
            .actors
            .credited_player(interval.source)
            .and_then(|p| fight.actors.get(p).spec_id);
        specs.entry(interval.spell).or_default().insert(spec);
    }
    let keys = row_keys(fight, &specs);
    // Keyed by (row key, player id or enemy name).
    let mut groups: HashMap<(String, String), Group> = HashMap::new();
    let mut metas: HashMap<String, RowMeta> = HashMap::new();
    for interval in intervals {
        let is_player = fight.actors.get(interval.target).kind == ActorKind::Player;
        let player = is_player.then_some(interval.target);
        let row = keys[&interval.spell].clone();
        let meta = metas.entry(row.clone()).or_default();
        *meta.spells.entry(interval.spell).or_default() += 1;
        if let Some(source) = fight.actors.credited_player(interval.source) {
            *meta.sources.entry(source).or_default() += 1;
        }
        let key = (
            row,
            if is_player {
                interval.target.to_string()
            } else {
                unit_name(fight, interval.target)
            },
        );
        let entry = groups.entry(key).or_insert((player, Vec::new(), 0));
        entry.1.push((interval.start_ms, interval.end_ms));
        entry.2 += 1;
    }
    let mut rows: HashMap<String, AuraRow> = HashMap::new();
    for ((row_key, target_key), (player, intervals, count)) in groups {
        let name = match player {
            Some(id) => unit_name(fight, id),
            None => target_key,
        };
        let uptime = union_ms(&intervals, start, end) as f64 / f64::from(len);
        let row = rows.entry(row_key.clone()).or_insert_with(|| {
            let meta = &metas[&row_key];
            let spells = by_count(&meta.spells);
            AuraRow {
                spell: spells[0],
                spells,
                sources: by_count(&meta.sources),
                applications: 0,
                uptime: 0.0,
                targets: Vec::new(),
            }
        });
        row.applications += count;
        row.targets.push(AuraTarget {
            name,
            player,
            uptime,
            intervals: merged(&intervals, start, end),
        });
    }
    let mut rows: Vec<AuraRow> = rows
        .into_values()
        .map(|mut row| {
            row.targets.sort_by(|a, b| {
                b.uptime
                    .total_cmp(&a.uptime)
                    .then_with(|| a.name.cmp(&b.name))
            });
            row.uptime =
                row.targets.iter().map(|t| t.uptime).sum::<f64>() / row.targets.len() as f64;
            row
        })
        .collect();
    rows.sort_by(|a, b| b.uptime.total_cmp(&a.uptime).then(a.spell.cmp(&b.spell)));
    rows
}
