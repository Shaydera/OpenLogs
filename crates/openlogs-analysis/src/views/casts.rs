use std::collections::{HashMap, HashSet};

use openlogs_gamedata::Curated;

use crate::actors::{ActorId, ActorKind, NOBODY};
use crate::casts::follow_up_casts;
use crate::cells::{Cell, CellKind, in_scope};
use crate::fight::{Event, EventKind, FailReason, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::links::{SpellKey, spell_key};
use crate::scope::{Scope, Side, side_of};
use crate::views::amounts::{cast_amounts, until_next_cast};
use crate::views::names::log_name;
use crate::views::parts::AmountFacts;
use crate::views::spans::{SpanIndex, Spans};
use crate::views::timeline::{Lanes, log_lines, overlaps};
use crate::views::{
    AmountRule, CastOutcome, EventRow, ItemKind, RowType, Sink, Summary, TimelineItem, ViewOptions,
    Window,
};

/// A `SPELL_CAST_FAILED` "Interrupted" and a `SPELL_INTERRUPT` of the same cast are logged this
/// close together; they close one cast.
const SAME_INTERRUPT_MS: i32 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CastKind {
    /// A success without a begin cast; channels too, read later from their aura.
    Instant,
    CastTime,
    Empowered,
    Interrupted,
    /// A begin cast nothing in the log closes.
    NoOutcome,
    /// A failed cast with another reason than "Interrupted".
    Rejected,
}

/// One cast as the log tells it: its begin, success and close lines paired.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CastItem {
    pub kind: CastKind,
    pub caster: ActorId,
    pub spell: SpellId,
    /// The success's target, else the begin's.
    pub target: ActorId,
    pub start: i32,
    /// When it completed, was interrupted or released; a cast without an outcome ends at the
    /// caster's next begin cast.
    pub end: Option<i32>,
    pub begin: Option<usize>,
    pub success: Option<usize>,
    /// The first line that closed it: an empower end, a failed cast or an interrupt.
    pub close: Option<usize>,
    /// Further lines of the same close (an interrupt logged both ways).
    pub also: Vec<usize>,
    pub stage: Option<u32>,
    pub reason: Option<FailReason>,
    /// Who interrupted it, with which spell.
    pub by: Option<(ActorId, SpellId)>,
    /// Further `SPELL_CAST_SUCCESS` IDs of the same press.
    pub follow_ups: Vec<usize>,
}

impl CastItem {
    fn new(kind: CastKind, event: &Event, caster: ActorId, spell: SpellId) -> Self {
        Self {
            kind,
            caster,
            spell,
            target: event.target,
            start: event.t,
            end: None,
            begin: None,
            success: None,
            close: None,
            also: Vec::new(),
            stage: None,
            reason: None,
            by: None,
            follow_ups: Vec::new(),
        }
    }

    /// The line the side and scope are read from.
    pub fn anchor(&self) -> usize {
        self.success.or(self.begin).or(self.close).unwrap_or(0)
    }

    /// Every logged line of the cast, in log order.
    pub fn lines(&self) -> Vec<usize> {
        let mut lines: Vec<usize> = [self.begin, self.success, self.close]
            .into_iter()
            .flatten()
            .chain(self.also.iter().copied())
            .chain(self.follow_ups.iter().copied())
            .collect();
        lines.sort_unstable();
        lines.dedup();
        lines
    }

    /// When a bar ends; `None` for a cast drawn at one point in time.
    pub fn bar_end(&self) -> Option<i32> {
        self.begin.and(self.end)
    }
}

#[derive(Clone, Copy)]
enum Open {
    Begin,
    Empower,
}

