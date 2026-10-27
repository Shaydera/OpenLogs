use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap};
use std::mem::take;

use openlogs_analysis::{ActorId, COLOR_GROUPS, SpellId, TOP_ABILITIES_PER_GROUP, per_second};
use serde::Serialize;

use crate::overview_dto::{KpisDto, MarkersDto, PlayerRef, QuickOverviewDto, SpellRef};
use crate::report_dto::{
    AbilityRowDto, BuffShareDto, DamageReportDto, DamageTakenReportDto, GroupAbilitiesDto,
    HealingReportDto, PlayerAmount, PlayerDamageDto, PlayerHealingDto, RowKindDto, TakenAbilityDto,
    TargetKindDto, TargetRefDto, TargetShareDto,
};
use crate::scope_dto::{
    BreakdownDto, BreakdownRowDto, FilterOptionDto, OptionValueDto, UnitRefDto, VariantDto,
    per_second as rate, share_of,
};

mod auras;
mod casts;
mod deaths;
mod kicks;

pub use auras::*;
pub use deaths::*;
pub use kicks::*;

/// Folds the reports of a set's pulls into one: the first pull's report takes each later one
/// through [`Merge::merge`], then [`Merge::finish`] runs once.
pub trait Merge {
    /// Sums `next` in; both reports use the set's actor ids.
    fn merge(&mut self, next: Self);
    /// Recomputes what depends on the whole set: rates, shares, orders and colour groups.
    fn finish(&mut self);
}

impl Merge for DamageReportDto {
    fn merge(&mut self, next: Self) {
        self.duration_ms += next.duration_ms;
        self.total += next.total;
        merge_rows(
            &mut self.players,
            next.players,
            |a, b| a.player == b.player,
            |a, mut b| {
                a.own += b.own;
                a.support_received += b.support_received;
                a.support_given += b.support_given;
                a.support_self += b.support_self;
                a.total += b.total;
                damage_breakdown(a).merge(damage_breakdown(&mut b));
                for group in b.group_abilities {
                    add_group(&mut a.group_abilities, group);
                }
            },
        );
        merge_roster(&mut self.roster, next.roster);
        merge_spells(&mut self.spells, next.spells);
    }

    fn finish(&mut self) {
        for p in &mut self.players {
            p.per_second = per_second(p.total, self.duration_ms);
            p.share = share_of(p.total as i64, self.total as i64);
            damage_breakdown(p).sort();
        }
        self.players
            .sort_by(|a, b| b.total.cmp(&a.total).then(a.player.cmp(&b.player)));
        self.color_groups = color_groups(self.players.iter().flat_map(|p| &p.targets));
        for p in &mut self.players {
            p.group_abilities = into_color_groups(take(&mut p.group_abilities), &self.color_groups);
        }
    }
}

impl Merge for HealingReportDto {
    fn merge(&mut self, next: Self) {
        self.duration_ms += next.duration_ms;
        self.total += next.total;
        self.overheal += next.overheal;
        merge_rows(
            &mut self.players,
            next.players,
            |a, b| a.player == b.player,
            |a, mut b| {
                a.healing += b.healing;
                a.absorbs += b.absorbs;
                a.overheal += b.overheal;
                a.support_received += b.support_received;
                a.support_given += b.support_given;
                a.support_self += b.support_self;
                a.total += b.total;
                healing_breakdown(a).merge(healing_breakdown(&mut b));
            },
        );
        merge_roster(&mut self.roster, next.roster);
        merge_spells(&mut self.spells, next.spells);
    }

    fn finish(&mut self) {
        for p in &mut self.players {
            p.per_second = per_second(p.total, self.duration_ms);
            p.share = share_of(p.total as i64, self.total as i64);
            healing_breakdown(p).sort();
        }
        self.players
            .sort_by(|a, b| b.total.cmp(&a.total).then(a.player.cmp(&b.player)));
    }
}

impl Merge for DamageTakenReportDto {
    fn merge(&mut self, next: Self) {
        self.duration_ms += next.duration_ms;
        self.total += next.total;
        merge_spells(&mut self.spells, next.spells);
        let spells = &self.spells;
        merge_taken(&mut self.by_ability, next.by_ability, spells);
        merge_rows(
            &mut self.by_player,
            next.by_player,
            |a, b| a.player == b.player,
            |a, b| {
                a.amount += b.amount;
                a.absorbed += b.absorbed;
                merge_taken(&mut a.abilities, b.abilities, spells);
            },
        );
        merge_roster(&mut self.roster, next.roster);
    }

    fn finish(&mut self) {
        let rows = self
            .by_ability
            .iter_mut()
            .chain(self.by_player.iter_mut().flat_map(|p| &mut p.abilities));
        for row in rows {
            row.spell_id = top_spell(&row.spell_amounts).unwrap_or(row.spell_id);
        }
        let spells = &self.spells;
        for row in &mut self.by_ability {
            let players_hit = self
                .by_player
                .iter()
                .filter(|p| p.abilities.iter().any(|a| same_taken(spells, a, row)))
                .count();
            row.players_hit = players_hit as u32;
        }
        for p in &mut self.by_player {
            p.per_second = per_second(p.amount, self.duration_ms);
            p.share = share_of(p.amount as i64, self.total as i64);
            sort_taken(&mut p.abilities);
        }
        sort_taken(&mut self.by_ability);
        self.by_player
            .sort_by(|a, b| b.amount.cmp(&a.amount).then(a.player.cmp(&b.player)));
    }
}

