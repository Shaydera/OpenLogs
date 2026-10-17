use std::collections::{HashMap, HashSet};

use openlogs_gamedata::{ChannelSpells, Curated};

use crate::actors::NOBODY;
use crate::fight::{AuraAction, DamageVia, Event, EventKind, Fight, SpellId};
use crate::views::Channel;
use crate::views::amounts::UNTIL_NEXT_CAST_MS;
use crate::views::casts::{CastItem, CastKind};
use crate::views::timeline::{NameSlots, name_ids};

/// A press logged this long before a channel's aura ends clipped it; the log may write the end a
/// few milliseconds after the press that caused it.
const CLIPPED_MS: i32 = 50;
/// A channel's self aura is logged with its press, at most this far from the success.
const SELF_AURA_MS: i32 = 5;

/// A cast's channel, and the aura lines it was read from.
#[derive(Debug, Clone, Default)]
pub(crate) struct Spans {
    pub channel: Option<Channel>,
    pub lines: Vec<usize>,
    /// Where the cast's drawing ends: the later of its bar and its channel; an unclosed channel
    /// ends at its last tick.
    pub span_end: Option<i32>,
}

/// A caster's spell name, as a slot of the index.
type Slot = usize;

/// An aura line with what the lookups read, so they need not go back to the log.
#[derive(Debug, Clone, Copy)]
struct AuraLine {
    index: usize,
    t: i32,
    spell: SpellId,
}

impl AuraLine {
    fn of(index: usize, event: &Event) -> Self {
        Self {
            index,
            t: event.t,
            spell: event.spell,
        }
    }
}

/// A cast's success in the index.
struct Cast {
    slot: Slot,
    at: i32,
    /// The caster's next cast of the same spell.
    next: Option<i32>,
}

/// The aura lines on themselves and the hits of the casters' instant spell names, read once per
/// request.
pub(crate) struct SpanIndex<'a> {
    fight: &'a Fight,
    pull_end: i32,
    slots: NameSlots,
    /// Each slot's auras its caster applied or refreshed on himself, in log order.
    auras: Vec<Vec<AuraLine>>,
    /// Each slot's auras removed from its caster, in log order.
    removals: Vec<Vec<AuraLine>>,
    /// When each slot's hits on other units than the caster landed.
    ticks: Vec<Vec<i32>>,
    /// Of each slot whose presses the game channels: when its direct hits on other units landed.
    direct: Vec<Vec<i32>>,
    /// Slots with a spell the game channels, unless its name was empowered in the request:
    /// empowered spells keep their own drawing.
    game_slots: Vec<bool>,
    /// The success times and spells of each slot's casts.
    casts: Vec<Vec<(i32, SpellId)>>,
    /// Each unit's begin casts and successes of any spell but curated procs, which are no presses.
    unit_casts: Vec<Vec<i32>>,
    /// Spells at least half of whose presses with their self aura are clean channels in the pull.
    channel_spells: HashSet<SpellId>,
    /// The spells the game channels.
    game_channels: &'a ChannelSpells,
}

/// A press with its spell's self aura, read against the channel rule.
struct ChannelRead {
    applied: AuraLine,
    ended: Option<AuraLine>,
    /// Its hits on other units inside the aura.
    ticks: Vec<i32>,
    /// It has a hit on another unit, and its caster pressed nothing else before it ended.
    clean: bool,
}

/// Whether the event is a periodic or a direct hit: damage or healing, a fully absorbed or
/// missed one too; not an Evoker's support share of it.
fn hit_periodic(event: &Event) -> Option<bool> {
    let via = match event.kind {
        EventKind::Damage(damage) if damage.supporter == NOBODY => damage.via,
        EventKind::Missed(missed) => missed.via,
        EventKind::Heal(heal) if heal.supporter == NOBODY => return Some(heal.periodic),
        _ => return None,
    };
    match via {
        DamageVia::Spell => Some(false),
        DamageVia::Periodic => Some(true),
        _ => None,
    }
}

/// The times in `[from, to]`.
fn between(times: &[i32], from: i32, to: i32) -> &[i32] {
    let first = times.partition_point(|&t| t < from);
    let last = times.partition_point(|&t| t <= to).max(first);
    &times[first..last]
}