/// Every cast of the fight with its begin, success and close lines. Same-timestamp lines keep
/// their log order, so an empower start and its success pair as one cast.
pub(crate) fn cast_items(
    fight: &Fight,
    curated: &Curated,
    follow_ups: &HashSet<usize>,
    casters: impl Fn(ActorId) -> bool,
) -> Vec<CastItem> {
    let mut items: Vec<CastItem> = Vec::new();
    let mut open: HashMap<(ActorId, SpellId), (Open, usize)> = HashMap::new();
    let mut interrupted: HashMap<(ActorId, SpellId), usize> = HashMap::new();
    let mut last_by_name: HashMap<(ActorId, SpellKey<'_>), usize> = HashMap::new();
    for (index, event) in fight.events.iter().enumerate() {
        let caster = match event.kind {
            EventKind::Interrupt { .. } => event.target,
            EventKind::CastStart
            | EventKind::EmpowerStart
            | EventKind::CastSuccess
            | EventKind::EmpowerEnd { .. }
            | EventKind::EmpowerInterrupt { .. }
            | EventKind::CastFailed { .. } => event.source,
            _ => continue,
        };
        if !casters(caster) {
            continue;
        }
        let key = (event.source, event.spell);
        match event.kind {
            EventKind::CastStart | EventKind::EmpowerStart => {
                if let Some((_, item)) = open.remove(&key) {
                    items[item].kind = CastKind::NoOutcome;
                }
                let empower = matches!(event.kind, EventKind::EmpowerStart);
                let kind = if empower {
                    CastKind::Empowered
                } else {
                    CastKind::CastTime
                };
                let mut item = CastItem::new(kind, event, event.source, event.spell);
                item.begin = Some(index);
                open.insert(
                    key,
                    (
                        if empower { Open::Empower } else { Open::Begin },
                        items.len(),
                    ),
                );
                items.push(item);
            }
            EventKind::CastSuccess => {
                if follow_ups.contains(&index) {
                    let name = (event.source, spell_key(fight, event.spell));
                    if let Some(&press) = last_by_name.get(&name) {
                        items[press].follow_ups.push(index);
                        continue;
                    }
                }
                let item = match open.get(&key).copied() {
                    Some((Open::Empower, item)) if items[item].success.is_none() => item,
                    Some((Open::Begin, item)) => {
                        open.remove(&key);
                        items[item].end = Some(event.t);
                        item
                    }
                    _ => {
                        items.push(CastItem::new(
                            CastKind::Instant,
                            event,
                            event.source,
                            event.spell,
                        ));
                        items.len() - 1
                    }
                };
                items[item].success = Some(index);
                if event.target != NOBODY {
                    items[item].target = event.target;
                }
                if !curated.is_proc(event.spell) {
                    last_by_name.insert((event.source, spell_key(fight, event.spell)), item);
                }
            }
            EventKind::EmpowerEnd { stage } => {
                let item = match open.remove(&key) {
                    Some((_, item)) => item,
                    None => {
                        items.push(CastItem::new(
                            CastKind::Empowered,
                            event,
                            event.source,
                            event.spell,
                        ));
                        items.len() - 1
                    }
                };
                let item = &mut items[item];
                item.kind = CastKind::Empowered;
                item.stage = Some(stage);
                item.end = Some(event.t);
                item.close = Some(index);
            }
            EventKind::EmpowerInterrupt { stage } => {
                let item = close_interrupted(
                    &mut items,
                    &mut open,
                    &mut interrupted,
                    index,
                    event,
                    key,
                    None,
                );
                items[item].stage.get_or_insert(stage);
            }
            EventKind::CastFailed {
                reason: FailReason::Interrupted,
            } => {
                close_interrupted(
                    &mut items,
                    &mut open,
                    &mut interrupted,
                    index,
                    event,
                    key,
                    None,
                );
            }
            EventKind::CastFailed { reason } => {
                let mut item = CastItem::new(CastKind::Rejected, event, event.source, event.spell);
                item.close = Some(index);
                item.reason = Some(reason);
                items.push(item);
            }
            EventKind::Interrupt { interrupted: spell } => {
                close_interrupted(
                    &mut items,
                    &mut open,
                    &mut interrupted,
                    index,
                    event,
                    (event.target, spell),
                    Some((event.source, event.spell)),
                );
            }
            _ => {}
        }
    }
    for (_, item) in open.into_values() {
        items[item].kind = CastKind::NoOutcome;
    }
    let mut next_begin: HashMap<ActorId, i32> = HashMap::new();
    for item in items.iter_mut().rev() {
        if item.kind == CastKind::NoOutcome {
            item.end = next_begin.get(&item.caster).copied();
        }
        if item.begin.is_some() {
            next_begin.insert(item.caster, item.start);
        }
    }
    items
}

fn close_interrupted(
    items: &mut Vec<CastItem>,
    open: &mut HashMap<(ActorId, SpellId), (Open, usize)>,
    interrupted: &mut HashMap<(ActorId, SpellId), usize>,
    index: usize,
    event: &Event,
    key: (ActorId, SpellId),
    by: Option<(ActorId, SpellId)>,
) -> usize {
    let item = match open.remove(&key) {
        Some((_, item)) => item,
        None => match interrupted.get(&key).copied() {
            Some(item)
                if items[item]
                    .end
                    .is_some_and(|end| event.t - end <= SAME_INTERRUPT_MS) =>
            {
                items[item].also.push(index);
                if items[item].by.is_none() {
                    items[item].by = by;
                }
                return item;
            }
            _ => {
                let mut item = CastItem::new(CastKind::Interrupted, event, key.0, key.1);
                if by.is_some() {
                    item.target = NOBODY;
                }
                items.push(item);
                items.len() - 1
            }
        },
    };
    let item_ref = &mut items[item];
    item_ref.kind = CastKind::Interrupted;
    item_ref.end = Some(event.t);
    item_ref.close = Some(index);
    item_ref.by = by;
    interrupted.insert(key, item);
    item
}

/// The units whose casts `side` counts: players (not their pets) for friendlies, units no player
/// owns for enemies.
pub(crate) fn casters(fight: &Fight, side: Side) -> impl Fn(ActorId) -> bool + '_ {
    move |actor| match side {
        Side::Friendly => fight.actors.get(actor).kind == ActorKind::Player,
        Side::Enemy => fight.actors.credited_player(actor).is_none(),
    }
}

