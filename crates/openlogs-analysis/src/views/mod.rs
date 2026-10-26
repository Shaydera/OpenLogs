//! The Events and Timeline views: the tab's facts as logged, one page or one window at a time.

mod amounts;
mod auras;
pub(crate) mod casts;
mod deaths;
mod kicks;
mod names;
pub(crate) mod parts;
mod power;
pub(crate) mod spans;
mod taken;
mod timeline;

use openlogs_gamedata::{ChannelSpells, Curated};

use crate::actors::{ActorId, NOBODY};
use crate::breakdown::{Dimension, RowKey};
use crate::cells::ScopeMetric;
use crate::fight::{AuraType, FailReason, Fight, MissType, SpellId};
use crate::filter::{Attribution, ReportFilter};
use crate::scope::{Scope, Side, UnitRef};
use crate::timeline::boss_units;
use crate::views::parts::AmountFacts;
use crate::views::spans::SpanIndex;
use crate::views::timeline::{Lanes, clip, lane_axis};

/// The views' toggles, and the Casts option they share with the table.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ViewOptions {
    /// Events of Casts: list begin casts.
    pub begin_casts: bool,
    /// Casts: list rejected inputs, which the log writes for the logging player only.
    pub rejected: bool,
    /// Timeline of Damage Taken: draw every hit.
    pub hits: bool,
    /// Casts: leave out curated procs unless an ability is selected.
    pub hide_procs: bool,
}

/// Which rows of the range a page holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Page {
    From {
        offset: u32,
        limit: u32,
    },
    /// The page that holds the first row at or after `t`.
    At {
        t: i32,
        limit: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowType {
    Damage,
    Tick,
    Melee,
    Ranged,
    /// A hit a shield swallowed completely (`SPELL_MISSED` with ABSORB).
    Absorbed,
    /// Any other `*_MISSED`: dodged, parried, immune, …
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
    /// A recap event before a death, shown in its context.
    Recap,
    Interrupt,
    Dispel,
    Steal,
}

/// How a begin cast ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CastOutcome {
    Completed,
    Interrupted,
    /// An empowered spell released at a stage.
    Released,
    /// Nothing in the log closes it.
    NoOutcome,
}

/// An Evoker's share of a hit, logged as its own `*_SUPPORT` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SharePart {
    pub buff: SpellId,
    pub evoker: ActorId,
    pub amount: u64,
    /// Credited to the Evoker and named by the source or ability selection.
    pub selected: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EventRow {
    /// The logged line in `Fight::events`; a boss that dies at the pull's end has no line and
    /// counts on from the last one.
    pub index: usize,
    pub t: i32,
    pub row_type: RowType,
    /// The log's event name, e.g. `SPELL_PERIODIC_DAMAGE`.
    pub event: &'static str,
    pub source: ActorId,
    pub spell: SpellId,
    pub target: ActorId,
    /// The tab's figure as its table counts it: damage with the absorbed part, effective
    /// healing, the absorbed amount, a killing blow's overkill.
    pub amount: Option<u64>,
    pub overkill: u64,
    pub absorbed: u64,
    pub blocked: u64,
    pub resisted: u64,
    pub overheal: u64,
    pub critical: bool,
    /// The target's HP after the event, when the logged unit HP is the target's.
    pub target_hp: Option<(u64, u64)>,
    pub shares: Vec<SharePart>,
    /// Aura rows: BUFF or DEBUFF, as the line logs it.
    pub aura_kind: Option<AuraType>,
    pub stacks: Option<u32>,
    /// Interrupts and dispels: the spell used; the row's spell is the one it stopped.
    pub used: Option<SpellId>,
    /// Casts: time from the begin cast to this row, or to a begin cast's outcome.
    pub duration_ms: Option<i32>,
    pub stage: Option<u32>,
    pub outcome: Option<CastOutcome>,
    pub reason: Option<FailReason>,
    /// A follow-up cast: when the press it belongs to was cast.
    pub press_ms: Option<i32>,
    /// The unit and spell behind the row: who interrupted the cast, broke the aura, or attacked
    /// into an absorb.
    pub by: Option<(ActorId, SpellId)>,
    /// Deaths: the log holds no lethal hit, so source and spell are unknown.
    pub unknown_blow: bool,
    pub environmental: bool,
    pub miss: Option<MissType>,
    /// Kills: from the unit's first hit to its death.
    pub alive_ms: Option<i32>,
    /// A recap row: the index of the death it leads up to.
    pub context_of: Option<usize>,
}

