use std::collections::{BTreeSet, HashMap};

use openlogs_gamedata::Curated;

use crate::actors::{ActorId, NOBODY};
use crate::breakdown::Dimension;
use crate::cells::{Cell, ScopeMetric, cells, in_scope};
use crate::fight::{EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::links::{SpellKey, spell_key};
use crate::scope::{AbilityRef, Scope, UnitRef};

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum OptionValue {
    Unit(UnitRef),
    Ability(AbilityRef),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpellVariant {
    pub spell: SpellId,
    pub casts: u32,
    pub hits: u32,
    pub heals: u32,
    pub auras: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilterOption {
    pub value: OptionValue,
    pub npc_id: Option<u32>,
    /// Units of this name in scope, first seen first.
    pub instances: Vec<ActorId>,
    /// Pet and guardian names of this player in scope.
    pub pets: Vec<String>,
    pub primary_spell: Option<SpellId>,
    pub variants: Vec<SpellVariant>,
    /// What the list is ranked by, largest first.
    pub amount: i64,
}

fn npc_id(guid: &str) -> Option<u32> {
    let mut parts = guid.split('-');
    let kind = parts.next()?;
    (kind == "Creature" || kind == "Vehicle")
        .then(|| parts.nth(4)?.parse().ok())
        .flatten()
}

struct VariantIndex<'a> {
    ids_by_name: HashMap<&'a str, Vec<SpellId>>,
    usage: HashMap<SpellId, SpellVariant>,
}

fn unused(spell: SpellId) -> SpellVariant {
    SpellVariant {
        spell,
        casts: 0,
        hits: 0,
        heals: 0,
        auras: 0,
    }
}

impl<'a> VariantIndex<'a> {
    fn new(fight: &'a Fight) -> Self {
        let mut ids_by_name: HashMap<&str, Vec<SpellId>> = HashMap::new();
        for &id in fight.spells.keys() {
            if let SpellKey::Name(name) = spell_key(fight, id) {
                ids_by_name.entry(name).or_default().push(id);
            }
        }
        let mut usage: HashMap<SpellId, SpellVariant> = HashMap::new();
        for event in &fight.events {
            let v = usage
                .entry(event.spell)
                .or_insert_with(|| unused(event.spell));
            match event.kind {
                EventKind::CastSuccess => v.casts += 1,
                EventKind::Damage(d) if d.supporter == NOBODY => v.hits += 1,
                EventKind::Heal(h) if h.supporter == NOBODY => v.heals += 1,
                EventKind::Aura { .. } => v.auras += 1,
                _ => {}
            }
        }
        VariantIndex { ids_by_name, usage }
    }

    fn variants(&self, ability: &AbilityRef) -> Vec<SpellVariant> {
        let ids: &[SpellId] = match ability {
            AbilityRef::Id(id) => std::slice::from_ref(id),
            AbilityRef::Name(name) => self
                .ids_by_name
                .get(name.as_str())
                .map_or(&[], Vec::as_slice),
        };
        let mut list: Vec<SpellVariant> = ids
            .iter()
            .map(|&id| self.usage.get(&id).copied().unwrap_or_else(|| unused(id)))
            .collect();
        list.sort_by_key(|v| v.spell);
        list
    }
}

fn primary(variants: &[SpellVariant]) -> Option<SpellId> {
    variants
        .iter()
        .max_by(|a, b| {
            (a.casts, a.hits + a.heals)
                .cmp(&(b.casts, b.hits + b.heals))
                .then(b.spell.cmp(&a.spell))
        })
        .map(|v| v.spell)
}

pub fn filter_options(
    fight: &Fight,
    curated: &Curated,
    filter: &ReportFilter,
    scope: &Scope,
    metric: ScopeMetric,
    dimension: Dimension,
) -> Vec<FilterOption> {
    let mut open = scope.clone();
    match dimension {
        Dimension::Source => open.source.clear(),
        Dimension::Target => open.target.clear(),
        Dimension::Ability => open.ability.clear(),
    }
    let all = cells(fight, curated, filter, scope.perspective, metric);
    let wanted: Vec<&Cell> = all
        .iter()
        .filter(|c| in_scope(&open, fight, c))
        .filter(|c| c.names(dimension))
        .filter(|c| dimension == Dimension::Ability || c.amount != 0 || c.hits > 0)
        .collect();
    let mut amounts: HashMap<OptionValue, i64> = HashMap::new();
    let mut instances: HashMap<String, BTreeSet<ActorId>> = HashMap::new();
    let mut pets: HashMap<ActorId, BTreeSet<String>> = HashMap::new();
    for cell in &wanted {
        let value = match dimension {
            Dimension::Ability => OptionValue::Ability(AbilityRef::of(fight, cell.spell)),
            Dimension::Source | Dimension::Target => {
                let unit = if dimension == Dimension::Source {
                    &cell.source
                } else {
                    &cell.target
                };
                match unit {
                    UnitRef::Instance(id) => {
                        if let Some(name) = &fight.actors.get(*id).name {
                            instances.entry(name.clone()).or_default().insert(*id);
                        }
                    }
                    UnitRef::Pet { owner, name } => {
                        pets.entry(*owner).or_default().insert(name.clone());
                    }
                    _ => {}
                }
                OptionValue::Unit(unit.grouped(fight))
            }
        };
        *amounts.entry(value).or_default() += cell.amount;
    }
    let mut ranked: Vec<(OptionValue, i64)> = amounts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let index = (dimension == Dimension::Ability).then(|| VariantIndex::new(fight));
    ranked
        .into_iter()
        .map(|(value, amount)| {
            let mut option = FilterOption {
                value: value.clone(),
                npc_id: None,
                instances: Vec::new(),
                pets: Vec::new(),
                primary_spell: None,
                variants: Vec::new(),
                amount,
            };
            match &value {
                OptionValue::Unit(UnitRef::Unit(name)) => {
                    option.instances = instances
                        .get(name)
                        .map(|s| s.iter().copied().collect())
                        .unwrap_or_default();
                    option.npc_id = option
                        .instances
                        .first()
                        .and_then(|id| npc_id(&fight.actors.get(*id).guid));
                }
                OptionValue::Unit(UnitRef::Player(player)) => {
                    option.pets = pets
                        .get(player)
                        .map(|s| s.iter().cloned().collect())
                        .unwrap_or_default();
                }
                OptionValue::Ability(ability) => {
                    option.variants = index
                        .as_ref()
                        .map(|index| index.variants(ability))
                        .unwrap_or_default();
                    option.primary_spell = primary(&option.variants);
                }
                _ => {}
            }
            option
        })
        .collect()
}
