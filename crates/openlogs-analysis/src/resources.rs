use crate::actors::ActorId;
use crate::fight::{Fight, PowerSample};

fn pct(sample: &PowerSample) -> Option<f32> {
    (sample.max > 0)
        .then(|| (sample.current as f64 * 100.0 / sample.max as f64).clamp(0.0, 100.0) as f32)
}

fn steps(start: i32, end: i32, step_ms: u32) -> usize {
    ((end - start).max(0) as u32).div_ceil(step_ms) as usize
}

/// Percent of max per step from the player's samples in `[start, end)`: the last sample in
/// each step. Power is a state, not a rate: steps between two samples keep the last value.
/// Empty without samples.
pub(crate) fn power_series(
    fight: &Fight,
    player: ActorId,
    power_type: i32,
    start: i32,
    end: i32,
    step_ms: u32,
) -> Vec<Option<f32>> {
    let mut series = vec![None; steps(start, end, step_ms)];
    let mut any = false;
    for sample in fight
        .power
        .iter()
        .filter(|p| p.actor == player && p.power_type == power_type && p.t >= start && p.t < end)
    {
        series[((sample.t - start) as u32 / step_ms) as usize] = pct(sample);
        any = true;
    }
    if !any {
        return Vec::new();
    }
    let first = series.iter().position(Option::is_some);
    let last = series.iter().rposition(Option::is_some);
    if let (Some(first), Some(last)) = (first, last) {
        for i in first + 1..=last {
            if series[i].is_none() {
                series[i] = series[i - 1];
            }
        }
    }
    series
}
