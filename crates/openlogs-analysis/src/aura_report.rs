use std::collections::{BTreeSet, HashMap, HashSet};

use crate::ability::unit_name;
use crate::actors::{ActorId, ActorKind};
use crate::auras::{AuraInterval, aura_intervals, coverage, merged, union_ms};
use crate::breakdown::{Dimension, effective_group};
use crate::cells::{CellKind, Facts, ScopeMetric, book};
use crate::fight::{AuraAction, AuraType, EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::player::EBON_MIGHT;
use crate::scope::{Scope, Side, side_of, unit_of};

/// Who has an aura: a player, or every enemy of one name.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AuraHolder {
    pub name: String,
    /// The player for player holders; `None` for an enemy group.
    pub player: Option<ActorId>,
}

/// One aura on one holder.
#[derive(Debug, Clone, PartialEq)]
pub struct AuraLane {
    pub holder: AuraHolder,
    /// The aura's spell ID with the most applications on this holder; `spells` are every ID of it.
    pub spell: SpellId,
    pub spells: Vec<SpellId>,
    /// The players who applied it (pets credited to their owner), most applications first.
    pub sources: Vec<ActorId>,
    /// Applications per spell and per source, in the order of `spells` and `sources`.
    pub spell_counts: Vec<(SpellId, u32)>,
    pub source_counts: Vec<(ActorId, u32)>,
    /// The specs that applied the aura's spells (on any holder), which keep same-named auras apart.
    pub source_specs: BTreeSet<SourceSpec>,
    /// Applied, refreshed and added-stack events in the range, plus one per aura already up
    /// when the range starts.
    pub applications: u32,
    pub uptime: f64,
    /// Merged and clipped to the range.
    pub intervals: Vec<(i32, i32)>,
}

