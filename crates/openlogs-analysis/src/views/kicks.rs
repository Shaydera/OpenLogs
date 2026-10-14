use crate::cells::in_scope;
use crate::fight::{EventKind, Fight};
use crate::filter::ReportFilter;
use crate::interrupts::{cell_of, kicks};
use crate::scope::Scope;
use crate::views::names::log_name;
use crate::views::{EventRow, RowType, Sink, Summary};

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
