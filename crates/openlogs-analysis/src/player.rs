use std::collections::{HashMap, HashSet};

use openlogs_gamedata::{CooldownCategory, CooldownSpell, Curated, PlayerCooldownKind};

use crate::actors::{ActorId, ActorKind, NOBODY};
use crate::auras::{aura_intervals, merged, union_ms};
use crate::casts::non_press_casts;
use crate::deaths::{Death, deaths};
use crate::fight::{AuraType, DamageVia, Event, EventKind, Fight, SpellId};
use crate::filter::{Attribution, Overkill, ReportFilter};
use crate::links::{AbilityIndex, AbilityLink, SpellKey, spell_key};
use crate::reports::damage::damage_done_in;
use crate::reports::healing::healing_in;
use crate::reports::taken::taken_amount;
use crate::reports::{
    AbilityRow, AbilityTargets, BuffShare, BuffedAbility, RowKind, Share, Support, SupportShare,
    TargetKey, TargetShare, buff_totals, buffed_spell, damage_share, healing_share, keeps_own,
    keeps_support, sorted_by_amount,
};
use crate::resources::power_series;
use crate::scope::Scope;
use crate::timeline::healing_amount;
use crate::usage::{ConsumableUse, DeathContext, consumable_uses, death_context, defensive_uses};

/// Step of the player's damage or healing over time.
pub const SERIES_STEP_MS: u32 = 5_000;
pub const EBON_MIGHT: SpellId = 395152;
pub const PRESCIENCE: SpellId = 410089;
const MAX_BUFF_ROWS: usize = 12;

/// The group of a cast row on the player page, in this order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CastKind {
    /// A major cooldown (`major_cds.json`).
    Major,
    /// A rotational cooldown from the player-page catalogue, or — for specs without catalogue
    /// entries — one of the player's most-cast spells.
    Rotation,
    /// A shield from the catalogue or a personal defensive.
    Defensive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CastRow {
    pub spell: SpellId,
    pub kind: CastKind,
    /// Effect length from the curated cooldown list; 0 for defensives and instant effects.
    pub duration_ms: u32,
    pub times: Vec<i32>,
    /// The ability page with this spell's hits; `None` when it has none.
    pub link: Option<AbilityLink>,
}

/// What a buff row shows; also its group on the page, in this order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum BuffKind {
    /// Ebon Might, Prescience.
    Aug,
    /// Bloodlust, Time Warp and the like.
    Lust,
    /// Another player's curated cooldown on the player (Power Infusion).
    External,
    /// The buff of one of the player's own major cooldowns (Arcane Surge).
    Cooldown,
    /// A key proc from the player-page catalogue.
    Proc,
    /// An absorb shield from the player-page catalogue.
    Shield,
    /// A tank's active mitigation or defensive buff from the player-page catalogue.
    Defensive,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BuffRow {
    pub spell: SpellId,
    /// The player who applied it; the player itself for self buffs.
    pub source: ActorId,
    pub kind: BuffKind,
    /// Clipped to the range.
    pub intervals: Vec<(i32, i32)>,
    pub uptime: f64,
}

