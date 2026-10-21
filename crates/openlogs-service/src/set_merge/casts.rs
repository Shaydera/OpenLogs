use super::{Merge, merge_rows, sum_spell_amounts, top_spell};
use crate::casts_dto::{CastExtraDto, CastsReportDto};

impl Merge for CastsReportDto {
    fn merge(&mut self, mut next: Self) {
        let (own_ms, next_ms) = (self.breakdown.duration_ms, next.breakdown.duration_ms);
        let total_ms = (own_ms + next_ms) as f64;
        let weight = |ms: u64| {
            if total_ms > 0.0 {
                ms as f64 / total_ms
            } else {
                0.0
            }
        };
        for (extras, ms) in [(&mut self.extras, own_ms), (&mut next.extras, next_ms)] {
            for extra in extras {
                extra.uptime = extra.uptime.map(|uptime| uptime * weight(ms));
            }
        }
        self.breakdown.merge(next.breakdown);
        merge_rows(&mut self.extras, next.extras, same_row, |a, b| {
            a.casts += b.casts;
            sum_spell_amounts(&mut a.casts_by_spell, b.casts_by_spell);
            a.first_cast_ms = a.first_cast_ms.min(b.first_cast_ms);
            a.link = a.link.or(b.link);
            a.uptime = match (a.uptime, b.uptime) {
                (None, None) => None,
                (x, y) => Some(x.unwrap_or(0.0) + y.unwrap_or(0.0)),
            };
        });
    }

    fn finish(&mut self) {
        self.breakdown.finish();
        for extra in &mut self.extras {
            extra.spell_id = top_spell(&extra.casts_by_spell).unwrap_or(extra.spell_id);
        }
        self.extras.sort_by(|a, b| {
            (a.player, a.ability.to_ability(), a.proc_trigger).cmp(&(
                b.player,
                b.ability.to_ability(),
                b.proc_trigger,
            ))
        });
    }
}

fn same_row(a: &CastExtraDto, b: &CastExtraDto) -> bool {
    (a.player, &a.ability, a.proc_trigger) == (b.player, &b.ability, b.proc_trigger)
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{
        ActorId, Actors, AuraAction, AuraType, Event, EventKind, NO_SPELL, NOBODY, SpellId,
    };
    use openlogs_gamedata::Curated;

    use crate::reports::casts;
    use crate::scope_dto::{DimensionDto, ScopeDto};
    use crate::set_merge::tests::{WHOLE, merged};
    use crate::test_fight::{PLAYER_FLAGS, fight, unit};

    const SPELL: SpellId = 100;

    fn event(t: i32, source: ActorId, kind: EventKind) -> Event {
        Event {
            t,
            source,
            target: NOBODY,
            spell: SPELL,
            kind,
            source_hostile: false,
            target_hostile: false,
            unit_hp: None,
        }
    }

    fn cast(t: i32, source: ActorId) -> Event {
        event(t, source, EventKind::CastSuccess)
    }

    fn aura(t: i32, source: ActorId, action: AuraAction) -> Event {
        event(
            t,
            source,
            EventKind::Aura {
                action,
                aura_type: AuraType::Buff,
                stacks: None,
                broken_by: NO_SPELL,
            },
        )
    }

    #[test]
    fn cast_rows_sum_and_weigh_uptime_by_pull_length() {
        let mut actors = Actors::new();
        let a = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let mut pull_1 = fight(
            actors.clone(),
            vec![
                cast(1_000, a),
                cast(2_000, a),
                cast(3_000, a),
                aura(0, a, AuraAction::Applied),
                aura(10_000, a, AuraAction::Removed),
            ],
        );
        pull_1.duration_ms = 20_000;
        let mut pull_2 = fight(actors, vec![cast(5_000, a)]);
        pull_2.duration_ms = 40_000;
        let part = |pull| {
            casts(
                pull,
                &Curated::bundled(),
                WHOLE,
                ScopeDto::default(),
                DimensionDto::Source,
                false,
            )
        };
        let set = merged(vec![part(&pull_1), part(&pull_2)]);
        let [row] = set.extras.as_slice() else {
            panic!("one cast row, got {:?}", set.extras);
        };
        assert_eq!((row.casts, row.first_cast_ms), (4, 1_000));
        assert!((row.uptime.unwrap() - 10.0 / 60.0).abs() < 1e-9);
    }
}
