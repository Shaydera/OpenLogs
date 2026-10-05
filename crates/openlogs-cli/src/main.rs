//! Developer CLI for inspecting combat logs.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

use clap::{Parser, Subcommand};
use openlogs_index::{index_file, load_or_build};

mod format;

#[derive(Parser)]
#[command(name = "openlogs-cli", about = "Inspect World of Warcraft combat logs")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List the fights (encounters) in a combat log.
    DumpFights {
        /// Path to a WoWCombatLog-*.txt file.
        file: PathBuf,
        /// Print the full index as JSON instead of a table.
        #[arg(long)]
        json: bool,
        /// Reuse and store the index in this directory.
        #[arg(long)]
        cache_dir: Option<PathBuf>,
    },
}

fn main() -> ExitCode {
    match Cli::parse().command {
        Command::DumpFights {
            file,
            json,
            cache_dir,
        } => match dump_fights(&file, json, cache_dir.as_deref()) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("error: cannot index {}: {err}", file.display());
                ExitCode::FAILURE
            }
        },
    }
}

fn dump_fights(file: &Path, json: bool, cache_dir: Option<&Path>) -> std::io::Result<()> {
    let started = Instant::now();
    let (index, cache) = match cache_dir {
        Some(dir) => {
            let (index, status) = load_or_build(file, dir)?;
            (index, Some(status))
        }
        None => (index_file(file)?, None),
    };
    let elapsed = started.elapsed();
    if json {
        println!("{}", serde_json::to_string_pretty(&index)?);
    } else {
        let size = std::fs::metadata(file)?.len();
        print!("{}", format::report(file, size, &index, elapsed, cache));
    }
    Ok(())
}