impl Merge for BreakdownDto {
    fn merge(&mut self, next: Self) {
        self.duration_ms += next.duration_ms;
        self.total += next.total;
        merge_rows(
            &mut self.rows,
            next.rows,
            |a, b| a.row.key == b.row.key,
            |a, b| {
                add_row(&mut a.row, b.row);
                for split in b.splits {
                    match a.splits.iter_mut().find(|s| s.dimension == split.dimension) {
                        Some(known) => merge_split_rows(&mut known.rows, split.rows),
                        None => a.splits.push(split),
                    }
                }
            },
        );
        merge_roster(&mut self.roster, next.roster);
    }

    fn finish(&mut self) {
        self.per_second = rate(self.total, self.duration_ms);
        for grouped in &mut self.rows {
            grouped.row.spell_id =
                top_spell(&grouped.row.spell_amounts).unwrap_or(grouped.row.spell_id);
            grouped.row.share = share_of(grouped.row.amount, self.total);
            grouped.per_second = rate(grouped.row.amount, self.duration_ms);
            for split in &mut grouped.splits {
                let sum: i64 = split.rows.iter().map(|r| r.amount).sum();
                for row in &mut split.rows {
                    row.spell_id = top_spell(&row.spell_amounts).unwrap_or(row.spell_id);
                    row.share = share_of(row.amount, sum);
                }
                split.rows.sort_by(by_amount_then_key);
            }
        }
        self.rows.sort_by(|a, b| by_amount_then_key(&a.row, &b.row));
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPullDto {
    pub fight_index: u32,
    pub kpis: KpisDto,
    pub boss_hp_step_ms: u32,
    pub boss_hp: Vec<Option<f32>>,
    pub cutoff_ms: Option<i32>,
    pub pull_duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetOverviewDto {
    pub overview: QuickOverviewDto,
    pub pulls: Vec<SetPullDto>,
}

#[derive(Default)]
pub struct SetOverviewAcc {
    overview: Option<QuickOverviewDto>,
    pulls: Vec<SetPullDto>,
}

impl SetOverviewAcc {
    pub fn add(&mut self, fight_index: u32, part: QuickOverviewDto) {
        self.pulls.push(SetPullDto {
            fight_index,
            kpis: part.kpis.clone(),
            boss_hp_step_ms: part.timeline.boss_hp_step_ms,
            boss_hp: part.timeline.boss_hp.clone(),
            cutoff_ms: part.timeline.cutoff_ms,
            pull_duration_ms: part.timeline.duration_ms,
        });
        let Some(set) = &mut self.overview else {
            self.overview = Some(part);
            return;
        };
        let (sum, next) = (&mut set.kpis, &part.kpis);
        sum.duration_ms += next.duration_ms;
        sum.raid_damage += next.raid_damage;
        sum.deaths += next.deaths;
        sum.combat_potions += next.combat_potions;
        sum.players_without_combat_potion += next.players_without_combat_potion;
        sum.healthstones += next.healthstones;
        sum.health_potions += next.health_potions;
        set.timeline.duration_ms += part.timeline.duration_ms;
        merge_roster(&mut set.players, part.players);
        merge_spells(&mut set.spells, part.spells);
    }

    pub fn finish(self, distinct_players: u32) -> Option<SetOverviewDto> {
        let mut overview = self.overview?;
        let kpis = &mut overview.kpis;
        kpis.players = distinct_players;
        kpis.raid_dps = per_second(kpis.raid_damage, kpis.duration_ms);
        kpis.first_death_ms = None;
        overview.timeline.boss_hp.clear();
        overview.timeline.raid_dps.clear();
        overview.timeline.phases.clear();
        overview.timeline.cutoff_ms = None;
        overview.timeline.markers = MarkersDto {
            deaths: Vec::new(),
            bloodlust: Vec::new(),
            boss_casts: Vec::new(),
        };
        overview.deaths.clear();
        overview.consumables.clear();
        overview.cooldowns.clear();
        Some(SetOverviewDto {
            overview,
            pulls: self.pulls,
        })
    }
}

fn merge_split_rows(rows: &mut Vec<BreakdownRowDto>, next: Vec<BreakdownRowDto>) {
    merge_rows(rows, next, |a, b| a.key == b.key, add_row);
}

fn add_row(row: &mut BreakdownRowDto, next: BreakdownRowDto) {
    sum_spell_amounts(&mut row.spell_amounts, next.spell_amounts);
    row.number = row.number.or(next.number);
    row.amount += next.amount;
    row.absorbed += next.absorbed;
    row.heal_absorbed += next.heal_absorbed;
    row.hits += next.hits;
    row.crits += next.crits;
    row.casts += next.casts;
    row.hit_amount += next.hit_amount;
    row.ticks += next.ticks;
    row.tick_amount += next.tick_amount;
    merge_rows(
        &mut row.misses,
        next.misses,
        |a, b| a.miss_type == b.miss_type,
        |a, b| a.count += b.count,
    );
    row.misses.sort_by_key(|m| m.miss_type);
    for pet in next.pets {
        if !row.pets.contains(&pet) {
            row.pets.push(pet);
        }
    }
    row.pets.sort_by_cached_key(UnitRefDto::to_unit);
}

fn sum_spell_amounts<T: std::ops::AddAssign>(
    list: &mut Vec<(SpellId, T)>,
    next: Vec<(SpellId, T)>,
) {
    merge_rows(list, next, |a, b| a.0 == b.0, |a, b| a.1 += b.1);
}

/// The ID with the largest amount, the lowest on a tie.
fn top_spell<T: Ord>(amounts: &[(SpellId, T)]) -> Option<SpellId> {
    amounts
        .iter()
        .max_by(|x, y| x.1.cmp(&y.1).then(y.0.cmp(&x.0)))
        .map(|(spell, _)| *spell)
}

fn by_amount_then_key(a: &BreakdownRowDto, b: &BreakdownRowDto) -> std::cmp::Ordering {
    b.amount
        .cmp(&a.amount)
        .then_with(|| a.key.to_key().cmp(&b.key.to_key()))
}

/// The filter-menu options of a set; serialized as the plain option list.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub struct FilterOptionsDto(pub Vec<FilterOptionDto>);

impl Merge for FilterOptionsDto {
    fn merge(&mut self, next: Self) {
        merge_rows(
            &mut self.0,
            next.0,
            |a, b| a.value == b.value,
            |a, b| {
                a.amount += b.amount;
                a.npc_id = a.npc_id.or(b.npc_id);
                for pet in b.pets {
                    if !a.pets.contains(&pet) {
                        a.pets.push(pet);
                    }
                }
                merge_rows(
                    &mut a.variants,
                    b.variants,
                    |x, y| x.spell_id == y.spell_id,
                    |x, y| {
                        x.casts += y.casts;
                        x.hits += y.hits;
                        x.heals += y.heals;
                        x.auras += y.auras;
                    },
                );
            },
        );
    }

    fn finish(&mut self) {
        for option in &mut self.0 {
            option.instances.clear();
            option.number = None;
            option.pets.sort();
            option.variants.sort_by_key(|v| v.spell_id);
            if matches!(option.value, OptionValueDto::Ability { .. }) {
                option.primary_spell = primary_spell(&option.variants);
            }
        }
        self.0
            .sort_by_cached_key(|option| (Reverse(option.amount), option.value.to_value()));
    }
}

fn primary_spell(variants: &[VariantDto]) -> Option<SpellId> {
    variants
        .iter()
        .max_by(|a, b| {
            (a.casts, a.hits + a.heals)
                .cmp(&(b.casts, b.hits + b.heals))
                .then(b.spell_id.cmp(&a.spell_id))
        })
        .map(|v| v.spell_id)
}

fn merge_rows<T>(
    rows: &mut Vec<T>,
    next: Vec<T>,
    same: impl Fn(&T, &T) -> bool,
    mut add: impl FnMut(&mut T, T),
) {
    for row in next {
        match rows.iter_mut().find(|known| same(known, &row)) {
            Some(known) => add(known, row),
            None => rows.push(row),
        }
    }
}

/// Keeps the later pull's entry unless only an earlier one knows the spec.
fn merge_roster(roster: &mut Vec<PlayerRef>, next: Vec<PlayerRef>) {
    for player in next {
        match roster
            .iter_mut()
            .find(|known| known.actor_id == player.actor_id)
        {
            Some(known) if known.spec_id.is_some() && player.spec_id.is_none() => {}
            Some(known) => *known = player,
            None => roster.push(player),
        }
    }
}

fn merge_spells(spells: &mut BTreeMap<SpellId, SpellRef>, next: BTreeMap<SpellId, SpellRef>) {
    for (id, spell) in next {
        if spells.get(&id).is_none_or(|known| known.name.is_empty()) {
            spells.insert(id, spell);
        }
    }
}

struct Breakdown<'a> {
    abilities: &'a mut Vec<AbilityRowDto>,
    support_by_recipient: &'a mut Vec<PlayerAmount>,
    support_received_from: &'a mut Vec<PlayerAmount>,
    support_received_by_buff: &'a mut Vec<BuffShareDto>,
    support_credited_by_buff: &'a mut Vec<BuffShareDto>,
    targets: &'a mut Vec<TargetShareDto>,
}

fn damage_breakdown(p: &mut PlayerDamageDto) -> Breakdown<'_> {
    Breakdown {
        abilities: &mut p.abilities,
        support_by_recipient: &mut p.support_by_recipient,
        support_received_from: &mut p.support_received_from,
        support_received_by_buff: &mut p.support_received_by_buff,
        support_credited_by_buff: &mut p.support_credited_by_buff,
        targets: &mut p.targets,
    }
}

fn healing_breakdown(p: &mut PlayerHealingDto) -> Breakdown<'_> {
    Breakdown {
        abilities: &mut p.abilities,
        support_by_recipient: &mut p.support_by_recipient,
        support_received_from: &mut p.support_received_from,
        support_received_by_buff: &mut p.support_received_by_buff,
        support_credited_by_buff: &mut p.support_credited_by_buff,
        targets: &mut p.targets,
    }
}