impl<'a> SpanIndex<'a> {
    /// `items`: every cast of the request, whose next casts end a channel.
    pub fn new(
        fight: &'a Fight,
        curated: &Curated,
        game_channels: &'a ChannelSpells,
        items: &[CastItem],
    ) -> Self {
        let succeeded = || {
            items
                .iter()
                .filter_map(|item| item.success.map(|success| (item, success)))
        };
        let names = name_ids(fight);
        let slots = NameSlots::new(
            fight,
            &names,
            succeeded()
                .filter(|(item, _)| item.kind == CastKind::Instant)
                .map(|(item, _)| (item.caster, item.spell)),
        );
        let mut casts: Vec<Vec<(i32, SpellId)>> = vec![Vec::new(); slots.len()];
        for (item, success) in succeeded() {
            if let Some(slot) = slots.find(item.caster, item.spell) {
                casts[slot].push((fight.events[success].t, item.spell));
            }
        }
        for times in &mut casts {
            times.sort_unstable();
        }
        let empowered: HashSet<u32> = items
            .iter()
            .filter(|item| item.kind == CastKind::Empowered)
            .filter_map(|item| names.get(&item.spell).copied())
            .collect();
        let mut game_slots = vec![false; slots.len()];
        for item in items.iter().filter(|item| {
            item.kind == CastKind::Instant
                && game_channels.contains(item.spell)
                && names
                    .get(&item.spell)
                    .is_some_and(|name| !empowered.contains(name))
        }) {
            if let Some(slot) = slots.find(item.caster, item.spell) {
                game_slots[slot] = true;
            }
        }
        let mut auras = vec![Vec::new(); casts.len()];
        let mut removals = vec![Vec::new(); casts.len()];
        let mut ticks = vec![Vec::new(); casts.len()];
        let mut direct = vec![Vec::new(); casts.len()];
        let mut unit_casts = vec![Vec::new(); fight.actors.len() + 1];
        for (index, event) in fight.events.iter().enumerate() {
            if !slots.has_unit(event.source) {
                continue;
            }
            let line = match event.kind {
                EventKind::CastStart | EventKind::CastSuccess => {
                    if !curated.is_proc(event.spell) {
                        unit_casts[event.source as usize].push(event.t);
                    }
                    continue;
                }
                EventKind::Aura { action, .. } if event.target == event.source => Ok(action),
                _ if event.target != event.source => match hit_periodic(event) {
                    Some(periodic) => Err(periodic),
                    None => continue,
                },
                _ => continue,
            };
            let Some(slot) = slots.find(event.source, event.spell) else {
                continue;
            };
            match line {
                Ok(AuraAction::Applied | AuraAction::Refresh) => {
                    auras[slot].push(AuraLine::of(index, event))
                }
                Ok(AuraAction::Removed) => removals[slot].push(AuraLine::of(index, event)),
                Ok(_) => {}
                Err(periodic) => {
                    ticks[slot].push(event.t);
                    if !periodic && game_slots[slot] {
                        direct[slot].push(event.t);
                    }
                }
            }
        }
        let mut index = Self {
            fight,
            pull_end: fight.duration_ms.min(i32::MAX as u64) as i32,
            slots,
            auras,
            removals,
            ticks,
            direct,
            game_slots,
            casts,
            unit_casts,
            channel_spells: HashSet::new(),
            game_channels,
        };
        index.channel_spells = index.channel_spells(items);
        index
    }

    /// The log alone can't tell a channel from a buff a press leaves; a spell most of whose
    /// presses read as clean channels is a channel spell, so its other presses draw alike.
    fn channel_spells(&self, items: &[CastItem]) -> HashSet<SpellId> {
        let mut votes: HashMap<SpellId, (u32, u32)> = HashMap::new();
        for item in items.iter().filter(|item| item.kind == CastKind::Instant) {
            if let Some(read) = self
                .cast(item)
                .and_then(|cast| self.read_channel(&cast, item))
            {
                let (pressed, clean) = votes.entry(item.spell).or_default();
                *pressed += 1;
                *clean += u32::from(read.clean);
            }
        }
        votes
            .into_iter()
            .filter(|&(_, (pressed, clean))| 2 * clean >= pressed)
            .map(|(spell, _)| spell)
            .collect()
    }

    /// The channel of an instant press of a channel spell: with the caster's aura of its spell,
    /// logged within a few ms of the success, it runs to that aura's end; a spell the game channels
    /// runs without it to its last hit before the next press of its name, the log has no end.
    pub fn spans(&self, item: &CastItem) -> Spans {
        let mut spans = Spans::default();
        if item.kind == CastKind::Instant
            && let Some(cast) = self.cast(item)
        {
            let game_channel =
                self.game_slots[cast.slot] && self.game_channels.contains(item.spell);
            if game_channel || self.channel_spells.contains(&item.spell) {
                if let Some(read) = self.read_channel(&cast, item) {
                    spans.channel = Some(Channel {
                        end_ms: read.ended.map(|ended| ended.t),
                        last_tick_ms: read.ticks.last().copied(),
                        ticks: read.ticks,
                    });
                    spans.lines.push(read.applied.index);
                    spans.lines.extend(read.ended.map(|ended| ended.index));
                } else if game_channel {
                    spans.channel = self.unlogged_channel(&cast);
                }
            }
        }
        spans.span_end = item.bar_end().max(
            spans
                .channel
                .as_ref()
                .and_then(|channel| channel.end_ms.or(channel.last_tick_ms)),
        );
        spans
    }

