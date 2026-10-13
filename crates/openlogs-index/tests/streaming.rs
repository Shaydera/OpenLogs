use openlogs_index::{Indexer, LogIndex, index_bytes};

const FIXTURES: [&str; 5] = [
    include_str!("fixtures/mini_raid.txt"),
    include_str!("fixtures/mythic_plus.txt"),
    include_str!("fixtures/mythic_plus_end_first.txt"),
    include_str!("fixtures/mythic_plus_offline_wipe.txt"),
    include_str!("fixtures/mythic_plus_reconnect.txt"),
];

fn index_in_chunks(log: &[u8], chunk_size: usize) -> LogIndex {
    let mut indexer = Indexer::new();
    for chunk in log.chunks(chunk_size) {
        indexer.feed(chunk);
    }
    indexer.finish()
}

#[test]
fn chunked_indexing_matches_indexing_the_whole_log() {
    let multibyte_names = FIXTURES[0].replace("Faelan", "Fælän");
    assert_ne!(multibyte_names, FIXTURES[0]);
    let without_final_newline = FIXTURES[0].trim_end();

    let logs = FIXTURES
        .iter()
        .copied()
        .chain([multibyte_names.as_str(), without_final_newline]);
    for log in logs {
        let whole = index_bytes(log.as_bytes());
        for chunk_size in [1, 2, 7, 4096, log.len()] {
            assert_eq!(
                index_in_chunks(log.as_bytes(), chunk_size),
                whole,
                "chunk size {chunk_size}"
            );
        }
    }
}

#[test]
fn an_overlong_line_counts_as_broken_and_the_log_after_it_still_indexes() {
    let junk = vec![b'x'; 3 << 20];
    let mut log = junk.clone();
    log.push(b'\n');
    log.extend_from_slice(FIXTURES[0].as_bytes());

    let whole = index_bytes(FIXTURES[0].as_bytes());
    let index = index_in_chunks(&log, 1 << 20);
    assert_eq!(index.broken_lines, whole.broken_lines + 1);
    let shift = junk.len() as u64 + 1;
    let starts: Vec<_> = index
        .fights
        .iter()
        .map(|f| f.start_offset - shift)
        .collect();
    assert_eq!(
        starts,
        whole
            .fights
            .iter()
            .map(|f| f.start_offset)
            .collect::<Vec<_>>()
    );
}
