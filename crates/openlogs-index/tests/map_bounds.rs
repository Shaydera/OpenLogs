//! Which map bounds the log has written when a pull starts.

use openlogs_index::{MapBounds, index_bytes};

const VERSION: &str = "10/7/2026 18:50:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1";
const ZONE: &str = "10/7/2026 18:50:00.0000  ZONE_CHANGE,3004,\"The Venomous Abyss\",15";
const PULL: &str = "10/7/2026 19:21:00.0000  ENCOUNTER_START,3129,\"Test Boss\",15,20,3004";

fn map_change(time: &str, id: u32, max_x: f32, min_x: f32, max_y: f32, min_y: f32) -> String {
    format!(
        "10/7/2026 {time}  MAP_CHANGE,{id},\"Somewhere\",{max_x:.6},{min_x:.6},{max_y:.6},{min_y:.6}"
    )
}

fn bounds_at_pull(lines: &[String]) -> Vec<MapBounds> {
    let mut text = lines.join("\n");
    text.push('\n');
    let index = index_bytes(text.as_bytes());
    assert_eq!(index.fights.len(), 1);
    index.fights[0].map_bounds.clone()
}

fn bounds(ui_map_id: u32, max_x: f32, min_x: f32, max_y: f32, min_y: f32) -> MapBounds {
    MapBounds {
        ui_map_id,
        min_x,
        max_x,
        min_y,
        max_y,
    }
}

#[test]
fn map_bounds_written_before_a_pull_reach_it() {
    let lines = [
        VERSION.to_string(),
        ZONE.to_string(),
        map_change("18:53:00.0000", 2608, 885.0, 265.0, 127.5, -802.5),
        map_change("18:54:00.0000", 2500, 100.0, -100.0, 50.0, -50.0),
        map_change("18:55:00.0000", 2608, 900.0, 270.0, 130.0, -800.0),
        PULL.to_string(),
    ];
    assert_eq!(
        bounds_at_pull(&lines),
        [
            bounds(2500, 100.0, -100.0, 50.0, -50.0),
            bounds(2608, 900.0, 270.0, 130.0, -800.0)
        ]
    );
}

#[test]
fn map_bounds_after_the_pull_start_are_not_in_its_summary() {
    let lines = [
        VERSION.to_string(),
        ZONE.to_string(),
        map_change("18:53:00.0000", 2608, 885.0, 265.0, 127.5, -802.5),
        PULL.to_string(),
        map_change("19:21:05.0000", 2608, 900.0, 270.0, 130.0, -800.0),
        map_change("19:21:06.0000", 2500, 100.0, -100.0, 50.0, -50.0),
    ];
    assert_eq!(
        bounds_at_pull(&lines),
        [bounds(2608, 885.0, 265.0, 127.5, -802.5)]
    );
}
