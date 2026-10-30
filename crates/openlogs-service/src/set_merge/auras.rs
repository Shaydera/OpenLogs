use std::collections::{BTreeMap, BTreeSet};

use openlogs_analysis::{EBON_MIGHT, Fight, SourceSpec, SpellId, coverage, union_ms};
use serde::Serialize;

use super::{Merge, merge_roster, merge_rows, merge_spells, spell_key};
use crate::auras_dto::{
    AuraHolderDto, AuraKindDto, AuraLaneDto, AuraRowDto, AurasReportDto, EbonMightDto,
};
use crate::overview_dto::SpellRef;
use crate::report_dto::FilterDto;
use crate::reports::auras;
use crate::scope_dto::{DimensionDto, ScopeDto};

/// A set's auras in set time: the pulls' windows back to back from 0.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAurasDto {
    #[serde(flatten)]
    pub report: AurasReportDto,
    pub pulls: Vec<SeamDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeamDto {
    pub fight_index: u32,
    pub start_ms: i32,
    pub end_ms: i32,
}

/// One pull's part of a set's auras report, to be merged with [`Merge`].
pub fn auras_set_part(
    fight_index: u32,
    fight: &Fight,
    filter: FilterDto,
    scope: ScopeDto,
    kind: AuraKindDto,
    group: DimensionDto,
) -> SetAurasDto {
    let mut report = auras(fight, filter, scope, kind, group);
    shift_intervals(&mut report.rows, -report.start_ms);
    report.end_ms -= report.start_ms;
    report.start_ms = 0;
    SetAurasDto {
        pulls: vec![SeamDto {
            fight_index,
            start_ms: 0,
            end_ms: report.end_ms,
        }],
        report,
    }
}

fn shift_intervals(rows: &mut [AuraRowDto], by: i32) {
    for interval in rows
        .iter_mut()
        .flat_map(|row| &mut row.lanes)
        .flat_map(|lane| &mut lane.intervals)
    {
        interval[0] += by;
        interval[1] += by;
    }
}

impl Merge for SetAurasDto {
    fn merge(&mut self, mut next: Self) {
        let offset = self.report.end_ms;
        shift_intervals(&mut next.report.rows, offset);
        for seam in &mut next.pulls {
            seam.start_ms += offset;
            seam.end_ms += offset;
        }
        let report = &mut self.report;
        report.end_ms += next.report.end_ms;
        merge_roster(&mut report.roster, next.report.roster);
        merge_spells(&mut report.spells, next.report.spells);
        let spells = &report.spells;
        merge_rows(
            &mut report.rows,
            next.report.rows,
            |a, b| a.key == b.key && (a.holder.is_some() || same_cluster(&a.lanes, &b.lanes)),
            |a, b| {
                let by_holder = a.holder.is_some();
                merge_lanes(&mut a.lanes, b.lanes, spells, by_holder)
            },
        );
        report.player_ids.extend(next.report.player_ids);
        self.pulls.extend(next.pulls);
    }

    fn finish(&mut self) {
        let report = &mut self.report;
        let duration = f64::from(report.end_ms);
        let mut ebon_might: Vec<Vec<(i32, i32)>> = Vec::new();
        for row in &mut report.rows {
            let mut spell_counts = Vec::new();
            let mut source_counts = Vec::new();
            for lane in &mut row.lanes {
                lane.spell_ids = by_count(&mut lane.spell_counts);
                lane.spell_id = lane.spell_ids.first().copied().unwrap_or(lane.spell_id);
                lane.sources = by_count(&mut lane.source_counts);
                let held_ms: i64 = lane.intervals.iter().map(|[a, b]| i64::from(b - a)).sum();
                lane.uptime = held_ms as f64 / duration;
                if lane.spell_ids.contains(&EBON_MIGHT) {
                    ebon_might.push(lane.intervals.iter().map(|&[a, b]| (a, b)).collect());
                }
                sum_counts(&mut spell_counts, lane.spell_counts.clone());
                sum_counts(&mut source_counts, lane.source_counts.clone());
            }
            row.lanes.sort_by(|a, b| {
                b.uptime
                    .total_cmp(&a.uptime)
                    .then_with(|| a.holder.cmp(&b.holder))
                    .then(a.spell_id.cmp(&b.spell_id))
            });
            if row.holder.is_none() {
                row.spell_ids = by_count(&mut spell_counts);
                row.spell_id = row.spell_ids.first().copied().unwrap_or(row.spell_id);
                let held: Vec<(i32, i32)> = row
                    .lanes
                    .iter()
                    .flat_map(|l| &l.intervals)
                    .map(|&[a, b]| (a, b))
                    .collect();
                row.uptime = union_ms(&held, 0, report.end_ms) as f64 / duration;
            }
            row.sources = by_count(&mut source_counts);
            row.applications = row.lanes.iter().map(|l| l.applications).sum();
        }
        report.rows.sort_by(|a, b| {
            b.uptime
                .total_cmp(&a.uptime)
                .then(a.spell_id.cmp(&b.spell_id))
                .then_with(|| a.holder.cmp(&b.holder))
        });
        report.ebon_might = coverage(&ebon_might, 0, report.end_ms)
            .map(|(uptime, allies)| EbonMightDto { uptime, allies });
        report.players = report.player_ids.len() as u32;
    }
}

