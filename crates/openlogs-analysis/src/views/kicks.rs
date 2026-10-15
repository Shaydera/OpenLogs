use crate::cells::in_scope;
use crate::fight::{EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::interrupts::{cell_of, kicks};
use crate::scope::Scope;
use crate::views::names::log_name;
use crate::views::timeline::{Lanes, log_lines, overlaps};
use crate::views::{EventRow, ItemKind, RowType, Sink, Summary, TimelineItem, Window};

/// Interrupts, dispels and steals by the side; the row's spell is the stopped one, `used` the
/// spell that stopped it.
pub(crate) fn rows(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    sink: &mut Sink,
) -> Summary {
    for (index, event, stopped) in kicks(fight, filter, scope.perspective) {
        if !in_scope(scope, fight, &cell_of(fight, event, stopped)) {
            continue;
        }
        let row_type = match event.kind {
            EventKind::Interrupt { .. } => RowType::Interrupt,
            EventKind::Stolen { .. } => RowType::Steal,
            _ => RowType::Dispel,
        };
        sink.row(event.t, || {
            let mut row = EventRow::new(
                index,
                event.t,
                row_type,
                log_name(event),
                (event.source, stopped, event.target),
            );
            row.used = Some(event.spell);
            row
        });
    }
    Summary::default()
}

/// A stopped cast began at most this long before its interrupt.
const CAST_LOOKBACK_MS: i32 = 30_000;

/// When the cast an interrupt at `index` stopped began: the caster's last begin of that spell, if
/// no outcome of that spell came after it (a channel has no begin to borrow).
fn cast_start(fight: &Fight, index: usize, stopped: SpellId) -> Option<i32> {
    let kick = &fight.events[index];
    fight.events[..index]
        .iter()
        .rev()
        .take_while(|e| kick.t - e.t <= CAST_LOOKBACK_MS)
        .find_map(|e| match e.kind {
            EventKind::Interrupt { interrupted }
                if e.target == kick.target && interrupted == stopped =>
            {
                Some(None)
            }
            _ if e.source != kick.target || e.spell != stopped => None,
            EventKind::CastStart | EventKind::EmpowerStart => Some(Some(e.t)),
            EventKind::CastSuccess
            | EventKind::CastFailed { .. }
            | EventKind::EmpowerEnd { .. }
            | EventKind::EmpowerInterrupt { .. } => Some(None),
            _ => None,
        })
        .flatten()
}

/// Interrupts and dispels marks: the spell used as the icon, the stopped spell and, for an
/// interrupt, how far into the cast it came.
pub(crate) fn marks(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    window: Window,
    lanes: &mut Lanes,
) {
    for (index, event, stopped) in kicks(fight, filter, scope.perspective) {
        let cell = cell_of(fight, event, stopped);
        if !in_scope(scope, fight, &cell) {
            continue;
        }
        lanes.count(fight, &cell, 1);
        if !overlaps(window, event.t, None) {
            continue;
        }
        let kind = match event.kind {
            EventKind::Interrupt { .. } => ItemKind::Interrupt,
            EventKind::Stolen { .. } => ItemKind::Steal,
            _ => ItemKind::Dispel,
        };
        let mut item = TimelineItem::new(kind, event.t, None);
        item.source = event.source;
        item.spell = stopped;
        item.target = event.target;
        item.used = Some(event.spell);
        if kind == ItemKind::Interrupt {
            item.cast_start_ms = cast_start(fight, index, stopped);
        }
        (item.log, item.log_more) = log_lines(fight, &[index]);
        lanes.item(fight, &cell, item);
    }
}