impl Breakdown<'_> {
    fn merge(self, next: Breakdown<'_>) {
        merge_rows(
            self.abilities,
            take(next.abilities),
            same_ability,
            add_ability,
        );
        merge_amounts(self.support_by_recipient, take(next.support_by_recipient));
        merge_amounts(self.support_received_from, take(next.support_received_from));
        merge_buff_shares(
            self.support_received_by_buff,
            take(next.support_received_by_buff),
        );
        merge_buff_shares(
            self.support_credited_by_buff,
            take(next.support_credited_by_buff),
        );
        merge_rows(
            self.targets,
            take(next.targets),
            |a, b| target_key(&a.target) == target_key(&b.target),
            |a, b| {
                a.amount += b.amount;
                a.absorbed += b.absorbed;
                a.heal_absorbed += b.heal_absorbed;
                a.hits += b.hits;
                a.crits += b.crits;
                a.target.units = a.target.units.max(b.target.units);
            },
        );
    }

    fn sort(self) {
        self.abilities
            .sort_by(|a, b| b.amount.cmp(&a.amount).then(a.spell_id.cmp(&b.spell_id)));
        sort_amounts(self.support_by_recipient);
        sort_amounts(self.support_received_from);
        sort_buff_shares(self.support_received_by_buff);
        sort_buff_shares(self.support_credited_by_buff);
        self.targets.sort_by(|a, b| {
            b.amount
                .cmp(&a.amount)
                .then_with(|| target_key(&a.target).cmp(&target_key(&b.target)))
        });
    }
}

