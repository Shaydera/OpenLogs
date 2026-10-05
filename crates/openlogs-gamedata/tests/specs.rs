use openlogs_gamedata::{Role, class, classes, spec, specs};

#[test]
fn every_spec_belongs_to_a_class_with_a_zamimg_icon() {
    let arcane = spec(62).unwrap();
    assert_eq!(
        (arcane.name.as_str(), arcane.role, arcane.icon.as_str()),
        ("Arcane", Role::Damage, "spell_holy_magicalsentry")
    );
    assert_eq!(class(arcane.class_id).unwrap().icon(), "classicon_mage");
    assert_eq!(class(6).unwrap().icon(), "classicon_deathknight");
    assert!(spec(0).is_none() && class(99).is_none());

    assert_eq!(classes().len(), 13);
    for spec in specs() {
        assert!(class(spec.class_id).is_some(), "spec {}", spec.id);
        assert!(!spec.icon.is_empty(), "spec {}", spec.id);
    }
}
