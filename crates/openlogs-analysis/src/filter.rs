use crate::deaths::nth_death_ms;
use crate::fight::Fight;

/// How Augmentation Evoker support is credited.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Attribution {
    /// As logged: the buffed player keeps the full hit.
    Augmented,
    /// The Evoker's share moves from the buffed player to the Evoker.
    Reattributed,
}

/// Whether damage done counts the overkill of a killing hit, the part beyond the target's HP.
/// Damage taken always does.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Overkill {
    #[default]
    Excluded,
    Included,
}

impl Overkill {
    pub fn included_if(include: bool) -> Self {
        if include {
            Self::Included
        } else {
            Self::Excluded
        }
    }
}

/// Time range (ms since `ENCOUNTER_START`, half-open `[start, end)`), attribution mode and
/// overkill rule for every report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReportFilter {
    pub start_ms: i32,
    pub end_ms: i32,
    pub attribution: Attribution,
    pub overkill: Overkill,
}

impl ReportFilter {
    /// The whole pull from `ENCOUNTER_START` on.
    pub fn whole(attribution: Attribution) -> Self {
        Self {
            start_ms: 0,
            end_ms: i32::MAX,
            attribution,
            overkill: Overkill::default(),
        }
    }

    /// Ends the range with the whole millisecond of the `death`th player death; unchanged
    /// when `death` is `None` or the pull has fewer deaths.
    pub fn cut_at_death(self, fight: &Fight, death: Option<u32>) -> Self {
        self.cut_after(death.and_then(|n| nth_death_ms(fight, n)))
    }

    /// Ends the range with the whole millisecond of a death at `death_ms`; unchanged for `None`.
    pub fn cut_after(self, death_ms: Option<i32>) -> Self {
        let Some(t) = death_ms else {
            return self;
        };
        Self {
            end_ms: self.end_ms.min(t.saturating_add(1)),
            ..self
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