/// Damage taken rows on the player page.
const TAKEN_ROWS: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Metric {
    Damage,
    Healing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerAbility {
    pub row: AbilityRow,
    /// The player's own casts of a spell of this name in the range; `None` without casts and
    /// for pet and support rows.
    pub casts: Option<u32>,
    /// Damage or healing an Evoker's buff created, also logged as support (Fate Mirror).
    pub aug: bool,
    /// Pet names merged into the pet row; 0 for other rows.
    pub pets: u32,
    /// Reattributed mode: `row.support` by buff and Evoker, largest first.
    pub support_from: Vec<BuffShare>,
    /// Reattributed mode, the Evoker's support rows: the players the buff supported, largest
    /// first (the Evoker too for his own share).
    pub recipients: Vec<SupportRecipient>,
    /// The row by target, largest first; merged rows sum their parts.
    pub targets: Vec<TargetShare>,
}

/// A player one of the Evoker's buffs supported, and the abilities it supported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupportRecipient {
    pub player: ActorId,
    pub amount: u64,
    /// Merged by spell name per caster, largest first; `None` for unmatched hits.
    pub abilities: Vec<(Option<BuffedAbility>, u64)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerDetail {
    pub player: ActorId,
    pub metric: Metric,
    /// The filter range clipped to the pull.
    pub start_ms: i32,
    pub end_ms: i32,
    pub total: u64,
    /// The same metric in the other Aug mode.
    pub other_mode_total: u64,
    pub per_second: f64,
    /// 1-based rank among the report's players in the same scope; 0 when the player has no total.
    pub rank: usize,
    pub ranked_players: usize,
    pub support_received: u64,
    /// Support received, by Evoker.
    pub support_received_from: Vec<(ActorId, u64)>,
    /// Effective healing and absorbs on the player.
    pub healing_received: u64,
    pub deaths: Vec<PlayerDeath>,
    pub consumables: Vec<ConsumableUse>,
    pub abilities: Vec<PlayerAbility>,
    /// Every pet ability (pet rows by pet name and spell), largest first: the pet row expanded.
    pub pet_abilities: Vec<PlayerAbility>,
    /// Damage taken by spell, largest first: (spell, world damage, amount).
    pub taken_by_spell: Vec<(SpellId, bool, u64)>,
    pub series_step_ms: u32,
    /// Per-second values per step from `start_ms`; the last step uses its real length.
    pub series: Vec<f64>,
    /// Curated cooldowns and defensives the player cast: major cooldowns, the spec's rotational
    /// cooldowns, then shields and defensives; first cast first within each.
    pub cast_rows: Vec<CastRow>,
    /// The player's own casts, most frequent spells first.
    pub cast_timeline: Vec<CastRow>,
    /// Curated buffs on the player by kind (Aug, lust, externals, own cooldowns, procs, shields).
    pub buff_rows: Vec<BuffRow>,
    /// Ebon Might on the player from any Evoker, merged and clipped to the range.
    pub ebon_might: Vec<(i32, i32)>,
    /// The player's dead phases overlapping the range, clipped to it.
    pub dead: Vec<(i32, i32)>,
    /// When the player was already dead at the range start: the time of that death.
    pub dead_since: Option<i32>,
    /// Evokers only: support and Ebon Might/Prescience uptime per buffed player.
    pub augmentation: Vec<AugTarget>,
    /// Whom the player damaged or healed, largest first.
    pub targets: Vec<TargetShare>,
    /// Units of each enemy name that took damage in the range (damage only).
    pub units: Vec<(String, u32)>,
    /// The raid's largest enemy groups in the range, the bars' colours (damage only).
    pub color_groups: Vec<String>,
    /// Mana percent per series step; empty without mana samples.
    pub mana: Vec<Option<f32>>,
}

struct Standing {
    total: u64,
    per_second: f64,
    rank: usize,
    ranked: usize,
    abilities: Vec<AbilityRow>,
    support: Vec<SupportShare>,
    /// Support received by Evoker as the scope keeps it; `None` when the player has no row.
    received_from: Option<Vec<(ActorId, u64)>>,
    targets: Vec<TargetShare>,
    ability_targets: Vec<AbilityTargets>,
    units: Vec<(String, u32)>,
    color_groups: Vec<String>,
}

fn standing(
    fight: &Fight,
    player: ActorId,
    metric: Metric,
    filter: &ReportFilter,
    scope: &Scope,
) -> Standing {
    let empty = |ranked: usize, support: Vec<SupportShare>, units, color_groups| Standing {
        total: 0,
        per_second: 0.0,
        rank: 0,
        ranked,
        abilities: Vec::new(),
        support,
        received_from: None,
        targets: Vec::new(),
        ability_targets: Vec::new(),
        units,
        color_groups,
    };
    match metric {
        Metric::Damage => {
            let report = damage_done_in(fight, filter, scope);
            let ranked = report.players.len();
            match report.players.iter().position(|p| p.player == player) {
                Some(index) => {
                    let row = report.players[index].clone();
                    Standing {
                        total: row.total,
                        per_second: row.per_second,
                        rank: index + 1,
                        ranked,
                        abilities: row.abilities,
                        support: report.support,
                        received_from: Some(row.support_received_from),
                        targets: row.targets,
                        ability_targets: row.ability_targets,
                        units: report.units,
                        color_groups: report.color_groups,
                    }
                }
                None => empty(ranked, report.support, report.units, report.color_groups),
            }
        }
        Metric::Healing => {
            let report = healing_in(fight, filter, scope);
            let ranked = report.players.len();
            match report.players.iter().position(|p| p.player == player) {
                Some(index) => {
                    let row = report.players[index].clone();
                    Standing {
                        total: row.total,
                        per_second: row.per_second,
                        rank: index + 1,
                        ranked,
                        abilities: row.abilities,
                        support: report.support,
                        received_from: Some(row.support_received_from),
                        targets: row.targets,
                        ability_targets: row.ability_targets,
                        units: Vec::new(),
                        color_groups: Vec::new(),
                    }
                }
                None => empty(ranked, report.support, Vec::new(), Vec::new()),
            }
        }
    }
}

struct SeriesSpan {
    reattributed: bool,
    overkill: Overkill,
    start: i32,
    end: i32,
}

fn series(
    fight: &Fight,
    player: ActorId,
    metric: Metric,
    span: SeriesSpan,
    scope: &Scope,
) -> Vec<f64> {
    let SeriesSpan {
        reattributed,
        overkill,
        start,
        end,
    } = span;
    let len = (end - start).max(0) as u32;
    if len == 0 {
        return Vec::new();
    }
    let mut sums = vec![0i64; len.div_ceil(SERIES_STEP_MS) as usize];
    for (index, event) in fight
        .events
        .iter()
        .enumerate()
        .filter(|(_, e)| e.t >= start && e.t < end)
    {
        let share = match metric {
            Metric::Damage => damage_share(fight, event, overkill),
            Metric::Healing => healing_share(fight, event),
        };
        let delta = match share {
            Some(Share::Own {
                player: p,
                actor,
                spell,
                amount,
                ..
            }) if p == player && keeps_own(fight, scope, actor, spell, event.target) => {
                amount as i64
            }
            Some(Share::Support(s)) if reattributed => {
                // The hit's ability decides only under a selection; finding it scans back.
                let buffed = if scope.selects_all() {
                    None
                } else {
                    buffed_spell(fight, index)
                };
                let parts = keeps_support(fight, scope, &s, buffed);
                let credit = if s.evoker == player && parts.credit {
                    s.amount as i64
                } else {
                    0
                };
                let deduction = if s.player == player && parts.buffed {
                    s.amount as i64
                } else {
                    0
                };
                credit - deduction
            }
            _ => 0,
        };
        sums[((event.t - start) as u32 / SERIES_STEP_MS) as usize] += delta;
    }
    sums.iter()
        .enumerate()
        .map(|(i, &sum)| {
            let bucket_len = SERIES_STEP_MS.min(len - i as u32 * SERIES_STEP_MS);
            sum.max(0) as f64 * 1000.0 / f64::from(bucket_len)
        })
        .collect()
}

/// Fallback rotation rows of a spec without catalogue entries: at most this many spells …
const FALLBACK_ROTATION_ROWS: usize = 6;
/// … cast at least this often in the range.
const FALLBACK_MIN_CASTS: usize = 3;

/// A spell that can stand for the rotation: no consumable, curated proc or curated movement or
/// utility spell (Hover, Charge, …: the `utility` entries of the player-page catalogue).
fn is_rotation_candidate(
    fight: &Fight,
    curated: &Curated,
    spell: SpellId,
    spec: Option<u32>,
) -> bool {
    let name = fight
        .spells
        .get(&spell)
        .map_or("", |info| info.name.as_str());
    let utility = spec
        .and_then(|spec_id| curated.player_cooldown(spell, spec_id))
        .is_some_and(|entry| entry.kind == PlayerCooldownKind::Utility);
    !curated.is_proc(spell) && !utility && curated.consumable_kind(spell, name).is_none()
}

fn cast_rows(
    fight: &Fight,
    curated: &Curated,
    player: ActorId,
    start: i32,
    end: i32,
    index: &AbilityIndex,
) -> Vec<CastRow> {
    let spec = fight.actors.get(player).spec_id;
    let catalogue = spec.is_some_and(|spec_id| curated.has_rotation_entries(spec_id));
    // Major cooldowns, then the spec's rotational cooldowns, then shields and defensives.
    let kind = |spell: SpellId| -> Option<CastKind> {
        if curated.cooldown(spell, spec).is_some() {
            return Some(CastKind::Major);
        }
        let spec_id = spec?;
        match curated
            .player_cooldown(spell, spec_id)
            .map(|entry| entry.kind)
        {
            Some(PlayerCooldownKind::Rotation) => Some(CastKind::Rotation),
            Some(PlayerCooldownKind::Shield) => Some(CastKind::Defensive),
            Some(PlayerCooldownKind::Proc | PlayerCooldownKind::Utility) => None,
            // A tank's buff entry: a cast row only when the spell is a personal defensive.
            Some(PlayerCooldownKind::Defensive) | None => curated
                .defensive(spell, spec_id)
                .map(|_| CastKind::Defensive),
        }
    };
    let mut rows: Vec<CastRow> = Vec::new();
    // Specs without catalogue entries: the player's own other casts, candidates for rotation,
    // one row per spell name.
    let mut others: Vec<CastRow> = Vec::new();
    // One cast per press: no procs, no follow-up casts of multi-ID spells.
    let not_pressed = non_press_casts(fight, curated, player);
    for (i, event) in fight
        .events
        .iter()
        .enumerate()
        .filter(|(_, e)| e.t >= start && e.t < end)
    {
        if !matches!(event.kind, EventKind::CastSuccess)
            || fight.actors.credited_player(event.source) != Some(player)
            || not_pressed.contains(&i)
        {
            continue;
        }
        let (list, kind, by_name) = match kind(event.spell) {
            Some(kind) => (&mut rows, kind, false),
            None if !catalogue
                && event.source == player
                && is_rotation_candidate(fight, curated, event.spell, spec) =>
            {
                (&mut others, CastKind::Rotation, true)
            }
            None => continue,
        };
        let same_row = |row: &&mut CastRow| {
            if by_name {
                spell_key(fight, row.spell) == spell_key(fight, event.spell)
            } else {
                row.spell == event.spell
            }
        };
        match list.iter_mut().find(same_row) {
            Some(row) => row.times.push(event.t),
            None => list.push(CastRow {
                spell: event.spell,
                kind,
                duration_ms: curated
                    .cooldown(event.spell, spec)
                    .map_or(0, |c| c.duration_s * 1_000),
                times: vec![event.t],
                link: index.link(fight, player, event.spell),
            }),
        }
    }
    // The most-cast ones with enough casts; `others` is in first-cast order, the sort is stable.
    let mut by_count: Vec<&CastRow> = others
        .iter()
        .filter(|row| row.times.len() >= FALLBACK_MIN_CASTS)
        .collect();
    by_count.sort_by_key(|row| std::cmp::Reverse(row.times.len()));
    let picked: HashSet<SpellId> = by_count
        .iter()
        .take(FALLBACK_ROTATION_ROWS)
        .map(|row| row.spell)
        .collect();
    rows.extend(others.into_iter().filter(|row| picked.contains(&row.spell)));
    // Stable: first-cast order inside a group.
    rows.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.times[0].cmp(&b.times[0])));
    rows
}

