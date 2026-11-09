mod support;

use openlogs_analysis::{
    Attribution, EventKind, FightKind, NOBODY, ReportFilter, Scope, Side, boss_units,
    deaths_report, listed_player, load_fight, quick_overview,
};
use openlogs_gamedata::Curated;
use openlogs_index::{FightSummary, Outcome, index_bytes};
use support::{FightBuilder, HOSTILE_FLAGS};

const OPEN_WORLD: &str = include_str!("../../openlogs-index/tests/fixtures/forever_open_world.txt");
const LOGGER: &str = "Player-6949-0066C9DA";

fn open_world_pull() -> FightSummary {
    index_bytes(OPEN_WORLD.as_bytes())
        .fights
        .into_iter()
        .find(FightSummary::is_combat)
        .expect("the fixture has a combat pull")
}

fn combat_pull(duration_ms: u64) -> FightBuilder {
    let mut b = FightBuilder::new(duration_ms);
    b.fight.kind = FightKind::Combat;
    b.fight.encounter_id = 0;
    b.fight.name = "Murloc Brute".into();
    b
}

#[test]
fn combat_pull_has_no_boss_units_or_made_up_deaths() {
    let mut b = combat_pull(30_000);
    let rogue = b.player("Player-1", "Ravel-Ashwood-EU", 259);
    let brute = b.unit("Creature-0-1-1-1-1-0001", "Murloc Brute", HOSTILE_FLAGS);
    let minion = b.unit("Creature-0-1-1-1-2-0002", "Murloc Minion", HOSTILE_FLAGS);
    let strike = b.spell(1752, "Sinister Strike");
    b.hit(1_000, rogue, brute, strike, 50_000, (950_000, 1_000_000));
    b.hit(2_000, rogue, minion, strike, 5_000, (0, 5_000));
    b.push(
        2_000,
        NOBODY,
        minion,
        0,
        EventKind::Died { unconscious: false },
    );
    b.fight.outcome = Outcome::Kill;
    let fight = b.build();

    assert!(boss_units(&fight).is_empty());
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let report = deaths_report(
        &fight,
        &Curated::bundled(),
        &ReportFilter::whole(Attribution::Augmented),
        &enemies,
    );
    let killed: Vec<_> = report.kills.iter().map(|kill| kill.unit).collect();
    assert_eq!(killed, [minion]);
}

#[test]
fn combat_pull_lists_the_players_who_fought() {
    let summary = open_world_pull();
    let fight = load_fight(OPEN_WORLD.as_bytes(), &summary);
    let listed = |guid: &str| listed_player(&fight, fight.actors.id(guid).expect("in the log"));

    assert!(listed(LOGGER), "the logger fought without COMBATANT_INFO");
    assert!(listed("Player-6941-006597A9"), "an outsider who fought");
    assert!(
        !listed("Player-6947-0066B6FD"),
        "only refreshed his own seal"
    );
    assert!(
        !listed("Player-6939-002654D1"),
        "fought neutral mobs before the pull"
    );
    let overview = quick_overview(&fight, &Curated::bundled());
    assert_eq!(overview.kpis.players as usize, summary.roster.len());
}

#[test]
fn combat_pull_uses_the_roster_spec() {
    let mut summary = open_world_pull();
    summary
        .roster
        .iter_mut()
        .find(|entry| entry.guid == LOGGER)
        .expect("the logger fought")
        .spec_id = 259;

    let fight = load_fight(OPEN_WORLD.as_bytes(), &summary);
    assert_eq!(fight.kind, FightKind::Combat);
    let id = fight.actors.id(LOGGER).expect("the logger is an actor");
    assert_eq!(fight.actors.get(id).spec_id, Some(259));
}
