use std::collections::HashMap;

use openlogs_gamedata::Curated;

use crate::actors::{ActorId, NOBODY};
use crate::auras::merged;
use crate::breakdown::Dimension;
use crate::cells::{Cell, CellKind, in_range, in_scope};
use crate::fight::{DamageVia, Event, EventKind, Fight, MissType};
use crate::filter::{Attribution, Overkill, ReportFilter};
use crate::reports::{Share, buffed_hit, damage_share, healing_share};
use crate::scope::{Scope, Side};
use crate::views::casts::{CastItem, side_casts, side_items, timeline_item};
use crate::views::names::log_name;
use crate::views::parts::{AmountFacts, Part, listed_row};
use crate::views::timeline::{Lanes, NameSlots, PartLanes, name_ids, overlaps};
use crate::views::{AmountRule, EventRow, ItemAmount, RowType, SharePart, Sink, Summary, Window};

/// A cast's hits count until the next cast of its name, at most this long.
pub(crate) const UNTIL_NEXT_CAST_MS: i32 = 15_000;
/// A boss cast's damage counts this long from the cast start.
const BOSS_CAST_MS: i32 = 10_000;

/// A support event with the hit it belongs to: what the row shows and what it books.
struct Attached {
    share: SharePart,
    parts: Vec<Part>,
}

pub(crate) fn part_cell(fight: &Fight, part: &Part) -> Cell {
    Cell::scope_probe(fight, part.source, part.spell, part.kind, part.target)
}

/// The parts the event at `index` books, as the table books them.
pub(crate) fn parts_at(
    fight: &Fight,
    facts: AmountFacts,
    index: usize,
    reattributed: bool,
    overkill: Overkill,
) -> Vec<Part> {
    let mut parts = Vec::new();
    facts.parts(fight, index, reattributed, overkill, &mut |part| {
        parts.push(part)
    });
    parts
}

fn is_support(event: &Event) -> bool {
    match event.kind {
        EventKind::Damage(damage) => damage.supporter != NOBODY,
        EventKind::Heal(heal) => heal.supporter != NOBODY,
        EventKind::Absorbed(absorbed) => absorbed.supporter != NOBODY,
        _ => false,
    }
}

/// The support share an event is, for the facts that have Aug support.
fn support_of(
    fight: &Fight,
    facts: AmountFacts,
    index: usize,
    overkill: Overkill,
) -> Option<SharePart> {
    let event = &fight.events[index];
    let share = match facts {
        AmountFacts::DamageDone => damage_share(fight, event, overkill),
        AmountFacts::Healing => healing_share(fight, event),
        AmountFacts::Taken { .. } | AmountFacts::EnemyHealing => None,
    };
    match share {
        Some(Share::Support(support)) => Some(SharePart {
            buff: support.buff,
            evoker: support.evoker,
            amount: support.amount,
            selected: false,
        }),
        _ => None,
    }
}

/// Damage, healing and damage taken rows: every hit as logged, with the Aug support logged for it.
/// A row is in the scope when any part it books is, and adds what those parts book; the shares
/// stay inline, never rows of their own.
pub(crate) fn rows(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    facts: AmountFacts,
    sink: &mut Sink,
) -> Summary {
    let reattributed = filter.attribution == Attribution::Reattributed;
    let names_credit = !(scope.source.is_empty() && scope.ability.is_empty());
    let all = scope.selects_all();
    let passes = |part: &Part| all || in_scope(scope, fight, &part_cell(fight, part));
    let range = in_range(fight, filter);
    let in_scope_sum =
        |parts: &[Part]| -> i64 { parts.iter().filter(|p| passes(p)).map(|p| p.amount).sum() };
    let mut attached: Vec<(usize, Attached)> = Vec::new();
    let mut unlisted = 0;
    for index in range.clone() {
        if !is_support(&fight.events[index]) {
            continue;
        }
        let Some(mut share) = support_of(fight, facts, index, filter.overkill) else {
            continue;
        };
        let parts = parts_at(fight, facts, index, reattributed, filter.overkill);
        share.selected = names_credit
            && parts
                .iter()
                .any(|p| p.kind == CellKind::Support && passes(p));
        let row = match parts.first() {
            Some(part) => part.row,
            None => buffed_hit(fight, index).and_then(|(hit, _)| listed_row(fight, hit)),
        }
        .filter(|row| range.contains(row));
        match row {
            Some(row) => attached.push((row, Attached { share, parts })),
            None => unlisted += in_scope_sum(&parts),
        }
    }
    attached.sort_by_key(|(row, _)| *row);
    let mut next = 0;
    let mut amount = 0;
    for index in range {
        // A support event is never a row of its own: the first pass attached it to its hit.
        if is_support(&fight.events[index]) {
            continue;
        }
        let mut own = None;
        facts.parts(fight, index, reattributed, filter.overkill, &mut |part| {
            if (part.hit || part.miss.is_some()) && part.row == Some(index) {
                own = Some(part);
            }
        });
        let Some(own) = own.as_ref() else {
            continue;
        };
        while next < attached.len() && attached[next].0 < index {
            unlisted += in_scope_sum(&attached[next].1.parts);
            next += 1;
        }
        let first = next;
        while next < attached.len() && attached[next].0 == index {
            next += 1;
        }
        let supports = &attached[first..next];
        let mut listed = false;
        let mut counted = 0;
        for part in std::iter::once(own).chain(supports.iter().flat_map(|(_, a)| a.parts.iter())) {
            if passes(part) {
                listed = true;
                counted += part.amount;
            }
        }
        if !listed {
            continue;
        }
        amount += counted;
        sink.row(fight.events[index].t, || {
            let mut row = amount_row(fight, index, own);
            row.shares = supports.iter().map(|(_, a)| a.share).collect();
            row
        });
    }
    for (_, rest) in &attached[next..] {
        unlisted += in_scope_sum(&rest.parts);
    }
    Summary {
        amount: Some(amount + unlisted),
        unlisted_support: unlisted,
        hidden_procs: 0,
    }
}