/// Whether `side` owns the cast: players for friendlies (their pets' casts are not counted),
/// units hostile at the cast for enemies.
pub(crate) fn casts_of(fight: &Fight, side: Side, item: &CastItem) -> bool {
    match side {
        Side::Friendly => fight.actors.get(item.caster).kind == ActorKind::Player,
        Side::Enemy => {
            let event = &fight.events[item.anchor()];
            let hostile = if event.source == item.caster {
                event.source_hostile
            } else {
                event.target_hostile
            };
            side_of(fight, item.caster, hostile) == Some(Side::Enemy)
        }
    }
}

/// Every cast of `side`'s casters, follow-ups folded into their press, and with `bosses` the
/// context lane's casts too: one pass over the log for a request. Only friendly follow-ups may
/// share the pass, as they never fold into a context caster's cast.
pub(crate) fn side_items(
    fight: &Fight,
    curated: &Curated,
    side: Side,
    bosses: Option<&[ActorId]>,
) -> Vec<CastItem> {
    debug_assert!(bosses.is_none() || side == Side::Friendly);
    let follow_ups = follow_up_casts(fight, curated, casters(fight, side));
    let own = casters(fight, side);
    let context = bosses.map(|bosses| context_casters(fight, bosses));
    cast_items(fight, curated, &follow_ups, |actor| {
        own(actor) || context.as_ref().is_some_and(|context| context(actor))
    })
}

