use std::collections::{HashMap, HashSet};

use crate::actors::{ActorId, NOBODY};
use crate::fight::{DamageVia, Event, EventKind, Fight, NO_SPELL, SpellId};
use crate::scope::{Scope, UnitRef, unit_of};
use crate::timeline::{counts_as_damage_done, damage_done_amount, hits_hostile_npc};

pub mod damage;
pub mod healing;
pub mod taken;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RowKind {
    /// Cast by the player.
    Own,
    /// Cast by one of the player's pets or guardians (`actor`).
    Pet,
    /// Reattributed mode: support the player's buffs added to hits, the player's own included.
    SupportGiven,
    /// Reattributed mode: support moved away from hits no ability could be matched to
    /// (`NO_SPELL`, `NOBODY`).
    Unmatched,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AbilityRow {
    pub spell: SpellId,
    /// Caster for own and pet rows, the Evoker for support rows.
    pub actor: ActorId,
    pub kind: RowKind,
    /// Reattributed mode: net of `support`, so negative for unmatched rows.
    pub amount: i64,
    /// Reattributed mode: the part of the logged amount that moved to Evokers.
    pub support: u64,
    pub overheal: u64,
    pub hits: u32,
    pub crits: u32,
    /// Largest single positive amount.
    pub max: u64,
    /// Periodic hits (DoT/HoT ticks).
    pub ticks: u32,
}

/// Whom an amount went to.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum TargetKey {
    /// A unit that is not a player, by name: all units of one name are one target.
    Unit(String),
    /// A player; heals on a pet count for its owner.
    Player(ActorId),
    /// A unit the log gives no name.
    Unknown,
}

/// What a player or one ability of a player did to one target in the range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetShare {
    pub target: TargetKey,
    /// Net of Aug support in Reattributed mode, like the rows.
    pub amount: i64,
    pub hits: u32,
    pub crits: u32,
}

/// An ability row's split by target, largest first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AbilityTargets {
    pub spell: SpellId,
    pub actor: ActorId,
    pub kind: RowKind,
    pub targets: Vec<TargetShare>,
}

/// A player's largest abilities on one colour group (`None`: "Other"), summed by spell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupAbilities {
    pub group: Option<String>,
    pub abilities: Vec<(SpellId, i64)>,
}

pub const TOP_ABILITIES_PER_GROUP: usize = 4;

/// A target as the event loop books it; names are resolved once per report in
/// [`Rows::into_parts`], which keeps the loop free of allocations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum RawTarget {
    Unit(ActorId),
    Player(ActorId),
}

pub(crate) fn damage_target(target: ActorId) -> RawTarget {
    RawTarget::Unit(target)
}

pub(crate) fn heal_target(fight: &Fight, target: ActorId) -> RawTarget {
    match fight.actors.credited_player(target) {
        Some(player) => RawTarget::Player(player),
        None => RawTarget::Unit(target),
    }
}

fn resolve(fight: &Fight, target: RawTarget) -> TargetKey {
    match target {
        RawTarget::Player(player) => TargetKey::Player(player),
        RawTarget::Unit(unit) => match &fight.actors.get(unit).name {
            Some(name) => TargetKey::Unit(name.clone()),
            None => TargetKey::Unknown,
        },
    }
}

type RowKey = (SpellId, ActorId, RowKind);

#[derive(Default, Clone, Copy)]
struct TargetAcc {
    amount: i64,
    hits: u32,
    crits: u32,
}

/// Accumulates ability rows keyed by (spell, actor, kind), each split by target.
#[derive(Default)]
pub(crate) struct Rows {
    rows: HashMap<RowKey, AbilityRow>,
    targets: HashMap<(RowKey, RawTarget), TargetAcc>,
}

/// A player's rows, largest first, with their split by target.
pub(crate) struct RowsOut {
    pub rows: Vec<AbilityRow>,
    pub targets: Vec<TargetShare>,
    pub ability_targets: Vec<AbilityTargets>,
    /// Amount by target and spell over all rows but unmatched hits, for [`group_abilities`].
    pub target_spells: Vec<(TargetKey, SpellId, i64)>,
}

