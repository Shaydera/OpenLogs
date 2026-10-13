//! Turns fights into the JSON shapes the UI shows (mirrored by `ui/src/api/types.ts`).

pub mod auras_dto;
pub mod casts_dto;
pub mod compare_dto;
pub mod detail_dto;
pub mod interrupts_dto;
pub mod log_dto;
pub mod overview_dto;
pub mod player_dto;
pub mod recap_dto;
mod refs;
pub mod report_dto;
mod reports;
pub mod resources_dto;
#[cfg(test)]
mod test_fight;

pub use reports::*;
