mod support;

use openlogs_analysis::{
    AbilityRow, Absorbed, ActorId, Attribution, BuffedAbility, Damage, DamageReport, DamageVia,
    EventKind, Fight, Heal, Metric, NO_SPELL, NOBODY, ReportFilter, RowKind, Scope, SupportShare,
    damage_done, healing, player_detail,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, damage, heal};

const EBON_MIGHT: u32 = 395152;
const PRESCIENCE: u32 = 410089;
const FIRE_BLAST: u32 = 108853;
const PYROBLAST: u32 = 11366;
const IGNITE: u32 = 12654;

struct Raid {
    b: FightBuilder,
    mage: ActorId,
    evoker: ActorId,
    boss: ActorId,
}

fn raid() -> Raid {
    let mut b = FightBuilder::new(20_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let evoker = b.player("Player-2", "Speronis-Stonevale-EU", 1473);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    for (id, name) in [
        (EBON_MIGHT, "Ebon Might"),
        (PRESCIENCE, "Prescience"),
        (FIRE_BLAST, "Fire Blast"),
        (PYROBLAST, "Pyroblast"),
        (IGNITE, "Ignite"),
    ] {
        b.spell(id, name);
    }
    Raid {
        b,
        mage,
        evoker,
        boss,
    }
}

fn spell_hit(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Spell, amount, 0))
}

fn supported(via: DamageVia, amount: u64, evoker: ActorId) -> EventKind {
    EventKind::Damage(Damage {
        supporter: evoker,
        ..damage(via, amount, 0)
    })
}

fn whole(attribution: Attribution) -> ReportFilter {
    ReportFilter::whole(attribution)
}

fn rows_of(report: &DamageReport, player: ActorId) -> Vec<(u32, RowKind, i64, u64)> {
    let p = report.players.iter().find(|p| p.player == player).unwrap();
    p.abilities
        .iter()
        .map(|a: &AbilityRow| (a.spell, a.kind, a.amount, a.support))
        .collect()
}

fn share(
    buff: u32,
    evoker: ActorId,
    player: ActorId,
    spell: Option<(u32, ActorId)>,
    amount: u64,
) -> SupportShare {
    SupportShare {
        buff,
        evoker,
        player,
        ability: spell.map(|(spell, actor)| BuffedAbility { spell, actor }),
        amount,
    }
}

#[test]
fn support_belongs_to_the_last_earlier_hit_of_its_kind() {
    let mut r = raid();
    r.b.push(1_000, r.mage, r.boss, PYROBLAST, spell_hit(1_000));
    r.b.push(1_001, r.mage, r.boss, FIRE_BLAST, spell_hit(500));
    r.b.push(
        1_001,
        r.mage,
        r.boss,
        IGNITE,
        EventKind::Damage(damage(DamageVia::Periodic, 200, 0)),
    );
    r.b.push(
        1_002,
        r.mage,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 50, r.evoker),
    );
    r.b.push(
        1_002,
        r.mage,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Periodic, 20, r.evoker),
    );
    let report = damage_done(&r.b.build(), &whole(Attribution::Reattributed));
    assert_eq!(
        rows_of(&report, r.mage),
        [
            (PYROBLAST, RowKind::Own, 1_000, 0),
            (FIRE_BLAST, RowKind::Own, 450, 50),
            (IGNITE, RowKind::Own, 180, 20),
        ],
        "a direct support goes to the latest direct hit, a periodic one to the DoT"
    );
}

#[test]
fn a_hit_just_before_the_range_still_owns_its_support() {
    let mut r = raid();
    r.b.push(4_999, r.mage, r.boss, PYROBLAST, spell_hit(1_000));
    r.b.push(
        5_000,
        r.mage,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 100, r.evoker),
    );
    r.b.push(6_000, r.mage, r.boss, FIRE_BLAST, spell_hit(500));
    let fight = r.b.build();
    let range = ReportFilter {
        start_ms: 5_000,
        end_ms: 10_000,
        attribution: Attribution::Reattributed,
    };
    let report = damage_done(&fight, &range);
    assert_eq!(
        report.support,
        [share(
            EBON_MIGHT,
            r.evoker,
            r.mage,
            Some((PYROBLAST, r.mage)),
            100
        )]
    );
    assert_eq!(
        rows_of(&report, r.mage),
        [
            (FIRE_BLAST, RowKind::Own, 500, 0),
            (PYROBLAST, RowKind::Own, -100, 100),
        ],
        "the support counts in the range like before; its hit is named, not lost"
    );
    let mage = &report.players[0];
    assert_eq!(mage.total, 400, "totals are unchanged by the matching");
}

#[test]
fn support_without_a_hit_within_2_ms_is_unmatched() {
    let mut r = raid();
    r.b.push(1_000, r.mage, r.boss, PYROBLAST, spell_hit(1_000));
    r.b.push(
        1_003,
        r.mage,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 30, r.evoker),
    );
    let report = damage_done(&r.b.build(), &whole(Attribution::Reattributed));
    assert_eq!(
        rows_of(&report, r.mage),
        [
            (PYROBLAST, RowKind::Own, 1_000, 0),
            (NO_SPELL, RowKind::Unmatched, -30, 30),
        ]
    );
    assert_eq!(
        report.support,
        [share(EBON_MIGHT, r.evoker, r.mage, None, 30)]
    );
}

