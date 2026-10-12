use openlogs_gamedata::{PhaseConfig, PhaseTrigger};
use openlogs_index::Outcome;

use crate::fight::{EventKind, Fight};
use crate::timeline::{ABORTED_PULL_MS, Phase, PhaseKind};

/// Named phases from a config. Each trigger is searched strictly after the previous
/// phase started; phases whose trigger never fires within the pull are skipped.
pub fn configured_phases(
    fight: &Fight,
    config: &PhaseConfig,
    boss_hp: &[Option<f32>],
    step_ms: u32,
) -> Vec<Phase> {
    let duration = fight.duration_ms.min(u64::from(u32::MAX)) as u32;
    let mut starts: Vec<(String, u32)> = Vec::new();
    let mut after: i64 = -1;
    for rule in &config.phases {
        let found = match &rule.start {
            PhaseTrigger::Pull => (after < 0).then_some(0),
            PhaseTrigger::Cast { spell_id } => fight
                .events
                .iter()
                .find(|e| {
                    i64::from(e.t) > after
                        && e.spell == *spell_id
                        && matches!(e.kind, EventKind::CastStart | EventKind::CastSuccess)
                        && fight.actors.credited_player(e.source).is_none()
                })
                .map(|e| e.t as u32),
            PhaseTrigger::BossHpBelow { percent } => boss_hp
                .iter()
                .enumerate()
                .map(|(i, v)| (i as u32 * step_ms, v))
                .find(|&(t, v)| i64::from(t) > after && v.is_some_and(|v| v < *percent as f32))
                .map(|(t, _)| t),
            PhaseTrigger::UnitAppears { name } => fight
                .events
                .iter()
                .find(|e| {
                    i64::from(e.t) > after
                        && [e.source, e.target]
                            .iter()
                            .any(|&a| fight.actors.get(a).name.as_deref() == Some(name.as_str()))
                })
                .map(|e| e.t as u32),
        };
        if let Some(t) = found.filter(|&t| t < duration) {
            starts.push((rule.name.clone(), t));
            after = i64::from(t);
        }
    }
    starts
        .iter()
        .enumerate()
        .map(|(i, (name, start))| Phase {
            kind: PhaseKind::Boss,
            number: i as u32 + 1,
            start_ms: *start,
            end_ms: starts.get(i + 1).map_or(duration, |next| next.1),
            name: Some(name.clone()),
        })
        .collect()
}

/// Phases of a Mythic+ run: each boss encounter is a phase named after
/// its boss, and the time around them is trash. Together they cover the run without gaps or
/// overlaps. An aborted boss pull (a non-kill under [`ABORTED_PULL_MS`]) counts as trash.
pub fn run_phases(fight: &Fight) -> Vec<Phase> {
    let duration = fight.duration_ms.min(u64::from(u32::MAX)) as u32;
    let clamp = |ms: i32| u32::try_from(ms).unwrap_or(0).min(duration);
    let mut phases: Vec<Phase> = Vec::new();
    let mut cursor = 0;
    for encounter in &fight.encounters {
        let start = clamp(encounter.start_ms).max(cursor);
        let end = clamp(encounter.end_ms).max(start);
        let aborted =
            encounter.outcome != Outcome::Kill && u64::from(end - start) < ABORTED_PULL_MS;
        if end == start || aborted {
            continue;
        }
        if start > cursor {
            phases.push(numbered(&phases, PhaseKind::Trash, cursor, start, None));
        }
        let name = Some(encounter.name.clone());
        phases.push(numbered(&phases, PhaseKind::Boss, start, end, name));
        cursor = end;
    }
    if cursor < duration || phases.is_empty() {
        phases.push(numbered(&phases, PhaseKind::Trash, cursor, duration, None));
    }
    phases
}

/// A phase numbered after the earlier phases of its kind.
fn numbered(
    earlier: &[Phase],
    kind: PhaseKind,
    start_ms: u32,
    end_ms: u32,
    name: Option<String>,
) -> Phase {
    Phase {
        kind,
        number: earlier.iter().filter(|phase| phase.kind == kind).count() as u32 + 1,
        start_ms,
        end_ms,
        name,
    }
}