fn ebon_might(fight: &Fight, player: ActorId, start: i32, end: i32) -> Vec<(i32, i32)> {
    let intervals: Vec<(i32, i32)> = aura_intervals(fight)
        .into_iter()
        .filter(|i| i.target == player && i.spell == EBON_MIGHT)
        .map(|i| (i.start_ms, i.end_ms))
        .collect();
    merged(&intervals, start, end)
}

/// The player page's rows: own rows of one spell name merged (the larger part's ID stays for icon
/// and page; rows arrive largest first), and every pet in one row named after the pet of the
/// largest pet row, with that pet's summon spell as its icon.
fn merged_abilities(
    fight: &Fight,
    player: ActorId,
    rows: Vec<PlayerAbility>,
) -> Vec<PlayerAbility> {
    let mut out: Vec<PlayerAbility> = Vec::new();
    let mut pets: Option<PlayerAbility> = None;
    let mut pet_names: HashSet<&str> = HashSet::new();
    for ability in rows {
        match ability.row.kind {
            RowKind::Own => {
                let key = spell_key(fight, ability.row.spell);
                match out
                    .iter_mut()
                    .find(|o| o.row.kind == RowKind::Own && spell_key(fight, o.row.spell) == key)
                {
                    Some(merged) => absorb(merged, &ability),
                    None => out.push(ability),
                }
            }
            RowKind::Pet => {
                pet_names.insert(
                    fight
                        .actors
                        .get(ability.row.actor)
                        .name
                        .as_deref()
                        .unwrap_or(""),
                );
                match pets.as_mut() {
                    Some(merged) => absorb(merged, &ability),
                    None => pets = Some(ability),
                }
            }
            _ => out.push(ability),
        }
    }
    if let Some(mut row) = pets {
        let name = fight
            .actors
            .get(row.row.actor)
            .name
            .as_deref()
            .unwrap_or("");
        if let Some(spell) = summon_spell(fight, player, name) {
            row.row.spell = spell;
        }
        row.pets = pet_names.len() as u32;
        out.push(row);
    }
    out.sort_by(|a, b| {
        b.row
            .amount
            .cmp(&a.row.amount)
            .then(a.row.spell.cmp(&b.row.spell))
    });
    out
}