/// The row of a logged hit; `own` is the part it books for its doer.
fn amount_row(fight: &Fight, index: usize, own: &Part) -> EventRow {
    let event = &fight.events[index];
    let row_type = match event.kind {
        EventKind::Damage(damage) => match damage.via {
            DamageVia::Periodic => RowType::Tick,
            DamageVia::Swing | DamageVia::SwingLanded => RowType::Melee,
            DamageVia::Range => RowType::Ranged,
            _ => RowType::Damage,
        },
        EventKind::Missed(_) if own.miss.is_some() => RowType::Missed,
        EventKind::Missed(_) => RowType::Absorbed,
        EventKind::Heal(heal) if heal.periodic => RowType::HotTick,
        EventKind::Heal(_) => RowType::Heal,
        _ => RowType::Absorb,
    };
    let mut row = EventRow::new(
        index,
        event.t,
        row_type,
        log_name(event),
        (own.source, own.spell, own.target),
    );
    row.amount = own.miss.is_none().then_some(own.amount.max(0) as u64);
    row.miss = own.miss;
    row.target_hp = event
        .unit_hp
        .filter(|hp| hp.actor == event.target)
        .map(|hp| (hp.current, hp.max));
    match event.kind {
        EventKind::Damage(damage) => {
            row.amount = Some(damage.amount + damage.absorbed);
            row.overkill = damage.overkill;
            row.absorbed = damage.absorbed;
            row.blocked = damage.blocked;
            row.resisted = damage.resisted;
            row.critical = damage.critical;
            row.environmental = damage.via == DamageVia::Environmental;
        }
        EventKind::Missed(missed) if missed.miss_type == MissType::Absorb => {
            row.absorbed = missed.amount_missed;
        }
        EventKind::Heal(heal) => {
            row.overheal = heal.overheal;
            row.absorbed = heal.absorbed;
            row.critical = heal.critical;
        }
        EventKind::Absorbed(_) => row.by = Some((event.source, event.spell)),
        _ => {}
    }
    row
}

/// The unit whose casts a part's hit belongs to: pets' hits are their owner's for friendlies.
fn caster_of(fight: &Fight, facts: AmountFacts, source: ActorId) -> ActorId {
    match facts {
        AmountFacts::DamageDone | AmountFacts::Healing => {
            fight.actors.credited_player(source).unwrap_or(source)
        }
        AmountFacts::Taken { .. } | AmountFacts::EnemyHealing => source,
    }
}

/// Casts by caster and spell name in time order, to find the cast a hit belongs to.
struct CastIndex {
    rule: AmountRule,
    slots: NameSlots,
    by_name: Vec<Vec<(i32, usize)>>,
}

impl CastIndex {
    fn new(fight: &Fight, items: &[CastItem], rule: AmountRule) -> Self {
        let who = |item: &CastItem| Self::who(rule, item.caster);
        let slots = NameSlots::new(
            fight,
            &name_ids(fight),
            items.iter().map(|item| (who(item), item.spell)),
        );
        let mut by_name: Vec<Vec<(i32, usize)>> = vec![Vec::new(); slots.len()];
        for (i, item) in items.iter().enumerate() {
            let Some(slot) = slots.find(who(item), item.spell) else {
                continue;
            };
            let anchor = match (rule, item.success) {
                (AmountRule::UntilNextCast, Some(success)) => fight.events[success].t,
                _ => item.start,
            };
            by_name[slot].push((anchor, i));
        }
        for list in &mut by_name {
            list.sort_unstable();
        }
        Self {
            rule,
            slots,
            by_name,
        }
    }

