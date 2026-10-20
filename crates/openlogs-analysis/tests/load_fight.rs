use openlogs_analysis::{
    ActorKind, Actors, Attribution, Damage, DamageVia, EventKind, FailReason, LANDED_TAIL_BYTES,
    NO_SPELL, ReportFilter, UnitHp, damage_done, load_fight, load_fight_slice,
    load_fight_slice_with,
};
use openlogs_index::{Outcome, index_bytes};
use openlogs_parser::Unit;

const FIXTURE: &str = include_str!("../../openlogs-index/tests/fixtures/mini_raid.txt");

#[test]
fn loads_the_first_fight_with_prelude_roster_and_events() {
    let index = index_bytes(FIXTURE.as_bytes());
    let fight = load_fight(FIXTURE.as_bytes(), &index.fights[0]);
    assert_eq!((fight.encounter_id, fight.name.as_str()), (3492, "Ula'tek"));
    assert_eq!((fight.outcome, fight.duration_ms), (Outcome::Wipe, 60_000));
    assert_eq!(fight.broken_lines, 1);

    let mut players: Vec<_> = fight
        .actors
        .players()
        .map(|p| (p.name.clone().unwrap(), p.spec_id))
        .collect();
    players.sort();
    assert_eq!(
        players,
        [
            ("Faelan-Emberfall-EU".to_string(), Some(62)),
            ("Pyrrin-Emberfall-EU".to_string(), Some(105)),
        ]
    );

    // Prelude aura at 19:02:50.0000, aura, two hits, a heal and a death — the 19:02:40 cast
    // lies before the 15 s prelude and the broken line is skipped.
    assert_eq!(fight.events.len(), 5);
    assert_eq!(fight.events[0].t, -12_076);
    assert!(fight.events.windows(2).all(|w| w[0].t <= w[1].t));

    let boss = fight
        .actors
        .id("Vehicle-0-3892-3004-1387-257758-00004679D4")
        .unwrap();
    assert_eq!(fight.actors.get(boss).kind, ActorKind::Npc);
    assert!(fight.actors.get(boss).is_hostile());
    let hit = fight.events.iter().find(|e| e.target == boss).unwrap();
    assert_eq!(hit.t, 148);
    assert_eq!(fight.spells[&hit.spell].name, "Arcane Barrage");
    assert_eq!(
        hit.unit_hp,
        Some(UnitHp {
            actor: boss,
            current: 951_059_820,
            max: 1_268_079_760
        })
    );
    match hit.kind {
        EventKind::Damage(Damage {
            via,
            amount,
            critical,
            supporter,
            ..
        }) => {
            assert_eq!(
                (via, amount, critical, supporter),
                (DamageVia::Spell, 317_019_940, true, 0)
            );
        }
        other => panic!("expected damage, got {other:?}"),
    }

    let faelan = fight.actors.id("Player-4101-8E8C0182").unwrap();
    let death = fight.events.last().unwrap();
    assert_eq!((death.target, death.spell), (faelan, NO_SPELL));
    assert_eq!(death.kind, EventKind::Died { unconscious: false });
}

const PET_LOG: &str = concat!(
    "10/7/2026 19:03:02.0762  ENCOUNTER_START,3492,\"Ula'tek\",15,23,3004\n",
    "10/7/2026 19:03:03.0000  SPELL_SUMMON,Player-4101-0A1AA093,\"Årvel-Emberfall-EU\",0x514,0x80000000,Creature-0-3892-3004-1387-143622-0000467A2F,\"Wild Imp\",0xa28,0x80000000,279910,\"Wild Imp\",0x20\n",
    "10/7/2026 19:03:04.0000  SPELL_DAMAGE,Creature-0-3892-3004-1387-143622-0000467A2F,\"Wild Imp\",0x2114,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,\"Ula'tek\",0x10a48,0x80000000,104318,\"Fel Firebolt\",0x4,Vehicle-0-3892-3004-1387-257758-00004679D4,0000000000000000,951059820,1268079760,0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93,50000,50000,-1,4,0,0,0,nil,nil,nil,ST\n",
    "10/7/2026 19:03:05.0000  SWING_DAMAGE,Pet-0-4246-0-846-17252-01044B0E32,\"ShaaNash\",0x1114,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,\"Ula'tek\",0x10a48,0x80000000,Pet-0-4246-0-846-17252-01044B0E32,Player-4101-0A1AA093,821186,821186,7070,10791,5420,0,0,164192,3,75,200,0,1576.64,5.07,2610,6.0174,333,6234,4155,-1,1,0,0,0,nil,nil,nil\n",
    "10/7/2026 19:04:02.0762  ENCOUNTER_END,3492,\"Ula'tek\",15,23,1,60000\n",
);

