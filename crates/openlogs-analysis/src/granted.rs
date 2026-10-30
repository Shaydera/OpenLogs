use crate::actors::NOBODY;
use crate::fight::{AuraAction, EventKind, Fight, SpellId};

/// The heal Healing Elixir makes its holder log as his own; the monk's buff grants it.
pub(crate) const HEALING_ELIXIR: SpellId = 428439;
/// The monk's Healing Elixir buffs on another player and on himself.
const HEALING_ELIXIR_BUFFS: [SpellId; 2] = [467281, 427296];

/// Records who put the buffs behind granted heals on whom, and [`NOBODY`] when one ended, as
/// loading does, for a fight built without loading it.
pub fn note_heal_grants(fight: &mut Fight) {
    let mut grants: Vec<_> = fight
        .events
        .iter()
        .filter(|event| HEALING_ELIXIR_BUFFS.contains(&event.spell))
        .filter_map(|event| match event.kind {
            EventKind::Aura {
                action: AuraAction::Applied | AuraAction::AppliedDose | AuraAction::Refresh,
                ..
            } => Some((event.target, event.t, event.source)),
            EventKind::Aura {
                action: AuraAction::Removed,
                ..
            } => Some((event.target, event.t, NOBODY)),
            _ => None,
        })
        .collect();
    grants.sort_unstable();
    fight.heal_grants = grants;
}
