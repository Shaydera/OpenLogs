use std::collections::HashMap;

use openlogs_parser::{ChallengeModeEnd, CombatEvent};

use crate::model::{FightSummary, Outcome, RunKind};

#[derive(Clone)]
pub(crate) struct OpenRun {
    pub(crate) summary: FightSummary,
    /// Player names seen in the run's boss pulls.
    pub(crate) player_names: HashMap<String, String>,
    /// Outcome of the run's latest boss pull so far.
    pub(crate) last_pull: Option<Outcome>,
    /// Instance copy of a dungeon run, once an NPC of its instance was seen.
    pub(crate) copy: Option<String>,
    /// Whether `summary.index` is set. A dungeon visit gets its number with its first pull,
    /// so a visit without a fight is never listed.
    pub(crate) numbered: bool,
}

impl OpenRun {
    pub(crate) fn new(summary: FightSummary) -> Self {
        let numbered = !matches!(summary.run, Some(RunKind::Dungeon));
        Self {
            summary,
            player_names: HashMap::new(),
            last_pull: None,
            copy: None,
            numbered,
        }
    }

    pub(crate) fn is_dungeon(&self) -> bool {
        matches!(self.summary.run, Some(RunKind::Dungeon))
    }

    pub(crate) fn learn_copy(&mut self, event: &CombatEvent<'_>) {
        if !self.is_dungeon() || self.copy.is_some() {
            return;
        }
        self.copy = [event.source.guid, event.target.guid]
            .into_iter()
            .find_map(|guid| instance_copy(guid, self.summary.instance_id))
            .map(str::to_string);
    }

    /// Whether `visit` is in the same instance copy, which only an NPC seen in both proves.
    pub(crate) fn continued_by(&self, visit: &OpenRun) -> bool {
        self.summary.instance_id == visit.summary.instance_id
            && self.summary.difficulty == visit.summary.difficulty
            && self.copy.is_some()
            && self.copy == visit.copy
    }

    /// Extends this run, left earlier, by a later visit of the same copy.
    pub(crate) fn absorb(&mut self, visit: OpenRun) {
        let summary = &mut self.summary;
        summary.end = summary.end.max(visit.summary.end);
        summary.end_offset = visit.summary.end_offset;
        summary.broken_lines += visit.summary.broken_lines;
        for entry in visit.summary.roster {
            if summary.roster.iter().all(|known| known.guid != entry.guid) {
                summary.roster.push(entry);
            }
        }
        for (guid, name) in visit.player_names {
            self.player_names.entry(guid).or_insert(name);
        }
    }

    /// A run lasts from its start line to its last line, `CHALLENGE_MODE_END` included.
    pub(crate) fn finish(mut self, outcome: Outcome) -> FightSummary {
        let summary = &mut self.summary;
        summary.outcome = outcome;
        summary.duration_ms = u64::try_from(summary.end.millis_since(summary.start)).unwrap_or(0);
        summary.group_size = summary.roster.len() as u32;
        for entry in &mut summary.roster {
            entry.name = self.player_names.get(&entry.guid).cloned();
        }
        self.summary
    }
}

/// The instance copy (zone UID) of an NPC GUID `Creature-0-<server>-<map>-<copy>-<npc>-<spawn>`
/// of map `instance_id`; NPCs of other maps also show up inside dungeons.
pub(crate) fn instance_copy(guid: &str, instance_id: u32) -> Option<&str> {
    let mut fields = guid.split('-');
    let kind = fields.next()?;
    if kind != "Creature" && kind != "Vehicle" {
        return None;
    }
    let map = fields.nth(2)?;
    let copy = fields.next()?;
    (map.parse() == Ok(instance_id)).then_some(copy)
}

/// `success` may mean "in time" or only "finished", so a completed key is told by its last
/// boss pull being a kill; the flag decides only when no pull tells.
pub(crate) fn run_outcome(end: &ChallengeModeEnd, last_pull: Option<Outcome>) -> Outcome {
    let completed = match last_pull {
        _ if end.total_time_ms == 0 => false,
        Some(Outcome::Kill) => true,
        Some(Outcome::Wipe) => false,
        Some(Outcome::Incomplete | Outcome::Ended) | None => end.success,
    };
    if completed {
        Outcome::Kill
    } else {
        Outcome::Wipe
    }
}
