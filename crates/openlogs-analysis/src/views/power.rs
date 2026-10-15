use std::collections::{BTreeMap, HashSet};

use crate::actors::ActorId;
use crate::breakdown::RowKey;
use crate::fight::{Fight, PowerSample};
use crate::filter::ReportFilter;
use crate::resources::{dead_phases, gains, samples_by_track};
use crate::scope::{Scope, unit_of};
use crate::views::timeline::Lanes;
use crate::views::{PowerLine, Window};

/// A line keeps every sample up to this many in the window; above it, each of `BUCKETS` time
/// buckets keeps its first, lowest, highest and last sample, so no extreme is lost.
const MAX_SAMPLES: usize = 1_200;
const BUCKETS: i32 = 300;

fn pct(sample: &PowerSample) -> f64 {
    if sample.max > 0 {
        sample.current as f64 / sample.max as f64
    } else {
        sample.current as f64
    }
}

/// The samples a line draws in the window: those inside it and one on either side, so the line
/// reaches the edges. Never averaged: every kept sample is one the log holds.
pub(crate) fn window_samples(samples: &[PowerSample], window: Window) -> Vec<(i32, i64, i64)> {
    let from = samples
        .partition_point(|s| s.t < window.start_ms)
        .saturating_sub(1);
    let to = (samples.partition_point(|s| s.t <= window.end_ms) + 1).min(samples.len());
    let shown = &samples[from..to.max(from)];
    let kept: Vec<&PowerSample> = if shown.len() <= MAX_SAMPLES {
        shown.iter().collect()
    } else {
        let span = i64::from((window.end_ms - window.start_ms).max(1));
        let bucket_of = |t: i32| {
            (i64::from(t - window.start_ms) * i64::from(BUCKETS) / span)
                .clamp(-1, i64::from(BUCKETS))
        };
        let mut kept: Vec<usize> = Vec::new();
        let mut i = 0;
        while i < shown.len() {
            let bucket = bucket_of(shown[i].t);
            let mut j = i;
            while j < shown.len() && bucket_of(shown[j].t) == bucket {
                j += 1;
            }
            let part = i..j;
            let low = part
                .clone()
                .min_by(|&a, &b| pct(&shown[a]).total_cmp(&pct(&shown[b])))
                .unwrap_or(i);
            let high = part
                .clone()
                .max_by(|&a, &b| pct(&shown[a]).total_cmp(&pct(&shown[b])))
                .unwrap_or(i);
            kept.extend([i, low, high, j - 1]);
            i = j;
        }
        kept.sort_unstable();
        kept.dedup();
        kept.into_iter().map(|k| &shown[k]).collect()
    };
    kept.into_iter().map(|s| (s.t, s.current, s.max)).collect()
}

/// Resources lanes: one per unit with its power and health as logged, health last, and when it
/// was dead. An ability selection keeps the units that gained from it.
pub(crate) fn lanes(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    window: Window,
    lanes: &mut Lanes,
) {
    let (start, end) = filter.clipped(fight);
    let side = scope.perspective;
    let holders = Scope {
        target: Vec::new(),
        ability: Vec::new(),
        ..scope.clone()
    };
    let gaining = Scope {
        target: Vec::new(),
        ..scope.clone()
    };
    let gained: Option<HashSet<ActorId>> = (!scope.ability.is_empty()).then(|| {
        gains(fight, start, end)
            .into_iter()
            .filter(|((unit, _), by_spell)| {
                let holder = unit_of(fight, *unit);
                by_spell
                    .keys()
                    .any(|&spell| gaining.accepts(fight, Some(&holder), Some(spell), None))
            })
            .map(|((unit, _), _)| unit)
            .collect()
    });
    let mut units: BTreeMap<ActorId, Vec<PowerLine>> = BTreeMap::new();
    for ((unit, power_type), samples) in samples_by_track(fight, side, start, end) {
        let holder = unit_of(fight, unit);
        if !holders.accepts(fight, Some(&holder), None, None)
            || gained.as_ref().is_some_and(|units| !units.contains(&unit))
        {
            continue;
        }
        units.entry(unit).or_default().push(PowerLine {
            power_type,
            samples: window_samples(&samples, window),
        });
    }
    let dead = dead_phases(
        fight,
        side,
        |unit| units.contains_key(&unit),
        window.start_ms,
        window.end_ms,
    );
    for (unit, mut power) in units {
        power.sort_by_key(|line| (line.power_type == crate::resources::HEALTH, line.power_type));
        let key = Some(RowKey::Unit(unit_of(fight, unit)));
        lanes.order(key.clone(), -i64::from(unit));
        let lane = lanes.lane(key);
        lane.power = power;
        lane.dead = dead.get(&unit).cloned().unwrap_or_default();
    }
}
