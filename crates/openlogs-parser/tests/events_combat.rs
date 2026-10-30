use openlogs_parser::{
    Absorbed, AuraAction, AuraChange, AuraType, CombatEvent, CombatKind, Damage, DamageVia,
    Energize, Event, Heal, HealAbsorbed, HealVia, Missed, Power, Spell, Unit, parse,
};

const EVOKER: &str = "Player-4103-63B5FD29";

fn combat(line: &str) -> CombatEvent<'_> {
    match parse(line).unwrap().event {
        Event::Combat(event) => event,
        other => panic!("expected a combat event, got {other:?}"),
    }
}

fn damage<'a>(event: &CombatEvent<'a>) -> Damage<'a> {
    match event.kind {
        CombatKind::Damage(damage) => damage,
        other => panic!("expected damage, got {other:?}"),
    }
}

#[test]
fn spell_damage_with_target_side_advanced_info() {
    let e = combat(
        r#"10/7/2026 19:03:02.2242  SPELL_DAMAGE,Player-4101-ACCA502A,"Ulvara-Emberfall-EU",0x514,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,8092,"Mind Blast",0x20,Vehicle-0-3892-3004-1387-257758-00004679D4,0000000000000000,1268044623,1268079760,0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93,35137,34114,-1,32,0,0,0,nil,nil,nil,ST"#,
    );
    assert_eq!(e.name, "SPELL_DAMAGE");
    assert_eq!(
        e.source,
        Unit {
            guid: "Player-4101-ACCA502A",
            name: Some("Ulvara-Emberfall-EU"),
            flags: 0x514,
            raid_flags: 0x8000_0000,
        }
    );
    assert!(e.source.is_player() && !e.source.is_hostile());
    assert!(e.target.is_hostile() && !e.target.is_player());
    assert_eq!(
        e.spell,
        Some(Spell {
            id: 8092,
            name: "Mind Blast",
            school: 0x20
        })
    );
    let info = e.advanced.unwrap();
    assert_eq!(info.owner_guid, None);
    assert_eq!(
        (info.current_hp, info.max_hp),
        (1_268_044_623, 1_268_079_760)
    );
    assert_eq!((info.ui_map_id, info.level), (2610, 93));
    assert_eq!(
        damage(&e),
        Damage {
            via: DamageVia::Spell,
            environmental_type: None,
            amount: 35137,
            base_amount: 34114,
            overkill: 0,
            school: 32,
            resisted: 0,
            blocked: 0,
            absorbed: 0,
            critical: false,
            glancing: false,
            crushing: false,
            supporter: None,
        }
    );
}

#[test]
fn advanced_info_describes_the_source_or_the_target_depending_on_the_event() {
    enum Side {
        Source,
        Target,
    }
    for (line, side) in [
        (
            r#"10/7/2026 19:03:02.2422  SWING_DAMAGE,Player-4101-D4B96DC1,"Edrin-Emberfall-EU",0x514,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,Player-4101-D4B96DC1,0000000000000000,1438102,1438102,3873,640,4629,1151,0,98473,17,25,120,0,1578.80,-5.19,2610,0.3976,325,6234,4155,-1,1,0,0,0,1,nil,nil"#,
            Side::Source,
        ),
        (
            r#"10/7/2026 19:03:02.2422  SWING_DAMAGE_LANDED,Player-4101-D4B96DC1,"Edrin-Emberfall-EU",0x514,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,0000000000000000,1268038389,1268079760,0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93,6234,4155,-1,1,0,0,0,1,nil,nil"#,
            Side::Target,
        ),
        (
            r#"10/7/2026 18:58:26.8942  SPELL_HEAL,Player-4101-77D4A765,"Pyrrin-Emberfall-EU",0x514,0x80000000,Player-4103-63B5FD29,"Speronis-Stonevale-EU",0x512,0x80000000,440121,"Bursting Growth",0x8,Player-4103-63B5FD29,0000000000000000,892200,892200,743,3307,2874,487,453,0,0,250000,250000,0,1520.43,6.75,2610,6.2700,330,3931,3931,3931,0,1"#,
            Side::Target,
        ),
        (
            r#"10/7/2026 19:00:08.5322  SPELL_CAST_SUCCESS,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,156322,"Eternal Flame",0x6,Player-4102-7E89660A,0000000000000000,924760,924760,3925,3774,4425,487,298,0,9|0,3|256024,5|260000,3|1500,1517.18,-10.41,2610,0.0647,334"#,
            Side::Source,
        ),
    ] {
        let e = combat(line);
        let described = match side {
            Side::Source => e.source.guid,
            Side::Target => e.target.guid,
        };
        assert_eq!(e.advanced.unwrap().info_guid, described, "{}", e.name);
    }
}