#[test]
fn heals_and_absorbs_own_their_support() {
    let mut b = FightBuilder::new(10_000);
    let shaman = b.player("Player-1", "Elowyn-Emberfall-EU", 264);
    let evoker = b.player("Player-2", "Speronis-Stonevale-EU", 1473);
    let tank = b.player("Player-3", "Edrin-Emberfall-EU", 581);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let periodic = |amount| Heal {
        periodic: true,
        ..heal(amount, 0)
    };
    b.push(1_000, shaman, tank, 61295, EventKind::Heal(periodic(500)));
    b.push(1_000, shaman, tank, 1064, EventKind::Heal(heal(800, 0)));
    b.push(
        1_000,
        shaman,
        tank,
        EBON_MIGHT,
        EventKind::Heal(Heal {
            supporter: evoker,
            ..periodic(50)
        }),
    );
    let absorb = |absorb_spell, amount, supporter| {
        EventKind::Absorbed(Absorbed {
            absorber: shaman,
            absorb_spell,
            amount,
            supporter,
        })
    };
    b.push(2_000, boss, tank, 9, absorb(114893, 1_000, NOBODY));
    b.push(2_001, boss, tank, 9, absorb(413984, 100, evoker));
    let report = healing(&b.build(), &whole(Attribution::Reattributed));
    let p = report.players.iter().find(|p| p.player == shaman).unwrap();
    let rows: Vec<_> = p
        .abilities
        .iter()
        .map(|a| (a.spell, a.amount, a.support))
        .collect();
    assert_eq!(
        rows,
        [(114893, 900, 100), (1064, 800, 0), (61295, 450, 50)],
        "the HoT tick owns the periodic support, the shield the absorb support"
    );
    let giver = report.players.iter().find(|p| p.player == evoker).unwrap();
    assert_eq!(
        giver
            .support_credited_by_buff
            .iter()
            .map(|b| (b.buff, b.amount))
            .collect::<Vec<_>>(),
        [(413984, 100), (EBON_MIGHT, 50)]
    );
}

#[test]
fn every_row_set_adds_up_to_its_total() {
    let mut r = raid();
    r.b.push(1_000, r.mage, r.boss, PYROBLAST, spell_hit(1_000));
    r.b.push(
        1_000,
        r.mage,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 100, r.evoker),
    );
    r.b.push(
        1_500,
        r.mage,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 7, r.evoker),
    );
    r.b.push(2_000, r.evoker, r.boss, 357208, spell_hit(600));
    r.b.push(
        2_000,
        r.evoker,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 60, r.evoker),
    );
    let fight = r.b.build();
    for mode in [Attribution::Augmented, Attribution::Reattributed] {
        let report = damage_done(&fight, &whole(mode));
        for p in &report.players {
            assert_eq!(
                p.abilities.iter().map(|a| a.amount).sum::<i64>(),
                p.total as i64,
                "{mode:?}"
            );
        }
    }
}

fn detail(fight: &Fight, player: ActorId) -> openlogs_analysis::PlayerDetail {
    player_detail(
        fight,
        &Curated::bundled(),
        player,
        Metric::Damage,
        &whole(Attribution::Reattributed),
        &Scope::default(),
    )
    .unwrap()
}

#[test]
fn the_evokers_support_rows_open_into_players_and_their_abilities() {
    let mut r = raid();
    let warrior = r.b.player("Player-4", "Wendel-Emberfall-EU", 71);
    r.b.spell(12294, "Mortal Strike");
    r.b.spell(357208, "Fire Breath");
    r.b.push(1_000, r.mage, r.boss, PYROBLAST, spell_hit(1_000));
    r.b.push(
        1_000,
        r.mage,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 100, r.evoker),
    );
    r.b.push(1_100, r.mage, r.boss, FIRE_BLAST, spell_hit(500));
    r.b.push(
        1_100,
        r.mage,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 50, r.evoker),
    );
    r.b.push(1_200, warrior, r.boss, 12294, spell_hit(3_000));
    r.b.push(
        1_200,
        warrior,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 300, r.evoker),
    );
    r.b.push(
        1_900,
        warrior,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 5, r.evoker),
    );
    r.b.push(2_000, r.evoker, r.boss, 357208, spell_hit(600));
    r.b.push(
        2_000,
        r.evoker,
        r.boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 60, r.evoker),
    );
    let fight = r.b.build();
    let page = detail(&fight, r.evoker);
    let ebon = page
        .abilities
        .iter()
        .find(|a| a.row.kind == RowKind::SupportGiven)
        .unwrap();
    assert_eq!(ebon.row.amount, 515, "his own share included");
    let tree: Vec<_> = ebon
        .recipients
        .iter()
        .map(|p| {
            (
                p.player,
                p.amount,
                p.abilities
                    .iter()
                    .map(|(a, amount)| (a.map(|a| a.spell), *amount))
                    .collect::<Vec<_>>(),
            )
        })
        .collect();
    assert_eq!(
        tree,
        [
            (warrior, 305, vec![(Some(12294), 300), (None, 5)]),
            (
                r.mage,
                150,
                vec![(Some(PYROBLAST), 100), (Some(FIRE_BLAST), 50)]
            ),
            (r.evoker, 60, vec![(Some(357208), 60)]),
        ]
    );
    let breath = page
        .abilities
        .iter()
        .find(|a| a.row.spell == 357208)
        .unwrap();
    assert_eq!((breath.row.amount, breath.row.support), (540, 60));
    assert_eq!(
        page.support_received, 0,
        "his own buff share is not support received"
    );
    assert_eq!(
        page.augmentation.iter().map(|a| a.support).sum::<u64>(),
        455
    );
}
