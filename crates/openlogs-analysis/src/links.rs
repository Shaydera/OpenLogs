use std::collections::HashMap;

use crate::actors::ActorId;
use crate::fight::{Fight, SpellId};
use crate::filter::ReportFilter;
use crate::player::Metric;
use crate::reports::{Share, damage_share, healing_share};

/// How casts and auras are matched: by spell **name**, so a spell whose
/// aura has another ID than its cast (Death and Decay, Dancing Rune Weapon, Arcane Surge) has an
/// uptime and a spell logged under two cast IDs (Spatial Rift) is one row; the player page's ability
/// rows merge by it too (Arcane Missiles casts as 5143 and hits as 7268). Spells without a known
/// name are matched by ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum SpellKey<'a> {
    Name(&'a str),
    Id(SpellId),
}

pub(crate) fn spell_key(fight: &Fight, spell: SpellId) -> SpellKey<'_> {
    match fight.spells.get(&spell) {
        Some(info) if !info.name.is_empty() => SpellKey::Name(&info.name),
        _ => SpellKey::Id(spell),
    }
}

/// The ability page that holds a cast spell's hits: the spell ID and metric under which
/// the player has own damage or healing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AbilityLink {
    pub spell: SpellId,
    pub metric: Metric,
}

/// The players' own (not pet) damage and healing per spell in a range. Cast and hit IDs
/// often differ (Lava Burst casts as 51505 and hits as 285452), so links fall back to a
/// spell of the same name.
pub(crate) struct AbilityIndex {
    /// (player, spell) → (damage, healing).
    amounts: HashMap<(ActorId, SpellId), (u64, u64)>,
}

impl AbilityIndex {
    /// `only` limits the index to one player.
    pub(crate) fn new(fight: &Fight, filter: &ReportFilter, only: Option<ActorId>) -> Self {
        let mut amounts: HashMap<(ActorId, SpellId), (u64, u64)> = HashMap::new();
        let wanted =
            |player: ActorId, actor: ActorId| actor == player && only.is_none_or(|p| p == player);
        for event in fight.events.iter().filter(|e| filter.contains(e.t)) {
            if let Some(Share::Own {
                player,
                actor,
                spell,
                amount,
                ..
            }) = damage_share(fight, event)
                && wanted(player, actor)
            {
                amounts.entry((player, spell)).or_default().0 += amount;
            }
            if let Some(Share::Own {
                player,
                actor,
                spell,
                amount,
                ..
            }) = healing_share(fight, event)
                && wanted(player, actor)
            {
                amounts.entry((player, spell)).or_default().1 += amount;
            }
        }
        Self { amounts }
    }

    /// The metric with more of the player's own amount for `spell`, and that amount.
    fn best(&self, player: ActorId, spell: SpellId) -> Option<(Metric, u64)> {
        let &(damage, healing) = self.amounts.get(&(player, spell))?;
        match (damage, healing) {
            (0, 0) => None,
            (d, h) if h > d => Some((Metric::Healing, h)),
            (d, _) => Some((Metric::Damage, d)),
        }
    }

    /// The same spell ID if it has hits, else the spell of the same name with the most.
    pub(crate) fn link(
        &self,
        fight: &Fight,
        player: ActorId,
        spell: SpellId,
    ) -> Option<AbilityLink> {
        if let Some((metric, _)) = self.best(player, spell) {
            return Some(AbilityLink { spell, metric });
        }
        let name = fight.spells.get(&spell)?.name.as_str();
        self.amounts
            .keys()
            .filter(|&&(p, id)| {
                p == player
                    && id != spell
                    && fight.spells.get(&id).is_some_and(|info| info.name == name)
            })
            .filter_map(|&(_, id)| {
                self.best(player, id)
                    .map(|(metric, amount)| (amount, id, metric))
            })
            .max_by_key(|&(amount, id, _)| (amount, std::cmp::Reverse(id)))
            .map(|(_, spell, metric)| AbilityLink { spell, metric })
    }
}