#[test]
fn advanced_info_lists_every_power_and_the_pet_owner() {
    let cast = combat(
        r#"10/7/2026 19:00:08.5322  SPELL_CAST_SUCCESS,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,156322,"Eternal Flame",0x6,Player-4102-7E89660A,0000000000000000,924760,924760,3925,3774,4425,487,298,0,9|0,3|256024,5|260000,3|1500,1517.18,-10.41,2610,0.0647,334"#,
    );
    assert_eq!(
        cast.advanced.unwrap().powers().collect::<Vec<_>>(),
        [
            Power {
                power_type: 9,
                current: 3,
                max: 5
            },
            Power {
                power_type: 0,
                current: 256_024,
                max: 260_000
            },
        ]
    );

    let pet = combat(
        r#"10/7/2026 19:03:18.5862  DAMAGE_SPLIT,Player-4101-0A1AA093,"Årvel-Emberfall-EU",0x514,0x80000000,Pet-0-4246-0-846-17252-01044B0E32,"ShaaNash",0x1114,0x80000000,108446,"Soul Link",0x20,Pet-0-4246-0-846-17252-01044B0E32,Player-4101-0A1AA093,821186,821186,7070,10791,5420,0,0,164192,3,75,200,0,1576.64,5.07,2610,6.0174,333,0,0,-1,32,0,0,45,nil,nil,nil,AOE"#,
    );
    assert_eq!(
        pet.advanced.unwrap().owner_guid,
        Some("Player-4101-0A1AA093")
    );
}

#[test]
fn damage_events_by_how_the_damage_was_dealt() {
    for (line, via, amount, critical) in [
        (
            r#"10/7/2026 19:03:02.2422  SWING_DAMAGE,Player-4101-D4B96DC1,"Edrin-Emberfall-EU",0x514,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,Player-4101-D4B96DC1,0000000000000000,1438102,1438102,3873,640,4629,1151,0,98473,17,25,120,0,1578.80,-5.19,2610,0.3976,325,6234,4155,-1,1,0,0,0,1,nil,nil"#,
            DamageVia::Swing,
            6234,
            true,
        ),
        (
            r#"10/7/2026 19:03:02.2422  SWING_DAMAGE_LANDED,Player-4101-D4B96DC1,"Edrin-Emberfall-EU",0x514,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,0000000000000000,1268038389,1268079760,0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93,6234,4155,-1,1,0,0,0,1,nil,nil"#,
            DamageVia::SwingLanded,
            6234,
            true,
        ),
        (
            r#"10/7/2026 19:03:03.0952  RANGE_DAMAGE,Player-4109-D8ECE665,"Corin-Ashgrove-EU",0x512,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,75,"Auto Shot",0x1,Vehicle-0-3892-3004-1387-257758-00004679D4,0000000000000000,1267461028,1268079760,0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93,12477,17304,-1,1,0,0,0,nil,nil,nil,ST"#,
            DamageVia::Range,
            12477,
            false,
        ),
        (
            r#"10/7/2026 18:59:18.2282  SPELL_PERIODIC_DAMAGE,0000000000000000,nil,0x514,0x80000000,Player-4101-0EE857C6,"Wendel-Emberfall-EU",0x514,0x80000000,1297338,"Deadly Venom",0x8,Player-4101-0EE857C6,0000000000000000,877960,946220,4387,421,2726,203,624,0,1,0,1300,0,1465.90,-25.32,2610,0.2768,334,68260,74153,-1,8,0,0,0,nil,nil,nil,ST"#,
            DamageVia::Periodic,
            68260,
            false,
        ),
        (
            r#"10/7/2026 19:03:18.5862  DAMAGE_SPLIT,Player-4101-0A1AA093,"Årvel-Emberfall-EU",0x514,0x80000000,Pet-0-4246-0-846-17252-01044B0E32,"ShaaNash",0x1114,0x80000000,108446,"Soul Link",0x20,Pet-0-4246-0-846-17252-01044B0E32,Player-4101-0A1AA093,821186,821186,7070,10791,5420,0,0,164192,3,75,200,0,1576.64,5.07,2610,6.0174,333,0,0,-1,32,0,0,45,nil,nil,nil,AOE"#,
            DamageVia::Split,
            0,
            false,
        ),
        (
            r#"9/6/2026 14:54:30.7292  DAMAGE_SHIELD,Player-4104-0F71DD92,"Trevan-Underreach-EU",0x40514,0x80000020,Creature-0-4244-3004-176490-257368-00001D61E3,"Ithraz",0x10a48,0x80000000,1295328,"First Mate's Shellward",0x1,Creature-0-4244-3004-176490-257368-00001D61E3,0000000000000000,311630112,416910475,0,0,1470,0,0,0,3,56,100,0,691.32,-15.86,2607,2.6354,93,16887,22306,-1,1,0,0,0,nil,nil,nil,ST"#,
            DamageVia::Shield,
            16887,
            false,
        ),
    ] {
        let d = damage(&combat(line));
        assert_eq!(
            (d.via, d.amount, d.critical),
            (via, amount, critical),
            "{line}"
        );
    }
}

