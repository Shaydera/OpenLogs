use openlogs_analysis::{ActorKind, Actors};
use openlogs_parser::Unit;

fn unit<'a>(guid: &'a str, name: &'a str, flags: u32) -> Unit<'a> {
    Unit {
        guid,
        name: Some(name),
        flags,
        raid_flags: 0x8000_0000,
    }
}

const PLAYER: &str = "Player-4101-0A1AA093";
const IMP: &str = "Creature-0-3892-3004-1387-143622-0000467A2F";
const IMP_CHILD: &str = "Creature-0-3892-3004-1387-999999-0000467A30";
const BOSS: &str = "Vehicle-0-3892-3004-1387-257758-00004679D4";

#[test]
fn kinds_come_from_guid_prefix_and_pet_flags() {
    let mut actors = Actors::new();
    let pet = actors.intern(&unit(
        "Pet-0-4246-0-846-17252-01044B0E32",
        "ShaaNash",
        0x1114,
    ));
    let guardian = actors.intern(&unit(IMP, "Wild Imp", 0x2114));
    let boss = actors.intern(&unit(BOSS, "Ula'tek", 0x10a48));
    assert_eq!(actors.get(pet).kind, ActorKind::Pet);
    assert_eq!(actors.get(guardian).kind, ActorKind::Pet);
    assert_eq!(actors.get(boss).kind, ActorKind::Npc);
    assert!(actors.get(boss).is_hostile());
    assert!(!actors.get(boss).is_friendly());
    assert!(actors.get(guardian).is_friendly());
}

#[test]
fn owner_chains_resolve_to_the_player() {
    let mut actors = Actors::new();
    let player = actors.intern(&unit(PLAYER, "Årvel-Emberfall-EU", 0x514));
    let imp = actors.intern(&unit(IMP, "Wild Imp", 0xa28));
    let child = actors.intern(&unit(IMP_CHILD, "Spawn", 0xa28));
    actors.set_owner(imp, player);
    actors.set_owner(child, imp);
    assert_eq!(
        actors.get(imp).kind,
        ActorKind::Pet,
        "an owned NPC becomes a pet"
    );
    assert_eq!(actors.root_owner(child), player);
    assert_eq!(actors.credited_player(child), Some(player));
    assert_eq!(actors.credited_player(player), Some(player));
}

#[test]
fn owner_cycles_terminate() {
    let mut actors = Actors::new();
    let a = actors.intern(&unit(IMP, "A", 0xa28));
    let b = actors.intern(&unit(IMP_CHILD, "B", 0xa28));
    actors.set_owner(a, b);
    actors.set_owner(b, a);
    let _ = actors.root_owner(a);
    assert_eq!(actors.credited_player(a), None);
}
