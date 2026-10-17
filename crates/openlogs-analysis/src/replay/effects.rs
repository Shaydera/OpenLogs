use std::collections::{BTreeMap, HashMap, HashSet};

use openlogs_gamedata::{
    Curated, EffectAnchor, EffectCategory, EffectDef, EffectDuration, EffectKind, EffectTrigger,
};

use crate::actors::{ActorId, ActorKind, NOBODY};
use crate::auras::{AuraInterval, merged};
use crate::fight::{AuraAction, Event, EventKind, Fight, SpellId};
use crate::replay::Track;
use crate::replay::casts::ChannelEnds;
use crate::replay::position::position_at;

/// Recipients whose evidence aura started this soon after the first one place an estimated
/// anchor.
const FIRST_RECIPIENTS_MS: i32 = 500;
/// How far outside a circle a player may stand and still be counted in it, for evidence that
/// several circles of one effect could own.
const RADIUS_SLACK_YD: f32 = 2.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EffectAnchorAt {
    Ground { x: f32, y: f32 },
    Unit { actor: ActorId },
}

/// When the log shows a player reached by an effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AffectedSpan {
    pub actor: ActorId,
    pub start_ms: i32,
    pub end_ms: i32,
}

/// One trigger of a curated effect in the pull.
#[derive(Debug, Clone, PartialEq)]
pub struct EffectInstance {
    pub name: String,
    pub spell: SpellId,
    pub caster: ActorId,
    /// `None`: the log places it nowhere; it is only listed.
    pub anchor: Option<EffectAnchorAt>,
    pub radius_yd: f32,
    pub start_ms: i32,
    pub end_ms: i32,
    /// The anchor is the centre of the first recipients, not a logged position.
    pub estimated: bool,
    pub kind: EffectKind,
    pub category: EffectCategory,
    /// Per player, in actor order, merged and inside `start_ms..end_ms`.
    pub affected: Vec<AffectedSpan>,
}

struct Trigger<'d> {
    def: &'d EffectDef,
    /// The def's position in the encounter's effect list.
    def_index: usize,
    /// The index of the triggering event.
    event: usize,
    t: i32,
    caster: ActorId,
    /// The trigger's target; [`NOBODY`] without one.
    target: ActorId,
    summoned: Option<ActorId>,
    /// The player the caster is credited to.
    credited: Option<ActorId>,
    /// The caster's next trigger of the same def.
    next: Option<i32>,
}

impl Trigger<'_> {
    /// Whether a line from `source` can be the effect's own: the caster's, the summoned unit's,
    /// another unit of the caster's player, or none (an area like Anti-Magic Zone logs its
    /// auras without a source).
    fn owns(&self, fight: &Fight, source: ActorId) -> bool {
        source == NOBODY
            || source == self.caster
            || Some(source) == self.summoned
            || self
                .credited
                .is_some_and(|player| fight.actors.credited_player(source) == Some(player))
    }
}

/// A trigger with its window and anchor.
struct Placed<'d> {
    trigger: Trigger<'d>,
    end: i32,
    anchor: Option<EffectAnchorAt>,
    estimated: bool,
}

/// The instances of one def, for evidence that several of them could own.
#[derive(Default)]
struct Siblings {
    /// Indices into the placed instances, by start.
    members: Vec<usize>,
    starts: Vec<i32>,
    longest: i32,
}

#[derive(Clone, Copy)]
struct Hit {
    t: i32,
    source: ActorId,
    target: ActorId,
}

/// The lines the effects are read from, grouped once.
struct Lookups<'a> {
    fight: &'a Fight,
    pull_end: i32,
    tracks: HashMap<ActorId, &'a Track>,
    /// Sorted by target, spell, source and start.
    intervals: &'a [AuraInterval],
    channel_ends: &'a ChannelEnds,
    /// Evidence aura intervals on players, per spell, by start.
    evidence_auras: HashMap<SpellId, Vec<&'a AuraInterval>>,
    /// Evidence hits and heals on players, per spell, in log order.
    hits: HashMap<SpellId, Vec<Hit>>,
    /// When each unit died or was destroyed.
    gone: HashMap<ActorId, Vec<i32>>,
    /// Each actor's last line as the source.
    last_line: Vec<i32>,
}