#[test]
fn environmental_damage_has_no_source_and_no_spell() {
    let e = combat(
        r#"10/7/2026 18:58:23.6302  ENVIRONMENTAL_DAMAGE,0000000000000000,nil,0x80000000,0x80000000,Player-4101-935568AF,"Mulgar-Emberfall-EU",0x512,0x80000000,Player-4101-935568AF,0000000000000000,774988,981700,939,3609,2925,411,478,0,0,283920,283920,0,1082.40,2.00,2610,6.2386,332,Falling,206712,206712,0,1,0,0,0,nil,nil,nil"#,
    );
    assert!(e.source.is_empty());
    assert_eq!(e.source.name, None);
    assert_eq!(e.spell, None);
    let d = damage(&e);
    assert_eq!(
        (d.via, d.environmental_type, d.amount, d.overkill),
        (DamageVia::Environmental, Some("Falling"), 206_712, 0)
    );
}

#[test]
fn support_events_name_the_augmentation_evoker() {
    fn share<'a>(e: &CombatEvent<'a>) -> (u64, Option<&'a str>) {
        match e.kind {
            CombatKind::Damage(d) => (d.amount, d.supporter),
            CombatKind::Heal(h) => (h.amount, h.supporter),
            CombatKind::Absorbed(a) => (a.amount, a.supporter),
            other => panic!("not a support event: {other:?}"),
        }
    }
    for (line, amount) in [
        (
            r#"10/7/2026 19:03:02.6492  SPELL_DAMAGE_SUPPORT,Player-4101-F345DE13,"Evaris-Emberfall-EU",0x511,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,395152,"Ebon Might",0xc,Vehicle-0-3892-3004-1387-257758-00004679D4,0000000000000000,1267790578,1268079760,0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93,777,732,-1,64,0,0,0,nil,nil,nil,Player-4103-63B5FD29"#,
            777,
        ),
        (
            r#"10/7/2026 19:03:03.0032  SWING_DAMAGE_LANDED_SUPPORT,Player-4101-E1B72D24,"Sabrel-Emberfall-EU",0x514,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,395152,"Ebon Might",0xc,Vehicle-0-3892-3004-1387-257758-00004679D4,0000000000000000,1267473505,1268079760,0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93,239,152,-1,1,0,0,0,1,nil,nil,Player-4103-63B5FD29"#,
            239,
        ),
        (
            r#"10/7/2026 19:03:03.6572  SPELL_PERIODIC_DAMAGE_SUPPORT,Player-4109-D8ECE665,"Corin-Ashgrove-EU",0x512,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,395152,"Ebon Might",0xc,Vehicle-0-3892-3004-1387-257758-00004679D4,0000000000000000,1266825957,1268079760,0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93,706,265,-1,4,0,0,0,1,nil,nil,Player-4103-63B5FD29"#,
            706,
        ),
        (
            r#"10/7/2026 19:03:05.5852  RANGE_DAMAGE_SUPPORT,Player-4101-CA28C6B4,"Turen-Emberfall-EU",0x512,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,395152,"Ebon Might",0xc,Vehicle-0-3892-3004-1387-257758-00004679D4,0000000000000000,1263709158,1268079760,0,0,1470,0,0,0,3,2,100,0,1599.81,-1.23,2610,3.1461,93,280,370,-1,1,0,0,0,nil,nil,nil,Player-4103-63B5FD29"#,
            280,
        ),
        (
            r#"10/7/2026 19:03:03.2442  SPELL_HEAL_SUPPORT,Player-4101-E1B72D24,"Sabrel-Emberfall-EU",0x514,0x80000000,Player-4101-E1B72D24,"Sabrel-Emberfall-EU",0x514,0x80000000,395152,"Ebon Might",0xc,Player-4101-E1B72D24,0000000000000000,658800,658800,2857,635,924,633,220,0,3,60,120,0,1575.53,-8.50,2610,0.3880,296,720,720,439,0,1,Player-4103-63B5FD29"#,
            720,
        ),
        (
            r#"10/7/2026 19:03:23.3902  SPELL_PERIODIC_HEAL_SUPPORT,Player-4101-2E0D6EAA,"Elowyn-Emberfall-EU",0x514,0x80000000,Player-4101-CA28C6B4,"Turen-Emberfall-EU",0x512,0x80000000,413984,"Shifting Sands",0x40,Player-4101-CA28C6B4,0000000000000000,564124,564124,2453,524,1198,1085,432,354905,2,104,125,0,1562.22,-7.26,2610,0.0720,274,138,138,138,0,nil,Player-4103-63B5FD29"#,
            138,
        ),
        (
            r#"10/7/2026 19:03:07.0722  SPELL_ABSORBED_SUPPORT,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,Player-4102-C0396199,"Selwyn-Ironmoor-EU",0x514,0x80000000,1286835,"Necrotic Vapors",0x8,Player-4102-C0396199,"Selwyn-Ironmoor-EU",0x514,0x80000000,413984,"Shifting Sands",0x40,2389,4144,nil,Player-4103-63B5FD29"#,
            2389,
        ),
        (
            r#"10/7/2026 19:08:33.6902  SPELL_ABSORBED_SUPPORT,Creature-0-3892-3004-1387-261874-0000C67C8C,"Blightscale Rawling",0xa48,0x80000000,Player-4101-0A1AA093,"Årvel-Emberfall-EU",0x514,0x80000000,Player-4101-0A1AA093,"Årvel-Emberfall-EU",0x514,0x80000000,413984,"Shifting Sands",0x40,567,18818,nil,Player-4103-63B5FD29"#,
            567,
        ),
    ] {
        assert_eq!(share(&combat(line)), (amount, Some(EVOKER)), "{line}");
    }
}

