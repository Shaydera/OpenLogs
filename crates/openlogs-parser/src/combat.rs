//! Unit-prefixed combat events (`SPELL_*`, `SWING_*`, `UNIT_DIED`, …).

use crate::ParseError;
use crate::event::{
    Absorbed, AuraAction, AuraChange, CombatEvent, CombatKind, Damage, DamageVia, Energize, Heal,
    HealVia, Missed, Spell,
};
use crate::fields::Fields;

/// Field layout of a combat event, decided from its name before any field is read.
#[derive(Clone, Copy)]
enum Shape {
    /// Melee without a spell prefix: advanced block at 9, damage at 28.
    Swing(DamageVia),
    SwingMissed,
    /// Advanced block at 9, environmental type at 28, damage at 29.
    Environmental,
    /// Spell prefix at 9, advanced block at 12, damage at 31.
    SpellDamage(DamageVia),
    SpellMissed(DamageVia),
    Heal(HealVia),
    Absorbed,
    Energize {
        periodic: bool,
    },
    CastStart,
    CastSuccess,
    CastFailed,
    Aura(AuraAction),
    Interrupt,
    Dispel,
    Stolen,
    Summon,
    Create,
    Resurrect,
    Instakill,
    EmpowerStart,
    EmpowerEnd,
    EmpowerInterrupt,
    Died,
    Destroyed,
    PartyKill,
}

fn shape_of(base: &str, support: bool) -> Option<Shape> {
    use DamageVia as Via;
    Some(match base {
        // `SWING_DAMAGE_LANDED_SUPPORT` carries the Evoker's buff as a spell prefix.
        "SWING_DAMAGE" if support => Shape::SpellDamage(Via::Swing),
        "SWING_DAMAGE_LANDED" if support => Shape::SpellDamage(Via::SwingLanded),
        "SWING_DAMAGE" => Shape::Swing(Via::Swing),
        "SWING_DAMAGE_LANDED" => Shape::Swing(Via::SwingLanded),
        "SWING_MISSED" => Shape::SwingMissed,
        "ENVIRONMENTAL_DAMAGE" => Shape::Environmental,
        "RANGE_DAMAGE" => Shape::SpellDamage(Via::Range),
        "SPELL_DAMAGE" => Shape::SpellDamage(Via::Spell),
        "SPELL_PERIODIC_DAMAGE" => Shape::SpellDamage(Via::Periodic),
        "SPELL_BUILDING_DAMAGE" => Shape::SpellDamage(Via::Building),
        "DAMAGE_SPLIT" => Shape::SpellDamage(Via::Split),
        "DAMAGE_SHIELD" => Shape::SpellDamage(Via::Shield),
        "RANGE_MISSED" => Shape::SpellMissed(Via::Range),
        "SPELL_MISSED" => Shape::SpellMissed(Via::Spell),
        "SPELL_PERIODIC_MISSED" => Shape::SpellMissed(Via::Periodic),
        "SPELL_BUILDING_MISSED" => Shape::SpellMissed(Via::Building),
        "DAMAGE_SHIELD_MISSED" => Shape::SpellMissed(Via::Shield),
        "SPELL_HEAL" => Shape::Heal(HealVia::Direct),
        "SPELL_PERIODIC_HEAL" => Shape::Heal(HealVia::Periodic),
        "SPELL_ABSORBED" => Shape::Absorbed,
        "SPELL_ENERGIZE" => Shape::Energize { periodic: false },
        "SPELL_PERIODIC_ENERGIZE" => Shape::Energize { periodic: true },
        "SPELL_CAST_START" => Shape::CastStart,
        "SPELL_CAST_SUCCESS" => Shape::CastSuccess,
        "SPELL_CAST_FAILED" => Shape::CastFailed,
        "SPELL_AURA_APPLIED" => Shape::Aura(AuraAction::Applied),
        "SPELL_AURA_REMOVED" => Shape::Aura(AuraAction::Removed),
        "SPELL_AURA_REFRESH" => Shape::Aura(AuraAction::Refresh),
        "SPELL_AURA_APPLIED_DOSE" => Shape::Aura(AuraAction::AppliedDose),
        "SPELL_AURA_REMOVED_DOSE" => Shape::Aura(AuraAction::RemovedDose),
        "SPELL_AURA_BROKEN" => Shape::Aura(AuraAction::Broken),
        "SPELL_AURA_BROKEN_SPELL" => Shape::Aura(AuraAction::BrokenSpell),
        "SPELL_INTERRUPT" => Shape::Interrupt,
        "SPELL_DISPEL" => Shape::Dispel,
        "SPELL_STOLEN" => Shape::Stolen,
        "SPELL_SUMMON" => Shape::Summon,
        "SPELL_CREATE" => Shape::Create,
        "SPELL_RESURRECT" => Shape::Resurrect,
        "SPELL_INSTAKILL" => Shape::Instakill,
        "SPELL_EMPOWER_START" => Shape::EmpowerStart,
        "SPELL_EMPOWER_END" => Shape::EmpowerEnd,
        "SPELL_EMPOWER_INTERRUPT" => Shape::EmpowerInterrupt,
        "UNIT_DIED" => Shape::Died,
        "UNIT_DESTROYED" | "UNIT_DISSIPATES" => Shape::Destroyed,
        "PARTY_KILL" => Shape::PartyKill,
        _ => return None,
    })
}