fn by_amount(list: &mut [TargetShare]) {
    list.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.target.cmp(&b.target)));
}

impl Rows {
    fn row(&mut self, spell: SpellId, actor: ActorId, kind: RowKind) -> &mut AbilityRow {
        self.rows.entry((spell, actor, kind)).or_insert(AbilityRow {
            spell,
            actor,
            kind,
            amount: 0,
            support: 0,
            overheal: 0,
            hits: 0,
            crits: 0,
            max: 0,
            ticks: 0,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add(
        &mut self,
        spell: SpellId,
        actor: ActorId,
        kind: RowKind,
        target: RawTarget,
        amount: i64,
        overheal: u64,
        critical: bool,
        periodic: bool,
    ) {
        let row = self.row(spell, actor, kind);
        row.amount += amount;
        row.overheal += overheal;
        row.hits += 1;
        row.crits += u32::from(critical);
        row.max = row.max.max(amount.max(0) as u64);
        row.ticks += u32::from(periodic);
        let split = self
            .targets
            .entry(((spell, actor, kind), target))
            .or_default();
        split.amount += amount;
        split.hits += 1;
        split.crits += u32::from(critical);
    }

    /// Moves `amount` of the buffed ability (`None`: unmatched) on `target` to an Evoker.
    fn deduct(
        &mut self,
        ability: Option<BuffedAbility>,
        player: ActorId,
        target: RawTarget,
        amount: u64,
    ) {
        let key = match ability {
            Some(a) => {
                let kind = if a.actor == player {
                    RowKind::Own
                } else {
                    RowKind::Pet
                };
                (a.spell, a.actor, kind)
            }
            None => (NO_SPELL, NOBODY, RowKind::Unmatched),
        };
        let row = self.row(key.0, key.1, key.2);
        row.amount -= amount as i64;
        row.support += amount;
        self.targets.entry((key, target)).or_default().amount -= amount as i64;
    }

    /// The units the rows booked an amount on.
    pub fn units(&self) -> impl Iterator<Item = ActorId> + '_ {
        self.targets.keys().filter_map(|(_, target)| match target {
            RawTarget::Unit(unit) => Some(*unit),
            RawTarget::Player(_) => None,
        })
    }

    /// Rows largest first; rows whose whole amount moved to Evokers (Fate Mirror) are left out.
    /// Targets whose amount nets to zero are left out too.
    pub fn into_parts(self, fight: &Fight) -> RowsOut {
        let mut rows: Vec<AbilityRow> = self
            .rows
            .into_values()
            .filter(|row| !(row.amount == 0 && row.support > 0))
            .collect();
        rows.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.spell.cmp(&b.spell)));

        let mut named: HashMap<(RowKey, TargetKey), TargetAcc> = HashMap::new();
        for ((key, target), acc) in self.targets {
            let sum = named.entry((key, resolve(fight, target))).or_default();
            sum.amount += acc.amount;
            sum.hits += acc.hits;
            sum.crits += acc.crits;
        }
        let mut per_row: HashMap<RowKey, Vec<TargetShare>> = HashMap::new();
        let mut per_target: HashMap<TargetKey, TargetAcc> = HashMap::new();
        let mut per_spell: HashMap<(TargetKey, SpellId), i64> = HashMap::new();
        for ((key, target), acc) in named {
            if acc.amount == 0 {
                continue;
            }
            per_row.entry(key).or_default().push(TargetShare {
                target: target.clone(),
                amount: acc.amount,
                hits: acc.hits,
                crits: acc.crits,
            });
            if key.2 != RowKind::Unmatched {
                *per_spell.entry((target.clone(), key.0)).or_default() += acc.amount;
            }
            let total = per_target.entry(target).or_default();
            total.amount += acc.amount;
            total.hits += acc.hits;
            total.crits += acc.crits;
        }
        let mut targets: Vec<TargetShare> = per_target
            .into_iter()
            .filter(|(_, acc)| acc.amount != 0)
            .map(|(target, acc)| TargetShare {
                target,
                amount: acc.amount,
                hits: acc.hits,
                crits: acc.crits,
            })
            .collect();
        by_amount(&mut targets);
        let ability_targets = rows
            .iter()
            .filter_map(|row| {
                let mut list = per_row.remove(&(row.spell, row.actor, row.kind))?;
                by_amount(&mut list);
                Some(AbilityTargets {
                    spell: row.spell,
                    actor: row.actor,
                    kind: row.kind,
                    targets: list,
                })
            })
            .collect();
        RowsOut {
            rows,
            targets,
            ability_targets,
            target_spells: per_spell
                .into_iter()
                .map(|((target, spell), amount)| (target, spell, amount))
                .collect(),
        }
    }
}

