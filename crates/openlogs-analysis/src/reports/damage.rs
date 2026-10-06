use std::collections::HashMap;

use crate::actors::ActorId;
use crate::fight::Fight;
use crate::filter::{Attribution, ReportFilter};
use crate::reports::{
    AbilityRow, PetNames, RowKind, Rows, Share, damage_share, per_second, sorted_by_amount,
};

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
}

#[derive(Debug, Clone, PartialEq)]
pub struct DamageReport {
    pub duration_ms: u64,
    pub total: u64,
    pub players: Vec<PlayerDamage>,
}

#[derive(Default)]
struct Acc {
    own: u64,
    received: u64,
    given: u64,
    self_support: u64,
    rows: Rows,
    recipients: HashMap<ActorId, u64>,
    givers: HashMap<ActorId, u64>,
}

pub fn damage_done(fight: &Fight, filter: &ReportFilter) -> DamageReport {
    let mut acc: HashMap<ActorId, Acc> = HashMap::new();
    let mut pets = PetNames::default();
    for event in fight.events.iter().filter(|e| filter.contains(e.t)) {
        match damage_share(fight, event) {
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
                entry
                    .rows
                    .add(spell, actor, kind, amount as i64, 0, critical, periodic);
            }
            Some(Share::Support {
                player,
                evoker,
                spell,
                amount,
            }) => {
                let buffed = acc.entry(player).or_default();
                buffed.received += amount;
                buffed.rows.add(
                    spell,
                    evoker,
                    RowKind::SupportDeducted,
                    -(amount as i64),
                    0,
                    false,
                    false,
                );
                *buffed.givers.entry(evoker).or_default() += amount;
                let giver = acc.entry(evoker).or_default();
                giver.given += amount;
                giver.rows.add(
                    spell,
                    evoker,
                    RowKind::SupportGiven,
                    amount as i64,
                    0,
                    false,
                    false,
                );
                *giver.recipients.entry(player).or_default() += amount;
            }
            Some(Share::SelfSupport {
                player,
                spell,
                amount,
            }) => {
                let entry = acc.entry(player).or_default();
                entry.self_support += amount;
                // Reattributed rows credit the own share like any support and deduct it again,
                // so the rows add up to the total.
                entry.rows.add(
                    spell,
                    player,
                    RowKind::SupportGiven,
                    amount as i64,
                    0,
                    false,
                    false,
                );
                entry.rows.add(
                    spell,
                    player,
                    RowKind::SupportDeducted,
                    -(amount as i64),
                    0,
                    false,
                    false,
                );
            }
            None => {}
        }
    }

    let reattributed = filter.attribution == Attribution::Reattributed;
    let duration_ms = filter.duration_ms(fight);
    let mut players: Vec<PlayerDamage> = acc
        .into_iter()
        .map(|(player, a)| {
            // Saturating: a support share whose main hit fell outside the range must not underflow.
            let total = if reattributed {
                (a.own + a.given).saturating_sub(a.received)
            } else {
                a.own
            };
            PlayerDamage {
                player,
                own: a.own,
                support_received: a.received,
                support_given: a.given,
                support_self: a.self_support,
                total,
                per_second: per_second(total, duration_ms),
                share: 0.0,
                abilities: a.rows.into_sorted(reattributed),
                support_by_recipient: sorted_by_amount(a.recipients),
                support_received_from: sorted_by_amount(a.givers),
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
    DamageReport {
        duration_ms,
        total,
        players,
    }
}