fn absorb(into: &mut PlayerAbility, part: &PlayerAbility) {
    into.row.amount += part.row.amount;
    into.row.support += part.row.support;
    into.support_from = buff_totals(into.support_from.iter().chain(&part.support_from).copied());
    into.row.overheal += part.row.overheal;
    into.row.hits += part.row.hits;
    into.row.crits += part.row.crits;
    into.row.ticks += part.row.ticks;
    into.row.max = into.row.max.max(part.row.max);
    into.aug |= part.aug;
    into.targets = merged_targets(into.targets.iter().chain(&part.targets));
}

/// Sums target shares by target, largest first.
fn merged_targets<'a>(parts: impl Iterator<Item = &'a TargetShare>) -> Vec<TargetShare> {
    let mut sums: HashMap<&TargetKey, (i64, u32, u32)> = HashMap::new();
    for part in parts {
        let sum = sums.entry(&part.target).or_default();
        sum.0 += part.amount;
        sum.1 += part.hits;
        sum.2 += part.crits;
    }
    let mut list: Vec<TargetShare> = sums
        .into_iter()
        .filter(|(_, sum)| sum.0 != 0)
        .map(|(target, (amount, hits, crits))| TargetShare {
            target: target.clone(),
            amount,
            hits,
            crits,
        })
        .collect();
    list.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.target.cmp(&b.target)));
    list
}

