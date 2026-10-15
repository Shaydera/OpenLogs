use std::collections::HashMap;

use crate::actors::ActorId;
use crate::aura_report::holds;
use crate::auras::{AuraInterval, aura_intervals};
use crate::breakdown::Dimension;
use crate::cells::{CellKind, ScopeMetric, in_range};
use crate::deaths::{Hit, deaths};
use crate::deaths_report::enemy_kills;
use crate::fight::{AuraType, Fight, SpellId};
use crate::filter::{Attribution, ReportFilter};
use crate::links::{SpellKey, spell_key};
use crate::scope::{Scope, Side};
use crate::views::amounts::timeline_parts;
use crate::views::auras::{aura_in_scope, place_bars};
use crate::views::deaths::{death_cell, death_item};
use crate::views::parts::AmountFacts;
use crate::views::timeline::{Lanes, PartLanes, first_seen, log_lines, overlaps};
use crate::views::{AmountRule, ItemAmount, ItemKind, TimelineItem, ViewOptions, Window};

/// A unit's hits by ability as `(t, amount, logged line)`.
type HitsOf<'a> = HashMap<(ActorId, SpellKey<'a>), Vec<(i32, i64, usize)>>;

/// Totals of a unit's hits by one ability up to a time: `(amount, hits, support)`.
struct Running {
    t: i32,
    total: (i64, i64, i64),
}

/// Debuffs the other side put on the holder: with every source selected, enemies and the
/// environment on friendlies (not Sated or Forbearance), players and their pets on enemies.
fn applied_by_other_side(fight: &Fight, side: Side, applier: ActorId) -> bool {
    let players = fight.actors.credited_player(applier).is_some();
    match side {
        Side::Friendly => !players,
        Side::Enemy => players,
    }
}

/// Damage Taken marks: debuff bars of the selected sources on the lane's unit, with that
/// ability's damage on it while the debuff was up; with the toggle, every hit; deaths as lines.
/// Returns the debuff spells drawn, in order of appearance.
pub(crate) fn marks(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    options: &ViewOptions,
    window: Window,
    lanes: &mut Lanes,
) -> Vec<SpellId> {
    let side = scope.perspective;
    let Some(facts) = AmountFacts::of(side, ScopeMetric::DamageTaken) else {
        return Vec::new();
    };
    let reattributed = filter.attribution == Attribution::Reattributed;
    let mut part_lanes = PartLanes::new(fight, scope);
    let mut hits: HitsOf = HashMap::new();
    let mut support_in: HashMap<usize, i64> = HashMap::new();
    let mut drawn_hits: Vec<(usize, usize, TimelineItem)> = Vec::new();
    for index in in_range(fight, filter) {
        let t = fight.events[index].t;
        timeline_parts(fight, facts, index, reattributed, &mut |part, booked| {
            if part.hit {
                hits.entry((part.target, spell_key(fight, part.spell)))
                    .or_default()
                    .push((t, part.amount, index));
            } else if part.kind != CellKind::Support
                && let Some(row) = part.row
            {
                *support_in.entry(row).or_default() -= part.amount;
            }
            let Some(known) = part_lanes.known(lanes, &part) else {
                return;
            };
            if booked {
                let lane = known.lane(lanes);
                lanes.count_at(lane, part.amount);
            }
            if options.hits && part.hit && part.kind == CellKind::Own && overlaps(window, t, None) {
                let mut item = TimelineItem::new(ItemKind::Hit, t, None);
                item.source = part.source;
                item.spell = part.spell;
                item.target = part.target;
                item.amount = Some(ItemAmount {
                    rule: AmountRule::Hit,
                    amount: part.amount,
                    hits: 1,
                    targets: 1,
                    support: 0,
                    healing: false,
                });
                (item.log, item.log_more) = log_lines(fight, &[index]);
                drawn_hits.push((known.lane(lanes), index, item));
            }
        });
    }
    for (lane, row, mut item) in drawn_hits {
        if let Some(amount) = item.amount.as_mut() {
            amount.support = support_in.get(&row).copied().unwrap_or(0);
        }
        lanes.item_at(lane, item);
    }
    let cumulative: HashMap<(ActorId, SpellKey<'_>), Vec<Running>> = hits
        .into_iter()
        .map(|(key, hits)| {
            let mut total = (0, 0, 0);
            let running = hits
                .into_iter()
                .map(|(t, amount, row)| {
                    let support = support_in.get(&row).copied().unwrap_or(0);
                    total = (total.0 + amount, total.1 + 1, total.2 + support);
                    Running { t, total }
                })
                .collect();
            (key, running)
        })
        .collect();
    let (start, end) = filter.clipped(fight);
    let debuffs: Vec<AuraInterval> = aura_intervals(fight)
        .into_iter()
        .filter(|i| {
            i.aura_type == AuraType::Debuff
                && i.end_ms > start
                && i.start_ms < end
                && holds(fight, i.target, i.target_hostile, side)
                && (!scope.source.is_empty() || applied_by_other_side(fight, side, i.source))
                && aura_in_scope(fight, scope, i.source, i.spell, i.target)
        })
        .collect();
    let while_up = |interval: &AuraInterval| {
        let running = cumulative
            .get(&(interval.target, spell_key(fight, interval.spell)))
            .map_or(&[][..], Vec::as_slice);
        let before = running.partition_point(|r| r.t < interval.start_ms);
        let through = running.partition_point(|r| r.t <= interval.end_ms);
        let at = |count: usize| {
            count
                .checked_sub(1)
                .map_or((0, 0, 0), |last| running[last].total)
        };
        let (from, to) = (at(before), at(through));
        Some(ItemAmount {
            rule: AmountRule::WhileUp,
            amount: to.0 - from.0,
            hits: (to.1 - from.1) as u32,
            targets: 1,
            support: to.2 - from.2,
            healing: false,
        })
    };
    place_bars(fight, filter, &debuffs, window, lanes, false, while_up);
    if lanes.axis() == Some(Dimension::Target) {
        death_lines(fight, filter, scope, window, lanes);
    }
    let mut by_start: Vec<&AuraInterval> = debuffs.iter().collect();
    by_start.sort_by_key(|i| i.start_ms);
    first_seen(by_start.into_iter().map(|i| i.spell))
}

/// A red line per death of a lane's unit in the window.
fn death_lines(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    window: Window,
    lanes: &mut Lanes,
) {
    let deaths: Vec<(ActorId, i32, Option<Hit>)> = match scope.perspective {
        Side::Friendly => deaths(fight)
            .into_iter()
            .filter(|d| filter.contains(d.t))
            .map(|d| (d.player, d.t, d.killing_blow))
            .collect(),
        Side::Enemy => enemy_kills(fight, filter)
            .into_iter()
            .map(|k| (k.unit, k.t, k.killing_blow))
            .collect(),
    };
    for (dead, t, blow) in deaths {
        if !overlaps(window, t, None) {
            continue;
        }
        let item = death_item(dead, t, None, blow);
        let cell = death_cell(fight, &item);
        if lanes.has(&lanes.key(fight, &cell)) {
            lanes.item(fight, &cell, item);
        }
    }
}
