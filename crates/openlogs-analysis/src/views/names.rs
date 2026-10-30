use crate::actors::NOBODY;
use crate::fight::{AuraAction, DamageVia, Event, EventKind};

/// The log's name of an event ("SPELL_PERIODIC_DAMAGE", "SWING_DAMAGE_LANDED_SUPPORT").
pub(crate) fn log_name(event: &Event) -> &'static str {
    match event.kind {
        EventKind::Damage(damage) => damage_name(damage.via, damage.supporter != NOBODY),
        EventKind::Missed(missed) => match missed.via {
            DamageVia::Swing | DamageVia::SwingLanded => "SWING_MISSED",
            DamageVia::Range => "RANGE_MISSED",
            DamageVia::Periodic => "SPELL_PERIODIC_MISSED",
            DamageVia::Building => "SPELL_BUILDING_MISSED",
            DamageVia::Shield => "DAMAGE_SHIELD_MISSED",
            DamageVia::Spell | DamageVia::Environmental | DamageVia::Split => "SPELL_MISSED",
        },
        EventKind::Heal(heal) => match (heal.periodic, heal.supporter != NOBODY) {
            (false, false) => "SPELL_HEAL",
            (false, true) => "SPELL_HEAL_SUPPORT",
            (true, false) => "SPELL_PERIODIC_HEAL",
            (true, true) => "SPELL_PERIODIC_HEAL_SUPPORT",
        },
        EventKind::Absorbed(absorbed) if absorbed.supporter != NOBODY => "SPELL_ABSORBED_SUPPORT",
        EventKind::Absorbed(_) => "SPELL_ABSORBED",
        EventKind::HealAbsorbed(_) => "SPELL_HEAL_ABSORBED",
        EventKind::Energize(_) => "SPELL_ENERGIZE",
        EventKind::CastStart => "SPELL_CAST_START",
        EventKind::CastSuccess => "SPELL_CAST_SUCCESS",
        EventKind::CastFailed { .. } => "SPELL_CAST_FAILED",
        EventKind::Aura { action, .. } => match action {
            AuraAction::Applied => "SPELL_AURA_APPLIED",
            AuraAction::Removed => "SPELL_AURA_REMOVED",
            AuraAction::Refresh => "SPELL_AURA_REFRESH",
            AuraAction::AppliedDose => "SPELL_AURA_APPLIED_DOSE",
            AuraAction::RemovedDose => "SPELL_AURA_REMOVED_DOSE",
            AuraAction::Broken => "SPELL_AURA_BROKEN",
            AuraAction::BrokenSpell => "SPELL_AURA_BROKEN_SPELL",
        },
        EventKind::Interrupt { .. } => "SPELL_INTERRUPT",
        EventKind::Dispel { .. } => "SPELL_DISPEL",
        EventKind::Stolen { .. } => "SPELL_STOLEN",
        EventKind::Summon => "SPELL_SUMMON",
        EventKind::Create => "SPELL_CREATE",
        EventKind::Resurrect => "SPELL_RESURRECT",
        EventKind::Instakill => "SPELL_INSTAKILL",
        EventKind::EmpowerStart => "SPELL_EMPOWER_START",
        EventKind::EmpowerEnd { .. } => "SPELL_EMPOWER_END",
        EventKind::EmpowerInterrupt { .. } => "SPELL_EMPOWER_INTERRUPT",
        EventKind::Died { .. } => "UNIT_DIED",
        EventKind::Destroyed => "UNIT_DESTROYED",
        EventKind::PartyKill => "PARTY_KILL",
    }
}

fn damage_name(via: DamageVia, support: bool) -> &'static str {
    match (via, support) {
        (DamageVia::Swing, false) => "SWING_DAMAGE",
        (DamageVia::Swing, true) => "SWING_DAMAGE_SUPPORT",
        (DamageVia::SwingLanded, false) => "SWING_DAMAGE_LANDED",
        (DamageVia::SwingLanded, true) => "SWING_DAMAGE_LANDED_SUPPORT",
        (DamageVia::Range, false) => "RANGE_DAMAGE",
        (DamageVia::Range, true) => "RANGE_DAMAGE_SUPPORT",
        (DamageVia::Spell, false) => "SPELL_DAMAGE",
        (DamageVia::Spell, true) => "SPELL_DAMAGE_SUPPORT",
        (DamageVia::Periodic, false) => "SPELL_PERIODIC_DAMAGE",
        (DamageVia::Periodic, true) => "SPELL_PERIODIC_DAMAGE_SUPPORT",
        (DamageVia::Building, false) => "SPELL_BUILDING_DAMAGE",
        (DamageVia::Building, true) => "SPELL_BUILDING_DAMAGE_SUPPORT",
        (DamageVia::Environmental, _) => "ENVIRONMENTAL_DAMAGE",
        (DamageVia::Split, _) => "DAMAGE_SPLIT",
        (DamageVia::Shield, _) => "DAMAGE_SHIELD",
    }
}
