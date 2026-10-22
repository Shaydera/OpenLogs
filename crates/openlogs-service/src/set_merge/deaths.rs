use std::collections::{BTreeMap, BTreeSet};
use std::mem::take;

use openlogs_analysis::{
    ActorId, Fight, Hit, ReportFilter, Scope, Side, SpellId, deaths, deaths_report, unit_of,
};
use openlogs_gamedata::Curated;
use serde::Serialize;

use super::{
    Merge, merge_roster, merge_rows, merge_spells, spell_key, sum_spell_amounts, top_spell,
};
use crate::overview_dto::{SpellRef, player_ref};
use crate::recap_dto::{
    DeathRecapDto, DeathsReportDto, KillDto, KillerDto, LethalDto, deaths_report_dto,
};
use crate::report_dto::FilterDto;
use crate::scope_dto::{ScopeDto, unit_dto};

const KILLING_BLOW_SOURCES: usize = 2;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDeathsDto {
    /// The set's tiles; its deaths and kills are in `pulls`.
    #[serde(flatten)]
    pub report: DeathsReportDto,
    pub pulls: Vec<SetDeathsPullDto>,
    pub by_killing_blow: Vec<KillingBlowRowDto>,
    /// Listed deaths the log holds no lethal hit for.
    pub no_lethal: u32,
    /// Friendlies only.
    pub by_player: Vec<PlayerDeathsDto>,
    #[serde(skip)]
    dead_players: BTreeSet<ActorId>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDeathsPullDto {
    pub fight_index: u32,
    pub duration_ms: u64,
    pub deaths: Vec<DeathRecapDto>,
    pub kills: Vec<KillDto>,
    /// Friendlies only: every present player of the dead-side selection, whatever killed them.
    pub lifetime: Vec<LifeDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifeDto {
    pub player: ActorId,
    pub first_death_ms: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KillingBlowRowDto {
    /// The spell of the row's name that killed most often.
    pub spell_id: SpellId,
    pub environmental: bool,
    /// Who landed the killing blows, most first; a pet's are its owner's.
    pub sources: Vec<String>,
    pub count: u32,
    #[serde(skip)]
    spell_counts: Vec<(SpellId, u32)>,
    #[serde(skip)]
    source_counts: Vec<(String, u32)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDeathsDto {
    pub player: ActorId,
    /// Pulls the player was present in.
    pub pulls: u32,
    pub deaths: u32,
}

/// One pull's part of a set's deaths report, to be merged with [`Merge`].
pub fn deaths_set_part(
    fight_index: u32,
    fight: &Fight,
    curated: &Curated,
    filter: FilterDto,
    scope: ScopeDto,
) -> SetDeathsDto {
    let (filter, scope) = (filter.to_filter(fight), scope.to_scope());
    let analysed = deaths_report(fight, curated, &filter, &scope);
    let mut report = deaths_report_dto(fight, curated, &analysed);
    let (blows, lifetime, dead_players): (Vec<Option<Hit>>, Vec<LifeDto>, BTreeSet<ActorId>) =
        match scope.perspective {
            Side::Friendly => {
                let lifetime = lifetime(fight, &filter, &scope);
                let dead = lifetime
                    .iter()
                    .filter(|life| life.first_death_ms.is_some())
                    .map(|life| life.player)
                    .collect();
                let blows = analysed.recaps.iter().map(|r| r.death.killing_blow);
                (blows.collect(), lifetime, dead)
            }
            Side::Enemy => (
                analysed.kills.iter().map(|k| k.killing_blow).collect(),
                Vec::new(),
                analysed.kills.iter().map(|k| k.unit).collect(),
            ),
        };
    let mut by_killing_blow = Vec::new();
    for hit in blows.iter().flatten() {
        merge_blows(
            &mut by_killing_blow,
            vec![blow_row(fight, hit)],
            &report.spells,
        );
    }
    for life in &lifetime {
        if !report.roster.iter().any(|p| p.actor_id == life.player) {
            report.roster.push(player_ref(fight, life.player));
        }
    }
    SetDeathsDto {
        pulls: vec![SetDeathsPullDto {
            fight_index,
            duration_ms: filter.duration_ms(fight),
            deaths: take(&mut report.deaths),
            kills: take(&mut report.kills),
            lifetime,
        }],
        report,
        by_killing_blow,
        no_lethal: blows.iter().filter(|blow| blow.is_none()).count() as u32,
        by_player: Vec::new(),
        dead_players,
    }
}

/// Present players are those with COMBATANT_INFO in this pull, plus anyone who died in it.
fn lifetime(fight: &Fight, filter: &ReportFilter, scope: &Scope) -> Vec<LifeDto> {
    let mut first_deaths: BTreeMap<ActorId, i32> = BTreeMap::new();
    for death in deaths(fight).into_iter().filter(|d| filter.contains(d.t)) {
        first_deaths.entry(death.player).or_insert(death.t);
    }
    let dead_side = scope.dead_side();
    fight
        .actors
        .players()
        .filter(|p| p.spec_id.is_some() || first_deaths.contains_key(&p.id))
        .filter(|p| dead_side.accepts(fight, None, None, Some(&unit_of(fight, p.id))))
        .map(|p| LifeDto {
            player: p.id,
            first_death_ms: first_deaths.get(&p.id).copied(),
        })
        .collect()
}

fn blow_row(fight: &Fight, hit: &Hit) -> KillingBlowRowDto {
    let source = unit_dto(fight, &unit_of(fight, hit.source).grouped(fight)).name;
    KillingBlowRowDto {
        spell_id: hit.spell,
        environmental: hit.environmental,
        sources: Vec::new(),
        count: 1,
        spell_counts: vec![(hit.spell, 1)],
        source_counts: if source.is_empty() {
            Vec::new()
        } else {
            vec![(source, 1)]
        },
    }
}

/// Keyed like the single pull's most lethal spell: by spell name, world damage as one row.
fn same_blow(
    spells: &BTreeMap<SpellId, SpellRef>,
    a: &KillingBlowRowDto,
    b: &KillingBlowRowDto,
) -> bool {
    a.environmental == b.environmental
        && (a.environmental || spell_key(spells, a.spell_id) == spell_key(spells, b.spell_id))
}

fn merge_blows(
    rows: &mut Vec<KillingBlowRowDto>,
    next: Vec<KillingBlowRowDto>,
    spells: &BTreeMap<SpellId, SpellRef>,
) {
    merge_rows(
        rows,
        next,
        |a, b| same_blow(spells, a, b),
        |a, b| {
            a.count += b.count;
            sum_spell_amounts(&mut a.spell_counts, b.spell_counts);
            merge_rows(
                &mut a.source_counts,
                b.source_counts,
                |x, y| x.0 == y.0,
                |x, y| x.1 += y.1,
            );
        },
    );
}

impl Merge for SetDeathsDto {
    fn merge(&mut self, next: Self) {
        let report = &mut self.report;
        report.rezzed += next.report.rezzed;
        report.dead_ms += next.report.dead_ms;
        merge_roster(&mut report.roster, next.report.roster);
        merge_spells(&mut report.spells, next.report.spells);
        merge_blows(
            &mut self.by_killing_blow,
            next.by_killing_blow,
            &report.spells,
        );
        self.no_lethal += next.no_lethal;
        self.pulls.extend(next.pulls);
        self.dead_players.extend(next.dead_players);
    }

    fn finish(&mut self) {
        for row in &mut self.by_killing_blow {
            row.spell_id = top_spell(&row.spell_counts).unwrap_or(row.spell_id);
            row.source_counts
                .sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            row.sources = row
                .source_counts
                .iter()
                .take(KILLING_BLOW_SOURCES)
                .map(|(name, _)| name.clone())
                .collect();
        }
        let report = &mut self.report;
        report.most_lethal = self
            .by_killing_blow
            .iter()
            .reduce(|best, next| if next.count > best.count { next } else { best })
            .map(|row| LethalDto {
                spell_id: row.spell_id,
                environmental: row.environmental,
                count: row.count,
            });
        self.by_killing_blow.sort_by(|a, b| {
            b.count
                .cmp(&a.count)
                .then(a.spell_id.cmp(&b.spell_id))
                .then(a.environmental.cmp(&b.environmental))
        });
        report.dead_units = self.dead_players.len() as u32;

        let kills: Vec<&KillDto> = self.pulls.iter().flat_map(|p| &p.kills).collect();
        let mut killers: Vec<KillerDto> = Vec::new();
        merge_rows(
            &mut killers,
            kills
                .iter()
                .filter_map(|k| k.killer.clone())
                .map(|unit| KillerDto { unit, count: 1 })
                .collect(),
            |a, b| a.unit.unit == b.unit.unit,
            |a, b| a.count += b.count,
        );
        report.top_killer = killers
            .into_iter()
            .reduce(|best, next| if next.count > best.count { next } else { best });
        let lives: Vec<i64> = kills
            .iter()
            .filter_map(|k| k.alive_ms.map(i64::from))
            .collect();
        report.avg_alive_ms =
            (!lives.is_empty()).then(|| (lives.iter().sum::<i64>() / lives.len() as i64) as i32);

        self.by_player = by_player(&self.pulls);
        let name = |id: ActorId| {
            report
                .roster
                .iter()
                .find(|p| p.actor_id == id)
                .map(|p| p.name.as_str())
        };
        self.by_player.sort_by(|a, b| {
            b.deaths
                .cmp(&a.deaths)
                .then_with(|| name(a.player).cmp(&name(b.player)))
                .then(a.player.cmp(&b.player))
        });
    }
}

fn by_player(pulls: &[SetDeathsPullDto]) -> Vec<PlayerDeathsDto> {
    let mut players: Vec<PlayerDeathsDto> = Vec::new();
    for pull in pulls {
        merge_rows(
            &mut players,
            pull.lifetime
                .iter()
                .map(|life| PlayerDeathsDto {
                    player: life.player,
                    pulls: 1,
                    deaths: 0,
                })
                .collect(),
            |a, b| a.player == b.player,
            |a, b| a.pulls += b.pulls,
        );
    }
    for death in pulls.iter().flat_map(|p| &p.deaths) {
        if let Some(row) = players.iter_mut().find(|p| p.player == death.death.player) {
            row.deaths += 1;
        }
    }
    players
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{ActorId, Actors, Event, EventKind, Fight, NOBODY, SpellId};
    use openlogs_gamedata::Curated;

    use super::*;
    use crate::scope_dto::{AbilityRefDto, ScopeDto};
    use crate::set_merge::tests::{WHOLE, merged};
    use crate::test_fight::{HOSTILE_FLAGS, PLAYER_FLAGS, fight, unit};

    const KILLER_SPELL: SpellId = 7;
    const OTHER_SPELL: SpellId = 8;
    const RESURRECTION: SpellId = 2006;

    fn event(t: i32, source: ActorId, target: ActorId, spell: SpellId, kind: EventKind) -> Event {
        Event {
            t,
            source,
            target,
            spell,
            kind,
            source_hostile: false,
            target_hostile: false,
            unit_hp: None,
        }
    }

    fn killed(t: i32, boss: ActorId, player: ActorId, spell: SpellId) -> [Event; 2] {
        [
            Event {
                source_hostile: true,
                ..event(t, boss, player, spell, EventKind::Instakill)
            },
            died(t, player),
        ]
    }

    fn died(t: i32, player: ActorId) -> Event {
        event(t, NOBODY, player, 0, EventKind::Died { unconscious: false })
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

    fn pull_with(raid: &Raid, present: &[ActorId], events: Vec<Event>) -> Fight {
        let mut actors = raid.actors.clone();
        for &player in present {
            actors.set_spec(player, 62);
        }
        fight(actors, events)
    }

    fn two_pulls(raid: &Raid) -> [Fight; 2] {
        let (a, b, boss) = (raid.a, raid.b, raid.boss);
        let mut pull_a = vec![event(10_000, b, a, RESURRECTION, EventKind::Resurrect)];
        pull_a.extend(killed(5_000, boss, a, KILLER_SPELL));
        pull_a.extend(killed(15_000, boss, a, KILLER_SPELL));
        let pull_b = killed(2_000, boss, b, OTHER_SPELL).to_vec();
        [
            pull_with(raid, &[a, b], pull_a),
            pull_with(raid, &[b], pull_b),
        ]
    }

    fn set_of(pulls: &[Fight], scope: ScopeDto) -> SetDeathsDto {
        merged(
            pulls
                .iter()
                .enumerate()
                .map(|(i, pull)| {
                    deaths_set_part(i as u32, pull, &Curated::bundled(), WHOLE, scope.clone())
                })
                .collect(),
        )
    }

    fn lifetimes(set: &SetDeathsDto) -> Vec<Vec<(ActorId, Option<i32>)>> {
        set.pulls
            .iter()
            .map(|pull| {
                pull.lifetime
                    .iter()
                    .map(|life| (life.player, life.first_death_ms))
                    .collect()
            })
            .collect()
    }

    fn by_player(set: &SetDeathsDto) -> Vec<(ActorId, u32, u32)> {
        set.by_player
            .iter()
            .map(|p| (p.player, p.pulls, p.deaths))
            .collect()
    }

    #[test]
    fn lifetime_lists_each_present_player_with_the_first_death() {
        let raid = raid();
        let (a, b) = (raid.a, raid.b);
        let set = set_of(&two_pulls(&raid), ScopeDto::default());
        assert_eq!(
            lifetimes(&set),
            [vec![(a, Some(5_000)), (b, None)], vec![(b, Some(2_000))]]
        );
        assert_eq!(by_player(&set), [(a, 1, 2), (b, 2, 1)]);
    }

    #[test]
    fn a_killing_blow_filter_narrows_the_totals_but_not_the_lifetime() {
        let raid = raid();
        let (a, b) = (raid.a, raid.b);
        let scope = ScopeDto {
            ability: vec![AbilityRefDto::Id {
                spell_id: OTHER_SPELL,
            }],
            ..ScopeDto::default()
        };
        let set = set_of(&two_pulls(&raid), scope);
        let rows: Vec<_> = set
            .by_killing_blow
            .iter()
            .map(|row| (row.spell_id, row.count))
            .collect();
        assert_eq!(rows, [(OTHER_SPELL, 1)]);
        assert_eq!(by_player(&set), [(b, 2, 1), (a, 1, 0)]);
        assert_eq!(lifetimes(&set)[0][0], (a, Some(5_000)));
    }

    #[test]
    fn deaths_by_killing_blow_count_a_spell_once_over_the_set() {
        let raid = raid();
        let (a, b, boss) = (raid.a, raid.b, raid.boss);
        let mut pull_a = killed(5_000, boss, a, KILLER_SPELL).to_vec();
        pull_a.push(died(8_000, b));
        let pull_b = killed(2_000, boss, b, KILLER_SPELL).to_vec();
        let pulls = [
            pull_with(&raid, &[a, b], pull_a),
            pull_with(&raid, &[b], pull_b),
        ];
        let set = set_of(&pulls, ScopeDto::default());
        let rows: Vec<_> = set
            .by_killing_blow
            .iter()
            .map(|row| {
                (
                    row.spell_id,
                    row.environmental,
                    row.sources.clone(),
                    row.count,
                )
            })
            .collect();
        assert_eq!(
            rows,
            [(KILLER_SPELL, false, vec!["Ula'tek".to_string()], 2)]
        );
        assert_eq!(set.no_lethal, 1);
        assert_eq!(set.report.most_lethal.map(|l| l.count), Some(2));
        assert_eq!(set.report.dead_units, 2);
    }

    #[test]
    fn set_deaths_lifetime_uses_the_analysed_time() {
        let raid = raid();
        let (a, b, boss) = (raid.a, raid.b, raid.boss);
        let mut events = vec![
            event(11_000, b, a, RESURRECTION, EventKind::Resurrect),
            event(13_000, a, b, RESURRECTION, EventKind::Resurrect),
        ];
        for (t, player) in [(10_000, a), (12_000, b), (14_000, a), (16_000, b)] {
            events.extend(killed(t, boss, player, KILLER_SPELL));
        }
        let mut pull = pull_with(&raid, &[a, b], events);
        pull.duration_ms = 90_000;
        let filter = FilterDto {
            death_cutoff: Some(3),
            ..WHOLE
        };
        let part = deaths_set_part(0, &pull, &Curated::bundled(), filter, ScopeDto::default());
        assert_eq!(part.pulls[0].duration_ms, 14_001);
        assert_eq!(part.pulls[0].deaths.len(), 3);
    }
}