/// The casts of `side` among `items` that are in the scope, and the success times of the procs
/// Hide procs leaves out.
pub(crate) fn scoped_items(
    fight: &Fight,
    curated: &Curated,
    scope: &Scope,
    hide_procs: bool,
    items: impl IntoIterator<Item = CastItem>,
) -> (Vec<CastItem>, Vec<i32>) {
    let side = scope.perspective;
    let hides = |item: &CastItem| {
        hide_procs
            && scope.ability.is_empty()
            && fight.actors.get(item.caster).kind == ActorKind::Player
            && curated.is_proc(item.spell)
    };
    let mut hidden = Vec::new();
    let mut scoped = Vec::new();
    for item in items {
        if !(casts_of(fight, side, &item) && item_in_scope(fight, scope, &item)) {
            continue;
        }
        if hides(&item) {
            hidden.extend(item.success.map(|i| fight.events[i].t));
        } else {
            scoped.push(item);
        }
    }
    (scoped, hidden)
}

pub(crate) fn item_in_scope(fight: &Fight, scope: &Scope, item: &CastItem) -> bool {
    scope.selects_all()
        || in_scope(
            scope,
            fight,
            &Cell::scope_probe(
                fight,
                item.caster,
                item.spell,
                CellKind::Own,
                scope_target(fight, item),
            ),
        )
}

/// The target the table books the cast under: its success line's, else its begin's.
fn scope_target(fight: &Fight, item: &CastItem) -> ActorId {
    item.success
        .or(item.begin)
        .map_or(item.target, |line| fight.events[line].target)
}

/// Casts rows: every press, its follow-up IDs, interrupted casts and, with their toggles, begin
/// casts with their outcome and rejected inputs.
pub(crate) fn rows(
    fight: &Fight,
    curated: &Curated,
    filter: &ReportFilter,
    scope: &Scope,
    options: &ViewOptions,
    sink: &mut Sink,
) -> Summary {
    let built = side_items(fight, curated, scope.perspective, None);
    let (items, hidden) = scoped_items(fight, curated, scope, options.hide_procs, built);
    let mut rows: Vec<(usize, &CastItem, RowType)> = Vec::new();
    for item in &items {
        if let (Some(begin), true) = (item.begin, options.begin_casts) {
            rows.push((begin, item, RowType::BeginCast));
        }
        if let Some(success) = item.success {
            rows.push((success, item, RowType::Cast));
        }
        rows.extend(item.follow_ups.iter().map(|&i| (i, item, RowType::Cast)));
        match item.kind {
            CastKind::Interrupted => {
                rows.extend(item.close.map(|i| (i, item, RowType::Interrupted)))
            }
            CastKind::Rejected if options.rejected => {
                rows.extend(item.close.map(|i| (i, item, RowType::Rejected)))
            }
            _ => {}
        }
    }
    rows.sort_by_key(|(index, _, _)| *index);
    for (index, item, row_type) in rows {
        let t = fight.events[index].t;
        if filter.contains(t) {
            sink.row(t, || cast_row(fight, index, item, row_type));
        }
    }
    Summary {
        amount: None,
        unlisted_support: 0,
        hidden_procs: hidden.iter().filter(|&&t| filter.contains(t)).count() as u32,
    }
}

fn cast_row(fight: &Fight, index: usize, item: &CastItem, row_type: RowType) -> EventRow {
    let event = &fight.events[index];
    let mut row = EventRow::new(
        index,
        event.t,
        row_type,
        log_name(event),
        (item.caster, item.spell, item.target),
    );
    let begun = item.begin.map(|_| item.start);
    match row_type {
        RowType::BeginCast => {
            row.outcome = Some(match item.kind {
                CastKind::CastTime => CastOutcome::Completed,
                CastKind::Empowered => CastOutcome::Released,
                CastKind::Interrupted => CastOutcome::Interrupted,
                _ => CastOutcome::NoOutcome,
            });
            if row.outcome != Some(CastOutcome::NoOutcome) {
                row.duration_ms = item.end.map(|end| end - item.start);
            }
            row.stage = item.stage;
        }
        RowType::Cast if Some(index) != item.success => {
            row.press_ms = item.success.map(|i| fight.events[i].t);
            row.spell = event.spell;
        }
        RowType::Cast => {
            row.stage = item.stage;
            row.duration_ms = if is_empower(fight, item) {
                item.stage.and(item.end).map(|end| end - item.start)
            } else {
                begun.map(|start| event.t - start)
            };
        }
        RowType::Interrupted => {
            row.duration_ms = begun.map(|start| event.t - start);
            row.stage = item.stage;
            row.by = item.by;
        }
        _ => row.reason = item.reason,
    }
    row
}