/// Pets of one name are one row, as in a single pull; each pull gives them new GUIDs.
fn same_ability(a: &AbilityRowDto, b: &AbilityRowDto) -> bool {
    a.spell_id == b.spell_id
        && a.kind == b.kind
        && match a.kind {
            RowKindDto::Pet if !a.actor_name.is_empty() => a.actor_name == b.actor_name,
            _ => a.actor_id == b.actor_id,
        }
}

fn add_ability(row: &mut AbilityRowDto, next: AbilityRowDto) {
    row.amount += next.amount;
    row.support += next.support;
    row.overheal += next.overheal;
    row.hits += next.hits;
    row.crits += next.crits;
    row.max_hit = row.max_hit.max(next.max_hit);
    row.ticks += next.ticks;
}

fn merge_amounts(list: &mut Vec<PlayerAmount>, next: Vec<PlayerAmount>) {
    merge_rows(
        list,
        next,
        |a, b| a.player == b.player,
        |a, b| a.amount += b.amount,
    );
}

fn sort_amounts(list: &mut [PlayerAmount]) {
    list.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.player.cmp(&b.player)));
}

fn merge_buff_shares(list: &mut Vec<BuffShareDto>, next: Vec<BuffShareDto>) {
    merge_rows(
        list,
        next,
        |a, b| (a.buff_id, a.evoker) == (b.buff_id, b.evoker),
        |a, b| a.amount += b.amount,
    );
}

fn sort_buff_shares(list: &mut [BuffShareDto]) {
    list.sort_by(|a, b| {
        b.amount
            .cmp(&a.amount)
            .then((a.buff_id, a.evoker).cmp(&(b.buff_id, b.evoker)))
    });
}

fn target_key(target: &TargetRefDto) -> (TargetKindDto, &str, Option<ActorId>) {
    (target.kind, &target.name, target.player)
}

fn color_groups<'a>(targets: impl Iterator<Item = &'a TargetShareDto>) -> Vec<String> {
    let mut sums: HashMap<&str, i64> = HashMap::new();
    for share in targets.filter(|share| share.target.kind == TargetKindDto::Unit) {
        *sums.entry(&share.target.name).or_default() += share.amount;
    }
    let mut list: Vec<(&str, i64)> = sums.into_iter().filter(|(_, v)| *v > 0).collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    list.into_iter()
        .take(COLOR_GROUPS)
        .map(|(name, _)| name.to_string())
        .collect()
}

fn add_group(groups: &mut Vec<GroupAbilitiesDto>, group: GroupAbilitiesDto) {
    match groups.iter_mut().find(|known| known.group == group.group) {
        Some(known) => merge_rows(
            &mut known.abilities,
            group.abilities,
            |a, b| a.spell_id == b.spell_id,
            |a, b| a.amount += b.amount,
        ),
        None => groups.push(group),
    }
}

/// Groups by every enemy name (a set part's) folded into the set's colour groups and "Other".
fn into_color_groups(
    groups: Vec<GroupAbilitiesDto>,
    color_groups: &[String],
) -> Vec<GroupAbilitiesDto> {
    let mut folded = Vec::new();
    for mut group in groups {
        if group
            .group
            .as_ref()
            .is_some_and(|name| !color_groups.contains(name))
        {
            group.group = None;
        }
        add_group(&mut folded, group);
    }
    for group in &mut folded {
        group
            .abilities
            .sort_by(|a, b| b.amount.cmp(&a.amount).then(a.spell_id.cmp(&b.spell_id)));
        group.abilities.truncate(TOP_ABILITIES_PER_GROUP);
    }
    folded.sort_by(|a, b| a.group.cmp(&b.group));
    folded
}

/// The single-pull identity of a damage-taken row: spell name (ID without a known name),
/// world-damage flag and source name.
fn same_taken(
    spells: &BTreeMap<SpellId, SpellRef>,
    a: &TakenAbilityDto,
    b: &TakenAbilityDto,
) -> bool {
    a.environmental == b.environmental
        && a.source_name == b.source_name
        && spell_key(spells, a.spell_id) == spell_key(spells, b.spell_id)
}

#[derive(PartialEq)]
enum SpellKey<'a> {
    Name(&'a str),
    Id(SpellId),
}

fn spell_key(spells: &BTreeMap<SpellId, SpellRef>, id: SpellId) -> SpellKey<'_> {
    match spells.get(&id) {
        Some(spell) if !spell.name.is_empty() => SpellKey::Name(&spell.name),
        _ => SpellKey::Id(id),
    }
}

fn merge_taken(
    rows: &mut Vec<TakenAbilityDto>,
    next: Vec<TakenAbilityDto>,
    spells: &BTreeMap<SpellId, SpellRef>,
) {
    merge_rows(
        rows,
        next,
        |a, b| same_taken(spells, a, b),
        |a, b| {
            sum_spell_amounts(&mut a.spell_amounts, b.spell_amounts);
            a.amount += b.amount;
            a.absorbed += b.absorbed;
            a.hits += b.hits;
            a.source_id = a.source_id.or(b.source_id);
        },
    );
}

