use crate::actors::NOBODY;
use crate::cells::{Cell, CellKind, in_range, in_scope};
use crate::fight::{DamageVia, Event, EventKind, Fight, MissType};
use crate::filter::{Attribution, ReportFilter};
use crate::reports::{Share, buffed_hit, damage_share, healing_share};
use crate::scope::{Scope, unit_of};
use crate::views::names::log_name;
use crate::views::parts::{AmountFacts, Part, listed_row};
use crate::views::{EventRow, RowType, SharePart, Sink, Summary};

/// A support event with the hit it belongs to: what the row shows and what it books.
struct Attached {
    share: SharePart,
    parts: Vec<Part>,
}

pub(crate) fn part_cell(fight: &Fight, part: &Part) -> Cell {
    Cell {
        source: unit_of(fight, part.source),
        spell: part.spell,
        kind: part.kind,
        target: unit_of(fight, part.target),
        amount: part.amount,
        absorbed: part.absorbed,
        hits: u32::from(part.hit),
        crits: u32::from(part.hit && part.crit),
    }
}

/// The parts the event at `index` books, as the table books them.
pub(crate) fn parts_at(
    fight: &Fight,
    facts: AmountFacts,
    index: usize,
    reattributed: bool,
) -> Vec<Part> {
    let mut parts = Vec::new();
    facts.parts(fight, index, reattributed, &mut |part| parts.push(part));
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
fn support_of(fight: &Fight, facts: AmountFacts, index: usize) -> Option<SharePart> {
    let event = &fight.events[index];
    let share = match facts {
        AmountFacts::DamageDone => damage_share(fight, event),
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
        let Some(mut share) = support_of(fight, facts, index) else {
            continue;
        };
        let parts = parts_at(fight, facts, index, reattributed);
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
        let mut own = None;
        facts.parts(fight, index, reattributed, &mut |part| {
            if part.hit && part.row == Some(index) {
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
    row.amount = Some(own.amount.max(0) as u64);
    row.target_hp = event
        .unit_hp
        .filter(|hp| hp.actor == event.target)
        .map(|hp| (hp.current, hp.max));
    match event.kind {
        EventKind::Damage(damage) => {
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