/// A player's largest abilities on each colour group and on "Other", groups in name order
/// ("Other" first).
pub(crate) fn group_abilities(
    target_spells: &[(TargetKey, SpellId, i64)],
    color_groups: &[String],
) -> Vec<GroupAbilities> {
    let mut sums: HashMap<(Option<&str>, SpellId), i64> = HashMap::new();
    for (target, spell, amount) in target_spells {
        let group = match target {
            TargetKey::Unit(name) if color_groups.contains(name) => Some(name.as_str()),
            _ => None,
        };
        *sums.entry((group, *spell)).or_default() += amount;
    }
    let mut by_group: HashMap<Option<&str>, Vec<(SpellId, i64)>> = HashMap::new();
    for ((group, spell), amount) in sums {
        by_group.entry(group).or_default().push((spell, amount));
    }
    let mut list: Vec<GroupAbilities> = by_group
        .into_iter()
        .map(|(group, mut abilities)| {
            abilities.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            abilities.truncate(TOP_ABILITIES_PER_GROUP);
            GroupAbilities {
                group: group.map(str::to_string),
                abilities,
            }
        })
        .collect();
    list.sort_by(|a, b| a.group.cmp(&b.group));
    list
}

/// Units that took a counted share, for "58 units".
#[derive(Default)]
pub(crate) struct UnitCounts(HashSet<ActorId>);

impl UnitCounts {
    pub fn extend(&mut self, units: impl Iterator<Item = ActorId>) {
        self.0.extend(units);
    }

    /// Units per name, in name order.
    pub fn into_sorted(self, fight: &Fight) -> Vec<(String, u32)> {
        let mut counts: HashMap<&str, u32> = HashMap::new();
        for unit in self.0 {
            if let Some(name) = &fight.actors.get(unit).name {
                *counts.entry(name).or_default() += 1;
            }
        }
        let mut list: Vec<(String, u32)> = counts
            .into_iter()
            .map(|(name, count)| (name.to_string(), count))
            .collect();
        list.sort();
        list
    }
}

/// How many enemy groups get a colour of their own on the bars; the rest is "Other".
pub const COLOR_GROUPS: usize = 4;

/// The raid's largest enemy groups in the range, largest first.
pub(crate) fn color_groups<'a>(targets: impl Iterator<Item = &'a TargetShare>) -> Vec<String> {
    let mut sums: HashMap<&str, i64> = HashMap::new();
    for share in targets {
        if let TargetKey::Unit(name) = &share.target {
            *sums.entry(name).or_default() += share.amount;
        }
    }
    let mut list: Vec<(&str, i64)> = sums.into_iter().filter(|(_, v)| *v > 0).collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    list.into_iter()
        .take(COLOR_GROUPS)
        .map(|(name, _)| name.to_string())
        .collect()
}

/// The ability a support share belongs to: its spell and caster (the player, or the
/// representative of the player's pets of one name).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct BuffedAbility {
    pub spell: SpellId,
    pub actor: ActorId,
}

/// Support of one Evoker's buff on one ability of a buffed player, summed over the range.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SupportShare {
    pub buff: SpellId,
    pub evoker: ActorId,
    pub player: ActorId,
    /// `None` when no hit matches the support events ("Unmatched hits").
    pub ability: Option<BuffedAbility>,
    pub amount: u64,
}

/// Support of one Evoker's buff, summed over a player's abilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuffShare {
    pub buff: SpellId,
    pub evoker: ActorId,
    pub amount: u64,
}

/// A support event belongs to the last earlier hit of its kind (same source and target) at
/// most this many ms before it.
pub(crate) const SUPPORT_MATCH_MS: i32 = 2;

