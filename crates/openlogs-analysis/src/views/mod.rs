//! The Events and Timeline views: the tab's facts as logged, one page or one window at a time.

mod amounts;
mod auras;
mod casts;
mod deaths;
mod kicks;
mod names;
pub(crate) mod parts;

use openlogs_gamedata::Curated;

use crate::actors::ActorId;
use crate::breakdown::Dimension;
use crate::cells::ScopeMetric;
use crate::fight::{AuraType, FailReason, Fight, SpellId};
use crate::filter::{Attribution, ReportFilter};
use crate::scope::Scope;
use crate::views::parts::AmountFacts;

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
    Stack,
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
        narrowed: narrowed(scope)
            .into_iter()
            .filter(|dimension| !credit || *dimension == Dimension::Target)
            .collect(),
        amount: summary.amount,
        unlisted_support: summary.unlisted_support,
        hidden_procs: summary.hidden_procs,
    }
}

pub(crate) fn narrowed(scope: &Scope) -> Vec<Dimension> {
    [
        (Dimension::Source, scope.source.is_empty()),
        (Dimension::Ability, scope.ability.is_empty()),
        (Dimension::Target, scope.target.is_empty()),
    ]
    .into_iter()
    .filter(|(_, open)| !open)
    .map(|(dimension, _)| dimension)
    .collect()
}