/// Parses a combat event, or returns `Ok(None)` if `f.name` is not a modelled combat event.
pub(crate) fn parse_combat<'a>(f: &Fields<'_, 'a>) -> Result<Option<CombatEvent<'a>>, ParseError> {
    let (base, support) = match f.name.strip_suffix("_SUPPORT") {
        Some(base) => (base, true),
        None => (f.name, false),
    };
    let Some(shape) = shape_of(base, support) else {
        return Ok(None);
    };
    // `_SUPPORT` events end with the Augmentation Evoker's GUID.
    let supporter = if support {
        Some(f.str(f.len() - 1)?)
    } else {
        None
    };

    let spell = match shape {
        Shape::Swing(_)
        | Shape::SwingMissed
        | Shape::Environmental
        | Shape::Died
        | Shape::Destroyed
        | Shape::PartyKill => None,
        Shape::Absorbed => absorbed_attack_spell(f)?,
        _ => Some(f.spell(9)?),
    };
    let advanced = match shape {
        Shape::Swing(_) | Shape::Environmental => Some(f.advanced(9)?),
        Shape::SpellDamage(_) | Shape::Heal(_) | Shape::Energize { .. } | Shape::CastSuccess => {
            Some(f.advanced(12)?)
        }
        _ => None,
    };
    let kind = match shape {
        Shape::Swing(via) => CombatKind::Damage(damage(f, 28, via, None, supporter)?),
        Shape::SwingMissed => CombatKind::Missed(missed(f, 9, DamageVia::Swing)?),
        Shape::Environmental => CombatKind::Damage(damage(
            f,
            29,
            DamageVia::Environmental,
            Some(f.str(28)?),
            supporter,
        )?),
        Shape::SpellDamage(via) => CombatKind::Damage(damage(f, 31, via, None, supporter)?),
        Shape::SpellMissed(via) => CombatKind::Missed(missed(f, 12, via)?),
        Shape::Heal(via) => CombatKind::Heal(Heal {
            via,
            amount: f.amount(31)?,
            base_amount: f.amount(32)?,
            overheal: f.amount(33)?,
            absorbed: f.amount(34)?,
            critical: f.flag(35)?,
            supporter,
        }),
        Shape::Absorbed => {
            let at = if spell.is_some() { 12 } else { 9 };
            CombatKind::Absorbed(Absorbed {
                absorber: f.unit(at)?,
                absorb_spell: f.spell(at + 4)?,
                amount: f.amount(at + 7)?,
                critical: f.flag(at + 9)?,
                supporter,
            })
        }
        Shape::Energize { periodic } => CombatKind::Energize(Energize {
            periodic,
            amount: f.num(31)?,
            over_energize: f.num(32)?,
            power_type: f.num(33)?,
            max_power: f.num(34)?,
        }),
        Shape::CastStart => CombatKind::CastStart,
        Shape::CastSuccess => CombatKind::CastSuccess,
        Shape::CastFailed => CombatKind::CastFailed { reason: f.str(12)? },
        Shape::Aura(action) => CombatKind::Aura(aura(f, action)?),
        Shape::Interrupt => CombatKind::Interrupt {
            interrupted: f.spell(12)?,
        },
        Shape::Dispel => CombatKind::Dispel {
            removed: f.spell(12)?,
            aura_type: f.aura_type(15)?,
        },
        Shape::Stolen => CombatKind::Stolen {
            removed: f.spell(12)?,
            aura_type: f.aura_type(15)?,
        },
        Shape::Summon => CombatKind::Summon,
        Shape::Create => CombatKind::Create,
        Shape::Resurrect => CombatKind::Resurrect,
        Shape::Instakill => CombatKind::Instakill,
        Shape::EmpowerStart => CombatKind::EmpowerStart,
        Shape::EmpowerEnd => CombatKind::EmpowerEnd { stage: f.num(12)? },
        Shape::EmpowerInterrupt => CombatKind::EmpowerInterrupt { stage: f.num(12)? },
        Shape::Died => CombatKind::UnitDied {
            unconscious: f.get(9) == Some("1"),
        },
        Shape::Destroyed => CombatKind::UnitDestroyed,
        Shape::PartyKill => CombatKind::PartyKill,
    };

    Ok(Some(CombatEvent {
        name: f.name,
        source: f.unit(1)?,
        target: f.unit(5)?,
        spell,
        advanced,
        kind,
    }))
}