#[test]
fn pets_are_credited_through_their_summon_or_the_advanced_owner() {
    let index = index_bytes(PET_LOG.as_bytes());
    let fight = load_fight(PET_LOG.as_bytes(), &index.fights[0]);
    let owner = fight.actors.id("Player-4101-0A1AA093").unwrap();
    let imp = fight
        .actors
        .id("Creature-0-3892-3004-1387-143622-0000467A2F")
        .unwrap();
    assert_eq!(fight.actors.get(imp).kind, ActorKind::Pet);
    assert_eq!(fight.actors.credited_player(imp), Some(owner));
    // Summoned before the slice: only the advanced block names the owner.
    let pet = fight
        .actors
        .id("Pet-0-4246-0-846-17252-01044B0E32")
        .unwrap();
    assert_eq!(fight.actors.credited_player(pet), Some(owner));
    let boss = fight
        .actors
        .id("Vehicle-0-3892-3004-1387-257758-00004679D4")
        .unwrap();
    assert_eq!(fight.actors.credited_player(boss), None);
}

const TURNCOAT_LOG: &str = concat!(
    "10/7/2026 19:03:02.0762  ENCOUNTER_START,3492,\"Ula'tek\",15,23,3004\n",
    "10/7/2026 19:03:03.0000  SPELL_DAMAGE,Player-4101-8E8C0182,\"Faelan-Emberfall-EU\",0x512,0x80000000,Creature-0-3892-3004-1387-261874-0000467B61,\"Blightscale Rawling\",0xa48,0x80000000,44425,\"Arcane Barrage\",0x40,Creature-0-3892-3004-1387-261874-0000467B61,0000000000000000,1000,2000,0,0,0,0,0,0,1,0,0,0,1590.00,-3.00,2610,1.0000,92,1000,1000,-1,64,0,0,0,nil,nil,nil,ST\n",
    "10/7/2026 19:03:04.0000  SPELL_AURA_APPLIED,Creature-0-3892-3004-1387-261874-0000467B61,\"Blightscale Rawling\",0xa28,0x80000000,Creature-0-3892-3004-1387-261874-0000467B61,\"Blightscale Rawling\",0xa28,0x80000000,1,\"Burrow\",0x1,BUFF\n",
    "10/7/2026 19:04:02.0762  ENCOUNTER_END,3492,\"Ula'tek\",15,23,1,60000\n",
);

#[test]
fn hostility_is_recorded_per_event() {
    let index = index_bytes(TURNCOAT_LOG.as_bytes());
    let fight = load_fight(TURNCOAT_LOG.as_bytes(), &index.fights[0]);
    let add = fight
        .actors
        .id("Creature-0-3892-3004-1387-261874-0000467B61")
        .unwrap();
    assert!(
        !fight.actors.get(add).is_hostile(),
        "the add turned neutral later"
    );
    let hit = fight
        .events
        .iter()
        .find(|e| e.target == add && matches!(e.kind, EventKind::Damage(_)))
        .unwrap();
    assert!(hit.target_hostile, "it was hostile when it was hit");
    assert!(!hit.source_hostile);
}

const CAST_FAILED_LOG: &str = concat!(
    "10/7/2026 19:03:02.0762  ENCOUNTER_START,3492,\"Ula'tek\",15,23,3004
",
    "10/7/2026 19:03:05.2742  SPELL_CAST_FAILED,Player-3703-0A91F445,\"Evocadera-Frostwolf-EU\",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,5143,\"Arcane Missiles\",0x40,\"Not yet recovered\"
",
    "10/7/2026 19:03:11.0922  SPELL_CAST_FAILED,Player-3703-0A91F445,\"Evocadera-Frostwolf-EU\",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,30451,\"Arcane Blast\",0x40,\"Interrupted\"
",
    "10/7/2026 19:03:12.0000  SPELL_CAST_FAILED,Player-3703-0A91F445,\"Evocadera-Frostwolf-EU\",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,30451,\"Arcane Blast\",0x40,\"Out of range\"
",
    "10/7/2026 19:03:13.0000  SPELL_CAST_FAILED,Player-3703-0A91F445,\"Evocadera-Frostwolf-EU\",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,5143,\"Arcane Missiles\",0x40,\"Not yet recovered\"
",
    "10/7/2026 19:04:02.0762  ENCOUNTER_END,3492,\"Ula'tek\",15,23,0,60000
",
);

#[test]
fn a_failed_cast_keeps_its_reason() {
    let index = index_bytes(CAST_FAILED_LOG.as_bytes());
    let fight = load_fight(CAST_FAILED_LOG.as_bytes(), &index.fights[0]);
    let reasons: Vec<FailReason> = fight
        .events
        .iter()
        .filter_map(|e| match e.kind {
            EventKind::CastFailed { reason } => Some(reason),
            _ => None,
        })
        .collect();
    assert_eq!(reasons.len(), 4);
    assert_eq!(reasons[1], FailReason::Interrupted);
    assert_eq!(
        reasons
            .iter()
            .map(|&r| fight.fail_reason(r))
            .collect::<Vec<_>>(),
        [
            "Not yet recovered",
            "Interrupted",
            "Out of range",
            "Not yet recovered"
        ]
    );
}