pub(super) fn effects(
    fight: &Fight,
    curated: &Curated,
    tracks: &[Track],
    intervals: &[AuraInterval],
    channel_ends: &ChannelEnds,
) -> Vec<EffectInstance> {
    let defs: Vec<&EffectDef> = curated.effects_for(fight.encounter_id).collect();
    if defs.is_empty() {
        return Vec::new();
    }
    let mut by_trigger: HashMap<(EffectTrigger, SpellId), Vec<usize>> = HashMap::new();
    for (index, def) in defs.iter().enumerate() {
        for &spell in &def.spell_ids {
            by_trigger
                .entry((def.trigger, spell))
                .or_default()
                .push(index);
        }
    }
    let evidence = |ids: fn(&EffectDef) -> &Vec<u32>| -> HashSet<SpellId> {
        defs.iter().flat_map(|def| ids(def)).copied().collect()
    };
    let aura_ids = evidence(|def| &def.evidence.aura_ids);
    let hit_ids = evidence(|def| &def.evidence.hit_ids);
    let is_player = |actor: ActorId| fight.actors.get(actor).kind == ActorKind::Player;

    let pull_end = fight.duration_ms.min(i32::MAX as u64) as i32;
    let mut triggers: Vec<Trigger> = Vec::new();
    let mut hits: HashMap<SpellId, Vec<Hit>> = HashMap::new();
    let mut gone: HashMap<ActorId, Vec<i32>> = HashMap::new();
    let mut last_line = vec![i32::MIN; fight.actors.len() + 1];
    for (index, event) in fight.events.iter().enumerate() {
        last_line[event.source as usize] = event.t;
        let trigger = match event.kind {
            EventKind::CastSuccess => EffectTrigger::Cast,
            EventKind::Aura {
                action: AuraAction::Applied,
                ..
            } => EffectTrigger::AuraApplied,
            EventKind::Summon => EffectTrigger::Summon,
            EventKind::Died { .. } | EventKind::Destroyed => {
                gone.entry(event.target).or_default().push(event.t);
                continue;
            }
            _ => {
                if is_hit(event) && hit_ids.contains(&event.spell) && is_player(event.target) {
                    hits.entry(event.spell).or_default().push(Hit {
                        t: event.t,
                        source: event.source,
                        target: event.target,
                    });
                }
                continue;
            }
        };
        if !(0..=pull_end).contains(&event.t) {
            continue;
        }
        for &def_index in by_trigger
            .get(&(trigger, event.spell))
            .into_iter()
            .flatten()
        {
            triggers.push(Trigger {
                def: defs[def_index],
                def_index,
                event: index,
                t: event.t,
                caster: event.source,
                target: event.target,
                summoned: (trigger == EffectTrigger::Summon).then_some(event.target),
                credited: fight.actors.credited_player(event.source),
                next: None,
            });
        }
    }
    let mut next_of: HashMap<(usize, ActorId), i32> = HashMap::new();
    for trigger in triggers.iter_mut().rev() {
        trigger.next = next_of
            .insert((trigger.def_index, trigger.caster), trigger.t)
            .filter(|&next| next > trigger.t);
    }

    let mut evidence_auras: HashMap<SpellId, Vec<&AuraInterval>> = HashMap::new();
    for interval in intervals {
        if aura_ids.contains(&interval.spell) && is_player(interval.target) {
            evidence_auras
                .entry(interval.spell)
                .or_default()
                .push(interval);
        }
    }
    for group in evidence_auras.values_mut() {
        group.sort_by_key(|interval| interval.start_ms);
    }
    let lookups = Lookups {
        fight,
        pull_end,
        tracks: tracks.iter().map(|track| (track.actor, track)).collect(),
        intervals,
        channel_ends,
        evidence_auras,
        hits,
        gone,
        last_line,
    };
    let placed: Vec<Placed> = triggers
        .into_iter()
        .map(|trigger| lookups.place(trigger))
        .collect();
    let mut siblings: Vec<Siblings> = (0..defs.len()).map(|_| Siblings::default()).collect();
    for (index, instance) in placed.iter().enumerate() {
        let group = &mut siblings[instance.trigger.def_index];
        group.members.push(index);
        group.starts.push(instance.trigger.t);
        group.longest = group.longest.max(instance.end - instance.trigger.t);
    }
    (0..placed.len())
        .map(|index| lookups.instance(index, &placed, &siblings))
        .collect()
}

