use openlogs_gamedata::{PhaseConfig, PhaseTrigger};

use crate::fight::{EventKind, Fight};
use crate::timeline::{Phase, PhaseKind};

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
