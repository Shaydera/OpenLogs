//! Single-pass index of a combat log: fights, outcomes, rosters and byte ranges.

mod builder;
mod cache;
mod markers;
mod model;
mod scan;

pub use builder::{IndexBuilder, LineSpan};
pub use cache::{CacheKey, CacheStatus, load_or_build};
pub use model::*;
pub use scan::{Indexer, index_bytes, index_file};