#[test]
fn a_fight_loads_the_same_from_its_part_of_the_log() {
    let mythic_plus = include_str!("../../openlogs-index/tests/fixtures/mythic_plus.txt");
    for log in [FIXTURE, mythic_plus].map(str::as_bytes) {
        let index = index_bytes(log);
        for summary in &index.fights {
            let start = summary.prelude_offset as usize;
            let end = ((summary.end_offset + LANDED_TAIL_BYTES) as usize).min(log.len());
            assert_eq!(
                load_fight_slice(&log[start..end], summary.prelude_offset, summary),
                load_fight(log, summary)
            );
        }
    }
}

const KILLING_SWING_LOG: &str = concat!(
    "10/7/2026 19:03:02.0762  ENCOUNTER_START,3492,\"Ula'tek\",15,23,3004\n",
    "10/7/2026 19:03:05.0000  SWING_DAMAGE,Pet-0-4246-0-846-17252-01044B0E32,\"ShaaNash\",0x1114,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,\"Ula'tek\",0x10a48,0x80000000,Pet-0-4246-0-846-17252-01044B0E32,Player-4101-0A1AA093,821186,821186,7070,10791,5420,0,0,164192,3,75,200,0,1576.64,5.07,2610,6.0174,333,6234,6234,-1,1,0,0,0,nil,nil,nil\n",
    "10/7/2026 19:04:02.0500  SWING_DAMAGE,Pet-0-4246-0-846-17252-01044B0E32,\"ShaaNash\",0x1114,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,\"Ula'tek\",0x10a48,0x80000000,Pet-0-4246-0-846-17252-01044B0E32,Player-4101-0A1AA093,821186,821186,7070,10791,5420,0,0,164192,3,75,200,0,1576.64,5.07,2610,6.0174,333,5000,5000,1200,1,0,0,0,nil,nil,nil\n",
    "10/7/2026 19:04:02.0762  ENCOUNTER_END,3492,\"Ula'tek\",15,23,1,60000\n",
    "10/7/2026 19:04:02.0800  SWING_DAMAGE_LANDED,Pet-0-4246-0-846-17252-01044B0E32,\"ShaaNash\",0x1114,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,\"Ula'tek\",0x10a48,0x80000000,Pet-0-4246-0-846-17252-01044B0E32,Player-4101-0A1AA093,821186,821186,7070,10791,5420,0,0,164192,3,75,200,0,1576.64,5.07,2610,6.0174,333,5000,5000,1200,1,0,0,0,nil,nil,nil\n",
);

#[test]
fn a_swing_whose_landed_copy_follows_the_end_stays_out_of_damage_done() {
    let index = index_bytes(KILLING_SWING_LOG.as_bytes());
    let fight = load_fight(KILLING_SWING_LOG.as_bytes(), &index.fights[0]);
    let report = damage_done(&fight, &ReportFilter::whole(Attribution::Augmented));
    assert_eq!(
        report.total, 6_234,
        "a swing without any landed copy still counts"
    );
    let swings: Vec<bool> = fight
        .events
        .iter()
        .filter_map(|e| match e.kind {
            EventKind::Damage(d) if d.via == DamageVia::Swing => Some(d.lands_after_end),
            _ => None,
        })
        .collect();
    assert_eq!(
        swings,
        [false, true],
        "the killing swing stays an event of the pull"
    );
}

#[test]
fn a_guid_keeps_its_id_in_the_next_pull_of_a_set() {
    let index = index_bytes(FIXTURE.as_bytes());
    let first = load_fight(FIXTURE.as_bytes(), &index.fights[0]);
    let third = load_fight_slice_with(
        FIXTURE.as_bytes(),
        0,
        &index.fights[2],
        first.actors.carried_over(),
    );
    let shared: Vec<_> = third
        .actors
        .players()
        .filter_map(|p| Some((first.actors.id(&p.guid)?, p.id)))
        .collect();
    assert!(!shared.is_empty());
    assert!(
        shared
            .iter()
            .all(|(in_first, in_third)| in_first == in_third)
    );
}

#[test]
fn carried_over_actors_forget_per_pull_facts() {
    let mut actors = Actors::new();
    let player = actors.intern(&Unit {
        guid: "Player-1",
        name: Some("Faelan-Emberfall-EU"),
        flags: 0x514,
        raid_flags: 0x8000_0000,
    });
    let pet = actors.intern_guid("Pet-1");
    actors.set_spec(player, 62);
    actors.set_owner(pet, player);
    actors.note_advanced(player, 700, 1_000_000);

    let carried = actors.carried_over();
    let kept = carried.get(player);
    assert_eq!(
        (kept.guid.as_str(), kept.name.as_deref(), kept.kind),
        ("Player-1", Some("Faelan-Emberfall-EU"), ActorKind::Player)
    );
    assert_eq!(carried.id("Pet-1"), Some(pet));
    assert_eq!(
        (kept.flags, kept.spec_id, kept.item_level, kept.max_hp),
        (0, None, None, None)
    );
    assert_eq!(carried.get(pet).owner, None);
}
