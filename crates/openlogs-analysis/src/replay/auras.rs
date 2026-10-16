use std::collections::HashMap;

use openlogs_gamedata::{CooldownCategory, Curated};

use crate::actors::ActorId;
use crate::auras::{AuraInterval, aura_intervals};
use crate::fight::{AuraAction, AuraType, EventKind, Fight, SpellId};
use crate::replay::units::{Roster, UnitKind};

/// Raid frame priorities after the curated list's (lower is shown first).
const HOSTILE_DEBUFF: u8 = 10;
const PERSONAL_DEFENSIVE: u8 = 20;
const RAID_DEFENSIVE: u8 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StackChange {
    pub t: i32,
    pub stacks: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayAura {
    pub target: ActorId,
    pub source: ActorId,
    pub spell: SpellId,
    pub buff: bool,
    pub start_ms: i32,
    pub end_ms: i32,
    /// The logged stack counts; one carried from before the pull starts at `start_ms`.
    pub stacks: Vec<StackChange>,
    /// The aura's raid frame priority (lower first); `None`: not shown on a raid frame.
    pub raid_frame: Option<u8>,
}

type Key = (ActorId, SpellId, ActorId);

#[derive(Clone, Copy)]
struct AuraLine {
    t: i32,
    action: AuraAction,
    stacks: Option<u32>,
}

pub(super) fn auras(fight: &Fight, curated: &Curated, roster: &Roster) -> Vec<ReplayAura> {
    let shown = |actor: ActorId| {
        matches!(
            roster.kind(actor),
            Some(UnitKind::Player | UnitKind::Boss | UnitKind::Add)
        )
    };
    let mut lines: HashMap<Key, Vec<AuraLine>> = HashMap::new();
    for event in &fight.events {
        if let EventKind::Aura { action, stacks, .. } = event.kind
            && shown(event.target)
        {
            lines
                .entry((event.target, event.spell, event.source))
                .or_default()
                .push(AuraLine {
                    t: event.t,
                    action,
                    stacks,
                });
        }
    }
    aura_intervals(fight)
        .into_iter()
        .filter(|interval| shown(interval.target))
        .map(|interval| {
            let key = (interval.target, interval.spell, interval.source);
            let lines = lines.get(&key).map_or(&[][..], Vec::as_slice);
            ReplayAura {
                target: interval.target,
                source: interval.source,
                spell: interval.spell,
                buff: interval.aura_type == AuraType::Buff,
                start_ms: interval.start_ms,
                end_ms: interval.end_ms,
                stacks: stack_changes(&interval, lines),
                raid_frame: raid_frame(fight, curated, roster, &interval),
            }
        })
        .collect()
}

/// The stack counts logged inside the interval. An interval cut at the pull start begins with
/// the count of its last dose before it.
fn stack_changes(interval: &AuraInterval, lines: &[AuraLine]) -> Vec<StackChange> {
    let (before, inside) = lines.split_at(lines.partition_point(|line| line.t < interval.start_ms));
    let opened_inside = inside
        .first()
        .is_some_and(|line| line.t == interval.start_ms && line.action == AuraAction::Applied);
    let carried = (interval.start_ms == 0 && !opened_inside)
        .then(|| {
            before.iter().rev().find(|line| {
                line.stacks.is_some()
                    || matches!(line.action, AuraAction::Applied | AuraAction::Removed)
            })
        })
        .flatten()
        .filter(|line| line.action != AuraAction::Removed)
        .and_then(|line| line.stacks)
        .map(|stacks| StackChange {
            t: interval.start_ms,
            stacks,
        });
    let inside = inside
        .iter()
        .take_while(|line| line.t < interval.end_ms)
        .filter_map(|line| {
            Some(StackChange {
                t: line.t,
                stacks: line.stacks?,
            })
        });
    carried.into_iter().chain(inside).collect()
}

fn raid_frame(
    fight: &Fight,
    curated: &Curated,
    roster: &Roster,
    interval: &AuraInterval,
) -> Option<u8> {
    let spell = interval.spell;
    if roster.kind(interval.target) != Some(UnitKind::Player) || curated.raid_frame_excluded(spell)
    {
        return None;
    }
    if interval.aura_type == AuraType::Debuff && interval.source_hostile {
        return Some(HOSTILE_DEBUFF);
    }
    if let Some(priority) = curated.raid_frame_priority(spell) {
        return Some(priority);
    }
    let target_spec = fight.actors.get(interval.target).spec_id;
    if target_spec.is_some_and(|spec| curated.defensive(spell, spec).is_some()) {
        return Some(PERSONAL_DEFENSIVE);
    }
    let caster_spec = fight
        .actors
        .credited_player(interval.source)
        .and_then(|player| fight.actors.get(player).spec_id);
    curated
        .cooldown(spell, caster_spec)
        .filter(|cooldown| cooldown.category == CooldownCategory::RaidDefensive)
        .map(|_| RAID_DEFENSIVE)
}