#[test]
fn melee_support_carries_the_buff_as_a_spell_prefix() {
    let e = combat(
        r#"10/7/2026 19:03:03.0032  SWING_DAMAGE_LANDED_SUPPORT,Player-4101-E1B72D24,"Sabrel-Emberfall-EU",0x514,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,395152,"Ebon Might",0xc,Vehicle-0-3892-3004-1387-257758-00004679D4,0000000000000000,1267473505,1268079760,0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93,239,152,-1,1,0,0,0,1,nil,nil,Player-4103-63B5FD29"#,
    );
    assert_eq!(e.spell.unwrap().id, 395152);
    let d = damage(&e);
    assert_eq!((d.via, d.critical), (DamageVia::SwingLanded, true));
}

#[test]
fn misses_with_and_without_a_partial_amount() {
    for (line, expected) in [
        (
            r#"10/7/2026 19:03:02.2572  SPELL_MISSED,Player-4101-0EE857C6,"Wendel-Emberfall-EU",0x514,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,105771,"Charge",0x1,IMMUNE,nil,ST"#,
            Missed {
                via: DamageVia::Spell,
                miss_type: "IMMUNE",
                offhand: false,
                amount_missed: None,
                critical: false,
            },
        ),
        (
            r#"10/7/2026 19:03:03.5872  SPELL_PERIODIC_MISSED,Player-4101-0A1AA093,"Årvel-Emberfall-EU",0x514,0x80000000,Player-4101-0A1AA093,"Årvel-Emberfall-EU",0x514,0x80000000,387846,"Fel Armor",0x20,ABSORB,nil,240,240,nil,ST"#,
            Missed {
                via: DamageVia::Periodic,
                miss_type: "ABSORB",
                offhand: false,
                amount_missed: Some(240),
                critical: false,
            },
        ),
        (
            r#"10/7/2026 19:03:04.1022  SWING_MISSED,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,Player-4101-D4B96DC1,"Edrin-Emberfall-EU",0x514,0x80000000,PARRY,nil"#,
            Missed {
                via: DamageVia::Swing,
                miss_type: "PARRY",
                offhand: false,
                amount_missed: None,
                critical: false,
            },
        ),
        (
            r#"9/6/2026 11:54:15.7542  RANGE_MISSED,Player-4106-27BE42D8,"Zarek-Greywater-EU",0x514,0x80000000,Creature-0-1461-3004-123976-260895-00019D3845,"Shrouded Venom",0xa48,0x80000000,75,"Auto Shot",0x1,ABSORB,nil,33699,23136,1"#,
            Missed {
                via: DamageVia::Range,
                miss_type: "ABSORB",
                offhand: false,
                amount_missed: Some(33699),
                critical: true,
            },
        ),
    ] {
        assert_eq!(combat(line).kind, CombatKind::Missed(expected), "{line}");
    }
}