    /// A channel the log has no aura for: its direct hits of the name until the next press of
    /// it, at most [`UNTIL_NEXT_CAST_MS`]; a DoT it left ticks on after it ended. None without a
    /// hit.
    fn unlogged_channel(&self, cast: &Cast) -> Option<Channel> {
        let until = cast.next.map_or(cast.at + UNTIL_NEXT_CAST_MS, |next| {
            (cast.at + UNTIL_NEXT_CAST_MS).min(next - 1)
        });
        let ticks = distinct(between(&self.direct[cast.slot], cast.at, until));
        Some(Channel {
            end_ms: None,
            last_tick_ms: Some(*ticks.last()?),
            ticks,
        })
    }

    fn cast(&self, item: &CastItem) -> Option<Cast> {
        let at = self.fight.events[item.success?].t;
        let slot = self.slots.find(item.caster, item.spell)?;
        let casts = &self.casts[slot];
        // A same-name spell (Divine Hymn's tick) is no recast of the channel.
        let next = casts[casts.partition_point(|&(t, _)| t <= at)..]
            .iter()
            .find(|&&(_, spell)| spell == item.spell)
            .map(|&(t, _)| t);
        Some(Cast { slot, at, next })
    }

    /// The press's self aura of its spell logged with the success (the nearest within
    /// [`SELF_AURA_MS`]), read against the channel rule: hits of the name on other units inside
    /// it, and no other press before it ends.
    fn read_channel(&self, cast: &Cast, item: &CastItem) -> Option<ChannelRead> {
        let auras = &self.auras[cast.slot];
        let applied = *auras[auras.partition_point(|aura| aura.t < cast.at - SELF_AURA_MS)..]
            .iter()
            .take_while(|aura| aura.t <= cast.at + SELF_AURA_MS)
            .filter(|aura| aura.spell == item.spell)
            .min_by_key(|aura| (aura.t - cast.at).abs())?;
        let ended = self.ended(cast.slot, &applied, cast.next);
        let end_ms = ended.map_or(self.pull_end, |ended| ended.t);
        let ticks = distinct(between(&self.ticks[cast.slot], cast.at, end_ms));
        // A press in the last moments clipped the channel; one before means the caster was free.
        let clipped_from = ended.map_or(end_ms, |_| end_ms - CLIPPED_MS);
        let casts = &self.unit_casts[item.caster as usize];
        let pressed_inside = casts
            .get(casts.partition_point(|&t| t <= cast.at))
            .is_some_and(|&t| t < clipped_from);
        Some(ChannelRead {
            applied,
            ended,
            clean: !ticks.is_empty() && !pressed_inside,
            ticks,
        })
    }

    /// The line that ended `aura`: its removal, or a recast's takeover, the caster's apply or
    /// refresh of the spell at or after his `next` cast of it. Earlier lines stay this
    /// cast's: the game logs some auras applied and refreshed in one millisecond, and extends
    /// others without a cast.
    fn ended(&self, slot: Slot, aura: &AuraLine, next: Option<i32>) -> Option<AuraLine> {
        let removed = self.removal(slot, aura);
        let taken_over = next.and_then(|next| {
            let auras = &self.auras[slot];
            auras[auras.partition_point(|later| later.t < next)..]
                .iter()
                .take_while(|later| removed.is_none_or(|removed| later.index < removed.index))
                .find(|later| later.index > aura.index && later.spell == aura.spell)
                .copied()
        });
        taken_over.or(removed)
    }

    /// The first removal of `aura` after its line.
    fn removal(&self, slot: Slot, aura: &AuraLine) -> Option<AuraLine> {
        let removals = &self.removals[slot];
        removals[removals.partition_point(|removed| removed.index <= aura.index)..]
            .iter()
            .find(|removed| removed.spell == aura.spell)
            .copied()
    }
}

fn distinct(times: &[i32]) -> Vec<i32> {
    let mut out = times.to_vec();
    out.dedup();
    out
}
