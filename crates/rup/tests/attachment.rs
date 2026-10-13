//! U419 (`scenarios/ui-image-send.md`): `attachment.save` keeps a pasted image in a file under the
//! Daemon's data folder. The real `rupd`.
#![allow(dead_code)]

#[path = "e2e/daemon.rs"]
mod daemon;

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::Engine as _;
use daemon::{Project, start};
use rpc::Client;
use serde_json::json;

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

async fn save(client: &Client, name: &str, data: &str) -> Result<PathBuf, String> {
    match client
        .request("attachment.save", json!({"name": name, "data": data}))
        .await
    {
        Ok(saved) => Ok(PathBuf::from(saved["path"].as_str().unwrap())),
        Err(err) => Err(err.to_string()),
    }
}

fn folder(project: &Project) -> PathBuf {
    project.data_dir().join("attachments")
}

fn files(dir: &Path) -> usize {
    std::fs::read_dir(dir).map_or(0, |entries| entries.count())
}

#[tokio::test]
async fn u419_save_returns_a_path_holding_the_bytes() {
    let project = start(&[]);
    let client = project.client().await;

    let path = save(&client, "shot.png", &b64(b"\x89PNG bytes"))
        .await
        .unwrap();

    assert!(path.is_absolute());
    assert!(path.starts_with(folder(&project).canonicalize().unwrap()));
    assert!(
        path.file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with("-shot.png")
    );
    assert_eq!(std::fs::read(path).unwrap(), b"\x89PNG bytes");
}

#[tokio::test]
async fn u419_a_name_with_slashes_stays_inside_the_folder() {
    let project = start(&[]);
    let client = project.client().await;

    let path = save(&client, "../..\\evil\n/x.png", &b64(b"a"))
        .await
        .unwrap();

    assert_eq!(
        path.parent().unwrap(),
        folder(&project).canonicalize().unwrap()
    );
    let name = path.file_name().unwrap().to_string_lossy().into_owned();
    assert!(name.ends_with("-.._.._evil__x.png"), "{name}");
}

#[tokio::test]
async fn u419_two_saves_of_one_name_make_two_files() {
    let project = start(&[]);
    let client = project.client().await;

    let first = save(&client, "a.png", &b64(b"one")).await.unwrap();
    let second = save(&client, "a.png", &b64(b"two")).await.unwrap();

    assert_ne!(first, second);
    assert_eq!(std::fs::read(first).unwrap(), b"one");
    assert_eq!(std::fs::read(second).unwrap(), b"two");
}

#[tokio::test]
async fn u419_bad_base64_and_over_20_mb_write_nothing() {
    let project = start(&[]);
    let client = project.client().await;

    let bad = save(&client, "a.png", "not base64!!").await.unwrap_err();
    let big = save(&client, "b.png", &b64(&vec![0u8; 20 * 1024 * 1024 + 1]))
        .await
        .unwrap_err();

    assert!(bad.contains("base64"), "{bad}");
    assert!(big.contains("20 MB"), "{big}");
    assert_eq!(files(&folder(&project)), 0);
}

#[tokio::test]
async fn u419_start_removes_files_older_than_7_days() {
    let mut project = start(&[]);
    let client = project.client().await;
    let old = save(&client, "old.png", &b64(b"o")).await.unwrap();
    let fresh = save(&client, "fresh.png", &b64(b"f")).await.unwrap();
    drop(client);
    let eight_days = SystemTime::now() - Duration::from_secs(8 * 24 * 60 * 60);
    std::fs::File::options()
        .write(true)
        .open(&old)
        .unwrap()
        .set_modified(eight_days)
        .unwrap();

    project.restart(&[]);

    assert!(!old.exists());
    assert!(fresh.exists());
    let again = save(&project.client().await, "old.png", &b64(b"n"))
        .await
        .unwrap();
    assert_ne!(again, fresh);
}