impl EventRow {
    pub(crate) fn new(
        index: usize,
        t: i32,
        row_type: RowType,
        event: &'static str,
        (source, spell, target): (ActorId, SpellId, ActorId),
    ) -> Self {
        Self {
            index,
            t,
            row_type,
            event,
            source,
            spell,
            target,
            amount: None,
            overkill: 0,
            absorbed: 0,
            blocked: 0,
            resisted: 0,
            overheal: 0,
            critical: false,
            target_hp: None,
            shares: Vec::new(),
            aura_kind: None,
            stacks: None,
            used: None,
            duration_ms: None,
            stage: None,
            outcome: None,
            reason: None,
            press_ms: None,
            by: None,
            unknown_blow: false,
            environmental: false,
            miss: None,
            alive_ms: None,
            context_of: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EventsPage {
    /// Rows in the range; context rows are not counted.
    pub total: u32,
    pub offset: u32,
    pub rows: Vec<EventRow>,
    /// Dimensions narrowed to one value: context, never a column.
    pub narrowed: Vec<Dimension>,
    /// Damage and healing: the scope's sum as the table counts it.
    pub amount: Option<i64>,
    /// Damage and healing: Aug support in the scope that no listed hit carries.
    pub unlisted_support: i64,
    /// Casts: rows Hide procs left out.
    pub hidden_procs: u32,
}

/// What a tab's rows add up to besides the rows.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Summary {
    pub amount: Option<i64>,
    pub unlisted_support: i64,
    pub hidden_procs: u32,
}

/// Counts the rows and keeps those of the page.
pub(crate) struct Sink {
    offset: u32,
    limit: u32,
    /// Counting the rows before `t` only, to find the page of a time.
    before: Option<i32>,
    total: u32,
    rows: Vec<EventRow>,
}

impl Sink {
    fn counts(&self, t: i32) -> bool {
        self.before.is_none_or(|before| t < before)
    }

    fn on_page(&self) -> bool {
        self.before.is_none() && self.total >= self.offset && self.total - self.offset < self.limit
    }

    pub(crate) fn row(&mut self, t: i32, build: impl FnOnce() -> EventRow) {
        if !self.counts(t) {
            return;
        }
        if self.on_page() {
            self.rows.push(build());
        }
        self.total += 1;
    }

    /// One counted row, the last, with context rows before it.
    pub(crate) fn group(&mut self, t: i32, build: impl FnOnce() -> Vec<EventRow>) {
        if !self.counts(t) {
            return;
        }
        if self.on_page() {
            self.rows.extend(build());
        }
        self.total += 1;
    }
}

fn produce(
    fight: &Fight,
    curated: &Curated,
    filter: &ReportFilter,
    scope: &Scope,
    metric: ScopeMetric,
    options: &ViewOptions,
    sink: &mut Sink,
) -> Summary {
    if let Some(facts) = AmountFacts::of(scope.perspective, metric) {
        return amounts::rows(fight, filter, scope, facts, sink);
    }
    match metric {
        ScopeMetric::Casts => casts::rows(fight, curated, filter, scope, options, sink),
        ScopeMetric::Buffs => auras::rows(fight, filter, scope, AuraType::Buff, sink),
        ScopeMetric::Debuffs => auras::rows(fight, filter, scope, AuraType::Debuff, sink),
        ScopeMetric::Deaths => deaths::rows(fight, filter, scope, sink),
        ScopeMetric::Interrupts => kicks::rows(fight, filter, scope, sink),
        ScopeMetric::DamageDone
        | ScopeMetric::Healing
        | ScopeMetric::DamageTaken
        | ScopeMetric::Resources => Summary::default(),
    }
}

/// One page of the tab's events in the range, in log order.
pub fn events(
    fight: &Fight,
    curated: &Curated,
    filter: &ReportFilter,
    scope: &Scope,
    metric: ScopeMetric,
    options: &ViewOptions,
    page: Page,
) -> EventsPage {
    let (offset, limit) = match page {
        Page::From { offset, limit } => (offset, limit.max(1)),
        Page::At { t, limit } => {
            let limit = limit.max(1);
            let mut before = Sink {
                offset: 0,
                limit,
                before: Some(t),
                total: 0,
                rows: Vec::new(),
            };
            produce(fight, curated, filter, scope, metric, options, &mut before);
            (before.total / limit * limit, limit)
        }
    };
    let mut sink = Sink {
        offset,
        limit,
        before: None,
        total: 0,
        rows: Vec::new(),
    };
    let summary = produce(fight, curated, filter, scope, metric, options, &mut sink);
    // With Aug credit, damage and healing rows also match through the Evoker's share: their source
    // and ability are then not the selected ones, so those columns stay.
    let credit = filter.attribution == Attribution::Reattributed
        && matches!(
            AmountFacts::of(scope.perspective, metric),
            Some(AmountFacts::DamageDone | AmountFacts::Healing)
        );
    EventsPage {
        total: sink.total,
        offset,
        rows: sink.rows,
        narrowed: narrowed(fight, scope)
            .into_iter()
            .filter(|dimension| !credit || *dimension == Dimension::Target)
            .collect(),
        amount: summary.amount,
        unlisted_support: summary.unlisted_support,
        hidden_procs: summary.hidden_procs,
    }
}

/// Dimensions whose selection shows one identity in every row: never a column. A player's selection
/// includes the pets it owns, and a unit name covers numbered instances, so those stay columns.
pub(crate) fn narrowed(fight: &Fight, scope: &Scope) -> Vec<Dimension> {
    let one_unit = |selected: &[UnitRef]| match selected {
        [UnitRef::Player(id)] => !fight
            .actors
            .iter()
            .any(|actor| actor.id != *id && fight.actors.credited_player(actor.id) == Some(*id)),
        [UnitRef::Pet { .. } | UnitRef::Instance(_) | UnitRef::Environment] => true,
        _ => false,
    };
    [
        (Dimension::Source, one_unit(&scope.source)),
        (Dimension::Ability, scope.ability.len() == 1),
        (Dimension::Target, one_unit(&scope.target)),
    ]
    .into_iter()
    .filter(|(_, one)| *one)
    .map(|(dimension, _)| dimension)
    .collect()
}

/// The part of the range a timeline shows, in ms since the pull started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    pub start_ms: i32,
    pub end_ms: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    /// A cast without a begin cast and without a channel the log closes.
    Instant,
    /// A cast without a begin cast whose own aura on the caster, logged with the success, holds
    /// its hits.
    Channel,
    CastTime,
    Empowered,
    Interrupted,
    /// A begin cast nothing in the log closes.
    NoOutcome,
    /// A failed cast with another reason than "Interrupted", logged for the logging player only.
    Rejected,
    Aura,
    Hit,
    Death,
    Interrupt,
    Dispel,
    Steal,
}

/// What an item's amount covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AmountRule {
    /// Hits of the caster (pets included) with the spell's name from the cast until the next
    /// cast of that name, at most 15 s.
    UntilNextCast,
    /// Hits of the aura's name on its holder while it was up.
    WhileUp,
    /// Damage to players with the spell's name from the cast start to 10 s after.
    BossCast,
    /// One hit as logged.
    Hit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ItemAmount {
    pub rule: AmountRule,
    /// The hits as logged; on an Evoker's buff, the support credited to him.
    pub amount: i64,
    pub hits: u32,
    pub targets: u32,
    /// The Aug support inside `amount`: the shares in the hits, or the Evoker's credit.
    pub support: i64,
    pub healing: bool,
}

/// A channel as logged: the caster's aura of the cast's spell, applied or refreshed with the
/// success.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Channel {
    /// The aura's removal, or its refresh by a recast that restarts the channel; `None` when the
    /// log has neither: it is drawn to its last tick.
    pub end_ms: Option<i32>,
    /// `None` for a press of a channel spell whose own channel logged no hit.
    pub last_tick_ms: Option<i32>,
    /// When its hits landed, each time once.
    pub ticks: Vec<i32>,
}