/// The spell that summoned the player's pet of this name, if the log has it.
fn summon_spell(fight: &Fight, player: ActorId, pet_name: &str) -> Option<SpellId> {
    fight
        .events
        .iter()
        .find(|e| {
            matches!(e.kind, EventKind::Summon)
                && fight.actors.credited_player(e.source) == Some(player)
                && fight.actors.get(e.target).name.as_deref() == Some(pet_name)
        })
        .map(|e| e.spell)
}

fn lust_or(cooldown: &CooldownSpell, other: BuffKind) -> BuffKind {
    if cooldown.category == CooldownCategory::Bloodlust {
        BuffKind::Lust
    } else {
        other
    }
}

/// The kind of a buff worth a row, `None` for every other buff (raid buffs, HoTs, uncurated
/// procs and externals).
fn buff_kind(
    fight: &Fight,
    curated: &Curated,
    player: ActorId,
    spell: SpellId,
    source: ActorId,
) -> Option<BuffKind> {
    if matches!(spell, EBON_MIGHT | PRESCIENCE) {
        return Some(BuffKind::Aug);
    }
    if source != player {
        return curated
            .cooldown(spell, fight.actors.get(source).spec_id)
            .map(|cd| lust_or(cd, BuffKind::External));
    }
    let spec = fight.actors.get(player).spec_id;
    if let Some(entry) = spec.and_then(|spec_id| curated.player_cooldown(spell, spec_id)) {
        return match entry.kind {
            PlayerCooldownKind::Proc => Some(BuffKind::Proc),
            PlayerCooldownKind::Shield => Some(BuffKind::Shield),
            PlayerCooldownKind::Defensive => Some(BuffKind::Defensive),
            PlayerCooldownKind::Rotation | PlayerCooldownKind::Utility => None,
        };
    }
    let name = fight.spells.get(&spell).map(|info| info.name.as_str())?;
    curated
        .cooldown(spell, spec)
        .or_else(|| curated.cooldown_named(name, spec))
        .map(|cd| lust_or(cd, BuffKind::Cooldown))
}

/// Curated buffs on the player, by kind, then by uptime.
fn buff_rows(
    fight: &Fight,
    curated: &Curated,
    player: ActorId,
    start: i32,
    end: i32,
) -> Vec<BuffRow> {
    let len = end - start;
    if len <= 0 {
        return Vec::new();
    }
    let mut by_source: HashMap<(SpellId, ActorId), Vec<(i32, i32)>> = HashMap::new();
    for interval in aura_intervals(fight) {
        if interval.target != player || interval.aura_type != AuraType::Buff {
            continue;
        }
        let Some(source) = fight.actors.credited_player(interval.source) else {
            continue;
        };
        by_source
            .entry((interval.spell, source))
            .or_default()
            .push((interval.start_ms, interval.end_ms));
    }
    let mut rows: Vec<BuffRow> = by_source
        .into_iter()
        .filter_map(|((spell, source), intervals)| {
            let kind = buff_kind(fight, curated, player, spell, source)?;
            let uptime = union_ms(&intervals, start, end) as f64 / f64::from(len);
            (uptime > 0.0).then(|| BuffRow {
                spell,
                source,
                kind,
                intervals: merged(&intervals, start, end),
                uptime,
            })
        })
        .collect();
    rows.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then(b.uptime.total_cmp(&a.uptime))
            .then(a.spell.cmp(&b.spell))
            .then(a.source.cmp(&b.source))
    });
    rows.truncate(MAX_BUFF_ROWS);
    rows
}

