use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::specs::Role;
use crate::spell_icons::{SpellIconError, read_icon_files};

/// Bear Form and Dire Bear Form.
pub const BEAR_FORMS: [u32; 2] = [5487, 9634];

/// `TraitNode.PosX` where the middle and the right column of a class tree begin.
const COLUMN_STARTS: [i64; 2] = [4000, 8000];

#[derive(Debug, Error)]
pub enum TalentTreesError {
    #[error("CSV error: {0}")]
    Csv(#[from] csv::Error),
    #[error("CSV is missing the column {0}")]
    MissingColumn(&'static str),
    #[error("{0}")]
    Icons(#[from] SpellIconError),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("the talent tree table is empty")]
    Empty,
    #[error("the columns of trait tree {0} do not name three trees of one class")]
    UnresolvedTree(u32),
}

/// A Forever talent tree, named by the classic `TalentTab` it continues.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TalentTree {
    pub id: u32,
    pub class_id: u32,
    pub name: String,
    pub icon: String,
}

/// How a tree's players are counted: one role, or by the share of a pull spent in Bear Form.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreeRole {
    Fixed(Role),
    BearForm,
}

pub fn tree_role(tree_id: u32) -> TreeRole {
    match tree_id {
        163 | 383 => TreeRole::Fixed(Role::Tank),
        201 | 202 | 382 | 262 | 282 => TreeRole::Fixed(Role::Healer),
        281 => TreeRole::BearForm,
        _ => TreeRole::Fixed(Role::Damage),
    }
}

/// The wago.tools exports the talent trees are derived from.
pub struct TalentTreeCsvs<'a> {
    pub trait_node: &'a [u8],
    pub node_x_entry: &'a [u8],
    pub node_entry: &'a [u8],
    pub definition: &'a [u8],
    pub talent: &'a [u8],
    pub talent_tab: &'a [u8],
    pub skill_line_x_trait_tree: &'a [u8],
    pub chr_specialization: &'a [u8],
    pub manifest: &'a [u8],
}

/// Forever's talent trees: which tree each trait node belongs to, and the class of each of its
/// class specs.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TalentTrees {
    trees: BTreeMap<u32, TalentTree>,
    node_trees: HashMap<u32, u32>,
    spec_classes: HashMap<u32, u32>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebTable {
    trees: Vec<TalentTree>,
    nodes: Vec<(u32, u32)>,
    spec_classes: Vec<(u32, u32)>,
}