fn item_kind(kind: CastKind) -> ItemKind {
    match kind {
        CastKind::Instant => ItemKind::Instant,
        CastKind::CastTime => ItemKind::CastTime,
        CastKind::Empowered => ItemKind::Empowered,
        CastKind::Interrupted => ItemKind::Interrupted,
        CastKind::NoOutcome => ItemKind::NoOutcome,
        CastKind::Rejected => ItemKind::Rejected,
    }
}

/// A cast as a timeline item with its log lines.
pub(crate) fn timeline_item(fight: &Fight, item: &CastItem) -> TimelineItem {
    spanned_item(fight, item, Spans::default())
}

/// A cast as a timeline item with its channel, and the lines that tell it.
fn spanned_item(fight: &Fight, item: &CastItem, spans: Spans) -> TimelineItem {
    let kind = if spans.channel.is_some() {
        ItemKind::Channel
    } else {
        item_kind(item.kind)
    };
    let mut out = TimelineItem::new(kind, item.start, item.bar_end());
    out.source = item.caster;
    out.spell = item.spell;
    out.target = item.target;
    out.stage = item.stage;
    out.by = item.by;
    out.reason = item.reason;
    out.span_end_ms = spans.span_end.or(item.bar_end()).unwrap_or(item.start);
    let mut lines = item.lines();
    lines.extend(spans.lines);
    lines.sort_unstable();
    lines.dedup();
    (out.log, out.log_more) = log_lines(fight, &lines);
    out.channel = spans.channel;
    out
}

/// The casts among `items` drawn in the window, a channel to its end, each with its channel.
fn drawn(spans: &SpanIndex<'_>, window: Window, items: &[CastItem]) -> Vec<(usize, Spans)> {
    items
        .iter()
        .enumerate()
        .filter(|(_, item)| item.start < window.end_ms)
        .map(|(i, item)| (i, spans.spans(item)))
        .filter(|(i, found)| overlaps(window, items[*i].start, found.span_end))
        .collect()
}

/// The lane cell of a cast: curated procs of players are rows of their own, as in the table.
fn cast_cell(fight: &Fight, curated: &Curated, item: &CastItem) -> Cell {
    let proc =
        fight.actors.get(item.caster).kind == ActorKind::Player && curated.is_proc(item.spell);
    let kind = if proc { CellKind::Proc } else { CellKind::Own };
    Cell::scope_probe(fight, item.caster, item.spell, kind, item.target)
}

/// The time a cast counts at: its success, else its begin or close.
pub(crate) fn cast_time(fight: &Fight, item: &CastItem) -> i32 {
    fight.events[item.anchor()].t
}