/// One aura (grouped by aura) or one holder (grouped by target) with its lanes.
#[derive(Debug, Clone, PartialEq)]
pub struct AuraRow {
    /// By aura: the row's spell ID with the most applications, its identity and icon; 0 by target.
    pub spell: SpellId,
    /// By aura: every spell ID of the row's name (Blessing of the Bronze logs 381750 and 381758),
    /// most applications first.
    pub spells: Vec<SpellId>,
    /// By target: the holder.
    pub holder: Option<AuraHolder>,
    /// The players who applied the row's auras, most applications first.
    pub sources: Vec<ActorId>,
    pub applications: u32,
    /// The union of its lanes' intervals over the range: an aura is up while any holder has it.
    /// By target, the union of the holder's auras, which is not shown.
    pub uptime: f64,
    /// By aura: one lane per holder; by target: one per aura.
    pub lanes: Vec<AuraLane>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AurasReport {
    pub group: Dimension,
    pub rows: Vec<AuraRow>,
    /// Ebon Might among the lanes: its uptime on anyone and the allies it buffed on average
    /// while up.
    pub ebon_might: Option<(f64, f64)>,
    /// Friendlies: players with an aura; enemies: players who applied one.
    pub players: u32,
    pub player_ids: BTreeSet<ActorId>,
}

/// The spec of the player behind an aura's source; `None` for no player or an unknown spec.
pub type SourceSpec = Option<u32>;

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

/// A count map's entries, most counted first, ties by the smaller key.
fn counted<K: Copy + Ord>(counts: &HashMap<K, u32>) -> Vec<(K, u32)> {
    let mut entries: Vec<(K, u32)> = counts.iter().map(|(&k, &n)| (k, n)).collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    entries
}

fn by_count<K: Copy + Ord>(counts: &HashMap<K, u32>) -> Vec<K> {
    counted(counts).into_iter().map(|(k, _)| k).collect()
}

/// Friendly holders are players (their pets' auras are not counted); enemy holders are units
/// hostile when the aura came.
pub(crate) fn holds(fight: &Fight, holder: ActorId, hostile: bool, side: Side) -> bool {
    match side {
        Side::Friendly => fight.actors.get(holder).kind == ActorKind::Player,
        Side::Enemy => side_of(fight, holder, hostile) == Some(Side::Enemy),
    }
}

fn holder_of(fight: &Fight, target: ActorId) -> AuraHolder {
    let player = fight.actors.get(target).kind == ActorKind::Player;
    AuraHolder {
        name: unit_name(fight, target),
        player: player.then_some(target),
    }
}

/// Auras of `aura_type` on `side`'s holders in the range, before the selections.
pub(crate) fn side_intervals(
    fight: &Fight,
    filter: &ReportFilter,
    side: Side,
    aura_type: AuraType,
) -> Vec<AuraInterval> {
    let (start, end) = filter.clipped(fight);
    aura_intervals(fight)
        .into_iter()
        .filter(|i| i.end_ms > start && i.start_ms < end)
        .filter(|i| i.aura_type == aura_type && holds(fight, i.target, i.target_hostile, side))
        .collect()
}

pub(crate) fn book_auras(
    fight: &Fight,
    filter: &ReportFilter,
    side: Side,
    aura_type: AuraType,
    map: &mut Facts,
) {
    for interval in side_intervals(fight, filter, side, aura_type) {
        book(
            map,
            (
                unit_of(fight, interval.source),
                interval.spell,
                CellKind::Own,
                unit_of(fight, interval.target),
            ),
            1,
            0,
            true,
            false,
        );
    }
}

/// A row: one aura (its name and spec cluster) or one holder.
#[derive(PartialEq, Eq, Hash)]
enum RowId {
    Aura(String),
    Holder(AuraHolder),
}

/// The intervals of one lane and its applications per spell and source.
#[derive(Default)]
struct LaneAcc {
    intervals: Vec<(i32, i32)>,
    spells: HashMap<SpellId, u32>,
    sources: HashMap<ActorId, u32>,
}

impl LaneAcc {
    fn count(&mut self, fight: &Fight, spell: SpellId, source: ActorId) {
        *self.spells.entry(spell).or_default() += 1;
        if let Some(source) = fight.actors.credited_player(source) {
            *self.sources.entry(source).or_default() += 1;
        }
    }
}

/// Auras by `wanted` (or its fallback): by aura with a lane per holder, or by target with a lane
/// per aura. Uptime is the union of a lane's intervals, never a sum.
pub fn auras_report(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    aura_type: AuraType,
    wanted: Dimension,
) -> AurasReport {
    let metric = match aura_type {
        AuraType::Buff => ScopeMetric::Buffs,
        AuraType::Debuff => ScopeMetric::Debuffs,
    };
    let group = effective_group(scope, metric, wanted);
    let (start, end) = filter.clipped(fight);
    let len = end - start;
    if len <= 0 {
        return AurasReport {
            group,
            rows: Vec::new(),
            ebon_might: None,
            players: 0,
            player_ids: BTreeSet::new(),
        };
    }
    let intervals: Vec<AuraInterval> = side_intervals(fight, filter, scope.perspective, aura_type)
        .into_iter()
        .filter(|i| {
            scope.accepts(
                fight,
                Some(&unit_of(fight, i.source)),
                Some(i.spell),
                Some(&unit_of(fight, i.target)),
            )
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
    // Keyed by (aura key, holder); a holder is a player or every enemy of one name.
    let mut lanes: HashMap<(String, AuraHolder), LaneAcc> = HashMap::new();
    let mut applied_at_start: HashSet<(ActorId, SpellId, ActorId)> = HashSet::new();
    for interval in &intervals {
        let holder = holder_of(fight, interval.target);
        let lane = lanes
            .entry((keys[&interval.spell].clone(), holder))
            .or_default();
        lane.intervals.push((interval.start_ms, interval.end_ms));
        lane.spells.entry(interval.spell).or_default();
        if let Some(source) = fight.actors.credited_player(interval.source) {
            lane.sources.entry(source).or_default();
        }
    }
    for event in &fight.events {
        let EventKind::Aura {
            action: action @ (AuraAction::Applied | AuraAction::Refresh | AuraAction::AppliedDose),
            aura_type: event_type,
            ..
        } = event.kind
        else {
            continue;
        };
        if event_type != aura_type
            || event.t < start
            || event.t >= end
            || !holds(fight, event.target, event.target_hostile, scope.perspective)
            || !scope.accepts(
                fight,
                Some(&unit_of(fight, event.source)),
                Some(event.spell),
                Some(&unit_of(fight, event.target)),
            )
        {
            continue;
        }
        let Some(key) = keys.get(&event.spell) else {
            continue;
        };
        let Some(lane) = lanes.get_mut(&(key.clone(), holder_of(fight, event.target))) else {
            continue;
        };
        if event.t == start && action == AuraAction::Applied {
            applied_at_start.insert((event.target, event.spell, event.source));
        }
        lane.count(fight, event.spell, event.source);
    }
    // An aura already up when the range starts counts as one application; one applied exactly
    // then is already counted by its event.
    for interval in &intervals {
        let opened_by_event = interval.start_ms == start
            && applied_at_start.contains(&(interval.target, interval.spell, interval.source));
        if interval.start_ms <= start && !opened_by_event {
            let holder = holder_of(fight, interval.target);
            if let Some(lane) = lanes.get_mut(&(keys[&interval.spell].clone(), holder)) {
                lane.count(fight, interval.spell, interval.source);
            }
        }
    }
    let mut players: BTreeSet<ActorId> = BTreeSet::new();
    let mut by_row: HashMap<RowId, Vec<(AuraLane, LaneAcc)>> = HashMap::new();
    for ((aura, holder), acc) in lanes {
        match scope.perspective {
            Side::Friendly => players.extend(holder.player),
            Side::Enemy => players.extend(acc.sources.keys().copied()),
        }
        let spells = by_count(&acc.spells);
        let lane = AuraLane {
            spell: spells[0],
            spells,
            sources: by_count(&acc.sources),
            spell_counts: counted(&acc.spells),
            source_counts: counted(&acc.sources),
            source_specs: acc
                .spells
                .keys()
                .flat_map(|spell| &specs[spell])
                .copied()
                .collect(),
            applications: acc.spells.values().sum(),
            uptime: union_ms(&acc.intervals, start, end) as f64 / f64::from(len),
            intervals: merged(&acc.intervals, start, end),
            holder: holder.clone(),
        };
        let row = match group {
            Dimension::Target => RowId::Holder(holder),
            _ => RowId::Aura(aura),
        };
        by_row.entry(row).or_default().push((lane, acc));
    }
    let mut ebon: Vec<Vec<(i32, i32)>> = Vec::new();
    let mut rows: Vec<AuraRow> = by_row
        .into_iter()
        .map(|(row, parts)| {
            let holder = match row {
                RowId::Holder(holder) => Some(holder),
                RowId::Aura(_) => None,
            };
            let mut spells: HashMap<SpellId, u32> = HashMap::new();
            let mut sources: HashMap<ActorId, u32> = HashMap::new();
            let mut held: Vec<(i32, i32)> = Vec::new();
            for (_, acc) in &parts {
                held.extend(&acc.intervals);
                for (&spell, &n) in &acc.spells {
                    *spells.entry(spell).or_default() += n;
                }
                for (&source, &n) in &acc.sources {
                    *sources.entry(source).or_default() += n;
                }
            }
            let mut lanes: Vec<AuraLane> = parts.into_iter().map(|(lane, _)| lane).collect();
            ebon.extend(
                lanes
                    .iter()
                    .filter(|l| l.spells.contains(&EBON_MIGHT))
                    .map(|l| l.intervals.clone()),
            );
            lanes.sort_by(|a, b| {
                b.uptime
                    .total_cmp(&a.uptime)
                    .then_with(|| a.holder.cmp(&b.holder))
                    .then(a.spell.cmp(&b.spell))
            });
            let spells = if holder.is_some() {
                Vec::new()
            } else {
                by_count(&spells)
            };
            AuraRow {
                spell: spells.first().copied().unwrap_or(0),
                spells,
                holder,
                sources: by_count(&sources),
                applications: lanes.iter().map(|l| l.applications).sum(),
                uptime: union_ms(&held, start, end) as f64 / f64::from(len),
                lanes,
            }
        })
        .collect();
    rows.sort_by(|a, b| {
        b.uptime
            .total_cmp(&a.uptime)
            .then(a.spell.cmp(&b.spell))
            .then_with(|| a.holder.cmp(&b.holder))
    });
    AurasReport {
        group,
        rows,
        ebon_might: coverage(&ebon, start, end),
        players: players.len() as u32,
        player_ids: players,
    }
}
