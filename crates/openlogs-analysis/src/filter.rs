use crate::fight::Fight;

/// How Augmentation Evoker support is credited.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Attribution {
    /// As logged: the buffed player keeps the full hit.
    Augmented,
    /// The Evoker's share moves from the buffed player to the Evoker.
    Reattributed,
}

/// Time range (ms since `ENCOUNTER_START`, half-open `[start, end)`) and attribution mode
/// for every report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReportFilter {
    pub start_ms: i32,
    pub end_ms: i32,
    pub attribution: Attribution,
}

impl ReportFilter {
    /// The whole pull from `ENCOUNTER_START` on.
    pub fn whole(attribution: Attribution) -> Self {
        Self {
            start_ms: 0,
            end_ms: i32::MAX,
            attribution,
        }
    }

    pub fn contains(&self, t: i32) -> bool {
        t >= self.start_ms && t < self.end_ms
    }

    /// Length of the range clipped to the pull; 0 for empty or inverted ranges.
    pub fn duration_ms(&self, fight: &Fight) -> u64 {
        let start = i64::from(self.start_ms).max(0);
        let end = i64::from(self.end_ms).min(fight.duration_ms as i64);
        (end - start).max(0) as u64
    }

    /// The range clipped to the pull: start ≥ 0, end ≤ duration and never before start.
    pub fn clipped(&self, fight: &Fight) -> (i32, i32) {
        let start = self.start_ms.max(0);
        let end = (i64::from(self.end_ms).min(fight.duration_ms as i64) as i32).max(start);
        (start, end)
    }
}
