use std::collections::{BTreeSet, HashMap};

use crate::actors::ActorId;
use crate::fight::{Fight, SpellId};
use crate::filter::{Attribution, ReportFilter};
use crate::reports::{
    AbilityRow, AbilityTargets, BuffShare, GroupAbilities, PetNames, RowKind, Share, SupportAcc,
    SupportLedger, SupportShare, TOP_ABILITIES_PER_GROUP, TargetKey, TargetShare, UnitCounts,
    color_groups, credit_support, damage_share, damage_target, group_abilities, keeps_own,
    keeps_support, per_second, sorted_by_amount, support_entry,
};
use crate::scope::Scope;

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerDamage {
    pub player: ActorId,
    /// Own and pet damage as logged.
    pub own: u64,
    /// Part of `own` that came from other Evokers' buffs.
    pub support_received: u64,
    /// Shares this player's buffs added to others' hits.
    pub support_given: u64,
    /// Support from the player's own buff; already inside `own`.
    pub support_self: u64,
    /// `own` (Augmented) or `own − received + given` (Reattributed).
    pub total: u64,
    pub per_second: f64,
    pub share: f64,
    pub abilities: Vec<AbilityRow>,
    /// Support given, by buffed player.
    pub support_by_recipient: Vec<(ActorId, u64)>,
    /// Support received, by Evoker.
    pub support_received_from: Vec<(ActorId, u64)>,
    /// Support received, by buff and Evoker.
    pub support_received_by_buff: Vec<BuffShare>,
    /// Support the player's buffs added (own share included), by buff.
    pub support_credited_by_buff: Vec<BuffShare>,
    /// By target, largest first.
    pub targets: Vec<TargetShare>,
    /// Each ability row by target.
    pub ability_targets: Vec<AbilityTargets>,
    /// The largest abilities on each of the report's colour groups.
    pub group_abilities: Vec<GroupAbilities>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DamageReport {
    pub duration_ms: u64,
    pub total: u64,
    pub players: Vec<PlayerDamage>,
    /// Every support share by buff, Evoker, buffed player and ability; the same in both modes.
    pub support: Vec<SupportShare>,
    /// Units of each enemy name that took damage in the range.
    pub units: Vec<(String, u32)>,
    /// The raid's largest enemy groups in the range, largest first; the bars' colours.
    pub color_groups: Vec<String>,
}

#[derive(Default)]
struct Acc {
    own: u64,
    support: SupportAcc,
}

enum AbilityGroups {
    TopOfColorGroups,
    AllOfEveryEnemy,
}

pub fn damage_done(fight: &Fight, filter: &ReportFilter) -> DamageReport {
    damage_done_in(fight, filter, &Scope::default())
}

/// One pull of a set of pulls: group abilities cover every enemy name, untruncated, so the
/// set's own colour groups can be built from the merged pulls.
pub fn damage_done_set_part(fight: &Fight, filter: &ReportFilter) -> DamageReport {
    damage_done_grouped(
        fight,
        filter,
        &Scope::default(),
        AbilityGroups::AllOfEveryEnemy,
    )
}

/// The report of the shares `scope` keeps; ranks and totals are the scope's.
pub(crate) fn damage_done_in(fight: &Fight, filter: &ReportFilter, scope: &Scope) -> DamageReport {
    damage_done_grouped(fight, filter, scope, AbilityGroups::TopOfColorGroups)
}

fn damage_done_grouped(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    groups: AbilityGroups,
) -> DamageReport {
    let reattributed = filter.attribution == Attribution::Reattributed;
    let mut acc: HashMap<ActorId, Acc> = HashMap::new();
    let mut pets = PetNames::default();
    let mut ledger = SupportLedger::default();
    let mut units = UnitCounts::default();
    for (index, event) in fight
        .events
        .iter()
        .enumerate()
        .filter(|(_, e)| filter.contains(e.t))
    {
        match damage_share(fight, event, filter.overkill) {
            Some(Share::Own { actor, spell, .. })
                if !keeps_own(fight, scope, actor, spell, event.target) => {}
            Some(Share::Own {
                player,
                actor,
                spell,
                amount,
                critical,
                periodic,
                ..
            }) => {
                let actor = pets.representative(fight, player, actor);
                let kind = if actor == player {
                    RowKind::Own
                } else {
                    RowKind::Pet
                };
                let entry = acc.entry(player).or_default();
                entry.own += amount;
                entry.support.rows.add(
                    spell,
                    actor,
                    kind,
                    damage_target(event.target),
                    amount as i64,
                    0,
                    critical,
                    periodic,
                );
            }
            Some(Share::Support(support)) => {
                let target = damage_target(support.target);
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
    let mut target_spells = HashMap::new();
    let mut players: Vec<PlayerDamage> = acc
        .into_iter()
        .map(|(player, a)| {
            let s = a.support;
            let total = if reattributed {
                s.reattributed_total(a.own)
            } else {
                a.own
            };
            let support_received_by_buff = s.received_by_buff();
            let support_credited_by_buff = s.credited_by_buff(player);
            units.extend(s.rows.units());
            let parts = s.rows.into_parts(fight);
            target_spells.insert(player, parts.target_spells);
            PlayerDamage {
                player,
                own: a.own,
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
                group_abilities: Vec::new(),
            }
        })
        .filter(|p| p.total > 0)
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
    let color_groups = color_groups(players.iter().flat_map(|p| &p.targets));
    let every_enemy;
    let (groups, limit): (&[String], _) = match groups {
        AbilityGroups::TopOfColorGroups => (&color_groups, Some(TOP_ABILITIES_PER_GROUP)),
        AbilityGroups::AllOfEveryEnemy => {
            every_enemy = enemy_names(target_spells.values().flatten());
            (&every_enemy, None)
        }
    };
    for p in &mut players {
        p.group_abilities = group_abilities(&target_spells[&p.player], groups, limit);
    }
    DamageReport {
        duration_ms,
        total,
        players,
        support: ledger.into_sorted(),
        units: units.into_sorted(fight),
        color_groups,
    }
}

fn enemy_names<'a>(
    target_spells: impl Iterator<Item = &'a (TargetKey, SpellId, i64)>,
) -> Vec<String> {
    let names: BTreeSet<&str> = target_spells
        .filter_map(|(target, _, _)| match target {
            TargetKey::Unit(name) => Some(name.as_str()),
            _ => None,
        })
        .collect();
    names.into_iter().map(str::to_string).collect()
}