/// Melee absorbs have no attacking spell. Spell IDs start with a digit; GUIDs never do.
fn absorbed_attack_spell<'a>(f: &Fields<'_, 'a>) -> Result<Option<Spell<'a>>, ParseError> {
    if f.str(9)?.starts_with(|c: char| c.is_ascii_digit()) {
        Ok(Some(f.spell(9)?))
    } else {
        Ok(None)
    }
}

/// Damage suffix: amount, base, overkill, school, resisted, blocked, absorbed, critical,
/// glancing, crushing.
fn damage<'a>(
    f: &Fields<'_, 'a>,
    at: usize,
    via: DamageVia,
    environmental_type: Option<&'a str>,
    supporter: Option<&'a str>,
) -> Result<Damage<'a>, ParseError> {
    Ok(Damage {
        via,
        environmental_type,
        amount: f.amount(at)?,
        base_amount: f.amount(at + 1)?,
        overkill: f.amount(at + 2)?,
        school: f.hex_or_dec(at + 3)?,
        resisted: f.amount(at + 4)?,
        blocked: f.amount(at + 5)?,
        absorbed: f.amount(at + 6)?,
        critical: f.flag(at + 7)?,
        glancing: f.flag(at + 8)?,
        crushing: f.flag(at + 9)?,
        supporter,
    })
}

/// Miss suffix: type, offhand, then amount, base amount and critical for partial misses.
fn missed<'a>(f: &Fields<'_, 'a>, at: usize, via: DamageVia) -> Result<Missed<'a>, ParseError> {
    let amount_missed = match f.get(at + 2) {
        Some(value) if value.starts_with(|c: char| c.is_ascii_digit()) => Some(f.amount(at + 2)?),
        _ => None,
    };
    Ok(Missed {
        via,
        miss_type: f.str(at)?,
        offhand: f.get(at + 1) == Some("1"),
        amount_missed,
        critical: amount_missed.is_some() && f.get(at + 4) == Some("1"),
    })
}

fn aura<'a>(f: &Fields<'_, 'a>, action: AuraAction) -> Result<AuraChange<'a>, ParseError> {
    Ok(match action {
        AuraAction::BrokenSpell => AuraChange {
            action,
            aura_type: f.aura_type(15)?,
            stacks: None,
            broken_by: Some(f.spell(12)?),
        },
        AuraAction::AppliedDose | AuraAction::RemovedDose => AuraChange {
            action,
            aura_type: f.aura_type(12)?,
            stacks: Some(f.num(13)?),
            broken_by: None,
        },
        _ => AuraChange {
            action,
            aura_type: f.aura_type(12)?,
            stacks: None,
            broken_by: None,
        },
    })
}
