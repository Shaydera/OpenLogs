//! Which world markers the log has active when a pull starts.

use openlogs_index::{WorldMarker, index_bytes};

const VERSION: &str = "10/7/2026 18:50:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1";
const ZONE: &str = "10/7/2026 18:50:00.0000  ZONE_CHANGE,3004,\"The Venomous Abyss\",15";
const PULL: &str = "10/7/2026 19:21:00.0000  ENCOUNTER_START,3129,\"Test Boss\",15,20,3004";

fn placed(time: &str, instance: u32, marker: u8, x: f32, y: f32) -> String {
    format!("10/7/2026 {time}  WORLD_MARKER_PLACED,{instance},{marker},{x:.2},{y:.2}")
}

fn removed(time: &str, marker: u8) -> String {
    format!("10/7/2026 {time}  WORLD_MARKER_REMOVED,{marker}")
}

fn markers_at_pull(lines: &[String]) -> Vec<WorldMarker> {
    let mut text = lines.join("\n");
    text.push('\n');
    let index = index_bytes(text.as_bytes());
    assert_eq!(index.fights.len(), 1);
    index.fights[0].world_markers.clone()
}

fn marker(marker: u8, x: f32, y: f32) -> WorldMarker {
    WorldMarker { marker, x, y }
}

#[test]
fn markers_placed_before_the_pull_are_active_at_its_start() {
    let lines = [
        VERSION.to_string(),
        ZONE.to_string(),
        placed("18:53:00.0000", 3004, 5, 387.15, 436.06),
        placed("18:53:01.0000", 3004, 3, 364.17, 422.32),
        PULL.to_string(),
    ];
    assert_eq!(
        markers_at_pull(&lines),
        [marker(3, 364.17, 422.32), marker(5, 387.15, 436.06)]
    );
}

#[test]
fn placing_an_active_marker_moves_it() {
    let lines = [
        VERSION.to_string(),
        ZONE.to_string(),
        placed("18:53:00.0000", 3004, 2, 100.0, 200.0),
        placed("18:54:00.0000", 3004, 2, 110.5, 210.5),
        PULL.to_string(),
    ];
    assert_eq!(markers_at_pull(&lines), [marker(2, 110.5, 210.5)]);
}

#[test]
fn removed_markers_and_other_instances_do_not_count() {
    let lines = [
        VERSION.to_string(),
        ZONE.to_string(),
        placed("18:53:00.0000", 3004, 1, 10.0, 20.0),
        placed("18:53:01.0000", 9999, 4, 30.0, 40.0),
        removed("18:54:00.0000", 1),
        PULL.to_string(),
    ];
    assert_eq!(markers_at_pull(&lines), []);
}

fn zone(time: &str, id: u32) -> String {
    format!("10/7/2026 {time}  ZONE_CHANGE,{id},\"Somewhere\",15")
}

#[test]
fn markers_removed_while_leaving_return_with_the_player() {
    let lines = [
        VERSION.to_string(),
        ZONE.to_string(),
        placed("14:14:46.0022", 3004, 0, 403.74, 416.47),
        placed("14:14:46.0022", 3004, 3, 372.46, 399.79),
        removed("14:15:00.5032", 0),
        removed("14:15:00.5032", 3),
        zone("14:15:03.1282", 2916),
        VERSION.to_string(),
        zone("14:15:16.4512", 3004),
        PULL.to_string(),
    ];
    assert_eq!(
        markers_at_pull(&lines),
        [marker(0, 403.74, 416.47), marker(3, 372.46, 399.79)]
    );
}

#[test]
fn leaving_without_removals_clears_the_markers() {
    let lines = [
        VERSION.to_string(),
        ZONE.to_string(),
        placed("18:53:00.0000", 3004, 6, 10.0, 20.0),
        zone("18:55:00.0000", 2810),
        zone("18:56:00.0000", 3004),
        PULL.to_string(),
    ];
    assert_eq!(markers_at_pull(&lines), []);
}

#[test]
fn a_removal_long_before_leaving_is_final() {
    let lines = [
        VERSION.to_string(),
        ZONE.to_string(),
        placed("13:10:00.0000", 3004, 2, 10.0, 20.0),
        removed("13:11:58.0000", 2),
        zone("13:13:11.0000", 2810),
        zone("13:14:00.0000", 3004),
        PULL.to_string(),
    ];
    assert_eq!(markers_at_pull(&lines), []);
}

#[test]
fn a_new_logging_session_keeps_the_markers() {
    let lines = [
        VERSION.to_string(),
        ZONE.to_string(),
        placed("18:53:00.0000", 3004, 6, 10.0, 20.0),
        VERSION.to_string(),
        PULL.to_string(),
    ];
    assert_eq!(markers_at_pull(&lines), [marker(6, 10.0, 20.0)]);
}

#[test]
fn a_placement_after_a_removal_makes_it_final() {
    let lines = [
        VERSION.to_string(),
        ZONE.to_string(),
        placed("18:53:00.0000", 3004, 1, 10.0, 20.0),
        placed("18:53:00.0000", 3004, 2, 30.0, 40.0),
        removed("18:55:00.0000", 1),
        placed("18:55:02.0000", 3004, 2, 31.0, 41.0),
        zone("18:55:05.0000", 2810),
        zone("18:56:00.0000", 3004),
        PULL.to_string(),
    ];
    assert_eq!(markers_at_pull(&lines), []);
}