/// Casts marks: every cast in the window, lanes ordered by presses in the range. `built`: the
/// request's [`side_items`], `spans` read over them.
#[allow(clippy::too_many_arguments)]
pub(crate) fn marks(
    fight: &Fight,
    curated: &Curated,
    filter: &ReportFilter,
    scope: &Scope,
    options: &ViewOptions,
    window: Window,
    built: &[CastItem],
    spans: &SpanIndex<'_>,
    lanes: &mut Lanes,
) {
    let all = side_casts(fight, scope.perspective, built);
    let (items, _) = scoped_items(
        fight,
        curated,
        scope,
        options.hide_procs,
        built.iter().cloned(),
    );
    let items: Vec<CastItem> = items
        .into_iter()
        .filter(|item| options.rejected || item.kind != CastKind::Rejected)
        .collect();
    let drawn = drawn(spans, window, &items);
    let shown: Vec<usize> = drawn.iter().map(|(i, _)| *i).collect();
    let in_all: HashMap<usize, usize> = all
        .iter()
        .enumerate()
        .filter_map(|(i, cast)| cast.success.map(|success| (success, i)))
        .collect();
    let counted = |item: &CastItem| {
        item.success
            .and_then(|success| in_all.get(&success).copied())
    };
    let anchors: Vec<usize> = shown.iter().filter_map(|&i| counted(&items[i])).collect();
    let amounts = cast_amounts(fight, filter, scope.perspective, &all, &anchors);
    let mut drawn = drawn.into_iter().peekable();
    for (i, item) in items.iter().enumerate() {
        let cell = cast_cell(fight, curated, item);
        if filter.contains(cast_time(fight, item)) {
            lanes.count(fight, &cell, i64::from(item.success.is_some()));
        }
        if let Some((_, found)) = drawn.next_if(|(at, _)| *at == i) {
            let mut mark = spanned_item(fight, item, found);
            mark.amount = counted(item).and_then(|a| amounts.get(&a).copied());
            lanes.item(fight, &cell, mark);
        }
    }
}

/// Every cast of `side` with a success among `items`, unscoped: the casts hits are matched to.
pub(crate) fn side_casts(fight: &Fight, side: Side, items: &[CastItem]) -> Vec<CastItem> {
    items
        .iter()
        .filter(|item| item.success.is_some() && casts_of(fight, side, item))
        .cloned()
        .collect()
}

/// Whose casts the context lane shows: the encounter's bosses; in a run (no bosses), enemies.
fn context_casters<'a>(fight: &'a Fight, bosses: &'a [ActorId]) -> impl Fn(ActorId) -> bool + 'a {
    let enemies = casters(fight, Side::Enemy);
    move |actor| {
        if bosses.is_empty() {
            enemies(actor)
        } else {
            bosses.contains(&actor)
        }
    }
}

/// The casts of the context lane's casters, each success its own cast.
pub(crate) fn context_items(fight: &Fight, curated: &Curated, bosses: &[ActorId]) -> Vec<CastItem> {
    cast_items(
        fight,
        curated,
        &HashSet::new(),
        context_casters(fight, bosses),
    )
}

/// Casts of the encounter's `bosses` among `items` drawn in the window; a run (no bosses) shows
/// the cast-time casts of enemies. Their amount is the damage to players with the spell's name
/// in the 10 s after, up to the next cast of that name anywhere in the pull.
pub(crate) fn boss_casts(
    fight: &Fight,
    filter: &ReportFilter,
    window: Window,
    bosses: &[ActorId],
    items: Vec<CastItem>,
    spans: &SpanIndex<'_>,
) -> Vec<TimelineItem> {
    let wanted = context_casters(fight, bosses);
    let items: Vec<CastItem> = items
        .into_iter()
        .filter(|item| {
            wanted(item.caster)
                && item.kind != CastKind::Rejected
                && (!bosses.is_empty()
                    || (item.begin.is_some() && casts_of(fight, Side::Enemy, item)))
        })
        .collect();
    let drawn = drawn(spans, window, &items);
    let shown: Vec<usize> = drawn.iter().map(|(i, _)| *i).collect();
    let facts = AmountFacts::Taken {
        hostile_sources_only: true,
    };
    let amounts = until_next_cast(
        fight,
        filter,
        facts,
        None,
        &items,
        &shown,
        AmountRule::BossCast,
    );
    drawn
        .into_iter()
        .map(|(i, found)| {
            let mut mark = spanned_item(fight, &items[i], found);
            mark.amount = amounts.get(&i).copied();
            mark
        })
        .collect()
}

fn is_empower(fight: &Fight, item: &CastItem) -> bool {
    item.stage.is_some()
        || item
            .begin
            .is_some_and(|begin| matches!(fight.events[begin].kind, EventKind::EmpowerStart))
}
