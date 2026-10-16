use openlogs_gamedata::{ChannelSpells, Curated};

use crate::actors::{ActorId, NOBODY};
use crate::casts::follow_up_casts;
use crate::fight::{Fight, SpellId};
use crate::replay::from_pull_start;
use crate::replay::units::Roster;
use crate::views::casts::{CastKind, cast_items};
use crate::views::spans::SpanIndex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayCastOutcome {
    Completed,
    Interrupted,
    /// A cast that began but ended without a success.
    Failed,
}

/// A cast of a unit, one per press. An instant cast has `start_ms == end_ms`; a channel ends
/// with its channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplayCast {
    pub caster: ActorId,
    pub spell: SpellId,
    pub target: Option<ActorId>,
    pub start_ms: i32,
    pub end_ms: i32,
    pub outcome: ReplayCastOutcome,
}

pub(super) fn casts(
    fight: &Fight,
    curated: &Curated,
    channels: &ChannelSpells,
    roster: &Roster,
) -> Vec<ReplayCast> {
    let is_unit = |actor: ActorId| roster.kind(actor).is_some();
    let follow_ups = follow_up_casts(fight, curated, is_unit);
    let items = cast_items(fight, curated, &follow_ups, is_unit);
    let spans = SpanIndex::new(fight, curated, channels, &items);
    items
        .iter()
        .filter_map(|item| {
            let outcome = match item.kind {
                CastKind::NoOutcome | CastKind::Rejected => return None,
                CastKind::Interrupted => ReplayCastOutcome::Interrupted,
                _ if item.success.is_none() => ReplayCastOutcome::Failed,
                _ => ReplayCastOutcome::Completed,
            };
            let end = spans.spans(item).span_end.unwrap_or(item.start);
            let (start_ms, end_ms) = from_pull_start(item.start, end.max(item.start))?;
            Some(ReplayCast {
                caster: item.caster,
                spell: item.spell,
                target: (item.target != NOBODY).then_some(item.target),
                start_ms,
                end_ms,
                outcome,
            })
        })
        .collect()
}
