mod support;

use openlogs_analysis::{
    ActorId, ContextItem, ContextState, DeathContext, EventKind, Fight, NOBODY, consumable_uses,
    cooldown_uses, death_context, deaths, defensive_uses,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, MELEE};

fn cast(b: &mut FightBuilder, t: i32, source: u32, spell_id: u32, name: &str) {
    let spell = b.spell(spell_id, name);
    b.push(t, source, NOBODY, spell, EventKind::CastSuccess);
}

fn die(b: &mut FightBuilder, t: i32, player: ActorId) {
    b.push(
        t,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
}

/// The context of every death of the fight, in death order.
fn contexts(fight: &Fight, curated: &Curated) -> Vec<Vec<DeathContext>> {
    let consumables = consumable_uses(fight, curated);
    let defensives = defensive_uses(fight, curated);
    deaths(fight)
        .iter()
        .map(|death| death_context(fight, curated, death, &consumables, &defensives))
        .collect()
}

#[test]
fn repeated_casts_within_five_seconds_are_one_use() {
    let curated = Curated::bundled();
    let mut b = FightBuilder::new(300_000);
    let druid = b.player("Player-1", "Pyrrin-Emberfall-EU", 105);
    for t in [10_000, 10_500, 11_000, 200_000] {
        cast(&mut b, t, druid, 740, "Tranquility");
    }
    let dh = b.player("Player-2", "Morvain-Emberfall-EU", 1480);
    cast(&mut b, 800, dh, 370965, "The Hunt");
    cast(&mut b, 1_400, dh, 1246167, "The Hunt");
    let uses = cooldown_uses(&b.build(), &curated);
    let times: Vec<_> = uses.iter().map(|u| (u.player, u.t)).collect();
    assert_eq!(times, [(dh, 800), (druid, 10_000), (druid, 200_000)]);
}

#[test]
fn death_context_reports_used_on_cooldown_and_available() {
    let curated = Curated::bundled();
    let mut b = FightBuilder::new(300_000);
    let dk = b.player("Player-1", "Rothgar-Emberfall-EU", 251);
    let lock = b.player("Player-2", "Årvel-Emberfall-EU", 266);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    cast(&mut b, -2_000, dk, 1236994, "Potion of Recklessness");
    cast(&mut b, 52_000, dk, 6262, "Healthstone");
    cast(&mut b, 0, dk, 48707, "Anti-Magic Shell");
    cast(&mut b, 30_000, lock, 104773, "Unending Resolve");
    b.push(
        60_000,
        boss,
        dk,
        9,
        EventKind::Damage(support::damage(openlogs_analysis::DamageVia::Spell, 10, 5)),
    );
    b.push(
        60_000,
        NOBODY,
        dk,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let fight = b.build();
    let death = &deaths(&fight)[0];
    let consumables = consumable_uses(&fight, &curated);
    let defensives = defensive_uses(&fight, &curated);
    let context = death_context(&fight, &curated, death, &consumables, &defensives);
    assert_eq!(
        context,
        [
            DeathContext {
                item: ContextItem::Healthstone,
                state: ContextState::Used { t: 52_000 },
                spell: Some(6262),
            },
            DeathContext {
                // The pre-pot does not block it: health potions run their own cooldown.
                item: ContextItem::HealthPotion,
                state: ContextState::Available,
                spell: None,
            },
            DeathContext {
                item: ContextItem::CombatPotion,
                state: ContextState::OnCooldown { used_at: -2_000 },
                spell: Some(1236994),
            },
            DeathContext {
                item: ContextItem::Defensive(48792),
                state: ContextState::Available,
                spell: None,
            },
            DeathContext {
                item: ContextItem::Defensive(48707),
                state: ContextState::Available,
                spell: None,
            },
        ],
        "AMS (60 s) used 60 s earlier is available again; IBF (120 s) cannot be \"never used\" 60 s in"
    );
}

#[test]
fn a_defensive_not_used_although_ready_again_is_never_used() {
    let curated = Curated::bundled();
    let mut b = FightBuilder::new(478_610);
    let wendel = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    let early = b.player("Player-2", "Eyrin-Emberfall-EU", 577);
    let edge = b.player("Player-3", "Kaeren-Emberfall-EU", 577);
    let morvain = b.player("Player-4", "Morvain-Emberfall-EU", 577);
    // A warlock in the raid: every death gets a healthstone entry.
    let _lock = b.player("Player-5", "Årvel-Emberfall-EU", 266);
    die(&mut b, 33_200, wendel);
    die(&mut b, 59_999, early);
    die(&mut b, 60_000, edge);
    die(&mut b, 172_400, morvain);
    // Only after Wendel's death (a resurrected player): it does not count for that death.
    cast(&mut b, 233_000, wendel, 118038, "Die by the Sword");
    let fight = b.build();
    let all = contexts(&fight, &curated);
    let states: Vec<Option<ContextState>> = all
        .iter()
        .map(|context| {
            context
                .iter()
                .find(|c| matches!(c.item, ContextItem::Defensive(118038 | 198589)))
                .map(|c| c.state)
        })
        .collect();
    assert_eq!(
        states,
        [
            // Die by the Sword (120 s) could not have come back 33 s in.
            Some(ContextState::Available),
            // Blur (60 s): one millisecond short of a whole cooldown.
            Some(ContextState::Available),
            Some(ContextState::NeverUsed),
            Some(ContextState::NeverUsed),
        ]
    );
    // Consumables are never "never used": Morvain's stone and potion are simply unused.
    assert!(
        all[3]
            .iter()
            .filter(|c| !matches!(c.item, ContextItem::Defensive(_)))
            .all(|c| c.state == ContextState::Available),
        "{:?}",
        all[3]
    );
}
