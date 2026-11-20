//! Forever talent trees from trimmed real exports of the rogue and druid trees.

use openlogs_gamedata::{Role, TalentTreeCsvs, TalentTrees, TalentTreesError, TreeRole, tree_role};

const ASSASSINATION: u32 = 182;
const COMBAT: u32 = 181;
const SUBTLETY: u32 = 183;

/// Left, middle and right column of the rogue tree.
const ASSASSINATION_NODE: u32 = 105722;
const COMBAT_NODE: u32 = 105724;
const SUBTLETY_NODE: u32 = 105743;
/// A classic Assassination talent that Forever placed in the middle column.
const MOVED_TO_COMBAT: u32 = 105708;
/// A Forever talent without a classic one, in the middle column.
const NEW_IN_COMBAT: u32 = 105719;
/// The druid tree's middle column.
const FERAL_NODE: u32 = 104938;
const FERAL_COMBAT: u32 = 281;
/// A node of a tree no class uses.
const UNUSED_TREE_NODE: u32 = 104775;

fn trees() -> TalentTrees {
    TalentTrees::from_csv(&TalentTreeCsvs {
        trait_node: include_bytes!("fixtures/forever/TraitNode.csv"),
        node_x_entry: include_bytes!("fixtures/forever/TraitNodeXTraitNodeEntry.csv"),
        node_entry: include_bytes!("fixtures/forever/TraitNodeEntry.csv"),
        definition: include_bytes!("fixtures/forever/TraitDefinition.csv"),
        talent: include_bytes!("fixtures/forever/Talent.csv"),
        talent_tab: include_bytes!("fixtures/forever/TalentTab.csv"),
        skill_line_x_trait_tree: include_bytes!("fixtures/forever/SkillLineXTraitTree.csv"),
        chr_specialization: include_bytes!("fixtures/forever/ChrSpecialization.csv"),
        manifest: include_bytes!("fixtures/forever/ManifestInterfaceData.csv"),
    })
    .unwrap()
}

fn tree_of(trees: &TalentTrees, node: u32) -> Option<u32> {
    trees.spec_of([(node, 1)]).map(|tree| tree.id)
}

#[test]
fn a_column_is_the_classic_tree_most_of_its_nodes_belong_to() {
    let trees = trees();
    assert_eq!(tree_of(&trees, ASSASSINATION_NODE), Some(ASSASSINATION));
    assert_eq!(tree_of(&trees, COMBAT_NODE), Some(COMBAT));
    assert_eq!(tree_of(&trees, SUBTLETY_NODE), Some(SUBTLETY));
    assert_eq!(tree_of(&trees, MOVED_TO_COMBAT), Some(COMBAT));
    assert_eq!(tree_of(&trees, NEW_IN_COMBAT), Some(COMBAT));
    assert_eq!(tree_of(&trees, FERAL_NODE), Some(FERAL_COMBAT));
}

#[test]
fn only_class_trees_count() {
    assert_eq!(tree_of(&trees(), UNUSED_TREE_NODE), None);
}

#[test]
fn the_tree_with_most_points_is_the_spec() {
    let trees = trees();
    let spec = trees
        .spec_of([(COMBAT_NODE, 35), (ASSASSINATION_NODE, 16)])
        .unwrap();
    assert_eq!(
        (
            spec.id,
            spec.class_id,
            spec.name.as_str(),
            spec.icon.as_str()
        ),
        (COMBAT, 4, "Combat", "ability_backstab")
    );
}

#[test]
fn a_tie_gives_no_spec() {
    assert!(
        trees()
            .spec_of([(COMBAT_NODE, 25), (ASSASSINATION_NODE, 25)])
            .is_none()
    );
}

#[test]
fn a_forever_spec_id_gives_its_class() {
    let trees = trees();
    assert_eq!(trees.class_of_spec(1488), Some(4));
    assert_eq!(trees.class_of_spec(1484), Some(11));
    assert_eq!(
        trees.class_of_spec(1493),
        None,
        "the default spec has no class"
    );
}

#[test]
fn the_table_survives_json() {
    let trees = TalentTrees::from_json(&trees().to_json()).unwrap();
    assert_eq!(trees.len(), 27);
    assert_eq!(tree_of(&trees, MOVED_TO_COMBAT), Some(COMBAT));
    assert_eq!(trees.tree(COMBAT).unwrap().icon, "ability_backstab");
    assert_eq!(trees.class_of_spec(1488), Some(4));
}

#[test]
fn roles_follow_our_table() {
    assert_eq!(tree_role(163), TreeRole::Fixed(Role::Tank));
    assert_eq!(tree_role(282), TreeRole::Fixed(Role::Healer));
    assert_eq!(tree_role(281), TreeRole::BearForm);
    assert_eq!(tree_role(COMBAT), TreeRole::Fixed(Role::Damage));
}

#[test]
fn a_class_tree_without_three_named_columns_is_an_error() {
    let err = TalentTrees::from_csv(&TalentTreeCsvs {
        trait_node: b"ID,TraitTreeID,PosX
1,1111,1000
2,1111,5000
3,1111,9000
",
        node_x_entry: b"TraitNodeID,TraitNodeEntryID
1,1
2,2
3,3
",
        node_entry: b"ID,TraitDefinitionID
1,1
2,2
3,3
",
        definition: b"ID,SpellID
1,101
2,102
3,999
",
        talent: b"TabID,SpellRank_0
182,101
181,102
",
        talent_tab: include_bytes!("fixtures/forever/TalentTab.csv"),
        skill_line_x_trait_tree: b"SkillLineID,TraitTreeID
38,1111
",
        chr_specialization: b"ID,ClassID
1488,4
",
        manifest: include_bytes!("fixtures/forever/ManifestInterfaceData.csv"),
    })
    .err()
    .unwrap();

    assert!(
        matches!(err, TalentTreesError::UnresolvedTree(1111)),
        "got {err}"
    );
}