/// The ability whose hit the support event at `index` is part of. Scans all events of the
/// fight, so a hit just before the range still matches a support inside it.
pub(crate) fn buffed_spell(fight: &Fight, index: usize) -> Option<SpellId> {
    let support = &fight.events[index];
    fight.events[..index]
        .iter()
        .rev()
        .take_while(|hit| support.t - hit.t <= SUPPORT_MATCH_MS)
        .find_map(|hit| supported_spell(support, hit))
}

fn supported_spell(support: &Event, hit: &Event) -> Option<SpellId> {
    if hit.source != support.source || hit.target != support.target {
        return None;
    }
    let melee = |via| matches!(via, DamageVia::Swing | DamageVia::SwingLanded);
    match (support.kind, hit.kind) {
        (EventKind::Damage(s), EventKind::Damage(h))
            if h.supporter == NOBODY && (s.via == h.via || (melee(s.via) && melee(h.via))) =>
        {
            Some(hit.spell)
        }
        (EventKind::Heal(s), EventKind::Heal(h))
            if h.supporter == NOBODY && s.periodic == h.periodic =>
        {
            Some(hit.spell)
        }
        (EventKind::Absorbed(s), EventKind::Absorbed(h))
            if h.supporter == NOBODY && h.absorber == s.absorber && hit.spell == support.spell =>
        {
            Some(h.absorb_spell)
        }
        _ => None,
    }
}

/// One player's support bookkeeping in the damage or healing report.
#[derive(Default)]
pub(crate) struct SupportAcc {
    pub rows: Rows,
    /// From other Evokers' buffs.
    pub received: u64,
    /// To other players.
    pub given: u64,
    /// From the player's own buff.
    pub self_support: u64,
    /// The player's own buff share credited to him as the Evoker; equals `self_support` unless
    /// a scope keeps only one side of the share.
    pub self_credit: u64,
    pub recipients: HashMap<ActorId, u64>,
    pub givers: HashMap<ActorId, u64>,
    pub by_buff: HashMap<(SpellId, ActorId), u64>,
    /// What the player's own buffs added, by buff; his own share included.
    pub credited_by_buff: HashMap<SpellId, u64>,
}

impl SupportAcc {
    pub fn credited_by_buff(&self, evoker: ActorId) -> Vec<BuffShare> {
        buff_totals(
            self.credited_by_buff
                .iter()
                .map(|(&buff, &amount)| BuffShare {
                    buff,
                    evoker,
                    amount,
                }),
        )
    }

    pub fn reattributed_total(&self, own: u64) -> u64 {
        // Saturating: a support share whose main hit fell outside the range must not underflow.
        (own + self.given + self.self_credit).saturating_sub(self.received + self.self_support)
    }

    pub fn received_by_buff(&self) -> Vec<BuffShare> {
        buff_totals(
            self.by_buff
                .iter()
                .map(|(&(buff, evoker), &amount)| BuffShare {
                    buff,
                    evoker,
                    amount,
                }),
        )
    }
}

/// Sums by buff and Evoker, largest first.
pub(crate) fn buff_totals(parts: impl Iterator<Item = BuffShare>) -> Vec<BuffShare> {
    let mut sums: HashMap<(SpellId, ActorId), u64> = HashMap::new();
    for part in parts {
        *sums.entry((part.buff, part.evoker)).or_default() += part.amount;
    }
    let mut list: Vec<BuffShare> = sums
        .into_iter()
        .map(|((buff, evoker), amount)| BuffShare {
            buff,
            evoker,
            amount,
        })
        .collect();
    list.sort_by(|a, b| {
        b.amount
            .cmp(&a.amount)
            .then((a.buff, a.evoker).cmp(&(b.buff, b.evoker)))
    });
    list
}

#[derive(Default)]
pub(crate) struct SupportLedger(HashMap<(SpellId, ActorId, ActorId, Option<BuffedAbility>), u64>);