fn shares_by_buff<'a>(shares: impl Iterator<Item = &'a SupportShare>) -> Vec<BuffShare> {
    buff_totals(shares.map(|s| BuffShare {
        buff: s.buff,
        evoker: s.evoker,
        amount: s.amount,
    }))
}

/// The players `evoker`'s `buff` supported, with their abilities merged by spell name per caster
/// like the player page's rows (the largest part's ID stays).
fn recipients(
    fight: &Fight,
    support: &[SupportShare],
    evoker: ActorId,
    buff: SpellId,
) -> Vec<SupportRecipient> {
    let mut by_player: HashMap<ActorId, SupportRecipient> = HashMap::new();
    // `support` is sorted largest first, so the first ability of a name is the largest part.
    for share in support
        .iter()
        .filter(|s| s.evoker == evoker && s.buff == buff)
    {
        let recipient = by_player.entry(share.player).or_insert(SupportRecipient {
            player: share.player,
            amount: 0,
            abilities: Vec::new(),
        });
        recipient.amount += share.amount;
        let key = |a: Option<BuffedAbility>| a.map(|a| (spell_key(fight, a.spell), a.actor));
        match recipient
            .abilities
            .iter_mut()
            .find(|(ability, _)| key(*ability) == key(share.ability))
        {
            Some((_, amount)) => *amount += share.amount,
            None => recipient.abilities.push((share.ability, share.amount)),
        }
    }
    let mut list: Vec<SupportRecipient> = by_player.into_values().collect();
    for recipient in &mut list {
        recipient
            .abilities
            .sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    }
    list.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.player.cmp(&b.player)));
    list
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AugTarget {
    pub player: ActorId,
    /// Support this Evoker's buffs added to the player's damage or healing.
    pub support: u64,
    pub ebon_might_uptime: f64,
    pub prescience_uptime: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerDeath {
    pub death: Death,
    /// Defensives and consumables at the moment of death, as on the Overview.
    pub context: Vec<DeathContext>,
}

fn augmentation(
    fight: &Fight,
    evoker: ActorId,
    metric: Metric,
    filter: &ReportFilter,
) -> Vec<AugTarget> {
    let (start, end) = filter.clipped(fight);
    let len = end - start;
    if len <= 0 {
        return Vec::new();
    }
    let mut support: HashMap<ActorId, u64> = HashMap::new();
    // Same events as the reports, so the sums match the Evoker's support rows.
    for event in fight.events.iter().filter(|e| filter.contains(e.t)) {
        let share = match metric {
            Metric::Damage => damage_share(fight, event, filter.overkill),
            Metric::Healing => healing_share(fight, event),
        };
        if let Some(Share::Support(Support {
            player,
            evoker: e,
            amount,
            ..
        })) = share
            && e == evoker
            && player != evoker
        {
            *support.entry(player).or_default() += amount;
        }
    }
    let mut ebon: HashMap<ActorId, Vec<(i32, i32)>> = HashMap::new();
    let mut prescience: HashMap<ActorId, Vec<(i32, i32)>> = HashMap::new();
    for interval in aura_intervals(fight) {
        if fight.actors.credited_player(interval.source) != Some(evoker)
            || interval.target == evoker
            || !is_player(fight, interval.target)
        {
            continue;
        }
        let list = match interval.spell {
            EBON_MIGHT => &mut ebon,
            PRESCIENCE => &mut prescience,
            _ => continue,
        };
        list.entry(interval.target)
            .or_default()
            .push((interval.start_ms, interval.end_ms));
    }
    let uptime = |map: &HashMap<ActorId, Vec<(i32, i32)>>, player: ActorId| {
        map.get(&player)
            .map_or(0.0, |iv| union_ms(iv, start, end) as f64 / f64::from(len))
    };
    let players: HashSet<ActorId> = support
        .keys()
        .chain(ebon.keys())
        .chain(prescience.keys())
        .copied()
        .collect();
    let mut rows: Vec<AugTarget> = players
        .into_iter()
        .map(|player| AugTarget {
            player,
            support: support.get(&player).copied().unwrap_or(0),
            ebon_might_uptime: uptime(&ebon, player),
            prescience_uptime: uptime(&prescience, player),
        })
        .filter(|row| row.support > 0 || row.ebon_might_uptime > 0.0 || row.prescience_uptime > 0.0)
        .collect();
    rows.sort_by(|a, b| b.support.cmp(&a.support).then(a.player.cmp(&b.player)));
    rows
}

/// Effective healing and absorbs `player` received, without Aug support shares.
pub(crate) fn received_healing(event: &Event, player: ActorId) -> Option<u64> {
    if event.target != player {
        return None;
    }
    match event.kind {
        EventKind::Heal(heal) if heal.supporter == NOBODY => Some(healing_amount(&heal)),
        EventKind::Absorbed(absorbed) if absorbed.supporter == NOBODY => Some(absorbed.amount),
        _ => None,
    }
}

pub(crate) fn is_player(fight: &Fight, id: ActorId) -> bool {
    id as usize <= fight.actors.len() && fight.actors.get(id).kind == ActorKind::Player
}

/// Rows in the player's full cast timeline.
pub const CAST_TIMELINE_ROWS: usize = 12;

/// The player's own casts in the range (no pets, no curated procs), by spell.
fn cast_timeline(
    fight: &Fight,
    curated: &Curated,
    player: ActorId,
    filter: &ReportFilter,
    index: &AbilityIndex,
) -> Vec<CastRow> {
    let mut by_spell: HashMap<SpellId, Vec<i32>> = HashMap::new();
    for event in fight.events.iter().filter(|e| filter.contains(e.t)) {
        if matches!(event.kind, EventKind::CastSuccess)
            && event.source == player
            && !curated.is_proc(event.spell)
        {
            by_spell.entry(event.spell).or_default().push(event.t);
        }
    }
    let mut rows: Vec<CastRow> = by_spell
        .into_iter()
        .map(|(spell, times)| CastRow {
            spell,
            kind: CastKind::Rotation,
            duration_ms: 0,
            times,
            link: index.link(fight, player, spell),
        })
        .collect();
    rows.sort_by(|a, b| {
        b.times
            .len()
            .cmp(&a.times.len())
            .then(a.spell.cmp(&b.spell))
    });
    rows.truncate(CAST_TIMELINE_ROWS);
    rows
}

/// The player is the page's subject; of `scope`, the target and ability selections apply to the
/// metric parts: totals, rank, abilities, targets and the series. The context (casts, buffs,
/// damage taken, deaths, consumables, Augmentation) stays whole.
pub fn player_detail(
    fight: &Fight,
    curated: &Curated,
    player: ActorId,
    metric: Metric,
    filter: &ReportFilter,
    scope: &Scope,
) -> Option<PlayerDetail> {
    if !is_player(fight, player) {
        return None;
    }
    let page = Scope {
        source: Vec::new(),
        ..scope.clone()
    };
    let (start_ms, end_ms) = filter.clipped(fight);
    let links = AbilityIndex::new(fight, filter, Some(player));

    let other_mode = match filter.attribution {
        Attribution::Augmented => Attribution::Reattributed,
        Attribution::Reattributed => Attribution::Augmented,
    };
    let current = standing(fight, player, metric, filter, &page);
    let other = standing(
        fight,
        player,
        metric,
        &ReportFilter {
            attribution: other_mode,
            ..*filter
        },
        &page,
    );
    let received: Vec<&SupportShare> = current
        .support
        .iter()
        // The Evoker's own buff share is not support received.
        .filter(|s| s.player == player && s.evoker != player)
        .collect();
    let support_received_from = match current.received_from.clone() {
        Some(from) => from,
        None if page.selects_all() => {
            let mut by_evoker: HashMap<ActorId, u64> = HashMap::new();
            for share in &received {
                *by_evoker.entry(share.evoker).or_default() += share.amount;
            }
            sorted_by_amount(by_evoker)
        }
        // The ledger books a share when either side is kept, so under a selection it cannot
        // tell whether the buffed side was.
        None => Vec::new(),
    };
    let support_received = support_received_from.iter().map(|(_, amount)| amount).sum();
    let buffs: HashSet<SpellId> = received.iter().map(|s| s.buff).collect();

    // Presses by spell name: procs and follow-up casts of multi-ID spells do not count.
    let not_pressed = non_press_casts(fight, curated, player);
    let mut casts: HashMap<SpellKey<'_>, u32> = HashMap::new();
    let mut healing_received = 0;
    // World damage and melee are both spell 0; the flag keeps them apart.
    let mut taken: HashMap<(SpellId, bool), u64> = HashMap::new();
    for (i, event) in fight
        .events
        .iter()
        .enumerate()
        .filter(|(_, e)| filter.contains(e.t))
    {
        match event.kind {
            EventKind::CastSuccess if event.source == player => {
                if not_pressed.contains(&i) {
                    continue;
                }
                *casts.entry(spell_key(fight, event.spell)).or_default() += 1;
            }
            _ if event.target == player => {
                if let Some(amount) = received_healing(event, player) {
                    healing_received += amount;
                } else if let Some((amount, _)) = taken_amount(event, filter.overkill) {
                    let environmental = matches!(event.kind, EventKind::Damage(d) if d.via == DamageVia::Environmental);
                    *taken.entry((event.spell, environmental)).or_default() += amount;
                }
            }
            _ => {}
        }
    }

    let support_from = |row: &AbilityRow| -> Vec<BuffShare> {
        let ability = match row.kind {
            RowKind::Own | RowKind::Pet => Some(BuffedAbility {
                spell: row.spell,
                actor: row.actor,
            }),
            RowKind::Unmatched => None,
            RowKind::SupportGiven => return Vec::new(),
        };
        if row.support == 0 {
            return Vec::new();
        }
        shares_by_buff(
            current
                .support
                .iter()
                .filter(|s| s.player == player && s.ability == ability),
        )
    };
    let rows: Vec<PlayerAbility> = current
        .abilities
        .iter()
        .map(|&row| PlayerAbility {
            row,
            casts: if row.kind == RowKind::Own {
                casts.get(&spell_key(fight, row.spell)).copied()
            } else {
                None
            },
            aug: matches!(row.kind, RowKind::Own | RowKind::Pet) && buffs.contains(&row.spell),
            pets: 0,
            support_from: support_from(&row),
            targets: current
                .ability_targets
                .iter()
                .find(|t| t.spell == row.spell && t.actor == row.actor && t.kind == row.kind)
                .map_or_else(Vec::new, |t| t.targets.clone()),
            recipients: if row.kind == RowKind::SupportGiven {
                recipients(fight, &current.support, player, row.spell)
            } else {
                Vec::new()
            },
        })
        .collect();
    // The pet row's parts (rows arrive largest first), shown when the row is expanded.
    let pet_abilities: Vec<PlayerAbility> = rows
        .iter()
        .filter(|a| a.row.kind == RowKind::Pet)
        .cloned()
        .collect();
    let abilities = merged_abilities(fight, player, rows);

    let taken_by_spell: Vec<(SpellId, bool, u64)> = sorted_by_amount(taken)
        .into_iter()
        .take(TAKEN_ROWS)
        .map(|((spell, environmental), amount)| (spell, environmental, amount))
        .collect();
    let all_deaths: Vec<Death> = deaths(fight)
        .into_iter()
        .filter(|d| d.player == player)
        .collect();
    let pull_end = fight.duration_ms.min(i32::MAX as u64) as i32;
    let dead = all_deaths
        .iter()
        .map(|d| {
            (
                d.t.max(start_ms),
                d.dead_until.unwrap_or(pull_end).min(end_ms),
            )
        })
        .filter(|(a, b)| b > a)
        .collect();
    let dead_since = all_deaths
        .iter()
        .find(|d| d.t < start_ms && d.dead_until.is_none_or(|r| r > start_ms))
        .map(|d| d.t);
    let all_consumables = consumable_uses(fight, curated);
    let defensives = defensive_uses(fight, curated);
    let deaths = all_deaths
        .iter()
        .filter(|d| filter.contains(d.t))
        .map(|death| PlayerDeath {
            context: death_context(fight, curated, death, &all_consumables, &defensives),
            death: death.clone(),
        })
        .collect();
    let consumables = all_consumables
        .iter()
        .filter(|u| u.player == player && u.t < end_ms && (u.t >= start_ms || start_ms == 0))
        .copied()
        .collect();

    Some(PlayerDetail {
        player,
        metric,
        start_ms,
        end_ms,
        total: current.total,
        other_mode_total: other.total,
        per_second: current.per_second,
        rank: current.rank,
        ranked_players: current.ranked,
        support_received,
        support_received_from,
        healing_received,
        deaths,
        consumables,
        abilities,
        pet_abilities,
        taken_by_spell,
        series_step_ms: SERIES_STEP_MS,
        series: series(
            fight,
            player,
            metric,
            SeriesSpan {
                reattributed: filter.attribution == Attribution::Reattributed,
                overkill: filter.overkill,
                start: start_ms,
                end: end_ms,
            },
            &page,
        ),
        cast_rows: cast_rows(fight, curated, player, start_ms, end_ms, &links),
        cast_timeline: cast_timeline(fight, curated, player, filter, &links),
        buff_rows: buff_rows(fight, curated, player, start_ms, end_ms),
        ebon_might: ebon_might(fight, player, start_ms, end_ms),
        dead,
        dead_since,
        augmentation: augmentation(fight, player, metric, filter),
        targets: current.targets,
        units: current.units,
        color_groups: current.color_groups,
        mana: power_series(fight, player, 0, start_ms, end_ms, SERIES_STEP_MS),
    })
}