/// Damage, a heal or a miss; not an Evoker's support share of one.
fn is_hit(event: &Event) -> bool {
    match event.kind {
        EventKind::Damage(damage) => damage.supporter == NOBODY,
        EventKind::Heal(heal) => heal.supporter == NOBODY,
        EventKind::Missed(_) => true,
        _ => false,
    }
}

fn ms(value: u32) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

impl<'a> Lookups<'a> {
    fn place<'d>(&self, trigger: Trigger<'d>) -> Placed<'d> {
        let end = self.end(&trigger).clamp(trigger.t, self.pull_end);
        let (anchor, estimated) = match self.logged_anchor(&trigger) {
            Some(anchor) => (Some(anchor), false),
            None => match self.estimated_anchor(&trigger, end) {
                Some(anchor) => (Some(anchor), true),
                None => (None, false),
            },
        };
        Placed {
            trigger,
            end,
            anchor,
            estimated,
        }
    }

    fn instance(&self, index: usize, placed: &[Placed], siblings: &[Siblings]) -> EffectInstance {
        let instance = &placed[index];
        let trigger = &instance.trigger;
        let def = trigger.def;
        EffectInstance {
            name: def.name.clone(),
            spell: self.fight.events[trigger.event].spell,
            caster: trigger.caster,
            anchor: instance.anchor,
            radius_yd: def.radius_yd,
            start_ms: trigger.t,
            end_ms: instance.end,
            estimated: instance.estimated,
            kind: def.kind,
            category: def.category,
            affected: self.affected(index, placed, &siblings[trigger.def_index]),
        }
    }

    fn end(&self, trigger: &Trigger) -> i32 {
        let t = trigger.t;
        let end = match trigger.def.duration {
            EffectDuration::Fixed { ms: duration } => Some(t.saturating_add(ms(duration))),
            EffectDuration::UntilAuraEnd { after_ms } => {
                let holder = if trigger.target == NOBODY {
                    trigger.caster
                } else {
                    trigger.target
                };
                let spell = self.fight.events[trigger.event].spell;
                self.aura_end(holder, spell, trigger.caster, t)
                    .map(|end| end.saturating_add(ms(after_ms)))
            }
            EffectDuration::UntilChannelEnd => self
                .channel_ends
                .get(&trigger.event)
                .copied()
                .or_else(|| self.last_evidence_hit(trigger)),
            EffectDuration::UntilUnitGone => {
                trigger.summoned.and_then(|unit| self.unit_gone(unit, t))
            }
        };
        end.unwrap_or(t)
    }

    /// The end of the aura `spell` from `source` on `target` that is up at `t`.
    fn aura_end(&self, target: ActorId, spell: SpellId, source: ActorId, t: i32) -> Option<i32> {
        let key = (target, spell, source);
        let after = self.intervals.partition_point(|i| {
            (i.target, i.spell, i.source, i.start_ms) <= (target, spell, source, t)
        });
        let interval = self.intervals.get(after.checked_sub(1)?)?;
        ((interval.target, interval.spell, interval.source) == key && interval.end_ms > t)
            .then_some(interval.end_ms)
    }

    /// The last evidence hit of the effect before the caster triggers it again.
    fn last_evidence_hit(&self, trigger: &Trigger) -> Option<i32> {
        let until = trigger.next.map_or(self.pull_end, |next| next - 1);
        trigger
            .def
            .evidence
            .hit_ids
            .iter()
            .filter_map(|spell| self.hits.get(spell))
            .flat_map(|hits| between(hits, trigger.t, until))
            .filter(|hit| trigger.owns(self.fight, hit.source))
            .map(|hit| hit.t)
            .max()
    }

    /// When the unit died or was destroyed; else its last sample or its last line as the
    /// source, whichever is later: a totem is sampled only by its casts, not to its end.
    fn unit_gone(&self, unit: ActorId, t: i32) -> Option<i32> {
        let died = self
            .gone
            .get(&unit)
            .and_then(|times| times.iter().copied().find(|&gone| gone >= t));
        died.or_else(|| {
            let last_sample = self
                .tracks
                .get(&unit)
                .and_then(|track| track.t.last().copied());
            let last_line = self.last_line.get(unit as usize).copied();
            last_sample.max(last_line).filter(|&last| last >= t)
        })
    }

    fn position(&self, actor: ActorId, t: i32) -> Option<(f32, f32)> {
        position_at(self.tracks.get(&actor)?, t)
    }

    fn ground(&self, actor: ActorId, t: i32) -> Option<EffectAnchorAt> {
        self.position(actor, t)
            .map(|(x, y)| EffectAnchorAt::Ground { x, y })
    }

    fn tracked(&self, actor: ActorId) -> Option<EffectAnchorAt> {
        self.tracks
            .contains_key(&actor)
            .then_some(EffectAnchorAt::Unit { actor })
    }

    fn logged_anchor(&self, trigger: &Trigger) -> Option<EffectAnchorAt> {
        let t = trigger.t;
        match trigger.def.anchor {
            EffectAnchor::SummonedUnit => trigger
                .summoned
                .and_then(|actor| self.tracked(actor))
                .or_else(|| self.ground(trigger.caster, t)),
            EffectAnchor::CasterAtCast => self.ground(trigger.caster, t),
            EffectAnchor::TargetAtCast => self.ground(trigger.target, t),
            EffectAnchor::FollowsCaster => self.tracked(trigger.caster),
            EffectAnchor::FollowsTarget => self.tracked(trigger.target),
            EffectAnchor::EstimatedFromAffected => None,
        }
    }

    /// Where the instance's circle is at `t`.
    fn center(&self, instance: &Placed, t: i32) -> Option<(f32, f32)> {
        match instance.anchor? {
            EffectAnchorAt::Ground { x, y } => Some((x, y)),
            EffectAnchorAt::Unit { actor } => self.position(actor, t),
        }
    }

    /// The centre of the players whose evidence aura started first, where they got it.
    fn estimated_anchor(&self, trigger: &Trigger, end: i32) -> Option<EffectAnchorAt> {
        let received: Vec<&AuraInterval> = self
            .evidence_intervals(trigger, end)
            .filter(|interval| interval.start_ms >= trigger.t)
            .collect();
        let first = received.iter().map(|interval| interval.start_ms).min()?;
        let mut seen = HashSet::new();
        let positions: Vec<(f32, f32)> = received
            .iter()
            .filter(|interval| interval.start_ms <= first + FIRST_RECIPIENTS_MS)
            .filter(|interval| seen.insert(interval.target))
            .filter_map(|interval| self.position(interval.target, interval.start_ms))
            .collect();
        if positions.is_empty() {
            return None;
        }
        let n = positions.len() as f32;
        let (x, y) = positions
            .iter()
            .fold((0.0, 0.0), |(x, y), p| (x + p.0, y + p.1));
        Some(EffectAnchorAt::Ground { x: x / n, y: y / n })
    }

    /// The trigger's owned evidence aura intervals that start at or before `end`.
    fn evidence_intervals<'t>(
        &'t self,
        trigger: &'t Trigger,
        end: i32,
    ) -> impl Iterator<Item = &'t AuraInterval> + 't {
        trigger
            .def
            .evidence
            .aura_ids
            .iter()
            .filter_map(|spell| self.evidence_auras.get(spell))
            .flat_map(move |group| &group[..group.partition_point(|i| i.start_ms <= end)])
            .copied()
            .filter(|interval| trigger.owns(self.fight, interval.source))
    }

    fn affected(&self, index: usize, placed: &[Placed], siblings: &Siblings) -> Vec<AffectedSpan> {
        let instance = &placed[index];
        let trigger = &instance.trigger;
        let (start, end) = (trigger.t, instance.end);
        let tick = ms(trigger.def.evidence.tick_window_ms);
        let lands_here = |target, source, from, to| {
            self.lands_in(index, placed, siblings, (target, source), (from, to))
        };
        let mut spans: BTreeMap<ActorId, Vec<(i32, i32)>> = BTreeMap::new();
        for interval in self.evidence_intervals(trigger, end) {
            if interval.end_ms > start
                && lands_here(
                    interval.target,
                    interval.source,
                    interval.start_ms,
                    interval.end_ms,
                )
            {
                spans
                    .entry(interval.target)
                    .or_default()
                    .push((interval.start_ms, interval.end_ms));
            }
        }
        for &spell in &trigger.def.evidence.hit_ids {
            let Some(hits) = self.hits.get(&spell) else {
                continue;
            };
            for hit in between(hits, start, end) {
                if hit.t < end
                    && trigger.owns(self.fight, hit.source)
                    && lands_here(hit.target, hit.source, hit.t, hit.t + 1)
                {
                    spans
                        .entry(hit.target)
                        .or_default()
                        .push((hit.t, hit.t.saturating_add(tick)));
                }
            }
        }
        spans
            .into_iter()
            .flat_map(|(actor, spans)| {
                merged(&spans, start, end)
                    .into_iter()
                    .map(move |(start_ms, end_ms)| AffectedSpan {
                        actor,
                        start_ms,
                        end_ms,
                    })
            })
            .collect()
    }

    /// Whether evidence on `target` from `source` during `from..to` belongs to instance `index`.
    /// When several instances of the def are up and could own it, it belongs to those whose
    /// circle (plus [`RADIUS_SLACK_YD`]) held the player, else to the nearest one; without a
    /// needed position, to all. Evidence is never dropped.
    fn lands_in(
        &self,
        index: usize,
        placed: &[Placed],
        siblings: &Siblings,
        (target, source): (ActorId, ActorId),
        (from, to): (i32, i32),
    ) -> bool {
        let first = siblings
            .starts
            .partition_point(|&start| start <= from.saturating_sub(siblings.longest));
        let last = siblings.starts.partition_point(|&start| start < to);
        let rivals: Vec<&Placed> = siblings.members[first..last]
            .iter()
            .map(|&member| &placed[member])
            .filter(|other| {
                other.trigger.t < to && other.end > from && other.trigger.owns(self.fight, source)
            })
            .collect();
        if rivals.len() < 2 {
            return true;
        }
        let mut own = None;
        let mut distances = Vec::with_capacity(rivals.len());
        for other in rivals {
            let at = from.max(other.trigger.t);
            let (Some(center), Some(player)) = (self.center(other, at), self.position(target, at))
            else {
                return true;
            };
            let distance = (center.0 - player.0).hypot(center.1 - player.1);
            if std::ptr::eq(other, &placed[index]) {
                own = Some(distance);
            }
            distances.push(distance);
        }
        let Some(own) = own else {
            return false;
        };
        let reach = placed[index].trigger.def.radius_yd + RADIUS_SLACK_YD;
        let nearest = distances.iter().copied().fold(f32::INFINITY, f32::min);
        own <= reach || (nearest > reach && own <= nearest)
    }
}

/// The hits in `[from, to]`.
fn between(hits: &[Hit], from: i32, to: i32) -> &[Hit] {
    let first = hits.partition_point(|hit| hit.t < from);
    let last = hits.partition_point(|hit| hit.t <= to).max(first);
    &hits[first..last]
}