// By holder, a row's lanes may be auras of one name that the analysis kept apart.
fn merge_lanes(
    lanes: &mut Vec<AuraLaneDto>,
    next: Vec<AuraLaneDto>,
    spells: &BTreeMap<SpellId, SpellRef>,
    by_holder: bool,
) {
    merge_rows(
        lanes,
        next,
        |a, b| {
            same_holder(&a.holder, &b.holder)
                && spell_key(spells, a.spell_id) == spell_key(spells, b.spell_id)
                && (!by_holder || same_cluster(std::slice::from_ref(a), std::slice::from_ref(b)))
        },
        |a, b| {
            a.applications += b.applications;
            a.intervals.extend(b.intervals);
            sum_counts(&mut a.spell_counts, b.spell_counts);
            sum_counts(&mut a.source_counts, b.source_counts);
            a.source_specs.extend(b.source_specs);
        },
    );
}

// Mirrors the analysis' clustering of one name: shared spell IDs or overlapping source specs.
fn same_cluster(a: &[AuraLaneDto], b: &[AuraLaneDto]) -> bool {
    let specs = |lanes: &[AuraLaneDto]| -> BTreeSet<SourceSpec> {
        lanes
            .iter()
            .flat_map(|l| &l.source_specs)
            .copied()
            .collect()
    };
    let ids = |lanes: &[AuraLaneDto]| -> BTreeSet<SpellId> {
        lanes
            .iter()
            .flat_map(|l| &l.spell_counts)
            .map(|&(id, _)| id)
            .collect()
    };
    !specs(a).is_disjoint(&specs(b)) || !ids(a).is_disjoint(&ids(b))
}

fn same_holder(a: &AuraHolderDto, b: &AuraHolderDto) -> bool {
    match (a.player, b.player) {
        (Some(a), Some(b)) => a == b,
        (None, None) => a.name == b.name,
        _ => false,
    }
}

fn sum_counts<K: PartialEq>(counts: &mut Vec<(K, u32)>, next: Vec<(K, u32)>) {
    merge_rows(counts, next, |a, b| a.0 == b.0, |a, b| a.1 += b.1);
}

