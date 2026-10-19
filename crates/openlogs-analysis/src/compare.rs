//! Two pulls side by side.

use std::collections::HashMap;

use openlogs_gamedata::Curated;

use crate::ability::unit_name;
use crate::actors::ActorId;
use crate::fight::Fight;
use crate::filter::{Attribution, Overkill, ReportFilter};
use crate::overview::{QuickOverview, quick_overview_in};
use crate::reports::damage::damage_done;
use crate::reports::healing::healing;

/// One player's figures in one pull, over the whole pull.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlayerSide {
    /// The player's actor in this pull; ids differ between pulls.
    pub actor: ActorId,
    pub dps: f64,
    pub hps: f64,
    pub deaths: u32,
}

/// A player of either pull, matched across the pulls by GUID.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ComparedPlayer {
    /// `None` when the player was not in that pull.
    pub a: Option<PlayerSide>,
    pub b: Option<PlayerSide>,
}

impl ComparedPlayer {
    /// DPS in pull B minus DPS in pull A; `None` unless the player was in both.
    pub fn dps_delta(&self) -> Option<f64> {
        Some(self.b?.dps - self.a?.dps)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PullComparison {
    /// Whole-pull overviews: KPIs, boss HP and raid DPS series, phases, deaths.
    pub a: QuickOverview,
    pub b: QuickOverview,
    /// Players of both pulls by |DPS difference|, largest first; then players of one pull
    /// by their DPS; ties by name.
    pub players: Vec<ComparedPlayer>,
}

/// Compares two whole pulls; the time range never applies. `attribution` decides the
/// players' DPS and HPS; KPIs, series and deaths are the same in both modes.
pub fn compare_pulls(
    a: &Fight,
    b: &Fight,
    curated: &Curated,
    attribution: Attribution,
    overkill: Overkill,
) -> PullComparison {
    let whole = |attribution| ReportFilter {
        overkill,
        ..ReportFilter::whole(attribution)
    };
    let overview_a = quick_overview_in(a, curated, &whole(Attribution::Augmented));
    let overview_b = quick_overview_in(b, curated, &whole(Attribution::Augmented));
    let filter = whole(attribution);
    let mut only_a = player_sides(a, &overview_a, &filter);
    let mut rows: Vec<(String, ComparedPlayer)> = player_sides(b, &overview_b, &filter)
        .into_iter()
        .map(|(guid, side_b)| {
            let row = ComparedPlayer {
                a: only_a.remove(&guid),
                b: Some(side_b),
            };
            (unit_name(b, side_b.actor), row)
        })
        .collect();
    rows.extend(only_a.into_values().map(|side_a| {
        let row = ComparedPlayer {
            a: Some(side_a),
            b: None,
        };
        (unit_name(a, side_a.actor), row)
    }));
    rows.sort_by(|(name_x, x), (name_y, y)| {
        let (group_x, size_x) = sort_key(x);
        let (group_y, size_y) = sort_key(y);
        group_x
            .cmp(&group_y)
            .then(size_y.total_cmp(&size_x))
            .then_with(|| name_x.cmp(name_y))
    });
    PullComparison {
        a: overview_a,
        b: overview_b,
        players: rows.into_iter().map(|(_, row)| row).collect(),
    }
}

/// Rows of both pulls first, by |DPS difference|; then rows of one pull, by their DPS.
fn sort_key(row: &ComparedPlayer) -> (u8, f64) {
    match row.dps_delta() {
        Some(delta) => (0, delta.abs()),
        None => (1, row.a.or(row.b).map_or(0.0, |side| side.dps)),
    }
}

/// The players of one pull by GUID: everyone with a spec, plus anyone who did damage or
/// healing or died there (an Evoker outside the raid, a player without `COMBATANT_INFO`).
fn player_sides(
    fight: &Fight,
    overview: &QuickOverview,
    filter: &ReportFilter,
) -> HashMap<String, PlayerSide> {
    let mut sides: HashMap<ActorId, PlayerSide> = HashMap::new();
    for player in fight.actors.players().filter(|p| p.spec_id.is_some()) {
        side(&mut sides, player.id);
    }
    for player in damage_done(fight, filter).players {
        side(&mut sides, player.player).dps = player.per_second;
    }
    for player in healing(fight, filter).players {
        side(&mut sides, player.player).hps = player.per_second;
    }
    for report in &overview.deaths {
        side(&mut sides, report.death.player).deaths += 1;
    }
    sides
        .into_values()
        .map(|side| (fight.actors.get(side.actor).guid.clone(), side))
        .collect()
}

fn side(sides: &mut HashMap<ActorId, PlayerSide>, actor: ActorId) -> &mut PlayerSide {
    sides.entry(actor).or_insert(PlayerSide {
        actor,
        dps: 0.0,
        hps: 0.0,
        deaths: 0,
    })
}
