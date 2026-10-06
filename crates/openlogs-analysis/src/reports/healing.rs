use std::collections::HashMap;

use crate::actors::ActorId;
use crate::fight::Fight;
use crate::filter::{Attribution, ReportFilter};
use crate::reports::{
    AbilityRow, PetNames, RowKind, Rows, Share, healing_share, per_second, sorted_by_amount,
};

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerHealing {
    pub player: ActorId,
    /// Effective healing (without overheal) of own and pet heals, as logged.
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
}

#[derive(Debug, Clone, PartialEq)]
pub struct HealingReport {
    pub duration_ms: u64,
    pub total: u64,
    pub overheal: u64,
    pub players: Vec<PlayerHealing>,
}

#[derive(Default)]
struct Acc {
    healing: u64,
    absorbs: u64,
    overheal: u64,
    received: u64,
    given: u64,
    self_support: u64,
    rows: Rows,
    recipients: HashMap<ActorId, u64>,
    givers: HashMap<ActorId, u64>,
}

fn move_support(
    acc: &mut HashMap<ActorId, Acc>,
    spell: u32,
    player: ActorId,
    evoker: ActorId,
    amount: u64,
) {
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

pub fn healing(fight: &Fight, filter: &ReportFilter) -> HealingReport {
    let mut acc: HashMap<ActorId, Acc> = HashMap::new();
    let mut pets = PetNames::default();
    for event in fight.events.iter().filter(|e| filter.contains(e.t)) {
        match healing_share(fight, event) {
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
                let actor = pets.representative(fight, player, actor);
                let kind = if actor == player {
                    RowKind::Own
                } else {
                    RowKind::Pet
                };
                let entry = acc.entry(player).or_default();
                if absorb {
                    entry.absorbs += amount;
                } else {
                    entry.healing += amount;
                    entry.overheal += overheal;
                }
                entry.rows.add(
                    spell,
                    actor,
                    kind,
                    amount as i64,
                    overheal,
                    critical,
                    periodic,
                );
            }
            Some(Share::Support {
                player,
                evoker,
                spell,
                amount,
            }) => {
                move_support(&mut acc, spell, player, evoker, amount);
            }
            Some(Share::SelfSupport {
                player,
                spell,
                amount,
            }) => {
                let entry = acc.entry(player).or_default();
                entry.self_support += amount;
                // As in damage: credited and deducted again, so the rows add up to the total.
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
    let all: Vec<PlayerHealing> = acc
        .into_iter()
        .map(|(player, a)| {
            let own = a.healing + a.absorbs;
            let total = if reattributed {
                (own + a.given).saturating_sub(a.received)
            } else {
                own
            };
            PlayerHealing {
                player,
                healing: a.healing,
                absorbs: a.absorbs,
                overheal: a.overheal,
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
        .collect();
    // Overheal counts even for players whose healing was all overheal.
    let overheal = all.iter().map(|p| p.overheal).sum();
    let mut players: Vec<PlayerHealing> = all.into_iter().filter(|p| p.total > 0).collect();
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
    }
}
