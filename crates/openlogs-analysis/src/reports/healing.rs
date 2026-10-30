use std::collections::HashMap;

use crate::actors::{ActorId, ActorKind};
use crate::fight::Fight;
use crate::filter::{Attribution, ReportFilter};
use crate::reports::{
    AbilityRow, AbilityTargets, Absorbs, BuffShare, PetNames, Share, SupportAcc, SupportLedger,
    SupportShare, TargetShare, credit_support, heal_target, healing_share, keeps_own,
    keeps_support, per_second, sorted_by_amount, support_entry,
};
use crate::scope::Scope;

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerHealing {
    pub player: ActorId,
    /// Effective healing of own and pet heals, as logged.
    pub healing: u64,
    /// Damage prevented by the player's absorbs.
    pub absorbs: u64,
    pub overheal: u64,
    pub support_received: u64,
    pub support_given: u64,
    /// Support from the player's own buff; already inside `healing`/`absorbs`.
    pub support_self: u64,
    pub total: u64,
    pub per_second: f64,
    pub share: f64,
    pub abilities: Vec<AbilityRow>,
    pub support_by_recipient: Vec<(ActorId, u64)>,
    /// Support received, by Evoker.
    pub support_received_from: Vec<(ActorId, u64)>,
    /// Support received, by buff and Evoker.
    pub support_received_by_buff: Vec<BuffShare>,
    /// Support the player's buffs added (own share included), by buff.
    pub support_credited_by_buff: Vec<BuffShare>,
    /// By target, largest first, with the largest abilities on each.
    pub targets: Vec<TargetShare>,
    /// Each ability row by target.
    pub ability_targets: Vec<AbilityTargets>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HealingReport {
    pub duration_ms: u64,
    pub total: u64,
    pub overheal: u64,
    pub players: Vec<PlayerHealing>,
    /// Every support share by buff, Evoker, buffed player and ability; the same in both modes.
    pub support: Vec<SupportShare>,
}

#[derive(Default)]
struct Acc {
    healing: u64,
    absorbs: u64,
    costs: u64,
    overheal: u64,
    support: SupportAcc,
}

pub fn healing(fight: &Fight, filter: &ReportFilter) -> HealingReport {
    healing_in(fight, filter, &Scope::default())
}

/// The report of the shares `scope` keeps; ranks and totals are the scope's.
pub(crate) fn healing_in(fight: &Fight, filter: &ReportFilter, scope: &Scope) -> HealingReport {
    let reattributed = filter.attribution == Attribution::Reattributed;
    let mut acc: HashMap<ActorId, Acc> = HashMap::new();
    let mut pets = PetNames::default();
    let mut ledger = SupportLedger::default();
    for (index, event) in fight
        .events
        .iter()
        .enumerate()
        .filter(|(_, e)| filter.contains(e.t))
    {
        match healing_share(fight, event) {
            Some(Share::Own { actor, spell, .. } | Share::Cost { actor, spell, .. })
                if !keeps_own(fight, scope, actor, spell, event.target) => {}
            Some(Share::Own {
                player,
                actor,
                spell,
                amount,
                overheal,
                critical,
                periodic,
                absorb,
            }) => {
                let (actor, kind) = pets.row(fight, player, actor);
                let entry = acc.entry(player).or_default();
                if absorb {
                    entry.absorbs += amount;
                } else {
                    entry.healing += amount;
                    entry.overheal += overheal;
                }
                entry.support.rows.add(
                    spell,
                    actor,
                    kind,
                    heal_target(fight, event.target),
                    amount as i64,
                    Absorbs::of(event),
                    overheal,
                    critical,
                    periodic,
                );
            }
            Some(Share::Cost {
                player,
                actor,
                spell,
                amount,
            }) => {
                let (actor, kind) = pets.row(fight, player, actor);
                let entry = acc.entry(player).or_default();
                entry.costs += amount;
                entry.support.rows.take_back(
                    spell,
                    actor,
                    kind,
                    heal_target(fight, event.target),
                    amount,
                );
            }
            Some(Share::Support(support)) => {
                let target = heal_target(fight, support.target);
                let entry = support_entry(fight, &mut pets, index, support, target);
                let parts = keeps_support(fight, scope, &support, entry.ability.map(|a| a.spell));
                credit_support(
                    &mut acc,
                    |a| &mut a.support,
                    &mut ledger,
                    reattributed,
                    entry,
                    parts,
                );
            }
            None => {}
        }
    }

    let duration_ms = filter.duration_ms(fight);
    let all: Vec<PlayerHealing> = acc
        .into_iter()
        .map(|(player, a)| {
            let s = a.support;
            let healing = a.healing.saturating_sub(a.costs);
            let absorbs = a.absorbs.saturating_sub(a.costs.saturating_sub(a.healing));
            let own = healing + absorbs;
            let total = if reattributed {
                s.reattributed_total(own)
            } else {
                own
            };
            let support_received_by_buff = s.received_by_buff();
            let support_credited_by_buff = s.credited_by_buff(player);
            let parts = s.rows.into_parts(fight);
            PlayerHealing {
                player,
                healing,
                absorbs,
                overheal: a.overheal,
                support_received: s.received,
                support_given: s.given,
                support_self: s.self_support,
                total,
                per_second: per_second(total, duration_ms),
                share: 0.0,
                abilities: parts.rows,
                support_by_recipient: sorted_by_amount(s.recipients),
                support_received_from: sorted_by_amount(s.givers),
                support_received_by_buff,
                support_credited_by_buff,
                targets: parts.targets,
                ability_targets: parts.ability_targets,
            }
        })
        .collect();
    // Overheal counts even for players whose healing was all overheal.
    let overheal = all.iter().map(|p| p.overheal).sum();
    let mut players: Vec<PlayerHealing> = all
        .into_iter()
        .filter(|p| p.total > 0 && fight.actors.get(p.player).kind == ActorKind::Player)
        .collect();
    let total: u64 = players.iter().map(|p| p.total).sum();
    for p in &mut players {
        p.share = if total > 0 {
            p.total as f64 / total as f64
        } else {
            0.0
        };
    }
    players.sort_by(|a, b| b.total.cmp(&a.total).then(a.player.cmp(&b.player)));
    HealingReport {
        duration_ms,
        total,
        overheal,
        players,
        support: ledger.into_sorted(),
    }
}