    /// A boss cast's damage may come from any enemy unit; other casts' from their caster.
    fn who(rule: AmountRule, caster: ActorId) -> ActorId {
        if rule == AmountRule::BossCast {
            NOBODY
        } else {
            caster
        }
    }

    fn limit(&self) -> i32 {
        if self.rule == AmountRule::BossCast {
            BOSS_CAST_MS
        } else {
            UNTIL_NEXT_CAST_MS
        }
    }

    /// The cast a hit of `caster` at `t` belongs to: the latest of the part's spell name at or
    /// before `t`, within the limit.
    fn find(&self, caster: ActorId, part: &Part, t: i32) -> Option<usize> {
        let slot = self.slots.find(Self::who(self.rule, caster), part.spell)?;
        let list = &self.by_name[slot];
        let at = list.partition_point(|&(anchor, _)| anchor <= t);
        let (anchor, item) = *list.get(at.checked_sub(1)?)?;
        (t - anchor <= self.limit()).then_some(item)
    }
}

/// A cast's amount as logged: its hits in full, the Aug support inside them named apart, and an
/// Evoker's credited support on the buff he cast.
#[derive(Default, Clone, Copy)]
struct Tally {
    amount: i64,
    hits: u32,
    support: i64,
}

impl Tally {
    fn add(&mut self, part: &Part) {
        if part.hit {
            self.amount += part.amount;
            self.hits += 1;
        } else if part.kind == CellKind::Support {
            self.amount += part.amount;
            self.support += part.amount;
        } else {
            self.support -= part.amount;
        }
    }
}

#[derive(Default)]
struct ItemAcc {
    tally: Tally,
    /// Every part so far is an Evoker's support credit.
    only_support: bool,
    started: bool,
    by_target: Vec<(ActorId, Tally)>,
}

impl ItemAcc {
    fn add(&mut self, part: &Part) {
        let credit = part.kind == CellKind::Support;
        self.only_support = (!self.started || self.only_support) && credit;
        self.started = true;
        self.tally.add(part);
        match self
            .by_target
            .iter_mut()
            .find(|(target, _)| *target == part.target)
        {
            Some((_, tally)) => tally.add(part),
            None => {
                let mut tally = Tally::default();
                tally.add(part);
                self.by_target.push((part.target, tally));
            }
        }
    }

    fn amount(&self, rule: AmountRule, healing: bool) -> ItemAmount {
        ItemAmount {
            rule,
            amount: self.tally.amount,
            hits: self.tally.hits,
            targets: self
                .by_target
                .iter()
                .filter(|(target, _)| *target != NOBODY)
                .count() as u32,
            support: self.tally.support,
            healing,
        }
    }
}

/// The parts of the event at `index` a timeline amount reads: every part the table books but
/// misses, and with Aug credit off the deductions too, which name the support inside a hit.
/// `booked` says whether the table counts the part.
pub(crate) fn timeline_parts(
    fight: &Fight,
    facts: AmountFacts,
    index: usize,
    reattributed: bool,
    overkill: Overkill,
    each: &mut impl FnMut(Part, bool),
) {
    facts.parts(fight, index, true, overkill, &mut |part| {
        if part.miss.is_some() {
            return;
        }
        let credit = part.kind == CellKind::Support;
        if reattributed || part.hit {
            each(part, true);
        } else if !credit {
            each(part, false);
        }
    });
}

fn healing_facts(facts: AmountFacts) -> bool {
    matches!(facts, AmountFacts::Healing | AmountFacts::EnemyHealing)
}

