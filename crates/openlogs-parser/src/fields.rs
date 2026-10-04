use std::str::FromStr;

use crate::ParseError;
use crate::event::{AdvancedInfo, AuraType, NULL_GUID, Spell, Unit};

/// Typed, bounds-checked access to the fields of one event; index 0 is the event name.
pub(crate) struct Fields<'f, 'a> {
    pub name: &'a str,
    items: &'f [&'a str],
}

impl<'f, 'a> Fields<'f, 'a> {
    pub fn new(items: &'f [&'a str]) -> Self {
        Self {
            name: items.first().copied().unwrap_or(""),
            items,
        }
    }

    pub fn str(&self, index: usize) -> Result<&'a str, ParseError> {
        self.items
            .get(index)
            .copied()
            .ok_or_else(|| ParseError::MissingField {
                event: self.name.to_string(),
                index,
            })
    }

    pub fn num<T: FromStr>(&self, index: usize) -> Result<T, ParseError> {
        let value = self.str(index)?;
        value.parse().map_err(|_| self.invalid(index, value))
    }

    /// WoW writes `1` for true and `nil` (sometimes `0`) for false.
    pub fn flag(&self, index: usize) -> Result<bool, ParseError> {
        Ok(self.str(index)? == "1")
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn get(&self, index: usize) -> Option<&'a str> {
        self.items.get(index).copied()
    }

    /// `nil` and the null GUID become `None`.
    pub fn opt_str(&self, index: usize) -> Result<Option<&'a str>, ParseError> {
        let value = self.str(index)?;
        Ok((value != "nil" && value != NULL_GUID).then_some(value))
    }

    /// Non-negative amount; WoW writes `-1` for "no overkill".
    pub fn amount(&self, index: usize) -> Result<u64, ParseError> {
        Ok(self.num::<i64>(index)?.max(0) as u64)
    }

    /// `0x`-prefixed hex or plain decimal; spell schools appear in both forms.
    pub fn hex_or_dec(&self, index: usize) -> Result<u32, ParseError> {
        let value = self.str(index)?;
        let parsed = match value.strip_prefix("0x") {
            Some(hex) => u32::from_str_radix(hex, 16),
            None => value.parse(),
        };
        parsed.map_err(|_| self.invalid(index, value))
    }

    /// GUID, name, flags, raid flags.
    pub fn unit(&self, index: usize) -> Result<Unit<'a>, ParseError> {
        Ok(Unit {
            guid: self.str(index)?,
            name: self.opt_str(index + 1)?,
            flags: self.hex_or_dec(index + 2)?,
            raid_flags: self.hex_or_dec(index + 3)?,
        })
    }

    /// Spell ID, name, school.
    pub fn spell(&self, index: usize) -> Result<Spell<'a>, ParseError> {
        Ok(Spell {
            id: self.num(index)?,
            name: self.str(index + 1)?,
            school: self.hex_or_dec(index + 2)?,
        })
    }

    pub fn aura_type(&self, index: usize) -> Result<AuraType, ParseError> {
        match self.str(index)? {
            "BUFF" => Ok(AuraType::Buff),
            "DEBUFF" => Ok(AuraType::Debuff),
            other => Err(self.invalid(index, other)),
        }
    }

    /// The 19-field advanced logging block starting at `index`.
    pub fn advanced(&self, index: usize) -> Result<AdvancedInfo<'a>, ParseError> {
        Ok(AdvancedInfo {
            info_guid: self.str(index)?,
            owner_guid: self.opt_str(index + 1)?,
            current_hp: self.amount(index + 2)?,
            max_hp: self.amount(index + 3)?,
            // index + 4 ..= index + 9: six stat fields the analysis does not use.
            power_types: self.str(index + 10)?,
            current_powers: self.str(index + 11)?,
            max_powers: self.str(index + 12)?,
            // index + 13: power cost.
            x: self.num(index + 14)?,
            y: self.num(index + 15)?,
            ui_map_id: self.num(index + 16)?,
            facing: self.num(index + 17)?,
            level: self.num(index + 18)?,
        })
    }

    fn invalid(&self, index: usize, value: &str) -> ParseError {
        ParseError::InvalidField {
            event: self.name.to_string(),
            index,
            value: value.to_string(),
        }
    }
}