#[test]
fn heals_and_energizes() {
    for (line, expected) in [
        (
            r#"10/7/2026 18:58:26.8942  SPELL_HEAL,Player-4101-77D4A765,"Pyrrin-Emberfall-EU",0x514,0x80000000,Player-4103-63B5FD29,"Speronis-Stonevale-EU",0x512,0x80000000,440121,"Bursting Growth",0x8,Player-4103-63B5FD29,0000000000000000,892200,892200,743,3307,2874,487,453,0,0,250000,250000,0,1520.43,6.75,2610,6.2700,330,3931,3931,3931,0,1"#,
            CombatKind::Heal(Heal {
                via: HealVia::Direct,
                amount: 3931,
                base_amount: 3931,
                overheal: 3931,
                absorbed: 0,
                critical: true,
                supporter: None,
            }),
        ),
        (
            r#"10/7/2026 18:58:23.5282  SPELL_PERIODIC_HEAL,Player-4101-77D4A765,"Pyrrin-Emberfall-EU",0x514,0x80000000,Player-4101-2E0D6EAA,"Elowyn-Emberfall-EU",0x514,0x80000000,774,"Rejuvenation",0x8,Player-4101-2E0D6EAA,0000000000000000,826600,826600,3242,432,1128,487,453,0,3,250,250,0,1521.16,-15.20,2610,5.4109,330,8526,8526,8526,0,nil"#,
            CombatKind::Heal(Heal {
                via: HealVia::Periodic,
                amount: 8526,
                base_amount: 8526,
                overheal: 8526,
                absorbed: 0,
                critical: false,
                supporter: None,
            }),
        ),
        (
            r#"10/7/2026 19:00:04.8762  SPELL_ENERGIZE,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,20473,"Holy Shock",0x2,Player-4102-7E89660A,0000000000000000,924760,924760,3925,3774,4425,487,298,0,0,260000,260000,0,1517.18,-10.41,2610,0.0647,334,1.0000,0.0000,9,5"#,
            CombatKind::Energize(Energize {
                periodic: false,
                amount: 1.0,
                over_energize: 0.0,
                power_type: 9,
                max_power: 5,
            }),
        ),
        (
            r#"10/7/2026 19:02:57.8132  SPELL_PERIODIC_ENERGIZE,Player-4101-77D4A765,"Pyrrin-Emberfall-EU",0x514,0x80000000,Player-4101-77D4A765,"Pyrrin-Emberfall-EU",0x514,0x80000000,1277461,"Drink",0x1,Player-4101-77D4A765,0000000000000000,937060,937060,3743,3599,1197,907,173,0,0,243371,250000,0,1532.10,-4.30,2610,0.0688,332,5000.0000,0.0000,0,250000"#,
            CombatKind::Energize(Energize {
                periodic: true,
                amount: 5000.0,
                over_energize: 0.0,
                power_type: 0,
                max_power: 250_000,
            }),
        ),
    ] {
        assert_eq!(combat(line).kind, expected, "{line}");
    }
}

