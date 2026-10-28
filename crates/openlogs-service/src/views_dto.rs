use std::collections::BTreeMap;

use openlogs_analysis::{
    AbilityRef, ActorId, AmountRule, AuraType, CastOutcome, Channel, EventRow, EventsPage, Fight,
    ItemAmount, ItemKind, Lane, LogLine, NOBODY, Page, RowKey, RowType, SpellId, Timeline,
    TimelineItem, UnitRef, ViewOptions, Window, top_spell, unit_of,
};
use serde::{Deserialize, Serialize};

use crate::overview_dto::{PlayerRef, SpellRef};
use crate::refs::Refs;
use crate::scope_dto::{DimensionDto, MissTypeDto, RowKeyDto, key_dto, unit_name};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ViewOptionsDto {
    pub begin_casts: bool,
    pub rejected: bool,
    pub hits: bool,
    pub hide_procs: bool,
}

impl ViewOptionsDto {
    pub fn to_options(self) -> ViewOptions {
        ViewOptions {
            begin_casts: self.begin_casts,
            rejected: self.rejected,
            hits: self.hits,
            hide_procs: self.hide_procs,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PageDto {
    From { offset: u32, limit: u32 },
    At { t: i32, limit: u32 },
}

impl PageDto {
    pub fn to_page(self) -> Page {
        match self {
            Self::From { offset, limit } => Page::From { offset, limit },
            Self::At { t, limit } => Page::At { t, limit },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowDto {
    pub start_ms: i32,
    pub end_ms: i32,
}

/// A unit a row or mark names: the logged unit itself, never its owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitInfoDto {
    pub actor_id: ActorId,
    /// As logged (players without realm); empty when the log names none.
    pub name: String,
    /// The 1-based number of an enemy among the units of its name.
    pub number: Option<u32>,
    /// The player a pet or guardian belongs to.
    pub owner: Option<ActorId>,
    pub player: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorSpellDto {
    pub actor_id: ActorId,
    pub spell_id: SpellId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePartDto {
    pub buff_id: SpellId,
    pub evoker: ActorId,
    pub amount: u64,
    pub selected: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RowTypeDto {
    Damage,
    Tick,
    Melee,
    Ranged,
    Absorbed,
    Missed,
    Heal,
    HotTick,
    Absorb,
    BeginCast,
    Cast,
    Interrupted,
    Rejected,
    Apply,
    Remove,
    Refresh,
    StackGained,
    StackLost,
    Died,
    Recap,
    Interrupt,
    Dispel,
    Steal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CastOutcomeDto {
    Completed,
    Interrupted,
    Released,
    NoOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuraTypeDto {
    Buff,
    Debuff,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRowDto {
    pub index: usize,
    pub t: i32,
    #[serde(rename = "type")]
    pub row_type: RowTypeDto,
    pub event: &'static str,
    pub source: ActorId,
    pub spell_id: SpellId,
    pub target: ActorId,
    pub amount: Option<u64>,
    pub overkill: u64,
    pub absorbed: u64,
    pub blocked: u64,
    pub resisted: u64,
    pub overheal: u64,
    pub critical: bool,
    /// `[current, max]`.
    pub target_hp: Option<[u64; 2]>,
    pub shares: Vec<SharePartDto>,
    pub aura_kind: Option<AuraTypeDto>,
    pub stacks: Option<u32>,
    pub used: Option<SpellId>,
    pub duration_ms: Option<i32>,
    pub stage: Option<u32>,
    pub outcome: Option<CastOutcomeDto>,
    /// As the log wrote it.
    pub reason: Option<String>,
    pub press_ms: Option<i32>,
    pub by: Option<ActorSpellDto>,
    pub unknown_blow: bool,
    pub environmental: bool,
    pub miss_type: Option<MissTypeDto>,
    pub alive_ms: Option<i32>,
    pub context_of: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsPageDto {
    pub total: u32,
    pub offset: u32,
    pub rows: Vec<EventRowDto>,
    pub narrowed: Vec<DimensionDto>,
    pub amount: Option<i64>,
    pub unlisted_support: i64,
    pub hidden_procs: u32,
    pub units: Vec<UnitInfoDto>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ItemKindDto {
    Instant,
    Channel,
    CastTime,
    Empowered,
    Interrupted,
    NoOutcome,
    Rejected,
    Aura,
    Hit,
    Death,
    Interrupt,
    Dispel,
    Steal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AmountRuleDto {
    UntilNextCast,
    WhileUp,
    BossCast,
    Hit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemAmountDto {
    pub rule: AmountRuleDto,
    pub amount: i64,
    pub hits: u32,
    pub targets: u32,
    pub support: i64,
    pub healing: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDto {
    /// Absent when the log has no end: the channel is drawn to its last tick.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<i32>,
    /// Absent for a press of a channel spell whose own channel logged no hit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_tick_ms: Option<i32>,
    pub ticks: Vec<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLineDto {
    pub t: i32,
    pub event: &'static str,
    pub spell_id: SpellId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDto {
    pub kind: ItemKindDto,
    pub start_ms: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<i32>,
    pub source: ActorId,
    pub spell_id: SpellId,
    pub target: ActorId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stacks: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<SpellId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub by: Option<ActorSpellDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overkill: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rezzed_ms: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alive_ms: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cast_start_ms: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<ItemAmountDto>,
    /// Where the drawing ends: the bar's end, or a channel's; the start for a point.
    pub span_end_ms: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<ChannelDto>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub log: Vec<LogLineDto>,
    /// Log lines not listed: beyond the first twelve, or every line in a wide window.
    #[serde(skip_serializing_if = "is_zero")]
    pub log_more: u32,
    #[serde(skip_serializing_if = "is_zero")]
    pub track: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerLineDto {
    pub power_type: i32,
    /// `[t, current, max]` as logged.
    pub samples: Vec<[i64; 3]>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneDto {
    /// `null` for the one lane of a view whose every dimension is narrowed to one value.
    pub key: Option<RowKeyDto>,
    pub name: String,
    pub number: Option<u32>,
    /// Ability lanes: the spell ID for the icon; 0 otherwise.
    pub spell_id: SpellId,
    pub total: i64,
    pub tracks: u32,
    pub items: Vec<ItemDto>,
    pub power: Vec<PowerLineDto>,
    pub dead: Vec<[i32; 2]>,
    /// Resources: the lane's unit is one of the encounter's boss units; `false` on other tabs.
    pub boss: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineDto {
    pub start_ms: i32,
    pub end_ms: i32,
    pub axis: Option<DimensionDto>,
    pub lanes: Vec<LaneDto>,
    pub context: Vec<ItemDto>,
    pub legend: Vec<SpellId>,
    pub units: Vec<UnitInfoDto>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
    /// Whether the marks list their log lines.
    pub lines_listed: bool,
    /// [`LISTED_WINDOW_MS`]: the widest window whose marks list their log lines.
    pub listed_window_ms: i32,
}

/// The units, players and spells a payload names.
struct Names<'a> {
    fight: &'a Fight,
    refs: Refs,
    units: BTreeMap<ActorId, UnitInfoDto>,
}

impl<'a> Names<'a> {
    fn new(fight: &'a Fight) -> Self {
        Self {
            fight,
            refs: Refs::default(),
            units: BTreeMap::new(),
        }
    }

    fn unit(&mut self, id: ActorId) -> ActorId {
        if id == NOBODY || self.units.contains_key(&id) {
            return id;
        }
        let unit = unit_of(self.fight, id);
        let (name, number) = unit_name(self.fight, &unit);
        let owner = match unit {
            UnitRef::Pet { owner, .. } => Some(owner),
            _ => None,
        };
        let player = matches!(unit, UnitRef::Player(_));
        if let Some(player) = owner.or(player.then_some(id)) {
            self.refs.player(player);
        }
        self.units.insert(
            id,
            UnitInfoDto {
                actor_id: id,
                name,
                number,
                owner,
                player,
            },
        );
        if let Some(owner) = owner {
            self.unit(owner);
        }
        id
    }

    fn spell(&mut self, id: SpellId) -> SpellId {
        self.refs.spell(self.fight, id)
    }

    fn by(&mut self, by: Option<(ActorId, SpellId)>) -> Option<ActorSpellDto> {
        by.map(|(actor, spell)| ActorSpellDto {
            actor_id: self.unit(actor),
            spell_id: self.spell(spell),
        })
    }

    fn finish(
        self,
    ) -> (
        Vec<UnitInfoDto>,
        Vec<PlayerRef>,
        BTreeMap<SpellId, SpellRef>,
    ) {
        let (roster, spells) = self.refs.finish(self.fight);
        (self.units.into_values().collect(), roster, spells)
    }
}

fn row_type(row_type: RowType) -> RowTypeDto {
    match row_type {
        RowType::Damage => RowTypeDto::Damage,
        RowType::Tick => RowTypeDto::Tick,
        RowType::Melee => RowTypeDto::Melee,
        RowType::Ranged => RowTypeDto::Ranged,
        RowType::Absorbed => RowTypeDto::Absorbed,
        RowType::Missed => RowTypeDto::Missed,
        RowType::Heal => RowTypeDto::Heal,
        RowType::HotTick => RowTypeDto::HotTick,
        RowType::Absorb => RowTypeDto::Absorb,
        RowType::BeginCast => RowTypeDto::BeginCast,
        RowType::Cast => RowTypeDto::Cast,
        RowType::Interrupted => RowTypeDto::Interrupted,
        RowType::Rejected => RowTypeDto::Rejected,
        RowType::Apply => RowTypeDto::Apply,
        RowType::Remove => RowTypeDto::Remove,
        RowType::Refresh => RowTypeDto::Refresh,
        RowType::StackGained => RowTypeDto::StackGained,
        RowType::StackLost => RowTypeDto::StackLost,
        RowType::Died => RowTypeDto::Died,
        RowType::Recap => RowTypeDto::Recap,
        RowType::Interrupt => RowTypeDto::Interrupt,
        RowType::Dispel => RowTypeDto::Dispel,
        RowType::Steal => RowTypeDto::Steal,
    }
}

fn outcome(outcome: CastOutcome) -> CastOutcomeDto {
    match outcome {
        CastOutcome::Completed => CastOutcomeDto::Completed,
        CastOutcome::Interrupted => CastOutcomeDto::Interrupted,
        CastOutcome::Released => CastOutcomeDto::Released,
        CastOutcome::NoOutcome => CastOutcomeDto::NoOutcome,
    }
}

fn row_dto(names: &mut Names<'_>, row: &EventRow) -> EventRowDto {
    let fight = names.fight;
    EventRowDto {
        index: row.index,
        t: row.t,
        row_type: row_type(row.row_type),
        event: row.event,
        source: names.unit(row.source),
        spell_id: names.spell(row.spell),
        target: names.unit(row.target),
        amount: row.amount,
        overkill: row.overkill,
        absorbed: row.absorbed,
        blocked: row.blocked,
        resisted: row.resisted,
        overheal: row.overheal,
        critical: row.critical,
        target_hp: row.target_hp.map(|(current, max)| [current, max]),
        shares: row
            .shares
            .iter()
            .map(|share| SharePartDto {
                buff_id: names.spell(share.buff),
                evoker: names.unit(share.evoker),
                amount: share.amount,
                selected: share.selected,
            })
            .collect(),
        aura_kind: row.aura_kind.map(|kind| match kind {
            AuraType::Buff => AuraTypeDto::Buff,
            AuraType::Debuff => AuraTypeDto::Debuff,
        }),
        stacks: row.stacks,
        used: row.used.map(|spell| names.spell(spell)),
        duration_ms: row.duration_ms,
        stage: row.stage,
        outcome: row.outcome.map(outcome),
        reason: row
            .reason
            .map(|reason| fight.fail_reason(reason).to_string()),
        press_ms: row.press_ms,
        by: names.by(row.by),
        unknown_blow: row.unknown_blow,
        environmental: row.environmental,
        miss_type: row.miss.map(MissTypeDto::of),
        alive_ms: row.alive_ms,
        context_of: row.context_of,
    }
}

pub fn events_page_dto(fight: &Fight, page: &EventsPage) -> EventsPageDto {
    let mut names = Names::new(fight);
    let rows = page
        .rows
        .iter()
        .map(|row| row_dto(&mut names, row))
        .collect();
    let (units, roster, spells) = names.finish();
    EventsPageDto {
        total: page.total,
        offset: page.offset,
        rows,
        narrowed: page
            .narrowed
            .iter()
            .copied()
            .map(DimensionDto::of)
            .collect(),
        amount: page.amount,
        unlisted_support: page.unlisted_support,
        hidden_procs: page.hidden_procs,
        units,
        roster,
        spells,
    }
}

fn item_kind(kind: ItemKind) -> ItemKindDto {
    match kind {
        ItemKind::Instant => ItemKindDto::Instant,
        ItemKind::Channel => ItemKindDto::Channel,
        ItemKind::CastTime => ItemKindDto::CastTime,
        ItemKind::Empowered => ItemKindDto::Empowered,
        ItemKind::Interrupted => ItemKindDto::Interrupted,
        ItemKind::NoOutcome => ItemKindDto::NoOutcome,
        ItemKind::Rejected => ItemKindDto::Rejected,
        ItemKind::Aura => ItemKindDto::Aura,
        ItemKind::Hit => ItemKindDto::Hit,
        ItemKind::Death => ItemKindDto::Death,
        ItemKind::Interrupt => ItemKindDto::Interrupt,
        ItemKind::Dispel => ItemKindDto::Dispel,
        ItemKind::Steal => ItemKindDto::Steal,
    }
}

fn amount_dto(amount: ItemAmount) -> ItemAmountDto {
    ItemAmountDto {
        rule: match amount.rule {
            AmountRule::UntilNextCast => AmountRuleDto::UntilNextCast,
            AmountRule::WhileUp => AmountRuleDto::WhileUp,
            AmountRule::BossCast => AmountRuleDto::BossCast,
            AmountRule::Hit => AmountRuleDto::Hit,
        },
        amount: amount.amount,
        hits: amount.hits,
        targets: amount.targets,
        support: amount.support,
        healing: amount.healing,
    }
}

fn channel_dto(channel: &Channel) -> ChannelDto {
    ChannelDto {
        end_ms: channel.end_ms,
        last_tick_ms: channel.last_tick_ms,
        ticks: channel.ticks.clone(),
    }
}

fn line_dto(names: &mut Names<'_>, line: &LogLine) -> LogLineDto {
    LogLineDto {
        t: line.t,
        event: line.event,
        spell_id: names.spell(line.spell),
        stage: line.stage,
        reason: line
            .reason
            .map(|reason| names.fight.fail_reason(reason).to_string()),
    }
}

/// A window wider than this lists no log lines, only how many there are: a wide window holds
/// thousands of marks, and their lines would make the payload many megabytes.
pub const LISTED_WINDOW_MS: i32 = 120_000;

fn item_dto(names: &mut Names<'_>, item: &TimelineItem, listed: bool) -> ItemDto {
    let shown = if listed { item.log.as_slice() } else { &[] };
    ItemDto {
        kind: item_kind(item.kind),
        start_ms: item.start_ms,
        end_ms: item.end_ms,
        source: names.unit(item.source),
        spell_id: names.spell(item.spell),
        target: names.unit(item.target),
        stage: item.stage,
        stacks: item.stacks,
        used: item.used.map(|spell| names.spell(spell)),
        by: names.by(item.by),
        reason: item
            .reason
            .map(|reason| names.fight.fail_reason(reason).to_string()),
        overkill: item.overkill,
        rezzed_ms: item.rezzed_ms,
        alive_ms: item.alive_ms,
        cast_start_ms: item.cast_start_ms,
        amount: item.amount.map(amount_dto),
        span_end_ms: item.span_end_ms,
        channel: item.channel.as_ref().map(channel_dto),
        log: shown.iter().map(|line| line_dto(names, line)).collect(),
        log_more: item.log_more + (item.log.len() - shown.len()) as u32,
        track: item.track,
    }
}

/// The spell ID an ability lane shows: the ID of the key, else its items' most frequent one,
/// else any ID of its name.
fn lane_spell(fight: &Fight, lane: &Lane) -> SpellId {
    let Some(RowKey::Ability { ability, .. }) = &lane.key else {
        return 0;
    };
    match ability {
        AbilityRef::Id(id) => *id,
        AbilityRef::Name(name) => {
            let mut counts: BTreeMap<SpellId, u32> = BTreeMap::new();
            for item in &lane.items {
                *counts.entry(item.spell).or_default() += 1;
            }
            top_spell(counts)
                .or_else(|| {
                    fight
                        .spells
                        .iter()
                        .find(|(_, info)| &info.name == name)
                        .map(|(&id, _)| id)
                })
                .unwrap_or(0)
        }
    }
}

fn lane_dto(names: &mut Names<'_>, lane: &Lane, listed: bool, bosses: &[ActorId]) -> LaneDto {
    let fight = names.fight;
    let (key, name, number) = match &lane.key {
        Some(key) => {
            let (dto, name, number) = key_dto(fight, key);
            if let RowKey::Unit(UnitRef::Player(id) | UnitRef::Pet { owner: id, .. }) = key {
                names.unit(*id);
            }
            (Some(dto), name, number)
        }
        None => (None, String::new(), None),
    };
    LaneDto {
        key,
        name,
        number,
        spell_id: names.spell(lane_spell(fight, lane)),
        total: lane.total,
        tracks: lane.tracks,
        items: lane
            .items
            .iter()
            .map(|item| item_dto(names, item, listed))
            .collect(),
        power: lane
            .power
            .iter()
            .map(|line| PowerLineDto {
                power_type: line.power_type,
                samples: line
                    .samples
                    .iter()
                    .map(|&(t, current, max)| [i64::from(t), current, max])
                    .collect(),
            })
            .collect(),
        dead: lane.dead.iter().map(|&(a, b)| [a, b]).collect(),
        boss: matches!(&lane.key, Some(RowKey::Unit(UnitRef::Instance(id))) if bosses.contains(id)),
    }
}

/// `bosses`: the units whose lanes are marked as a boss's.
pub fn timeline_dto(fight: &Fight, timeline: &Timeline, bosses: &[ActorId]) -> TimelineDto {
    let mut names = Names::new(fight);
    let listed = timeline.window.end_ms - timeline.window.start_ms <= LISTED_WINDOW_MS;
    let lanes = timeline
        .lanes
        .iter()
        .map(|lane| lane_dto(&mut names, lane, listed, bosses))
        .collect();
    let context = timeline
        .context
        .iter()
        .map(|item| item_dto(&mut names, item, listed))
        .collect();
    let legend = timeline
        .legend
        .iter()
        .map(|&spell| names.spell(spell))
        .collect();
    let (units, roster, spells) = names.finish();
    TimelineDto {
        lines_listed: listed,
        listed_window_ms: LISTED_WINDOW_MS,
        start_ms: timeline.window.start_ms,
        end_ms: timeline.window.end_ms,
        axis: timeline.axis.map(DimensionDto::of),
        lanes,
        context,
        legend,
        units,
        roster,
        spells,
    }
}

impl WindowDto {
    pub fn to_window(self) -> Window {
        Window {
            start_ms: self.start_ms,
            end_ms: self.end_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report_dto::{AttributionDto, FilterDto};
    use crate::reports::{events, timeline};
    use crate::scope_dto::{ScopeDto, ScopeMetricDto, SideDto};
    use crate::test_fight::{HOSTILE_FLAGS, PET_FLAGS, PLAYER_FLAGS, damage_event, fight, unit};
    use openlogs_analysis::{Actors, Event, EventKind, SpellInfo, UnitHp};

    fn imp_fight() -> (Fight, ActorId, ActorId) {
        let mut actors = Actors::new();
        let warlock = unit(&mut actors, "Player-1", "Areus-Stonevale-EU", PLAYER_FLAGS);
        let imp = unit(
            &mut actors,
            "Creature-0-1-1-1-55659-0001",
            "Wild Imp",
            PET_FLAGS,
        );
        actors.set_owner(imp, warlock);
        let add = unit(
            &mut actors,
            "Creature-0-1-1-1-261874-0002",
            "Blightscale Rawling",
            HOSTILE_FLAGS,
        );
        let mut cast = damage_event(1_000, warlock, add, 104316, 0, NOBODY);
        cast.kind = EventKind::CastSuccess;
        let mut f = fight(
            actors,
            vec![
                cast,
                damage_event(1_500, imp, add, 104318, 2_000, NOBODY),
                damage_event(1_600, warlock, add, 104316, 500, NOBODY),
            ],
        );
        for (id, name) in [(104316, "Call Dreadstalkers"), (104318, "Fel Firebolt")] {
            f.spells.insert(
                id,
                SpellInfo {
                    name: name.into(),
                    school: 32,
                },
            );
        }
        (f, warlock, imp)
    }

    fn whole() -> FilterDto {
        FilterDto {
            start_ms: None,
            end_ms: None,
            attribution: AttributionDto::Augmented,
            include_overkill: false,
            death_cutoff: None,
            known_cut_ms: None,
        }
    }

    #[test]
    fn an_events_page_names_the_logged_unit_and_its_owner_without_a_row_of_his_own() {
        let (f, warlock, imp) = imp_fight();
        let page: PageDto =
            serde_json::from_str(r#"{"kind":"from","offset":0,"limit":1}"#).unwrap();
        let dto = events(
            &f,
            &openlogs_gamedata::Curated::bundled(),
            whole(),
            ScopeDto::default(),
            ScopeMetricDto::DamageDone,
            ViewOptionsDto::default(),
            page,
        );
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["total"], 2);
        assert_eq!(json["rows"][0]["type"], "damage");
        assert_eq!(json["rows"][0]["event"], "SPELL_DAMAGE");
        assert_eq!(json["rows"][0]["source"], imp);
        let units = json["units"].as_array().unwrap();
        let imp_unit = units.iter().find(|u| u["actorId"] == imp).unwrap();
        assert_eq!(imp_unit["name"], "Wild Imp");
        assert_eq!(imp_unit["owner"], warlock);
        let owner = units.iter().find(|u| u["actorId"] == warlock).unwrap();
        assert_eq!(owner["name"], "Areus");
        assert_eq!(json["roster"][0]["actorId"], warlock);
    }

    #[test]
    fn a_timeline_round_trips_with_lanes_marks_and_names_and_counts_lines_of_wide_windows() {
        let (mut f, warlock, _) = imp_fight();
        f.duration_ms = 300_000;
        let view = |window: &str| {
            let dto = timeline(
                &f,
                &openlogs_gamedata::Curated::bundled(),
                &openlogs_gamedata::ChannelSpells::default(),
                whole(),
                ScopeDto::default(),
                ScopeMetricDto::DamageDone,
                DimensionDto::Source,
                serde_json::from_str(r#"{"hits":true}"#).unwrap(),
                serde_json::from_str(window).unwrap(),
            );
            serde_json::to_value(&dto).unwrap()
        };
        let json = view(r#"{"startMs":0,"endMs":20000}"#);
        assert_eq!(json["axis"], "source");
        let lane = &json["lanes"][0];
        assert_eq!(lane["key"]["unit"]["actorId"], warlock);
        assert_eq!(lane["name"], "Areus");
        assert_eq!(lane["total"], 2_500);
        assert_eq!(lane["items"][0]["kind"], "instant");
        assert_eq!(lane["items"][0]["amount"]["amount"], 500);
        assert_eq!(lane["items"][0]["log"][0]["event"], "SPELL_CAST_SUCCESS");
        let wide = view(r#"{"startMs":0,"endMs":300000}"#);
        assert_eq!(wide["linesListed"], false);
        let mark = &wide["lanes"][0]["items"][0];
        assert_eq!(mark.get("log"), None, "a wide window only counts the lines");
        assert_eq!(mark["logMore"], 1);
    }

    #[test]
    fn resources_lanes_say_whether_their_unit_is_a_boss() {
        let mut actors = Actors::new();
        let mage = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Vehicle-0-1-1-1-257758-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let add = unit(
            &mut actors,
            "Creature-0-1-1-1-261874-0001",
            "Blightscale Rawling",
            HOSTILE_FLAGS,
        );
        let hit = |t, target, amount, max| Event {
            unit_hp: Some(UnitHp {
                actor: target,
                current: max - amount,
                max,
            }),
            ..damage_event(t, mage, target, 1, amount, NOBODY)
        };
        let mut f = fight(
            actors,
            vec![
                hit(1_000, boss, 1_000_000, 10_000_000),
                hit(2_000, add, 1_000, 100_000),
            ],
        );
        f.duration_ms = 20_000;
        let dto = timeline(
            &f,
            &openlogs_gamedata::Curated::bundled(),
            &openlogs_gamedata::ChannelSpells::default(),
            whole(),
            ScopeDto {
                perspective: SideDto::Enemy,
                ..ScopeDto::default()
            },
            ScopeMetricDto::Resources,
            DimensionDto::Source,
            ViewOptionsDto::default(),
            serde_json::from_str(r#"{"startMs":0,"endMs":20000}"#).unwrap(),
        );
        let json = serde_json::to_value(&dto).unwrap();
        let mut flags: Vec<_> = json["lanes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|lane| (lane["name"].clone(), lane["boss"].clone()))
            .collect();
        flags.sort_by_key(|(name, _)| name.to_string());
        assert_eq!(
            flags,
            [
                (
                    serde_json::json!("Blightscale Rawling"),
                    serde_json::json!(false)
                ),
                (serde_json::json!("Ula'tek"), serde_json::json!(true)),
            ]
        );
    }
}
