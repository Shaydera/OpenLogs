use openlogs_gamedata::{Role, TalentTrees, TreeRole, tree_role};
use openlogs_index::BEAR_FORMS;

use crate::actors::{ActorId, TalentSpec};
use crate::auras::{AuraInterval, aura_intervals, union_ms};
use crate::fight::Fight;

/// A Feral Combat druid tanks a pull they spent at least this share of in Bear Form.
const BEAR_FORM_TANK_SHARE: f64 = 0.2;

/// Gives each player with talents the tree they put most points into, with their role in this
/// pull, and each player whose spec ID is one of the game's class specs that class.
pub fn assign_talent_specs(fight: &mut Fight, trees: &TalentTrees) {
    let players: Vec<(ActorId, Option<u32>)> = fight
        .actors
        .players()
        .map(|player| (player.id, player.spec_id))
        .collect();
    let mut bear_forms: Option<Vec<AuraInterval>> = None;
    for (player, spec_id) in players {
        let tree = fight
            .talents
            .get(&player)
            .and_then(|talents| trees.spec_of(talents.iter().copied()));
        let class = spec_id
            .and_then(|spec_id| trees.class_of_spec(spec_id))
            .or(tree.map(|tree| tree.class_id));
        if class.is_some() {
            fight.actors.set_class(player, class);
        }
        let spec = tree.map(|tree| TalentSpec {
            tree_id: tree.id,
            name: tree.name.clone(),
            icon: tree.icon.clone(),
            role: match tree_role(tree.id) {
                TreeRole::Fixed(role) => role,
                TreeRole::BearForm => {
                    let intervals = bear_forms.get_or_insert_with(|| bear_form_intervals(fight));
                    if bear_form_share(fight, intervals, player) >= BEAR_FORM_TANK_SHARE {
                        Role::Tank
                    } else {
                        Role::Damage
                    }
                }
            },
        });
        fight.actors.set_talent_spec(player, spec);
    }
}

fn bear_form_intervals(fight: &Fight) -> Vec<AuraInterval> {
    aura_intervals(fight)
        .into_iter()
        .filter(|interval| BEAR_FORMS.contains(&interval.spell))
        .collect()
}

fn bear_form_share(fight: &Fight, bear_forms: &[AuraInterval], player: ActorId) -> f64 {
    let duration = i32::try_from(fight.duration_ms).unwrap_or(i32::MAX);
    if duration <= 0 {
        return 0.0;
    }
    let spans: Vec<(i32, i32)> = bear_forms
        .iter()
        .filter(|interval| interval.target == player)
        .map(|interval| (interval.start_ms, interval.end_ms))
        .collect();
    if spans.is_empty() && fight.in_bear_form_at_start.contains(&player) {
        return 1.0;
    }
    union_ms(&spans, 0, duration) as f64 / f64::from(duration)
}
