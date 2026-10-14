use std::collections::HashMap;

use crate::actors::ActorId;
use crate::aura_report::holds;
use crate::cells::{Cell, CellKind, in_range, in_scope};
use crate::fight::{AuraAction, AuraType, EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::scope::{Scope, unit_of};
use crate::views::names::log_name;
use crate::views::{EventRow, RowType, Sink, Summary};

/// Whether the scope keeps an aura of `applier` on `holder`.
pub(crate) fn aura_in_scope(
    fight: &Fight,
    scope: &Scope,
    applier: ActorId,
    spell: SpellId,
    holder: ActorId,
) -> bool {
    scope.selects_all()
        || in_scope(
            scope,
            fight,
            &Cell {
                source: unit_of(fight, applier),
                spell,
                kind: CellKind::Own,
                target: unit_of(fight, holder),
                amount: 1,
                absorbed: 0,
                hits: 1,
                crits: 0,
            },
        )
}

/// Aura rows of `aura_type` on the side's holders: applied, removed (with what broke it),
/// refreshed and stack changes.
pub(crate) fn rows(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    aura_type: AuraType,
    sink: &mut Sink,
) -> Summary {
    let mut broken: HashMap<(ActorId, SpellId), (i32, ActorId, SpellId)> = HashMap::new();
    for index in in_range(fight, filter) {
        let event = &fight.events[index];
        let EventKind::Aura {
            action,
            aura_type: kind,
            stacks,
            broken_by,
        } = event.kind
        else {
            continue;
        };
        if kind != aura_type || !holds(fight, event.target, event.target_hostile, scope.perspective)
        {
            continue;
        }
        let row_type = match action {
            AuraAction::Broken | AuraAction::BrokenSpell => {
                broken.insert(
                    (event.target, event.spell),
                    (event.t, event.source, broken_by),
                );
                continue;
            }
            AuraAction::Applied => RowType::Apply,
            AuraAction::Removed => RowType::Remove,
            AuraAction::Refresh => RowType::Refresh,
            AuraAction::AppliedDose | AuraAction::RemovedDose => RowType::Stack,
        };
        let by = match action {
            AuraAction::Removed => broken
                .remove(&(event.target, event.spell))
                .filter(|(t, _, _)| *t == event.t)
                .map(|(_, breaker, spell)| (breaker, spell)),
            _ => None,
        };
        if !aura_in_scope(fight, scope, event.source, event.spell, event.target) {
            continue;
        }
        sink.row(event.t, || {
            let mut row = EventRow::new(
                index,
                event.t,
                row_type,
                log_name(event),
                (event.source, event.spell, event.target),
            );
            row.stacks = stacks;
            row.by = by;
            row
        });
    }
    Summary::default()
}
