use openlogs_analysis::{Fight, MarkerInterval, load_fight};
use openlogs_index::index_bytes;

const VERSION: &str = "9/6/2026 11:50:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1";
const ZONE: &str = "9/6/2026 11:50:00.0000  ZONE_CHANGE,3004,\"Test Zone\",15";
const PULL: &str = "9/6/2026 11:53:00.0000  ENCOUNTER_START,3129,\"Training Boss\",15,20,3004";
const END: &str = "9/6/2026 11:53:10.0000  ENCOUNTER_END,3129,\"Training Boss\",15,20,1,10000";

const PLAYER: &str = "Player-1-0000000A";
const BOSS: &str = "Creature-0-1-3004-1-259181-0000000001";
const KNOWN_BLOCK: &str =
    "783469,850360,981,3238,2628,1416,0,0,0,251142,267750,5500,417.55,-297.97,2608,2.0554,315";
const UNKNOWN_BLOCK: &str =
    "783469,850360,981,3238,2628,1416,0,0,0,251142,267750,5500,0.00,0.00,0,0.0000,315";

fn cast(second: u32, block: &str) -> String {
    format!(
        "9/6/2026 11:53:{second:02}.0000  SPELL_CAST_SUCCESS,{PLAYER},\"Alpha-Realm\",0x514,0x80000000,0000000000000000,nil,0x80000000,0x80000000,98008,\"Totem\",0x8,{PLAYER},0000000000000000,{block}"
    )
}

fn hit_on_boss(second: u32, target_raid_flags: &str, block: &str) -> String {
    format!(
        "9/6/2026 11:53:{second:02}.0000  SPELL_DAMAGE,{PLAYER},\"Alpha-Realm\",0x514,0x80000000,{BOSS},\"Training Boss\",0x10a48,{target_raid_flags},30451,\"Arcane Blast\",0x40,{BOSS},0000000000000000,{block},93,9088,8823,-1,64,0,0,0,nil,nil,nil,ST"
    )
}

fn load(lines: &[String]) -> Fight {
    let mut text = lines.join("\n");
    text.push('\n');
    let index = index_bytes(text.as_bytes());
    assert_eq!(index.fights.len(), 1);
    load_fight(text.as_bytes(), &index.fights[0])
}

fn pull(lines: &[String]) -> Fight {
    let mut all = vec![VERSION.to_string(), ZONE.to_string(), PULL.to_string()];
    all.extend_from_slice(lines);
    all.push(END.to_string());
    load(&all)
}

#[test]
fn a_cast_positions_its_source() {
    let fight = pull(&[cast(2, KNOWN_BLOCK)]);
    let player = fight.actors.id(PLAYER).unwrap();
    assert_eq!(fight.positions.len(), 1);
    let sample = fight.positions[0];
    assert_eq!(
        (sample.t, sample.actor, sample.x, sample.y, sample.facing),
        (2_000, player, 417.55, -297.97, 2.0554)
    );
    assert_eq!(fight.ui_map_id, Some(2608));
}

#[test]
fn a_damage_event_positions_the_unit_its_block_describes() {
    let block = "636358512,636367600,0,0,1470,0,0,0,3,75,100,0,439.95,-295.55,2608,4.7124";
    let fight = pull(&[hit_on_boss(2, "0x80000000", block)]);
    let boss = fight.actors.id(BOSS).unwrap();
    assert_eq!(fight.positions.len(), 1);
    let sample = fight.positions[0];
    assert_eq!((sample.actor, sample.x, sample.y), (boss, 439.95, -295.55));
}

#[test]
fn an_unknown_position_is_not_stored() {
    let fight = pull(&[cast(2, UNKNOWN_BLOCK)]);
    assert!(fight.positions.is_empty());
    assert_eq!(fight.ui_map_id, None);
}

#[test]
fn raid_flags_become_marker_intervals() {
    let block = "636358512,636367600,0,0,1470,0,0,0,3,75,100,0,439.95,-295.55,2608,4.7124";
    let fight = pull(&[
        hit_on_boss(1, "0x80000008", block),
        hit_on_boss(3, "0x80000008", block),
        hit_on_boss(4, "0x80000000", block),
    ]);
    let boss = fight.actors.id(BOSS).unwrap();
    assert_eq!(
        fight.raid_markers,
        [MarkerInterval {
            actor: boss,
            marker: 4,
            start_ms: 1_000,
            end_ms: 4_000
        }]
    );
}

#[test]
fn the_lowest_raid_target_bit_picks_the_marker_and_open_ones_end_with_the_fight() {
    let block = "636358512,636367600,0,0,1470,0,0,0,3,75,100,0,439.95,-295.55,2608,4.7124";
    let fight = pull(&[
        hit_on_boss(1, "0x80000001", block),
        hit_on_boss(2, "0x80000080", block),
        hit_on_boss(3, "0x80000060", block),
    ]);
    let boss = fight.actors.id(BOSS).unwrap();
    let markers: Vec<_> = fight
        .raid_markers
        .iter()
        .map(|m| (m.actor, m.marker, m.start_ms, m.end_ms))
        .collect();
    assert_eq!(
        markers,
        [
            (boss, 1, 1_000, 2_000),
            (boss, 8, 2_000, 3_000),
            (boss, 6, 3_000, 10_000)
        ]
    );
}

#[test]
fn world_markers_span_the_pull() {
    let placed_before = "9/6/2026 11:51:00.0000  WORLD_MARKER_PLACED,3004,5,387.15,436.06";
    let placed_in_prelude = "9/6/2026 11:52:55.0000  WORLD_MARKER_PLACED,3004,6,1.00,2.00";
    let removed = "9/6/2026 11:53:02.0000  WORLD_MARKER_REMOVED,5";
    let placed = "9/6/2026 11:53:03.0000  WORLD_MARKER_PLACED,3004,2,100.50,200.50";
    let fight = load(&[
        VERSION.to_string(),
        ZONE.to_string(),
        placed_before.to_string(),
        placed_in_prelude.to_string(),
        PULL.to_string(),
        removed.to_string(),
        placed.to_string(),
        END.to_string(),
    ]);
    let markers: Vec<_> = fight
        .world_markers
        .iter()
        .map(|m| (m.marker, m.x, m.y, m.start_ms, m.end_ms))
        .collect();
    assert_eq!(
        markers,
        [
            (5, 387.15, 436.06, 0, 2_000),
            (6, 1.0, 2.0, 0, 10_000),
            (2, 100.5, 200.5, 3_000, 10_000),
        ]
    );
}