impl SupportLedger {
    pub fn into_sorted(self) -> Vec<SupportShare> {
        let mut list: Vec<SupportShare> = self
            .0
            .into_iter()
            .map(|((buff, evoker, player, ability), amount)| SupportShare {
                buff,
                evoker,
                player,
                ability,
                amount,
            })
            .collect();
        list.sort_by(|a, b| {
            b.amount.cmp(&a.amount).then(
                (a.buff, a.evoker, a.player, a.ability)
                    .cmp(&(b.buff, b.evoker, b.player, b.ability)),
            )
        });
        list
    }
}

pub(crate) struct SupportEntry {
    pub buff: SpellId,
    pub evoker: ActorId,
    pub player: ActorId,
    pub ability: Option<BuffedAbility>,
    pub target: RawTarget,
    pub amount: u64,
}

/// Whether a scope keeps an own share: `actor`'s `spell` on `target`.
pub(crate) fn keeps_own(
    fight: &Fight,
    scope: &Scope,
    actor: ActorId,
    spell: SpellId,
    target: ActorId,
) -> bool {
    scope.selects_all()
        || scope.wants(
            fight,
            &unit_of(fight, actor),
            spell,
            &unit_of(fight, target),
        )
}

/// The parts of a support share a scope keeps, as the cells split it: the buffed player's
/// deduction belongs to the hit's ability (`None`: unmatched), the Evoker's credit to the buff.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SupportParts {
    pub buffed: bool,
    pub credit: bool,
}

pub(crate) fn keeps_support(
    fight: &Fight,
    scope: &Scope,
    support: &Support,
    ability: Option<SpellId>,
) -> SupportParts {
    if scope.selects_all() {
        return SupportParts {
            buffed: true,
            credit: true,
        };
    }
    let target = unit_of(fight, support.target);
    SupportParts {
        buffed: scope.accepts(
            fight,
            Some(&unit_of(fight, support.doer)),
            ability,
            Some(&target),
        ),
        credit: scope.accepts(
            fight,
            Some(&UnitRef::Player(support.evoker)),
            Some(support.buff),
            Some(&target),
        ),
    }
}

/// Books a support share in the ledger and both players' sums; in Reattributed mode it also
/// moves from the buffed ability's row to the Evoker's support row. `parts` says which sides
/// the scope keeps.
pub(crate) fn credit_support<A: Default>(
    acc: &mut HashMap<ActorId, A>,
    part: impl Fn(&mut A) -> &mut SupportAcc,
    ledger: &mut SupportLedger,
    reattributed: bool,
    entry: SupportEntry,
    parts: SupportParts,
) {
    let SupportEntry {
        buff,
        evoker,
        player,
        ability,
        target,
        amount,
    } = entry;
    if !(parts.buffed || parts.credit) {
        return;
    }
    *ledger.0.entry((buff, evoker, player, ability)).or_default() += amount;
    let own_buff = evoker == player;
    if parts.buffed {
        let buffed = part(acc.entry(player).or_default());
        if own_buff {
            buffed.self_support += amount;
        } else {
            buffed.received += amount;
            *buffed.givers.entry(evoker).or_default() += amount;
            *buffed.by_buff.entry((buff, evoker)).or_default() += amount;
        }
        if reattributed {
            buffed.rows.deduct(ability, player, target, amount);
        }
    }
    if !parts.credit {
        return;
    }
    let giver = part(acc.entry(evoker).or_default());
    *giver.credited_by_buff.entry(buff).or_default() += amount;
    if own_buff {
        giver.self_credit += amount;
    } else {
        giver.given += amount;
        *giver.recipients.entry(player).or_default() += amount;
    }
    if reattributed {
        giver.rows.add(
            buff,
            evoker,
            RowKind::SupportGiven,
            target,
            amount as i64,
            0,
            false,
            false,
        );
    }
}

pub(crate) fn support_entry<'a>(
    fight: &'a Fight,
    pets: &mut PetNames<'a>,
    index: usize,
    support: Support,
    target: RawTarget,
) -> SupportEntry {
    let Support {
        player,
        evoker,
        doer,
        buff,
        amount,
        ..
    } = support;
    let ability = buffed_spell(fight, index).map(|spell| BuffedAbility {
        spell,
        actor: pets.representative(fight, player, doer),
    });
    SupportEntry {
        buff,
        evoker,
        player,
        ability,
        target,
        amount,
    }
}

