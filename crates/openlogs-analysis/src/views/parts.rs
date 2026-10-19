use crate::actors::{ActorId, ActorKind, NOBODY};
use crate::cells::{CellKind, ScopeMetric};
use crate::fight::{DamageVia, Event, EventKind, Fight, NO_SPELL, SpellId};
use crate::filter::Overkill;
use crate::reports::taken::taken_amount;
use crate::reports::{Share, buffed_hit, damage_share, healing_share};
use crate::scope::Side;

/// The amount rule of Damage Done, Healing and Damage Taken from one side's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AmountFacts {
    /// Hits of players and their pets on hostile NPCs.
    DamageDone,
    /// Heals and absorbs of players and their pets on units that are not hostile.
    Healing,
    /// Damage players took; `hostile_sources_only` keeps what enemies did.
    Taken { hostile_sources_only: bool },
    /// Heals of hostile units on hostile units.
    EnemyHealing,
}

/// One amount an event books in a cell. A Reattributed support share books two: the Evoker's
/// credit and the deduction from the hit it was part of.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Part {
    pub source: ActorId,
    pub spell: SpellId,
    pub kind: CellKind,
    pub target: ActorId,
    pub amount: i64,
    pub absorbed: i64,
    pub hit: bool,
    pub crit: bool,
    /// The logged hit the part belongs to; `None` for support no hit matches.
    pub row: Option<usize>,
}

impl AmountFacts {
    pub(crate) fn of(side: Side, metric: ScopeMetric) -> Option<Self> {
        match (side, metric) {
            (Side::Friendly, ScopeMetric::DamageDone) | (Side::Enemy, ScopeMetric::DamageTaken) => {
                Some(Self::DamageDone)
            }
            (Side::Friendly, ScopeMetric::Healing) => Some(Self::Healing),
            (Side::Friendly, ScopeMetric::DamageTaken) => Some(Self::Taken {
                hostile_sources_only: false,
            }),
            (Side::Enemy, ScopeMetric::DamageDone) => Some(Self::Taken {
                hostile_sources_only: true,
            }),
            (Side::Enemy, ScopeMetric::Healing) => Some(Self::EnemyHealing),
            _ => None,
        }
    }

    /// Calls `book` with every part the event at `index` books.
    pub(crate) fn parts(
        self,
        fight: &Fight,
        index: usize,
        reattributed: bool,
        overkill: Overkill,
        book: &mut impl FnMut(Part),
    ) {
        let event = &fight.events[index];
        match self {
            Self::DamageDone => own_side(
                fight,
                index,
                damage_share(fight, event, overkill),
                reattributed,
                book,
            ),
            Self::Healing => own_side(
                fight,
                index,
                healing_share(fight, event),
                reattributed,
                book,
            ),
            Self::Taken {
                hostile_sources_only,
            } => taken(fight, index, hostile_sources_only, overkill, book),
            Self::EnemyHealing => enemy_healing(index, event, book),
        }
    }
}

fn own_side(
    fight: &Fight,
    index: usize,
    share: Option<Share>,
    reattributed: bool,
    book: &mut impl FnMut(Part),
) {
    let event = &fight.events[index];
    match share {
        Some(Share::Own {
            actor,
            spell,
            amount,
            critical,
            ..
        }) => book(Part {
            source: actor,
            spell,
            kind: CellKind::Own,
            target: event.target,
            amount: amount as i64,
            absorbed: logged_absorbed(event),
            hit: true,
            crit: critical,
            row: Some(index),
        }),
        Some(Share::Support(support)) if reattributed => {
            let amount = support.amount as i64;
            let hit = buffed_hit(fight, index);
            let row = hit.and_then(|(hit, _)| listed_row(fight, hit));
            book(Part {
                source: support.evoker,
                spell: support.buff,
                kind: CellKind::Support,
                target: support.target,
                amount,
                absorbed: 0,
                hit: false,
                crit: false,
                row,
            });
            let (spell, kind) = match hit {
                Some((_, spell)) => (spell, CellKind::Own),
                None => (NO_SPELL, CellKind::Unmatched),
            };
            book(Part {
                source: support.doer,
                spell,
                kind,
                target: support.target,
                amount: -amount,
                absorbed: 0,
                hit: false,
                crit: false,
                row,
            });
        }
        _ => {}
    }
}

/// A melee hit's landed copy follows its swing at most this long after.
const LANDED_MATCH_MS: i32 = 1_000;

/// The listed row of the hit at `index`. Melee support is logged after the hit's
/// SWING_DAMAGE_LANDED copy, which is never listed: its row is the swing it repeats.
pub(crate) fn listed_row(fight: &Fight, index: usize) -> Option<usize> {
    let hit = &fight.events[index];
    let EventKind::Damage(landed) = hit.kind else {
        return Some(index);
    };
    if landed.via != DamageVia::SwingLanded {
        return Some(index);
    }
    fight.events[..index]
        .iter()
        .enumerate()
        .rev()
        .take_while(|(_, swing)| hit.t - swing.t <= LANDED_MATCH_MS)
        .find(|(_, swing)| {
            swing.source == hit.source
                && swing.target == hit.target
                && matches!(swing.kind, EventKind::Damage(d)
                    if d.via == DamageVia::Swing && d.supporter == NOBODY && d.amount == landed.amount)
        })
        .map(|(i, _)| i)
}

fn logged_absorbed(event: &Event) -> i64 {
    match event.kind {
        EventKind::Damage(damage) => damage.absorbed as i64,
        _ => 0,
    }
}

fn taken(
    fight: &Fight,
    index: usize,
    hostile_sources_only: bool,
    overkill: Overkill,
    book: &mut impl FnMut(Part),
) {
    let event = &fight.events[index];
    let Some((amount, absorbed)) = taken_amount(event, overkill) else {
        return;
    };
    if fight.actors.get(event.target).kind != ActorKind::Player {
        return;
    }
    if hostile_sources_only && (event.source == NOBODY || !event.source_hostile) {
        return;
    }
    book(Part {
        source: event.source,
        spell: event.spell,
        kind: CellKind::Own,
        target: event.target,
        amount: amount as i64,
        absorbed: absorbed as i64,
        hit: true,
        crit: matches!(event.kind, EventKind::Damage(d) if d.critical),
        row: Some(index),
    });
}

fn enemy_healing(index: usize, event: &Event, book: &mut impl FnMut(Part)) {
    let EventKind::Heal(heal) = event.kind else {
        return;
    };
    if !(event.source_hostile && event.target_hostile) || heal.supporter != NOBODY {
        return;
    }
    book(Part {
        source: event.source,
        spell: event.spell,
        kind: CellKind::Own,
        target: event.target,
        amount: heal.amount.saturating_sub(heal.overheal) as i64,
        absorbed: 0,
        hit: true,
        crit: heal.critical,
        row: Some(index),
    });
}