/// A logged line behind an item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogLine {
    pub t: i32,
    pub event: &'static str,
    pub spell: SpellId,
    pub stage: Option<u32>,
    pub reason: Option<FailReason>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TimelineItem {
    pub kind: ItemKind,
    pub start_ms: i32,
    /// `None` for a point in time.
    pub end_ms: Option<i32>,
    pub source: ActorId,
    pub spell: SpellId,
    pub target: ActorId,
    pub stage: Option<u32>,
    pub stacks: Option<u32>,
    /// Interrupts and dispels: the spell used; `spell` is the one it stopped.
    pub used: Option<SpellId>,
    /// Who interrupted a cast, or landed a killing blow.
    pub by: Option<(ActorId, SpellId)>,
    pub reason: Option<FailReason>,
    /// Deaths: the killing blow's overkill.
    pub overkill: Option<u64>,
    /// Deaths: when a resurrect ended it.
    pub rezzed_ms: Option<i32>,
    /// Kills: from the unit's first hit to its death.
    pub alive_ms: Option<i32>,
    /// Interrupts: when the stopped cast began, when the log says.
    pub cast_start_ms: Option<i32>,
    pub amount: Option<ItemAmount>,
    /// Where the drawing ends: the bar's end, or a channel's (an unclosed channel ends at its last
    /// tick); the start for a point.
    pub span_end_ms: i32,
    pub channel: Option<Channel>,
    pub log: Vec<LogLine>,
    /// Log lines beyond those listed.
    pub log_more: u32,
    /// The sub-track of an aura lane that packs overlapping bars.
    pub track: u32,
}