pub(crate) fn per_second(total: u64, duration_ms: u64) -> f64 {
    if duration_ms == 0 {
        0.0
    } else {
        total as f64 * 1000.0 / duration_ms as f64
    }
}

pub(crate) fn sorted_by_amount<K: Ord + Copy>(map: HashMap<K, u64>) -> Vec<(K, u64)> {
    let mut entries: Vec<(K, u64)> = map.into_iter().collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    entries
}

/// Pets and guardians of one player that share a name (every Wild Imp has its own GUID)
/// share ability rows; the first one seen labels the row.
#[derive(Default)]
pub(crate) struct PetNames<'a>(HashMap<(ActorId, &'a str), ActorId>);

impl<'a> PetNames<'a> {
    /// The actor whose row `actor`'s ability goes into; `player` itself stays as is.
    pub fn representative(&mut self, fight: &'a Fight, player: ActorId, actor: ActorId) -> ActorId {
        if actor == player {
            return actor;
        }
        match fight.actors.get(actor).name.as_deref() {
            Some(name) => *self.0.entry((player, name)).or_insert(actor),
            None => actor,
        }
    }
}

/// One event's contribution to the damage or healing report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Share {
    /// Logged on `player`, done by `actor` (the player or one of its pets).
    Own {
        player: ActorId,
        actor: ActorId,
        spell: SpellId,
        amount: u64,
        overheal: u64,
        critical: bool,
        periodic: bool,
        /// Healing only: damage prevented by `actor`'s absorb.
        absorb: bool,
    },
    /// An Evoker's share inside `player`'s event, done by `doer` (the player or a pet, the
    /// absorber for absorbs). Reattributed, it moves to `evoker` — the player himself for his
    /// own buff, from his ability to his support row.
    Support(Support),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Support {
    pub player: ActorId,
    pub evoker: ActorId,
    pub doer: ActorId,
    pub buff: SpellId,
    pub target: ActorId,
    pub amount: u64,
}

/// Damage done: hits on units that were hostile at the hit, credited through pets.
/// Support from an unknown Evoker is not a share.
pub(crate) fn damage_share(fight: &Fight, event: &Event) -> Option<Share> {
    let EventKind::Damage(damage) = event.kind else {
        return None;
    };
    if !hits_hostile_npc(fight, event) {
        return None;
    }
    let player = fight.actors.credited_player(event.source)?;
    let amount = damage_done_amount(&damage);
    if damage.supporter == NOBODY {
        return counts_as_damage_done(&damage).then_some(Share::Own {
            player,
            actor: event.source,
            spell: event.spell,
            amount,
            overheal: 0,
            critical: damage.critical,
            periodic: damage.via == DamageVia::Periodic,
            absorb: false,
        });
    }
    let evoker = fight.actors.credited_player(damage.supporter)?;
    Some(Share::Support(Support {
        player,
        evoker,
        doer: event.source,
        buff: event.spell,
        target: event.target,
        amount,
    }))
}

/// Healing: effective heals and absorbs on targets that were not hostile at the event.
pub(crate) fn healing_share(fight: &Fight, event: &Event) -> Option<Share> {
    if event.target_hostile || event.target == NOBODY {
        return None;
    }
    let (doer, spell, amount, overheal, critical, periodic, absorb, supporter) = match event.kind {
        EventKind::Heal(heal) => (
            event.source,
            event.spell,
            heal.amount.saturating_sub(heal.overheal),
            heal.overheal,
            heal.critical,
            heal.periodic,
            false,
            heal.supporter,
        ),
        EventKind::Absorbed(absorbed) => (
            absorbed.absorber,
            absorbed.absorb_spell,
            absorbed.amount,
            0,
            false,
            false,
            true,
            absorbed.supporter,
        ),
        _ => return None,
    };
    let player = fight.actors.credited_player(doer)?;
    if supporter == NOBODY {
        return Some(Share::Own {
            player,
            actor: doer,
            spell,
            amount,
            overheal,
            critical,
            periodic,
            absorb,
        });
    }
    let evoker = fight.actors.credited_player(supporter)?;
    Some(Share::Support(Support {
        player,
        evoker,
        doer,
        buff: spell,
        target: event.target,
        amount,
    }))
}
