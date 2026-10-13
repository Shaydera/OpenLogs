use std::collections::BTreeMap;

use openlogs_analysis::{ActorId, ActorKind, Fight, InterruptsReport, SpellId};
use serde::Serialize;

use crate::overview_dto::{PlayerRef, SpellRef};
use crate::refs::{Refs, name_of};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptDto {
    pub t: i32,
    pub player: ActorId,
    pub spell_id: SpellId,
    pub target_name: Option<String>,
    pub interrupted_id: SpellId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispelDto {
    pub t: i32,
    pub player: ActorId,
    pub spell_id: SpellId,
    pub target_name: Option<String>,
    /// The target when it is a player (in `roster`): shown with its icon and class colour.
    pub target: Option<ActorId>,
    pub removed_id: SpellId,
    pub stolen: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissedCastDto {
    pub t: i32,
    pub source_name: Option<String>,
    pub spell_id: SpellId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptsReportDto {
    pub interrupts: Vec<InterruptDto>,
    pub dispels: Vec<DispelDto>,
    pub missed: Vec<MissedCastDto>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

pub fn interrupts_report_dto(fight: &Fight, report: &InterruptsReport) -> InterruptsReportDto {
    let mut refs = Refs::default();
    let interrupts = report
        .interrupts
        .iter()
        .map(|i| InterruptDto {
            t: i.t,
            player: refs.player(i.player),
            spell_id: refs.spell(fight, i.spell),
            target_name: name_of(fight, i.target),
            interrupted_id: refs.spell(fight, i.interrupted),
        })
        .collect();
    let dispels = report
        .dispels
        .iter()
        .map(|d| DispelDto {
            t: d.t,
            player: refs.player(d.player),
            spell_id: refs.spell(fight, d.spell),
            target_name: name_of(fight, d.target),
            target: (fight.actors.get(d.target).kind == ActorKind::Player)
                .then(|| refs.player(d.target)),
            removed_id: refs.spell(fight, d.removed),
            stolen: d.stolen,
        })
        .collect();
    let missed = report
        .missed
        .iter()
        .map(|m| MissedCastDto {
            t: m.t,
            source_name: name_of(fight, m.source),
            spell_id: refs.spell(fight, m.spell),
        })
        .collect();
    let (roster, spells) = refs.finish(fight);
    InterruptsReportDto {
        interrupts,
        dispels,
        missed,
        roster,
        spells,
    }
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{Actors, DispelEntry, InterruptsReport};

    use super::*;
    use crate::test_fight::{HOSTILE_FLAGS, PLAYER_FLAGS, fight, unit};

    #[test]
    fn only_dispelled_players_are_named_as_targets_and_join_the_roster() {
        let mut actors = Actors::new();
        let paladin = unit(&mut actors, "Player-1", "Puran-Ironmoor-EU", PLAYER_FLAGS);
        let aleth = unit(&mut actors, "Player-2", "Aleth-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Vehicle-0-1-1-1-257758-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let fight = fight(actors, Vec::new());
        let dispel = |target| DispelEntry {
            t: 33_973,
            player: paladin,
            spell: 4987,
            target,
            removed: 1287036,
            stolen: false,
        };
        let report = InterruptsReport {
            interrupts: Vec::new(),
            dispels: vec![dispel(aleth), dispel(boss)],
            missed: Vec::new(),
        };
        let dto = interrupts_report_dto(&fight, &report);
        let targets: Vec<_> = dto
            .dispels
            .iter()
            .map(|d| (d.target, d.target_name.as_deref()))
            .collect();
        assert_eq!(
            targets,
            [
                (Some(aleth), Some("Aleth-Emberfall-EU")),
                (None, Some("Ula'tek"))
            ]
        );
        let roster: Vec<_> = dto.roster.iter().map(|p| p.actor_id).collect();
        assert_eq!(roster, [paladin, aleth]);
    }
}