#[test]
fn absorbs_with_and_without_an_attacking_spell() {
    let spell = combat(
        r#"10/7/2026 19:03:03.0812  SPELL_ABSORBED,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,Player-4101-935568AF,"Mulgar-Emberfall-EU",0x514,0x80000000,1286835,"Necrotic Vapors",0x8,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,414019,"Greater Judgment",0x20,19435,27807,nil"#,
    );
    assert_eq!(spell.spell.map(|s| s.name), Some("Necrotic Vapors"));
    assert_eq!(
        spell.kind,
        CombatKind::Absorbed(Absorbed {
            absorber: Unit {
                guid: "Player-4102-7E89660A",
                name: Some("Puran-Ironmoor-EU"),
                flags: 0x514,
                raid_flags: 0x8000_0000,
            },
            absorb_spell: Spell {
                id: 414019,
                name: "Greater Judgment",
                school: 0x20
            },
            amount: 19435,
            critical: false,
            supporter: None,
        })
    );

    let melee = combat(
        r#"10/7/2026 19:03:11.1832  SPELL_ABSORBED,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,Player-4101-D4B96DC1,"Edrin-Emberfall-EU",0x514,0x80000000,Player-4101-D4B96DC1,"Edrin-Emberfall-EU",0x514,0x80000000,263648,"Soul Barrier",0x20,130439,1561920,nil"#,
    );
    assert_eq!(melee.spell, None);
    let CombatKind::Absorbed(absorbed) = melee.kind else {
        panic!("expected an absorb, got {:?}", melee.kind);
    };
    assert_eq!(
        (absorbed.absorb_spell.name, absorbed.amount),
        ("Soul Barrier", 130_439)
    );
}

#[test]
fn heal_absorbs_name_the_heal_they_took() {
    let e = combat(
        r#"10/7/2026 19:00:04.9992  SPELL_HEAL_ABSORBED,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,448005,"Light of the Martyr",0x2,Player-4101-D4B96DC1,"Edrin-Emberfall-EU",0x514,0x80000000,143924,"Leech",0x1,10729,10729"#,
    );
    assert_eq!(e.spell.map(|s| s.id), Some(448005));
    assert_eq!(e.source.guid, "Player-4102-7E89660A");
    assert_eq!(
        e.kind,
        CombatKind::HealAbsorbed(HealAbsorbed {
            healer: Unit {
                guid: "Player-4101-D4B96DC1",
                name: Some("Edrin-Emberfall-EU"),
                flags: 0x514,
                raid_flags: 0x8000_0000,
            },
            heal_spell: Spell {
                id: 143924,
                name: "Leech",
                school: 0x1,
            },
            amount: 10729,
        })
    );
}