/// The amounts of the casts `shown` (indices into `items`) by `rule`, from the facts' parts in
/// the range; `scope` keeps only its parts.
pub(crate) fn until_next_cast(
    fight: &Fight,
    filter: &ReportFilter,
    facts: AmountFacts,
    scope: Option<&Scope>,
    items: &[CastItem],
    shown: &[usize],
    rule: AmountRule,
) -> HashMap<usize, ItemAmount> {
    if shown.is_empty() {
        return HashMap::new();
    }
    let index = CastIndex::new(fight, items, rule);
    let reaches: Vec<(i32, i32)> = shown
        .iter()
        .map(|&i| {
            let item = &items[i];
            let anchor = item.success.map(|success| fight.events[success].t);
            let last = item
                .end
                .into_iter()
                .chain(anchor)
                .fold(item.start, i32::max);
            (item.start, last + index.limit())
        })
        .collect();
    let mut wanted = vec![false; items.len()];
    for &i in shown {
        wanted[i] = true;
    }
    let reattributed = filter.attribution == Attribution::Reattributed;
    let range = in_range(fight, filter);
    let stretches = merged(&reaches, i32::MIN, i32::MAX)
        .into_iter()
        .map(|(first, last)| {
            let from = fight
                .events
                .partition_point(|e| e.t < first)
                .max(range.start);
            let to = fight.events.partition_point(|e| e.t <= last).min(range.end);
            from..to.max(from)
        });
    let mut accs: Vec<Option<ItemAcc>> =
        std::iter::repeat_with(|| None).take(items.len()).collect();
    for i in stretches.flatten() {
        let t = fight.events[i].t;
        timeline_parts(
            fight,
            facts,
            i,
            reattributed,
            filter.overkill,
            &mut |part, _| {
                if scope.is_some_and(|scope| {
                    !scope.selects_all() && !in_scope(scope, fight, &part_cell(fight, &part))
                }) {
                    return;
                }
                let caster = caster_of(fight, facts, part.source);
                if let Some(item) = index.find(caster, &part, t)
                    && wanted[item]
                {
                    accs[item].get_or_insert_with(ItemAcc::default).add(&part);
                }
            },
        );
    }
    accs.into_iter()
        .enumerate()
        .filter_map(|(item, acc)| Some((item, acc?.amount(rule, healing_facts(facts)))))
        .collect()
}

/// A Casts tab cast's amount: its damage, else its healing, until the next cast of its name.
pub(crate) fn cast_amounts(
    fight: &Fight,
    filter: &ReportFilter,
    side: Side,
    items: &[CastItem],
    shown: &[usize],
) -> HashMap<usize, ItemAmount> {
    let (damage, healing) = match side {
        Side::Friendly => (AmountFacts::DamageDone, AmountFacts::Healing),
        Side::Enemy => (
            AmountFacts::Taken {
                hostile_sources_only: true,
            },
            AmountFacts::EnemyHealing,
        ),
    };
    let rule = AmountRule::UntilNextCast;
    let mut amounts = until_next_cast(fight, filter, damage, None, items, shown, rule);
    let rest: Vec<usize> = shown
        .iter()
        .copied()
        .filter(|i| !amounts.contains_key(i))
        .collect();
    amounts.extend(until_next_cast(
        fight, filter, healing, None, items, &rest, rule,
    ));
    amounts
}

/// Damage Done and Healing marks: each cast whose hits in the scope dealt the tab's amount, with
/// the amount of those hits until the next cast of its name. Lanes count every part in the
/// scope, as the table does; hits without a cast of their name (melee, pets' own spells) are not
/// drawn.
pub(crate) fn marks(
    fight: &Fight,
    curated: &Curated,
    filter: &ReportFilter,
    scope: &Scope,
    facts: AmountFacts,
    window: Window,
    lanes: &mut Lanes,
) {
    let side = scope.perspective;
    let items = side_casts(fight, side, &side_items(fight, curated, side, None));
    let rule = AmountRule::UntilNextCast;
    let index = CastIndex::new(fight, &items, rule);
    let reattributed = filter.attribution == Attribution::Reattributed;
    let mut part_lanes = PartLanes::new(fight, scope);
    let mut accs: HashMap<usize, ItemAcc> = HashMap::new();
    for i in in_range(fight, filter) {
        let t = fight.events[i].t;
        timeline_parts(
            fight,
            facts,
            i,
            reattributed,
            filter.overkill,
            &mut |part, booked| {
                let Some(known) = part_lanes.known(lanes, &part) else {
                    return;
                };
                if booked {
                    let lane = known.lane(lanes);
                    lanes.count_at(lane, part.amount);
                }
                let caster = caster_of(fight, facts, part.source);
                if let Some(item) = index.find(caster, &part, t) {
                    accs.entry(item).or_default().add(&part);
                }
            },
        );
    }
    let by_target = lanes.axis() == Some(Dimension::Target);
    let healing = healing_facts(facts);
    for (item, acc) in accs {
        let cast = &items[item];
        if !overlaps(window, cast.start, cast.bar_end()) {
            continue;
        }
        let kind = if acc.only_support {
            CellKind::Support
        } else {
            CellKind::Own
        };
        let cell =
            |target: ActorId| Cell::scope_probe(fight, cast.caster, cast.spell, kind, target);
        if by_target {
            for &(target, ref tally) in &acc.by_target {
                let mut mark = timeline_item(fight, cast);
                mark.target = target;
                mark.amount = Some(ItemAmount {
                    rule,
                    amount: tally.amount,
                    hits: tally.hits,
                    targets: u32::from(target != NOBODY),
                    support: tally.support,
                    healing,
                });
                lanes.item(fight, &cell(target), mark);
            }
        } else {
            let mut mark = timeline_item(fight, cast);
            mark.amount = Some(acc.amount(rule, healing));
            lanes.item(fight, &cell(cast.target), mark);
        }
    }
}
