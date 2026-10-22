use std::collections::{BTreeMap, HashMap};

use openlogs_parser::Timestamp;

use crate::model::WorldMarker;

/// The logging client writes the removals of a marker set up to this long before the
/// `ZONE_CHANGE` that leaves the instance.
const LEAVING_REMOVAL_MICROS: i64 = 10_000_000;

/// World markers the log shows as active, with those it hides while the player is away.
#[derive(Clone, Default)]
pub(crate) struct MarkerState {
    instance: Option<u32>,
    active: BTreeMap<u8, WorldMarker>,
    /// Removals since the last placement, which may turn out to be the log hiding the
    /// markers because the player is leaving.
    removed: Vec<(Timestamp, WorldMarker)>,
    hidden: HashMap<u32, BTreeMap<u8, WorldMarker>>,
}

impl MarkerState {
    pub(crate) fn place(&mut self, instance_id: u32, marker: WorldMarker) {
        // Without a ZONE_CHANGE there is no instance to filter against.
        if self.instance.is_none_or(|current| current == instance_id) {
            self.removed.clear();
            self.active.insert(marker.marker, marker);
        }
    }

    pub(crate) fn remove(&mut self, at: Timestamp, marker: u8) {
        if let Some(marker) = self.active.remove(&marker) {
            self.removed.push((at, marker));
        }
    }

    pub(crate) fn change_zone(&mut self, at: Timestamp, zone_id: u32) {
        if self.instance != Some(zone_id) {
            if let Some(left) = self.instance {
                let hidden = self
                    .removed
                    .iter()
                    .filter(|(removed_at, _)| at.0 - removed_at.0 <= LEAVING_REMOVAL_MICROS)
                    .map(|(_, marker)| (marker.marker, *marker))
                    .collect();
                self.hidden.insert(left, hidden);
            }
            self.removed.clear();
            self.active = self.hidden.remove(&zone_id).unwrap_or_default();
        }
        self.instance = Some(zone_id);
    }

    pub(crate) fn active(&self) -> Vec<WorldMarker> {
        self.active.values().copied().collect()
    }
}