#[test]
fn casts_auras_and_unit_events() {
    let necrotic_vapors = Spell {
        id: 1286835,
        name: "Necrotic Vapors",
        school: 8,
    };
    let aura = |action, aura_type, stacks| {
        CombatKind::Aura(AuraChange {
            action,
            aura_type,
            stacks,
            broken_by: None,
        })
    };
    for (line, expected) in [
        (
            r#"10/7/2026 18:58:52.9552  SPELL_CAST_START,Player-4101-935568AF,"Mulgar-Emberfall-EU",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,431998,"Delicate Crimson Parasol",0x1"#,
            CombatKind::CastStart,
        ),
        (
            r#"10/7/2026 19:00:08.5322  SPELL_CAST_SUCCESS,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,156322,"Eternal Flame",0x6,Player-4102-7E89660A,0000000000000000,924760,924760,3925,3774,4425,487,298,0,9|0,3|256024,5|260000,3|1500,1517.18,-10.41,2610,0.0647,334"#,
            CombatKind::CastSuccess,
        ),
        (
            r#"10/7/2026 19:03:05.2742  SPELL_CAST_FAILED,Player-4101-F345DE13,"Evaris-Emberfall-EU",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,5143,"Arcane Missiles",0x40,"Not yet recovered""#,
            CombatKind::CastFailed {
                reason: "Not yet recovered",
            },
        ),
        (
            r#"10/7/2026 18:58:23.5592  SPELL_AURA_APPLIED,Creature-0-3892-3004-1387-143622-0000467A2F,"Wild Imp",0x2114,0x80000000,Creature-0-3892-3004-1387-143622-0000467A2F,"Wild Imp",0x2114,0x80000000,108370,"Soul Leech",0x1,BUFF"#,
            aura(AuraAction::Applied, AuraType::Buff, None),
        ),
        (
            r#"10/7/2026 18:59:25.4292  SPELL_AURA_REMOVED,0000000000000000,nil,0x514,0x80000000,Player-4101-0EE857C6,"Wendel-Emberfall-EU",0x514,0x80000000,1297338,"Deadly Venom",0x8,DEBUFF"#,
            aura(AuraAction::Removed, AuraType::Debuff, None),
        ),
        (
            r#"10/7/2026 18:58:28.3742  SPELL_AURA_REFRESH,Player-4101-98386587,"Forrin-Emberfall-EU",0x512,0x80000000,Player-4101-98386587,"Forrin-Emberfall-EU",0x512,0x80000000,448604,"Spellfire Sphere",0x1,BUFF"#,
            aura(AuraAction::Refresh, AuraType::Buff, None),
        ),
        (
            r#"10/7/2026 18:58:26.4002  SPELL_AURA_APPLIED_DOSE,Player-4101-0A1AA093,"Årvel-Emberfall-EU",0x514,0x80000000,Player-4101-0A1AA093,"Årvel-Emberfall-EU",0x514,0x80000000,1281559,"Hellbent Commander",0x24,BUFF,3"#,
            aura(AuraAction::AppliedDose, AuraType::Buff, Some(3)),
        ),
        (
            r#"10/7/2026 18:58:31.6612  SPELL_AURA_REMOVED_DOSE,Player-4101-0A1AA093,"Årvel-Emberfall-EU",0x514,0x80000000,Player-4101-0A1AA093,"Årvel-Emberfall-EU",0x514,0x80000000,1281559,"Hellbent Commander",0x24,BUFF,2"#,
            aura(AuraAction::RemovedDose, AuraType::Buff, Some(2)),
        ),
        (
            r#"10/7/2026 19:17:15.8692  SPELL_AURA_BROKEN,Creature-0-3773-2987-17755-252959-0000467E42,"Nymrissa Wavecaller",0x10a48,0x80000000,Player-4102-B255A46C,"Scarlet-Ironmoor-EU",0x514,0x80000000,3714,"Path of Frost",0x1,BUFF"#,
            aura(AuraAction::Broken, AuraType::Buff, None),
        ),
        (
            r#"10/7/2026 19:06:36.0672  SPELL_AURA_BROKEN_SPELL,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0xa48,0x80000000,Player-4101-8E8C0182,"Faelan-Emberfall-EU",0x512,0x80000000,110960,"Greater Invisibility",0x40,1286835,"Necrotic Vapors",8,BUFF"#,
            CombatKind::Aura(AuraChange {
                action: AuraAction::BrokenSpell,
                aura_type: AuraType::Buff,
                stacks: None,
                broken_by: Some(necrotic_vapors),
            }),
        ),
        (
            r#"10/7/2026 19:05:57.7152  SPELL_INTERRUPT,Player-4101-0EE857C6,"Wendel-Emberfall-EU",0x514,0x80000000,Creature-0-3892-3004-1387-264045-0000467BEA,"Doomscale Warden",0xa48,0x80000000,6552,"Pummel",0x1,1290779,"Malice",8"#,
            CombatKind::Interrupt {
                interrupted: Spell {
                    id: 1290779,
                    name: "Malice",
                    school: 8,
                },
            },
        ),
        (
            r#"10/7/2026 19:03:36.0492  SPELL_DISPEL,Player-4102-7E89660A,"Puran-Ironmoor-EU",0x514,0x80000000,Player-4101-DCA91DA3,"Aleth-Emberfall-EU",0x514,0x80000000,4987,"Cleanse",0x2,1287036,"Poisonous Bite",8,DEBUFF"#,
            CombatKind::Dispel {
                removed: Spell {
                    id: 1287036,
                    name: "Poisonous Bite",
                    school: 8,
                },
                aura_type: AuraType::Debuff,
            },
        ),
        (
            r#"10/5/2026 19:25:06.4572  SPELL_STOLEN,Creature-0-3112-3004-255656-223453-000043DD63,"Arcane Phoenix",0x2112,0x80000000,Creature-0-3112-3004-255656-261479-0000C3D395,"Venomfang Infuser",0xa48,0x80000000,30449,"Spellsteal",0x40,1290198,"Toxin Infusion",8,BUFF"#,
            CombatKind::Stolen {
                removed: Spell {
                    id: 1290198,
                    name: "Toxin Infusion",
                    school: 8,
                },
                aura_type: AuraType::Buff,
            },
        ),
        (
            r#"10/7/2026 18:58:23.4792  SPELL_SUMMON,Player-4101-0A1AA093,"Årvel-Emberfall-EU",0x514,0x80000000,Creature-0-3892-3004-1387-143622-0000467A2F,"Wild Imp",0xa28,0x80000000,279910,"Wild Imp",0x20"#,
            CombatKind::Summon,
        ),
        (
            r#"10/7/2026 19:00:54.9802  SPELL_CREATE,Player-4101-98386587,"Forrin-Emberfall-EU",0x512,0x80000000,GameObject-0-3892-3004-1387-627495-0000467AC7,"Hearty Harandar Celebration",0x4228,0x80000000,1278929,"Hearty Harandar Celebration",0x1"#,
            CombatKind::Create,
        ),
        (
            r#"10/7/2026 19:03:39.4672  SPELL_RESURRECT,Player-4107-D76CCCEC,"Serrik-Silverbrook-EU",0x512,0x80000000,Player-4101-0EE857C6,"Wendel-Emberfall-EU",0x514,0x80000000,20484,"Rebirth",0x8"#,
            CombatKind::Resurrect,
        ),
        (
            r#"10/5/2026 18:26:22.6132  SPELL_INSTAKILL,Player-4105-F327D20D,"Talbrand-Stormcrag-EU",0x512,0x80000000,Player-4105-F327D20D,"Talbrand-Stormcrag-EU",0x512,0x80000000,123982,"Purgatory",0x1,0"#,
            CombatKind::Instakill,
        ),
        (
            r#"10/7/2026 19:03:07.0512  SPELL_EMPOWER_START,Player-4103-63B5FD29,"Speronis-Stonevale-EU",0x514,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,396286,"Upheaval",0xc"#,
            CombatKind::EmpowerStart,
        ),
        (
            r#"10/7/2026 19:03:07.5672  SPELL_EMPOWER_END,Player-4103-63B5FD29,"Speronis-Stonevale-EU",0x514,0x80000000,0000000000000000,nil,0x80000000,0x80000000,396286,"Upheaval",0xc,1"#,
            CombatKind::EmpowerEnd { stage: 1 },
        ),
        (
            r#"10/7/2026 19:03:36.4602  SPELL_EMPOWER_INTERRUPT,Creature-0-3892-3004-1387-253466-0000467B48,"Future Self",0x2114,0x80000000,0000000000000000,nil,0x80000000,0x80000000,396286,"Upheaval",0xc,3"#,
            CombatKind::EmpowerInterrupt { stage: 3 },
        ),
        (
            r#"10/7/2026 19:03:41.1302  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-4110-1A73F2A2,"Paëne-Duskmere-EU",0x514,0x80000000,0"#,
            CombatKind::UnitDied { unconscious: false },
        ),
        (
            r#"10/7/2026 19:03:36.4422  PARTY_KILL,Player-4101-8E8C0182,"Faelan-Emberfall-EU",0x512,0x80000000,Creature-0-3892-3004-1387-261874-0000467B61,"Blightscale Rawling",0xa48,0x80000000,0"#,
            CombatKind::PartyKill,
        ),
    ] {
        assert_eq!(combat(line).kind, expected, "{line}");
    }
}