fn by_count<K: Copy + Ord>(counts: &mut [(K, u32)]) -> Vec<K> {
    counts.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    counts.iter().map(|&(k, _)| k).collect()
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{
        ActorId, Actors, AuraAction, AuraType, Event, EventKind, NO_SPELL, SpellId, SpellInfo,
    };

    use super::*;
    use crate::set_merge::tests::{WHOLE, merged};
    use crate::test_fight::{PLAYER_FLAGS, fight, unit};

    const BLESSING: SpellId = 381750;
    const BLESSING_ALT: SpellId = 381758;
    const CLEARCASTING_MAGE: SpellId = 263725;
    const CLEARCASTING_DRUID: SpellId = 16870;

    fn buff(t: i32, action: AuraAction, source: ActorId, target: ActorId, spell: SpellId) -> Event {
        Event {
            t,
            source,
            target,
            spell,
            kind: EventKind::Aura {
                action,
                aura_type: AuraType::Buff,
                stacks: None,
                broken_by: NO_SPELL,
            },
            source_logged_hostile: false,
            target_logged_hostile: false,
            unit_hp: None,
        }
    }

    fn held(from: i32, to: i32, source: ActorId, target: ActorId, spell: SpellId) -> [Event; 2] {
        [
            buff(from, AuraAction::Applied, source, target, spell),
            buff(to, AuraAction::Removed, source, target, spell),
        ]
    }

    struct Raid {
        a: ActorId,
        b: ActorId,
        c: ActorId,
        mage: ActorId,
        druid: ActorId,
        actors: Actors,
    }

    fn raid() -> Raid {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let b = unit(&mut actors, "Player-2", "Aleth-Emberfall-EU", PLAYER_FLAGS);
        let c = unit(&mut actors, "Player-3", "Ulvara-Emberfall-EU", PLAYER_FLAGS);
        let mage = unit(&mut actors, "Player-4", "Wendel-Emberfall-EU", PLAYER_FLAGS);
        let druid = unit(&mut actors, "Player-5", "Morwen-Emberfall-EU", PLAYER_FLAGS);
        actors.set_spec(mage, 62);
        actors.set_spec(druid, 105);
        Raid {
            a,
            b,
            c,
            mage,
            druid,
            actors,
        }
    }

    fn pull(raid: &Raid, events: Vec<Event>) -> Fight {
        let mut pull = fight(raid.actors.clone(), events);
        let names = [
            (BLESSING, "Blessing of the Bronze"),
            (BLESSING_ALT, "Blessing of the Bronze"),
            (CLEARCASTING_MAGE, "Clearcasting"),
            (CLEARCASTING_DRUID, "Clearcasting"),
        ];
        for (id, name) in names {
            pull.spells.insert(
                id,
                SpellInfo {
                    name: name.into(),
                    school: 64,
                },
            );
        }
        pull
    }

    fn set_of(pulls: &[Fight], group: DimensionDto) -> SetAurasDto {
        merged(
            pulls
                .iter()
                .enumerate()
                .map(|(i, pull)| {
                    auras_set_part(
                        i as u32,
                        pull,
                        WHOLE,
                        ScopeDto::default(),
                        AuraKindDto::Buffs,
                        group,
                    )
                })
                .collect(),
        )
    }

    #[test]
    fn an_aura_in_one_pull_is_divided_by_the_summed_duration() {
        let raid = raid();
        let pulls = [
            pull(&raid, Vec::new()),
            pull(&raid, held(5_000, 15_000, raid.b, raid.a, BLESSING).into()),
        ];
        let set = set_of(&pulls, DimensionDto::Ability);
        let seams: Vec<_> = set
            .pulls
            .iter()
            .map(|s| (s.fight_index, s.start_ms, s.end_ms))
            .collect();
        assert_eq!(seams, [(0, 0, 20_000), (1, 20_000, 40_000)]);
        assert_eq!((set.report.start_ms, set.report.end_ms), (0, 40_000));
        assert_eq!(set.report.rows.len(), 1);
        let row = &set.report.rows[0];
        assert_eq!(row.uptime, 0.25);
        assert_eq!(row.lanes[0].intervals, [[25_000, 35_000]]);
    }

    #[test]
    fn an_aura_is_up_while_any_holder_has_it_across_the_pulls() {
        let raid = raid();
        let (a, b, c) = (raid.a, raid.b, raid.c);
        let first = [
            held(0, 10_000, c, a, BLESSING),
            held(5_000, 15_000, c, b, BLESSING),
        ];
        let pulls = [
            pull(&raid, first.concat()),
            pull(&raid, held(0, 5_000, c, a, BLESSING).into()),
        ];
        let set = set_of(&pulls, DimensionDto::Ability);
        assert_eq!(set.report.rows.len(), 1);
        let row = &set.report.rows[0];
        assert_eq!(uptimes(&row.lanes), [(BLESSING, 0.375), (BLESSING, 0.25)]);
        assert_eq!(row.uptime, 0.5);
    }

    #[test]
    fn ebon_might_is_taken_over_the_pulls_back_to_back() {
        let raid = raid();
        let (a, b, c) = (raid.a, raid.b, raid.c);
        let first = [
            held(0, 10_000, c, a, EBON_MIGHT),
            held(5_000, 15_000, c, b, EBON_MIGHT),
        ];
        let pulls = [
            pull(&raid, first.concat()),
            pull(&raid, held(0, 5_000, c, a, EBON_MIGHT).into()),
        ];
        let set = set_of(&pulls, DimensionDto::Ability);
        assert_eq!(
            set.report.ebon_might,
            Some(EbonMightDto {
                uptime: 0.5,
                allies: 1.25
            })
        );
    }

    #[test]
    fn a_lane_sums_applications_and_keeps_the_most_applied_spell_first() {
        let raid = raid();
        let (a, b, c) = (raid.a, raid.b, raid.c);
        let second = [
            held(0, 2_000, c, a, BLESSING_ALT),
            held(5_000, 7_000, c, a, BLESSING_ALT),
        ];
        let pulls = [
            pull(&raid, held(0, 5_000, b, a, BLESSING).into()),
            pull(&raid, second.concat()),
        ];
        let set = set_of(&pulls, DimensionDto::Ability);
        assert_eq!(set.report.rows.len(), 1);
        let row = &set.report.rows[0];
        assert_eq!(row.lanes.len(), 1);
        let lane = &row.lanes[0];
        assert_eq!((lane.applications, lane.uptime), (3, 0.225));
        assert_eq!(lane.spell_id, BLESSING_ALT);
        assert_eq!(lane.spell_ids, [BLESSING_ALT, BLESSING]);
        assert_eq!(lane.sources, [c, b]);
        assert_eq!(
            lane.intervals,
            [[0, 5_000], [20_000, 22_000], [25_000, 27_000]]
        );
        assert_eq!((row.spell_id, row.applications), (BLESSING_ALT, 3));
        assert_eq!(set.report.players, 1);
    }

    fn uptimes(lanes: &[AuraLaneDto]) -> Vec<(SpellId, f64)> {
        lanes.iter().map(|l| (l.spell_id, l.uptime)).collect()
    }

    #[test]
    fn auras_of_one_name_stay_apart_by_the_spec_that_applied_them() {
        let raid = raid();
        let (a, mage, druid) = (raid.a, raid.mage, raid.druid);
        let events = || {
            [
                held(0, 10_000, mage, a, CLEARCASTING_MAGE),
                held(0, 5_000, druid, a, CLEARCASTING_DRUID),
            ]
            .concat()
        };
        let pulls = [pull(&raid, events()), pull(&raid, events())];

        let by_aura = set_of(&pulls, DimensionDto::Ability);
        let rows: Vec<_> = by_aura
            .report
            .rows
            .iter()
            .map(|row| (row.spell_id, row.uptime, uptimes(&row.lanes)))
            .collect();
        assert_eq!(
            rows,
            [
                (CLEARCASTING_MAGE, 0.5, vec![(CLEARCASTING_MAGE, 0.5)]),
                (CLEARCASTING_DRUID, 0.25, vec![(CLEARCASTING_DRUID, 0.25)]),
            ]
        );

        let by_holder = set_of(&pulls, DimensionDto::Target);
        assert_eq!(by_holder.report.rows.len(), 1);
        assert_eq!(
            uptimes(&by_holder.report.rows[0].lanes),
            [(CLEARCASTING_MAGE, 0.5), (CLEARCASTING_DRUID, 0.25)]
        );
    }

    #[test]
    fn a_spell_applied_by_another_spec_in_a_later_pull_stays_one_aura() {
        let raid = raid();
        let (a, mage, druid) = (raid.a, raid.mage, raid.druid);
        let pulls = [
            pull(&raid, held(0, 5_000, mage, a, BLESSING).into()),
            pull(&raid, held(0, 5_000, druid, a, BLESSING).into()),
        ];
        let set = set_of(&pulls, DimensionDto::Ability);
        assert_eq!(set.report.rows.len(), 1);
        assert_eq!(uptimes(&set.report.rows[0].lanes), [(BLESSING, 0.25)]);
    }
}
