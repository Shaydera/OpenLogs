use crate::replay::Track;

/// Over this gap between samples a unit's position is not backed by the log.
const STALE_MS: i32 = 2_000;

/// Where the unit of `track` was at `t`, interpolated linearly; `None` before its first sample,
/// inside a sample gap over [`STALE_MS`] and once more than [`STALE_MS`] past its last sample.
pub(crate) fn position_at(track: &Track, t: i32) -> Option<(f32, f32)> {
    let after = track.t.partition_point(|&sample| sample <= t);
    let i = after.checked_sub(1)?;
    let held = (track.x[i], track.y[i]);
    // A sample at `t` is exact even when a long gap follows it.
    if track.t[i] == t {
        return Some(held);
    }
    let Some(&next_t) = track.t.get(after) else {
        return (t - track.t[i] <= STALE_MS).then_some(held);
    };
    let gap = next_t - track.t[i];
    if gap > STALE_MS {
        return None;
    }
    let f = (t - track.t[i]) as f32 / gap as f32;
    Some((
        held.0 + (track.x[after] - held.0) * f,
        held.1 + (track.y[after] - held.1) * f,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(samples: &[(i32, f32)]) -> Track {
        Track {
            actor: 1,
            t: samples.iter().map(|s| s.0).collect(),
            x: samples.iter().map(|s| s.1).collect(),
            y: vec![0.0; samples.len()],
            facing: vec![0.0; samples.len()],
            map: vec![0; samples.len()],
        }
    }

    #[test]
    fn interpolates_between_close_samples_only() {
        let track = track(&[(1_000, 0.0), (2_000, 10.0), (5_000, 40.0)]);
        assert_eq!(position_at(&track, 999), None);
        assert_eq!(position_at(&track, 1_500), Some((5.0, 0.0)));
        assert_eq!(position_at(&track, 3_000), None, "inside a 3 s gap");
        assert_eq!(position_at(&track, 2_000), Some((10.0, 0.0)));
        assert_eq!(position_at(&track, 7_000), Some((40.0, 0.0)));
        assert_eq!(position_at(&track, 7_001), None);
    }
}
