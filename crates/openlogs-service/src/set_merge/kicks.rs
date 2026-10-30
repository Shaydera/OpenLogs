use std::mem::take;

use openlogs_analysis::{Fight, largest_first};
use serde::Serialize;

use super::{Merge, merge_roster, merge_rows, merge_spells, sum_spell_amounts, top_spell};
use crate::interrupts_dto::{
    DispelDto, InterruptDto, InterruptsReportDto, KickRowDto, MissedCastDto, SpellCountDto,
};
use crate::report_dto::FilterDto;
use crate::reports::interrupts;
use crate::scope_dto::{DimensionDto, RowKeyDto, ScopeDto, UnitDto, UnitRefDto};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetInterruptsDto {
    /// The set's rows and tallies; its interrupts, dispels and missed casts are in `pulls`.
    #[serde(flatten)]
    pub report: InterruptsReportDto,
    pub pulls: Vec<SetKicksPullDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetKicksPullDto {
    pub fight_index: u32,
    pub duration_ms: u64,
    pub interrupts: Vec<InterruptDto>,
    pub dispels: Vec<DispelDto>,
    pub missed: Vec<MissedCastDto>,
}

pub fn interrupts_set_part(
    fight_index: u32,
    fight: &Fight,
    filter: FilterDto,
    scope: ScopeDto,
    group: DimensionDto,
) -> SetInterruptsDto {
    let filter = filter.for_fight(fight);
    let analysed_ms = filter.to_filter(fight).duration_ms(fight);
    let mut report = interrupts(fight, filter, scope, group);
    SetInterruptsDto {
        pulls: vec![SetKicksPullDto {
            fight_index,
            duration_ms: analysed_ms,
            interrupts: take(&mut report.interrupts),
            dispels: take(&mut report.dispels),
            missed: take(&mut report.missed),
        }],
        report,
    }
}

impl Merge for SetInterruptsDto {
    fn merge(&mut self, next: Self) {
        let report = &mut self.report;
        merge_kick_rows(&mut report.interrupt_rows, next.report.interrupt_rows);
        merge_kick_rows(&mut report.dispel_rows, next.report.dispel_rows);
        merge_roster(&mut report.roster, next.report.roster);
        merge_spells(&mut report.spells, next.report.spells);
        self.pulls.extend(next.pulls);
    }

    fn finish(&mut self) {
        let report = &mut self.report;
        rank_kick_rows(&mut report.interrupt_rows);
        rank_kick_rows(&mut report.dispel_rows);

        let interrupts = || self.pulls.iter().flat_map(|p| &p.interrupts);
        let mut stopped: Vec<SpellCountDto> = Vec::new();
        merge_rows(
            &mut stopped,
            interrupts()
                .map(|i| SpellCountDto {
                    spell_id: i.interrupted_id,
                    count: 1,
                })
                .collect(),
            |a, b| a.spell_id == b.spell_id,
            |a, b| a.count += b.count,
        );
        report.most_interrupted = stopped
            .into_iter()
            .reduce(|best, next| if next.count > best.count { next } else { best });
        report.kickers = distinct_units(interrupts().map(|i| &i.source));
        report.dispellers = distinct_units(
            self.pulls
                .iter()
                .flat_map(|p| &p.dispels)
                .map(|d| &d.source),
        );
    }
}

fn merge_kick_rows(rows: &mut Vec<KickRowDto>, next: Vec<KickRowDto>) {
    merge_rows(
        rows,
        next,
        |a, b| a.key == b.key,
        |a, b| {
            a.count += b.count;
            sum_spell_amounts(&mut a.spell_counts, b.spell_counts);
        },
    );
}

fn rank_kick_rows(rows: &mut [KickRowDto]) {
    for row in rows.iter_mut() {
        if let RowKeyDto::Ability { .. } = row.key {
            row.spell_id = top_spell(&row.spell_counts).unwrap_or(row.spell_id);
        }
    }
    rows.sort_by_cached_key(|r| largest_first(r.count, r.key.to_key()));
}

fn distinct_units<'a>(sources: impl Iterator<Item = &'a UnitDto>) -> u32 {
    let mut seen: Vec<&UnitRefDto> = Vec::new();
    for source in sources {
        if !seen.contains(&&source.unit) {
            seen.push(&source.unit);
        }
    }
    seen.len() as u32
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{
        ActorId, Actors, AuraType, Event, EventKind, Fight, SpellId, SpellInfo,
    };

    use super::*;
    use crate::scope_dto::{DimensionDto, ScopeDto};
    use crate::set_merge::tests::{WHOLE, merged};
    use crate::test_fight::{HOSTILE_FLAGS, PLAYER_FLAGS, fight, unit};

    const KICK: SpellId = 1766;
    const CLEANSE: SpellId = 4987;

    fn interrupt(t: i32, source: ActorId, target: ActorId, interrupted: SpellId) -> Event {
        Event {
            t,
            source,
            target,
            spell: KICK,
            kind: EventKind::Interrupt { interrupted },
            source_logged_hostile: false,
            target_logged_hostile: true,
            unit_hp: None,
        }
    }

    fn dispel(t: i32, source: ActorId, target: ActorId) -> Event {
        Event {
            t,
            source,
            target,
            spell: CLEANSE,
            kind: EventKind::Dispel {
                removed: 100,
                aura_type: AuraType::Debuff,
            },
            source_logged_hostile: false,
            target_logged_hostile: false,
            unit_hp: None,
        }
    }

    struct Raid {
        a: ActorId,
        b: ActorId,
        boss: ActorId,
        actors: Actors,
    }

    fn raid() -> Raid {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let b = unit(&mut actors, "Player-2", "Aleth-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        Raid { a, b, boss, actors }
    }

    fn pull(raid: &Raid, events: Vec<Event>) -> Fight {
        let mut pull = fight(raid.actors.clone(), events);
        for id in [100, 101, 102] {
            pull.spells.insert(
                id,
                SpellInfo {
                    name: "Shadow Bolt".into(),
                    school: 32,
                },
            );
        }
        pull
    }

    fn set_of(pulls: &[Fight], group: DimensionDto) -> SetInterruptsDto {
        merged(
            pulls
                .iter()
                .enumerate()
                .map(|(i, pull)| {
                    interrupts_set_part(i as u32, pull, WHOLE, ScopeDto::default(), group)
                })
                .collect(),
        )
    }

    #[test]
    fn kicks_sum_per_row_and_count_kickers_once() {
        let raid = raid();
        let (a, b, boss) = (raid.a, raid.b, raid.boss);
        let pulls = [
            pull(&raid, vec![interrupt(1_000, a, boss, 100)]),
            pull(
                &raid,
                vec![
                    interrupt(2_000, a, boss, 100),
                    interrupt(3_000, b, boss, 100),
                ],
            ),
        ];
        let set = set_of(&pulls, DimensionDto::Source);
        let rows: Vec<_> = set
            .report
            .interrupt_rows
            .iter()
            .map(|row| (row.name.as_str(), row.count))
            .collect();
        assert_eq!(rows, [("Faelan", 2), ("Aleth", 1)]);
        assert_eq!(set.report.kickers, 2);
        let second: Vec<_> = set.pulls[1].interrupts.iter().map(|i| i.t).collect();
        assert_eq!(second, [2_000, 3_000]);
        assert_eq!(set.pulls[0].fight_index, 0);
        assert_eq!(set.pulls[1].duration_ms, 20_000);
    }

    #[test]
    fn dispels_sum_and_rank_in_their_own_rows() {
        let raid = raid();
        let (a, b, boss) = (raid.a, raid.b, raid.boss);
        let pulls = [
            pull(
                &raid,
                vec![dispel(1_000, a, b), interrupt(1_500, a, boss, 100)],
            ),
            pull(&raid, vec![dispel(2_000, b, a), dispel(3_000, b, a)]),
        ];
        let set = set_of(&pulls, DimensionDto::Source);
        let counts = |rows: &[KickRowDto]| {
            rows.iter()
                .map(|row| (row.name.clone(), row.count))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            counts(&set.report.dispel_rows),
            [("Aleth".to_string(), 2), ("Faelan".to_string(), 1)]
        );
        assert_eq!(
            counts(&set.report.interrupt_rows),
            [("Faelan".to_string(), 1)]
        );
    }

    #[test]
    fn a_stopped_spell_row_takes_the_icon_spell_stopped_most_over_the_set() {
        let raid = raid();
        let (a, boss) = (raid.a, raid.boss);
        let pulls = [
            pull(
                &raid,
                vec![
                    interrupt(1_000, a, boss, 100),
                    interrupt(2_000, a, boss, 101),
                ],
            ),
            pull(&raid, vec![interrupt(1_000, a, boss, 101)]),
        ];
        let set = set_of(&pulls, DimensionDto::Ability);
        assert_eq!(set.report.interrupt_rows.len(), 1);
        assert_eq!(set.report.interrupt_rows[0].spell_id, 101);
        assert_eq!(
            set.report.most_interrupted.map(|m| (m.spell_id, m.count)),
            Some((101, 2))
        );
    }

    #[test]
    fn the_first_spell_to_reach_the_top_count_is_the_most_interrupted() {
        let raid = raid();
        let (a, boss) = (raid.a, raid.boss);
        let pulls = [
            pull(&raid, vec![interrupt(1_000, a, boss, 100)]),
            pull(&raid, vec![interrupt(1_000, a, boss, 102)]),
        ];
        let set = set_of(&pulls, DimensionDto::Source);
        assert_eq!(set.report.most_interrupted.map(|m| m.spell_id), Some(100));
    }
}
