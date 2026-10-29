//! Copied unchanged into the recorded baseline's marks module to measure its real save/read paths.
use super::*;
use std::{fs, path::Path, time::Instant};

#[cfg(unix)]
fn physical_bytes(path: &Path) -> std::io::Result<u64> {
    use std::os::unix::fs::MetadataExt;
    let meta = fs::symlink_metadata(path)?;
    if meta.is_dir() {
        let children: std::io::Result<u64> = fs::read_dir(path)?
            .map(|entry| physical_bytes(&entry?.path()))
            .sum();
        Ok(meta.blocks() * 512 + children?)
    } else {
        Ok(meta.blocks() * 512)
    }
}

fn observe() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let input = std::env::var_os("CHECKPOINT_OBSERVER_INPUT").ok_or("missing input")?;
    let output = std::env::var_os("CHECKPOINT_OBSERVER_OUTPUT").ok_or("missing output")?;
    let input: Marks = serde_json::from_slice(&fs::read(input)?)?;
    let mut changed = input.clone();
    let file = changed.agents[0]
        .files
        .iter_mut()
        .find(|file| matches!(file.content, FileContent::Regular { .. }))
        .ok_or("no regular file")?;
    if let FileContent::Regular { bytes, .. } = &mut file.content {
        bytes.extend_from_slice(b"\nN15 changed file\n");
    }
    let mut rows = Vec::new();
    for repetition in 1..=5 {
        let dir = tempfile::tempdir()?;
        let store = Checkpoints::open(dir.path())?;
        for (index, marks) in [&input, &input, &changed].into_iter().enumerate() {
            let id = u32::try_from(index + 1)?;
            store.db()?.execute("INSERT INTO checkpoints VALUES('door',?1,123,'fixed title','[{\"kind\":\"text\",\"text\":\"fixed block\"}]')", [id])?;
            let start = Instant::now();
            store.save_marks("door", id, marks)?;
            let save_ms = start.elapsed().as_secs_f64() * 1000.0;
            let bytes = physical_bytes(dir.path())?;
            let start = Instant::now();
            let read = store.marks("door", id)?;
            let read_ms = start.elapsed().as_secs_f64() * 1000.0;
            if read != *marks {
                return Err(
                    format!("repetition {repetition} checkpoint {id}: unequal Marks").into(),
                );
            }
            rows.push(serde_json::json!({"repetition": repetition, "checkpoint": id, "physical_bytes": bytes, "save_ms": save_ms, "read_ms": read_ms}));
        }
    }
    fs::write(output, serde_json::to_vec_pretty(&rows)?)?;
    Ok(())
}

#[test]
#[ignore = "N15 observer: requires captured input and output paths"]
fn n15_repository_storage_and_timing() {
    if let Err(error) = observe() {
        println!(
            "FAIL\tcommand=cargo test -p checkpoints n15_repository_storage_and_timing -- --ignored --nocapture\tcondition={error}\texit=1"
        );
        panic!("N15 observer failed: {error}");
    }
    println!(
        "PASS\tcondition=15 measurements, three Checkpoints written/read per repetition\texit=0"
    );
}

#[test]
#[ignore = "run only in the recorded baseline checkout"]
fn n14_generate_legacy_fixture() {
    let input = std::env::var_os("CHECKPOINT_OBSERVER_INPUT").unwrap();
    let output = std::env::var_os("CHECKPOINT_LEGACY_OUTPUT").unwrap();
    fs::create_dir_all(&output).unwrap();
    let input: Marks = serde_json::from_slice(&fs::read(input).unwrap()).unwrap();
    let store = Checkpoints::open(Path::new(&output)).unwrap();
    store.db().unwrap().execute_batch("INSERT INTO checkpoints VALUES ('door',1,123,'legacy title','[{\"kind\":\"text\",\"text\":\"legacy block\"}]'), ('door',2,456,'invalidated title','[]');").unwrap();
    store.save_marks("door", 1, &input).unwrap();
    store.save_marks("door", 2, &input).unwrap();
    store.invalidate_after("door", 1).unwrap();
    store
        .db()
        .unwrap()
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .unwrap();
}