impl TalentTrees {
    /// A class tree lays its talents out in three columns. A node belongs to the classic tree that
    /// most of its column's talents come from, also when Forever moved it there from another tree.
    pub fn from_csv(csvs: &TalentTreeCsvs<'_>) -> Result<Self, TalentTreesError> {
        let class_trees: HashSet<u32> = numbers(csvs.skill_line_x_trait_tree, ["TraitTreeID"])?
            .into_iter()
            .map(|[tree]| tree)
            .collect();
        let entry_of_node: HashMap<u32, u32> =
            numbers(csvs.node_x_entry, ["TraitNodeID", "TraitNodeEntryID"])?
                .into_iter()
                .map(|[node, entry]| (node, entry))
                .collect();
        let definition_of_entry: HashMap<u32, u32> =
            numbers(csvs.node_entry, ["ID", "TraitDefinitionID"])?
                .into_iter()
                .map(|[entry, definition]| (entry, definition))
                .collect();
        let spell_of_definition: HashMap<u32, u32> = numbers(csvs.definition, ["ID", "SpellID"])?
            .into_iter()
            .map(|[definition, spell]| (definition, spell))
            .collect();
        let tab_of_spell = classic_talent_tabs(csvs.talent)?;
        let classic_tab = |node: u32| {
            let definition = definition_of_entry.get(entry_of_node.get(&node)?)?;
            tab_of_spell
                .get(spell_of_definition.get(definition)?)
                .copied()
        };

        let nodes: Vec<(u32, (u32, usize))> =
            signed(csvs.trait_node, ["ID", "TraitTreeID", "PosX"])?
                .into_iter()
                .filter_map(|[node, tree, x]| {
                    let (node, tree) = (u32::try_from(node).ok()?, u32::try_from(tree).ok()?);
                    class_trees
                        .contains(&tree)
                        .then_some((node, (tree, column(x))))
                })
                .collect();
        let mut votes: HashMap<(u32, usize), BTreeMap<u32, u32>> = HashMap::new();
        for &(node, place) in &nodes {
            if let Some(tab) = classic_tab(node) {
                *votes.entry(place).or_default().entry(tab).or_default() += 1;
            }
        }
        let column_tabs: HashMap<(u32, usize), u32> = votes
            .into_iter()
            .filter_map(|(place, tabs)| {
                let top = tabs
                    .iter()
                    .max_by_key(|&(&tab, &count)| (count, std::cmp::Reverse(tab)))?;
                Some((place, *top.0))
            })
            .collect();
        let node_trees = nodes
            .into_iter()
            .filter_map(|(node, place)| Some((node, *column_tabs.get(&place)?)))
            .collect();

        let icons = read_icon_files(csvs.manifest)?;
        let trees: BTreeMap<u32, TalentTree> = talent_tabs(csvs.talent_tab)?
            .into_iter()
            .filter_map(|(id, class_mask, name, icon)| {
                let class_id = class_of_mask(class_mask)?;
                let icon = icons
                    .get(&icon)
                    .cloned()
                    .unwrap_or_else(|| icon.to_string());
                Some((
                    id,
                    TalentTree {
                        id,
                        class_id,
                        name,
                        icon,
                    },
                ))
            })
            .collect();
        for &class_tree in &class_trees {
            let tabs: Vec<Option<&TalentTree>> = (0..=COLUMN_STARTS.len())
                .map(|column| {
                    column_tabs
                        .get(&(class_tree, column))
                        .and_then(|tab| trees.get(tab))
                })
                .collect();
            let resolved = tabs.iter().all(Option::is_some)
                && tabs
                    .iter()
                    .flatten()
                    .map(|tree| tree.id)
                    .collect::<HashSet<_>>()
                    .len()
                    == tabs.len()
                && tabs
                    .iter()
                    .flatten()
                    .map(|tree| tree.class_id)
                    .collect::<HashSet<_>>()
                    .len()
                    == 1;
            if !resolved {
                return Err(TalentTreesError::UnresolvedTree(class_tree));
            }
        }
        let spec_classes = numbers(csvs.chr_specialization, ["ID", "ClassID"])?
            .into_iter()
            .filter(|&[_, class]| class != 0)
            .map(|[spec, class]| (spec, class))
            .collect();
        Ok(Self {
            trees,
            node_trees,
            spec_classes,
        })
    }

    pub fn tree(&self, id: u32) -> Option<&TalentTree> {
        self.trees.get(&id)
    }

    pub fn class_of_spec(&self, spec_id: u32) -> Option<u32> {
        self.spec_classes.get(&spec_id).copied()
    }

    /// The tree with the most points of `talents` (node, rank); `None` on a tie or without points.
    pub fn spec_of(&self, talents: impl IntoIterator<Item = (u32, u32)>) -> Option<&TalentTree> {
        let mut points: BTreeMap<u32, u32> = BTreeMap::new();
        for (node, rank) in talents {
            if let Some(&tree) = self.node_trees.get(&node) {
                *points.entry(tree).or_default() += rank;
            }
        }
        let most = points.values().copied().max().filter(|&most| most > 0)?;
        let mut leaders = points.iter().filter(|&(_, &p)| p == most);
        let (&tree, _) = leaders.next()?;
        if leaders.next().is_some() {
            return None;
        }
        self.tree(tree)
    }

    pub fn len(&self) -> usize {
        self.trees.len()
    }

    pub fn is_empty(&self) -> bool {
        self.trees.is_empty()
    }

    pub fn to_json(&self) -> String {
        let mut nodes: Vec<(u32, u32)> = self.node_trees.iter().map(|(&n, &t)| (n, t)).collect();
        nodes.sort_unstable();
        let mut spec_classes: Vec<(u32, u32)> =
            self.spec_classes.iter().map(|(&s, &c)| (s, c)).collect();
        spec_classes.sort_unstable();
        let table = WebTable {
            trees: self.trees.values().cloned().collect(),
            nodes,
            spec_classes,
        };
        serde_json::to_string(&table).expect("the talent tree table serializes")
    }