impl TimelineItem {
    pub(crate) fn new(kind: ItemKind, start_ms: i32, end_ms: Option<i32>) -> Self {
        Self {
            kind,
            start_ms,
            end_ms,
            source: NOBODY,
            spell: 0,
            target: NOBODY,
            stage: None,
            stacks: None,
            used: None,
            by: None,
            reason: None,
            overkill: None,
            rezzed_ms: None,
            alive_ms: None,
            cast_start_ms: None,
            amount: None,
            span_end_ms: end_ms.unwrap_or(start_ms),
            channel: None,
            log: Vec::new(),
            log_more: 0,
            track: 0,
        }
    }
}

/// A unit's power or health as logged, one line per power type.
#[derive(Debug, Clone, PartialEq)]
pub struct PowerLine {
    pub power_type: i32,
    /// `(t, current, max)`.
    pub samples: Vec<(i32, i64, i64)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Lane {
    /// `None`: the one lane of a view whose every dimension is narrowed to one value.
    pub key: Option<RowKey>,
    /// The lane's figure in the range: the table's amount or count; for auras, their time up.
    pub total: i64,
    /// Sub-tracks the lane's bars are packed into.
    pub tracks: u32,
    pub items: Vec<TimelineItem>,
    pub power: Vec<PowerLine>,
    /// When the lane's unit was dead, clipped to the window.
    pub dead: Vec<(i32, i32)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Timeline {
    /// The window clipped to the range.
    pub window: Window,
    pub axis: Option<Dimension>,
    pub lanes: Vec<Lane>,
    /// Casts of the encounter's units above the lanes.
    pub context: Vec<TimelineItem>,
    /// The encounter's boss units.
    pub bosses: Vec<ActorId>,
    /// Damage Taken: the range's debuff spells in order of appearance, whatever the window.
    pub legend: Vec<SpellId>,
}

/// The tab's marks in `window`, in lanes by `wanted` (or its fallback). Lanes with something in
/// the range are listed even when the window is empty there. `channels`: the spells the game
/// channels, empty without game data.
#[allow(clippy::too_many_arguments)]
pub fn timeline(
    fight: &Fight,
    curated: &Curated,
    channels: &ChannelSpells,
    filter: &ReportFilter,
    scope: &Scope,
    metric: ScopeMetric,
    wanted: Dimension,
    options: &ViewOptions,
    window: Window,
) -> Timeline {
    let window = clip(fight, filter, window);
    // A window that reaches the pull's end holds the events of its last millisecond.
    let pull_end = fight.duration_ms.min(i32::MAX as u64) as i32;
    let marked = if window.end_ms >= pull_end && filter.clipped(fight).1 == pull_end {
        Window {
            end_ms: window.end_ms.saturating_add(1),
            ..window
        }
    } else {
        window
    };
    let axis = lane_axis(scope, metric, wanted);
    let mut lanes = Lanes::new(axis, metric);
    let mut legend = Vec::new();
    let bosses = boss_units(fight);
    let shows_context = !(metric == ScopeMetric::Casts && scope.perspective == Side::Enemy);
    let mut context_items = None;
    match metric {
        ScopeMetric::Casts => {
            let context = shows_context.then_some(bosses.as_slice());
            let items = casts::side_items(fight, curated, scope.perspective, context);
            let spans = SpanIndex::new(fight, curated, channels, &items);
            casts::marks(
                fight, curated, filter, scope, options, marked, &items, &spans, &mut lanes,
            );
            context_items = context.map(|_| (items, spans));
        }
        ScopeMetric::DamageDone | ScopeMetric::Healing => {
            if let Some(facts) = AmountFacts::of(scope.perspective, metric) {
                amounts::marks(fight, curated, filter, scope, facts, marked, &mut lanes);
            }
        }
        ScopeMetric::DamageTaken => {
            legend = taken::marks(fight, filter, scope, options, marked, &mut lanes);
        }
        ScopeMetric::Buffs => {
            auras::marks(fight, filter, scope, AuraType::Buff, marked, &mut lanes)
        }
        ScopeMetric::Debuffs => {
            auras::marks(fight, filter, scope, AuraType::Debuff, marked, &mut lanes)
        }
        ScopeMetric::Deaths => deaths::marks(fight, filter, scope, marked, &mut lanes),
        ScopeMetric::Interrupts => kicks::marks(fight, filter, scope, marked, &mut lanes),
        ScopeMetric::Resources => power::lanes(fight, filter, scope, window, &mut lanes),
    }
    let context = if shows_context {
        let (items, spans) = context_items.unwrap_or_else(|| {
            let items = casts::context_items(fight, curated, &bosses);
            let spans = SpanIndex::new(fight, curated, channels, &items);
            (items, spans)
        });
        casts::boss_casts(fight, filter, marked, &bosses, items, &spans)
    } else {
        Vec::new()
    };
    Timeline {
        window,
        axis,
        lanes: lanes.into_lanes(),
        context,
        legend,
        bosses,
    }
}