fn sort_taken(rows: &mut [TakenAbilityDto]) {
    rows.sort_by(|a, b| {
        b.amount
            .cmp(&a.amount)
            .then(a.spell_id.cmp(&b.spell_id))
            .then(b.environmental.cmp(&a.environmental))
            .then_with(|| a.source_name.cmp(&b.source_name))
    });
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{
        Actors, DamageVia, Event, EventKind, Fight, MissType, Missed, NOBODY, SpellInfo,
    };

    use super::*;
    use crate::overview_dto::TimelineDto;
    use crate::report_dto::{AttributionDto, FilterDto, RowKindDto};
    use crate::scope_dto::{
        AbilityRefDto, DimensionDto, MissCountDto, MissTypeDto, ScopeDto, ScopeMetricDto,
    };
    use crate::test_fight::{HOSTILE_FLAGS, PET_FLAGS, PLAYER_FLAGS, damage_event, fight, unit};
    use crate::{breakdown_report, damage_done_set_part, damage_taken_set_part, filter_options};

    pub(super) const WHOLE: FilterDto = FilterDto {
        start_ms: None,
        end_ms: None,
        attribution: AttributionDto::Augmented,
        include_overkill: false,
        death_cutoff: None,
        known_cut_ms: None,
    };

    pub(super) fn merged<T: Merge>(parts: Vec<T>) -> T {
        let mut parts = parts.into_iter();
        let mut set = parts.next().expect("a set has pulls");
        for part in parts {
            set.merge(part);
        }
        set.finish();
        set
    }

    #[test]
    fn a_player_in_one_pull_is_divided_by_the_summed_duration() {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let b = unit(&mut actors, "Player-2", "Aleth-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let pull_1 = fight(
            actors.clone(),
            vec![damage_event(1_000, a, boss, 1, 2_000, NOBODY)],
        );
        let pull_2 = fight(
            actors,
            vec![
                damage_event(1_000, a, boss, 1, 4_000, NOBODY),
                damage_event(2_000, b, boss, 1, 1_000, NOBODY),
            ],
        );
        let set = merged(vec![
            damage_done_set_part(&pull_1, WHOLE),
            damage_done_set_part(&pull_2, WHOLE),
        ]);
        assert_eq!(set.duration_ms, 40_000);
        let players: Vec<_> = set
            .players
            .iter()
            .map(|p| (p.player, p.total, p.per_second, p.share))
            .collect();
        assert_eq!(
            players,
            [
                (a, 6_000, 150.0, 6_000.0 / 7_000.0),
                (b, 1_000, 25.0, 1_000.0 / 7_000.0)
            ]
        );
    }

    #[test]
    fn a_pets_ability_is_one_row_across_pulls() {
        let mut actors = Actors::new();
        let hunter = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let wolves = [
            unit(&mut actors, "Pet-0-1-1-1-1-0001", "Wolf", PET_FLAGS),
            unit(&mut actors, "Pet-0-1-1-1-1-0002", "Wolf", PET_FLAGS),
        ];
        for wolf in wolves {
            actors.set_owner(wolf, hunter);
        }
        let boss = unit(
            &mut actors,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let pull_1 = fight(
            actors.clone(),
            vec![damage_event(1_000, wolves[0], boss, 1, 300, NOBODY)],
        );
        let pull_2 = fight(
            actors,
            vec![damage_event(1_000, wolves[1], boss, 1, 500, NOBODY)],
        );
        let set = merged(vec![
            damage_done_set_part(&pull_1, WHOLE),
            damage_done_set_part(&pull_2, WHOLE),
        ]);
        let rows: Vec<_> = set.players[0]
            .abilities
            .iter()
            .map(|row| (row.kind, row.actor_name.as_str(), row.amount, row.max_hit))
            .collect();
        assert_eq!(rows, [(RowKindDto::Pet, "Wolf", 800, 500)]);
    }

    #[test]
    fn taken_counts_players_hit_over_the_set() {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let b = unit(&mut actors, "Player-2", "Aleth-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let pull_1 = fight(
            actors.clone(),
            vec![damage_event(1_000, boss, a, 7, 300, NOBODY)],
        );
        let pull_2 = fight(
            actors,
            vec![
                damage_event(1_000, boss, b, 7, 500, NOBODY),
                damage_event(2_000, boss, b, 7, 200, NOBODY),
            ],
        );
        let set = merged(vec![
            damage_taken_set_part(&pull_1, WHOLE),
            damage_taken_set_part(&pull_2, WHOLE),
        ]);
        let abilities: Vec<_> = set
            .by_ability
            .iter()
            .map(|row| (row.spell_id, row.amount, row.hits, row.players_hit))
            .collect();
        assert_eq!(abilities, [(7, 1_000, 3, 2)]);
    }

    #[test]
    fn colour_groups_follow_the_whole_set() {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let [add, boss, imp, hound, shade] = [
            ("Creature-0-1-1-1-2-01", "Add"),
            ("Creature-0-1-1-1-1-01", "Boss"),
            ("Creature-0-1-1-1-3-01", "Imp"),
            ("Creature-0-1-1-1-4-01", "Hound"),
            ("Creature-0-1-1-1-5-01", "Shade"),
        ]
        .map(|(guid, name)| unit(&mut actors, guid, name, HOSTILE_FLAGS));
        let pull_1 = fight(
            actors.clone(),
            vec![
                damage_event(1_000, a, add, 1, 1_000, NOBODY),
                damage_event(2_000, a, boss, 1, 600, NOBODY),
            ],
        );
        let pull_2 = fight(
            actors,
            vec![
                damage_event(1_000, a, boss, 1, 800, NOBODY),
                damage_event(2_000, a, imp, 2, 900, NOBODY),
                damage_event(3_000, a, hound, 2, 700, NOBODY),
                damage_event(4_000, a, shade, 3, 500, NOBODY),
            ],
        );
        let set = merged(vec![
            damage_done_set_part(&pull_1, WHOLE),
            damage_done_set_part(&pull_2, WHOLE),
        ]);
        assert_eq!(set.color_groups, ["Boss", "Add", "Imp", "Hound"]);
        let groups: Vec<_> = set.players[0]
            .group_abilities
            .iter()
            .map(|g| {
                let abilities: Vec<_> =
                    g.abilities.iter().map(|x| (x.spell_id, x.amount)).collect();
                (g.group.as_deref(), abilities)
            })
            .collect();
        assert_eq!(
            groups,
            [
                (None, vec![(3, 500)]),
                (Some("Add"), vec![(1, 1_000)]),
                (Some("Boss"), vec![(1, 1_400)]),
                (Some("Hound"), vec![(2, 700)]),
                (Some("Imp"), vec![(2, 900)]),
            ]
        );
    }

    #[test]
    fn a_breakdown_over_two_pulls_rates_by_the_summed_duration() {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let b = unit(&mut actors, "Player-2", "Aleth-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let pull_1 = fight(
            actors.clone(),
            vec![damage_event(1_000, a, boss, 1, 2_000, NOBODY)],
        );
        let pull_2 = fight(
            actors,
            vec![
                damage_event(1_000, a, boss, 1, 4_000, NOBODY),
                damage_event(2_000, b, boss, 1, 1_000, NOBODY),
            ],
        );
        let part = |fight| {
            breakdown_report(
                fight,
                &openlogs_gamedata::Curated::bundled(),
                WHOLE,
                ScopeDto::default(),
                ScopeMetricDto::DamageDone,
                DimensionDto::Source,
            )
        };
        let set = merged(vec![part(&pull_1), part(&pull_2)]);
        assert_eq!(set.duration_ms, 40_000);
        let rows: Vec<_> = set
            .rows
            .iter()
            .map(|r| (r.row.amount, r.per_second, r.row.share))
            .collect();
        assert_eq!(
            rows,
            [
                (6_000, 150.0, 6_000.0 / 7_000.0),
                (1_000, 25.0, 1_000.0 / 7_000.0)
            ]
        );
        assert_eq!(set.per_second, 175.0);
    }

    #[test]
    fn ability_rows_sum_casts_ticks_and_misses_by_type_across_pulls() {
        let mut actors = Actors::new();
        let mage = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let miss = |t, miss_type| Event {
            kind: EventKind::Missed(Missed {
                via: DamageVia::Spell,
                miss_type,
                amount_missed: 0,
            }),
            ..damage_event(t, mage, boss, 1, 0, NOBODY)
        };
        let mut tick = damage_event(1_000, mage, boss, 1, 300, NOBODY);
        if let EventKind::Damage(damage) = &mut tick.kind {
            damage.via = DamageVia::Periodic;
        }
        let cast = Event {
            kind: EventKind::CastSuccess,
            ..damage_event(1_000, mage, boss, 1, 0, NOBODY)
        };
        let pull_1 = fight(actors.clone(), vec![tick, miss(2_000, MissType::Parry)]);
        let pull_2 = fight(
            actors,
            vec![
                cast,
                damage_event(1_500, mage, boss, 1, 1_000, NOBODY),
                miss(2_000, MissType::Parry),
                miss(3_000, MissType::Dodge),
            ],
        );
        let part = |fight| {
            breakdown_report(
                fight,
                &openlogs_gamedata::Curated::bundled(),
                WHOLE,
                ScopeDto::default(),
                ScopeMetricDto::DamageDone,
                DimensionDto::Ability,
            )
        };
        let set = merged(vec![part(&pull_1), part(&pull_2)]);
        let row = &set.rows[0].row;
        assert_eq!(
            (
                row.casts,
                row.hits,
                row.hit_amount,
                row.ticks,
                row.tick_amount
            ),
            (1, 2, 1_300, 1, 300)
        );
        let parry = |count| MissCountDto {
            miss_type: MissTypeDto::Parry,
            count,
        };
        let dodge = MissCountDto {
            miss_type: MissTypeDto::Dodge,
            count: 1,
        };
        assert_eq!(row.misses, [dodge, parry(2)]);
    }

    #[test]
    fn filter_options_list_units_of_every_pull_once() {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let add = unit(&mut actors, "Creature-0-1-1-1-2-01", "Add", HOSTILE_FLAGS);
        let pull_1 = fight(
            actors.clone(),
            vec![damage_event(1_000, a, boss, 1, 2_000, NOBODY)],
        );
        let pull_2 = fight(
            actors,
            vec![
                damage_event(1_000, a, boss, 1, 4_000, NOBODY),
                damage_event(2_000, a, add, 1, 1_000, NOBODY),
            ],
        );
        let part = |fight| {
            FilterOptionsDto(filter_options(
                fight,
                &openlogs_gamedata::Curated::bundled(),
                WHOLE,
                ScopeDto::default(),
                ScopeMetricDto::DamageDone,
                DimensionDto::Target,
            ))
        };
        let set = merged(vec![part(&pull_1), part(&pull_2)]);
        let options: Vec<_> = set
            .0
            .iter()
            .map(|o| (o.name.as_str(), o.number, o.instances.len()))
            .collect();
        assert_eq!(options, [("Ula'tek", None, 0), ("Add", None, 0)]);
    }

    #[test]
    fn filter_options_rank_by_the_amount_over_the_set() {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let [boss, add, imp] = [
            ("Creature-0-1-1-1-1-01", "Ula'tek"),
            ("Creature-0-1-1-1-2-01", "Add"),
            ("Creature-0-1-1-1-3-01", "Imp"),
        ]
        .map(|(guid, name)| unit(&mut actors, guid, name, HOSTILE_FLAGS));
        let pull_1 = fight(
            actors.clone(),
            vec![
                damage_event(1_000, a, boss, 1, 3_000, NOBODY),
                damage_event(2_000, a, add, 1, 1_000, NOBODY),
            ],
        );
        let pull_2 = fight(
            actors,
            vec![
                damage_event(1_000, a, add, 1, 4_000, NOBODY),
                damage_event(2_000, a, imp, 1, 3_000, NOBODY),
            ],
        );
        let part = |fight| {
            FilterOptionsDto(filter_options(
                fight,
                &openlogs_gamedata::Curated::bundled(),
                WHOLE,
                ScopeDto::default(),
                ScopeMetricDto::DamageDone,
                DimensionDto::Target,
            ))
        };
        let set = merged(vec![part(&pull_1), part(&pull_2)]);
        let names: Vec<_> = set.0.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(names, ["Add", "Imp", "Ula'tek"]);
    }

    #[test]
    fn a_spell_option_picks_the_variant_cast_most_over_the_set() {
        let option = |variants: Vec<(u32, u32, u32)>| {
            FilterOptionsDto(vec![FilterOptionDto {
                value: OptionValueDto::Ability {
                    ability: AbilityRefDto::Name {
                        name: "Smite".into(),
                    },
                },
                name: "Smite".into(),
                number: None,
                npc_id: None,
                instances: Vec::new(),
                pets: Vec::new(),
                primary_spell: None,
                variants: variants
                    .into_iter()
                    .map(|(spell_id, casts, hits)| VariantDto {
                        spell_id,
                        casts,
                        hits,
                        heals: 0,
                        auras: 0,
                    })
                    .collect(),
                amount: 0,
            }])
        };
        let set = merged(vec![
            option(vec![(10, 3, 3), (11, 1, 5)]),
            option(vec![(10, 0, 0), (11, 4, 4)]),
        ]);
        assert_eq!(set.0[0].primary_spell, Some(11));
        let variants: Vec<_> = set.0[0]
            .variants
            .iter()
            .map(|v| (v.spell_id, v.casts))
            .collect();
        assert_eq!(variants, [(10, 3), (11, 5)]);
    }

    fn by_source(fight: &Fight) -> BreakdownDto {
        breakdown_report(
            fight,
            &openlogs_gamedata::Curated::bundled(),
            WHOLE,
            ScopeDto::default(),
            ScopeMetricDto::DamageDone,
            DimensionDto::Source,
        )
    }

    fn name_spells(fight: &mut Fight, ids: &[SpellId]) {
        for &id in ids {
            fight.spells.insert(
                id,
                SpellInfo {
                    name: "Smite".into(),
                    school: 1,
                },
            );
        }
    }

    #[test]
    fn rows_of_equal_amount_are_ordered_by_numeric_actor_id() {
        let mut actors = Actors::new();
        let players: Vec<_> = (1..=11)
            .map(|n| {
                let guid = format!("Player-{n}");
                unit(&mut actors, &guid, &format!("Raider{n}"), PLAYER_FLAGS)
            })
            .collect();
        let [two, ten] = [2, 10].map(|id| *players.iter().find(|&&p| p == id).unwrap());
        let boss = unit(
            &mut actors,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let both = fight(
            actors.clone(),
            vec![
                damage_event(1_000, ten, boss, 1, 1_000, NOBODY),
                damage_event(1_000, two, boss, 1, 1_000, NOBODY),
            ],
        );
        let pull_1 = fight(
            actors.clone(),
            vec![damage_event(1_000, ten, boss, 1, 1_000, NOBODY)],
        );
        let pull_2 = fight(
            actors,
            vec![damage_event(1_000, two, boss, 1, 1_000, NOBODY)],
        );
        let set = merged(vec![by_source(&pull_1), by_source(&pull_2)]);
        let order: Vec<_> = set.rows.iter().map(|r| r.row.key.clone()).collect();
        let single = by_source(&both);
        let expected: Vec<_> = single.rows.iter().map(|r| r.row.key.clone()).collect();
        assert_eq!(order, expected);
    }

    #[test]
    fn a_breakdown_row_takes_the_icon_spell_with_the_most_damage_over_the_set() {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let mut pull_1 = fight(
            actors.clone(),
            vec![
                damage_event(1_000, a, boss, 1, 5, NOBODY),
                damage_event(2_000, a, boss, 2, 4, NOBODY),
            ],
        );
        let mut pull_2 = fight(actors, vec![damage_event(1_000, a, boss, 2, 5, NOBODY)]);
        name_spells(&mut pull_1, &[1, 2]);
        name_spells(&mut pull_2, &[1, 2]);
        let part = |fight: &Fight| {
            breakdown_report(
                fight,
                &openlogs_gamedata::Curated::bundled(),
                WHOLE,
                ScopeDto::default(),
                ScopeMetricDto::DamageDone,
                DimensionDto::Ability,
            )
        };
        let set = merged(vec![part(&pull_1), part(&pull_2)]);
        assert_eq!(set.rows[0].row.amount, 14);
        assert_eq!(set.rows[0].row.spell_id, 2);
    }

    #[test]
    fn a_taken_row_takes_the_icon_spell_with_the_most_damage_over_the_set() {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let mut pull_1 = fight(
            actors.clone(),
            vec![
                damage_event(1_000, boss, a, 1, 5, NOBODY),
                damage_event(2_000, boss, a, 2, 4, NOBODY),
            ],
        );
        let mut pull_2 = fight(actors, vec![damage_event(1_000, boss, a, 2, 5, NOBODY)]);
        name_spells(&mut pull_1, &[1, 2]);
        name_spells(&mut pull_2, &[1, 2]);
        let set = merged(vec![
            damage_taken_set_part(&pull_1, WHOLE),
            damage_taken_set_part(&pull_2, WHOLE),
        ]);
        assert_eq!(set.by_ability.len(), 1);
        assert_eq!(set.by_ability[0].spell_id, 2);
        assert_eq!(set.by_player[0].abilities[0].spell_id, 2);
    }

    #[test]
    fn split_rows_sum_over_pulls_and_share_the_split_total() {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let b = unit(&mut actors, "Player-2", "Aleth-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let pull_1 = fight(
            actors.clone(),
            vec![damage_event(1_000, a, boss, 1, 2_000, NOBODY)],
        );
        let pull_2 = fight(
            actors,
            vec![
                damage_event(1_000, a, boss, 1, 4_000, NOBODY),
                damage_event(2_000, b, boss, 1, 1_000, NOBODY),
            ],
        );
        let part = |fight: &Fight| {
            breakdown_report(
                fight,
                &openlogs_gamedata::Curated::bundled(),
                WHOLE,
                ScopeDto::default(),
                ScopeMetricDto::DamageDone,
                DimensionDto::Ability,
            )
        };
        let set = merged(vec![part(&pull_1), part(&pull_2)]);
        let splits: Vec<_> = set.rows[0]
            .splits
            .iter()
            .map(|s| {
                let rows: Vec<_> = s.rows.iter().map(|r| (r.amount, r.share)).collect();
                (s.dimension, rows)
            })
            .collect();
        assert_eq!(
            splits,
            [
                (
                    DimensionDto::Source,
                    vec![(6_000, 6_000.0 / 7_000.0), (1_000, 1_000.0 / 7_000.0)]
                ),
                (DimensionDto::Target, vec![(7_000, 1.0)]),
            ]
        );
    }

    #[test]
    fn a_set_overview_sums_tiles_and_keeps_each_pull() {
        let part = |damage: u64, duration: u64, deaths: u32, first_death: Option<i32>, hp: f32| {
            QuickOverviewDto {
                kpis: KpisDto {
                    players: 20,
                    duration_ms: duration,
                    raid_damage: damage,
                    raid_dps: 0.0,
                    deaths,
                    first_death_ms: first_death,
                    combat_potions: 3,
                    players_without_combat_potion: 1,
                    healthstones: 1,
                    health_potions: 2,
                },
                timeline: TimelineDto {
                    boss_hp_step_ms: 1_000,
                    boss_hp: vec![Some(hp)],
                    dps_step_ms: 1_000,
                    raid_dps: vec![1.0],
                    phases: Vec::new(),
                    markers: MarkersDto {
                        deaths: Vec::new(),
                        bloodlust: Vec::new(),
                        boss_casts: Vec::new(),
                    },
                    duration_ms: duration,
                    cutoff_ms: None,
                },
                players: Vec::new(),
                spells: BTreeMap::new(),
                deaths: Vec::new(),
                consumables: Vec::new(),
                cooldowns: Vec::new(),
            }
        };
        let mut acc = SetOverviewAcc::default();
        acc.add(3, part(6_000, 20_000, 1, Some(5_000), 40.0));
        acc.add(5, part(2_000, 20_000, 2, Some(9_000), 10.0));
        let set = acc.finish(22).expect("two pulls were added");
        let kpis = &set.overview.kpis;
        assert_eq!(
            (
                kpis.players,
                kpis.duration_ms,
                kpis.raid_damage,
                kpis.raid_dps
            ),
            (22, 40_000, 8_000, 200.0)
        );
        assert_eq!((kpis.deaths, kpis.first_death_ms), (3, None));
        assert_eq!(
            (
                kpis.combat_potions,
                kpis.players_without_combat_potion,
                kpis.healthstones,
                kpis.health_potions
            ),
            (6, 2, 2, 4)
        );
        assert!(set.overview.timeline.boss_hp.is_empty());
        assert_eq!(set.pulls[0].boss_hp, [Some(40.0)]);
        assert_eq!(set.overview.timeline.duration_ms, 40_000);
        assert_eq!(set.pulls[1].fight_index, 5);
        assert_eq!(set.pulls[1].kpis.first_death_ms, Some(9_000));
        assert_eq!(set.pulls[1].boss_hp, [Some(10.0)]);
    }

    #[test]
    fn set_pulls_cut_each_at_their_own_death() {
        let mut actors = Actors::new();
        let players: Vec<_> = (1..=3)
            .map(|i| {
                unit(
                    &mut actors,
                    &format!("Player-{i}"),
                    &format!("Raider{i}"),
                    PLAYER_FLAGS,
                )
            })
            .collect();
        let died = |t: i32, player: ActorId| Event {
            t,
            source: NOBODY,
            target: player,
            spell: 0,
            kind: EventKind::Died { unconscious: false },
            source_hostile: false,
            target_hostile: false,
            unit_hp: None,
        };
        let mut long = fight(
            actors.clone(),
            vec![
                died(10_000, players[0]),
                died(20_000, players[1]),
                died(40_000, players[2]),
            ],
        );
        long.duration_ms = 90_000;
        let mut short = fight(actors, vec![died(5_000, players[0])]);
        short.duration_ms = 60_000;
        let filter = FilterDto {
            death_cutoff: Some(3),
            ..WHOLE
        };
        let curated = openlogs_gamedata::Curated::bundled();
        let mut acc = SetOverviewAcc::default();
        for (index, pull) in [&long, &short].into_iter().enumerate() {
            acc.add(
                index as u32,
                crate::quick_overview(pull, &curated, Some(filter)),
            );
        }
        let set = acc.finish(3).expect("two pulls were added");
        let pulls: Vec<_> = set
            .pulls
            .iter()
            .map(|p| (p.cutoff_ms, p.kpis.duration_ms, p.pull_duration_ms))
            .collect();
        assert_eq!(
            pulls,
            [(Some(40_000), 40_001, 90_000), (None, 60_000, 60_000)]
        );
        assert_eq!(set.overview.kpis.duration_ms, 100_001);
        assert_eq!(set.overview.timeline.cutoff_ms, None);
    }
}