    pub fn from_json(text: &str) -> Result<Self, TalentTreesError> {
        let table: WebTable = serde_json::from_str(text)?;
        if table.trees.is_empty() {
            return Err(TalentTreesError::Empty);
        }
        Ok(Self {
            trees: table
                .trees
                .into_iter()
                .map(|tree| (tree.id, tree))
                .collect(),
            node_trees: table.nodes.into_iter().collect(),
            spec_classes: table.spec_classes.into_iter().collect(),
        })
    }
}

fn column(x: i64) -> usize {
    COLUMN_STARTS.iter().filter(|&&start| x >= start).count()
}

/// `ClassMask` has one bit per class, the class ID's bit counted from 1.
fn class_of_mask(mask: u32) -> Option<u32> {
    mask.is_power_of_two().then(|| mask.trailing_zeros() + 1)
}

/// Spell of any rank of a classic talent → its `TalentTab`.
fn classic_talent_tabs(talent: &[u8]) -> Result<HashMap<u32, u32>, TalentTreesError> {
    let mut reader = csv::Reader::from_reader(talent);
    let headers = reader.headers()?.clone();
    let tab_col = column_of(&headers, "TabID")?;
    let rank_cols: Vec<usize> = headers
        .iter()
        .enumerate()
        .filter(|(_, header)| header.starts_with("SpellRank_"))
        .map(|(col, _)| col)
        .collect();
    let mut tabs = HashMap::new();
    for record in reader.records() {
        let record = record?;
        let parse = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
        let Some(tab) = parse(tab_col) else { continue };
        for spell in rank_cols
            .iter()
            .filter_map(|&col| parse(col))
            .filter(|&s| s != 0)
        {
            tabs.insert(spell, tab);
        }
    }
    Ok(tabs)
}

/// `(ID, ClassMask, Name_lang, SpellIconID)` of each `TalentTab`.
fn talent_tabs(talent_tab: &[u8]) -> Result<Vec<(u32, u32, String, u32)>, TalentTreesError> {
    let mut reader = csv::Reader::from_reader(talent_tab);
    let headers = reader.headers()?.clone();
    let cols = [
        column_of(&headers, "ID")?,
        column_of(&headers, "ClassMask")?,
        column_of(&headers, "Name_lang")?,
        column_of(&headers, "SpellIconID")?,
    ];
    let mut tabs = Vec::new();
    for record in reader.records() {
        let record = record?;
        let parse = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
        if let (Some(id), Some(mask), Some(name), Some(icon)) = (
            parse(cols[0]),
            parse(cols[1]),
            record.get(cols[2]),
            parse(cols[3]),
        ) {
            tabs.push((id, mask, name.to_string(), icon));
        }
    }
    Ok(tabs)
}

fn numbers<const N: usize>(
    csv_bytes: &[u8],
    names: [&'static str; N],
) -> Result<Vec<[u32; N]>, TalentTreesError> {
    Ok(signed(csv_bytes, names)?
        .into_iter()
        .filter_map(|row| {
            let mut values = [0; N];
            for (value, &v) in values.iter_mut().zip(&row) {
                *value = u32::try_from(v).ok()?;
            }
            Some(values)
        })
        .collect())
}

/// The named columns of every row where all of them are numbers.
fn signed<const N: usize>(
    csv_bytes: &[u8],
    names: [&'static str; N],
) -> Result<Vec<[i64; N]>, TalentTreesError> {
    let mut reader = csv::Reader::from_reader(csv_bytes);
    let headers = reader.headers()?.clone();
    let mut cols = [0; N];
    for (col, name) in cols.iter_mut().zip(names) {
        *col = column_of(&headers, name)?;
    }
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record?;
        let mut values = [0; N];
        let complete = values.iter_mut().zip(cols).all(|(value, col)| {
            record
                .get(col)
                .and_then(|v| v.parse::<i64>().ok())
                .map(|v| *value = v)
                .is_some()
        });
        if complete {
            rows.push(values);
        }
    }
    Ok(rows)
}

fn column_of(headers: &csv::StringRecord, name: &'static str) -> Result<usize, TalentTreesError> {
    headers
        .iter()
        .position(|header| header == name)
        .ok_or(TalentTreesError::MissingColumn(name))
}
