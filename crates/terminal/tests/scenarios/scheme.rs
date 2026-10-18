//! X17: a program's colour queries are answered from the App's scheme.

use crate::common::{PATIENCE, drain, open, sh};
use contracts::terminal::{Scheme, SchemeParams};
use terminal::{Output, Spawned};

fn params(scheme: Scheme) -> SchemeParams {
    let (background, foreground) = match scheme {
        Scheme::Light => ("#ffffff", "#1d1d1f"),
        Scheme::Dark => ("#1c1c1e", "#f5f5f7"),
    };
    SchemeParams {
        scheme,
        background: background.into(),
        foreground: foreground.into(),
    }
}

/// Send `first` to the Terminal, then print `ready`, then print as hex every byte the Terminal
/// types back until it has been quiet for a second.
fn script(first: &str) -> String {
    format!(
        r"stty raw -echo min 0 time 10; printf '{first}'; echo ready; dd bs=1 count=200 2>/dev/null | od -An -v -tx1"
    )
}

async fn until_ready(spawned: &mut Spawned) {
    let mut printed = String::new();
    tokio::time::timeout(PATIENCE, async {
        while !printed.contains("ready") {
            if let Output::Bytes { bytes, .. } =
                spawned.output.next().await.expect("the program stays up")
            {
                printed.push_str(&String::from_utf8_lossy(&bytes));
            }
        }
    })
    .await
    .expect("the program prints ready");
}

/// The bytes the Terminal typed back, as hex, from what `drain` collected after `ready`.
async fn typed_back(spawned: &mut Spawned) -> String {
    let rest = drain(&mut spawned.output).await;
    rest.rsplit("ready")
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .collect()
}

const OSC_11_QUERY: &str = r"\033]11;?\033\\\033[c";

fn hex(bytes: &str) -> String {
    bytes.bytes().map(|byte| format!("{byte:02x}")).collect()
}

#[tokio::test]
async fn x17_a_colour_query_gets_one_reply_in_the_current_scheme() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    for (scheme, background) in [
        (Scheme::Light, "ffff/ffff/ffff"),
        (Scheme::Dark, "1c1c/1c1c/1e1e"),
    ] {
        terminals.set_scheme(params(scheme)).await.unwrap();
        let mut spawned = terminals
            .spawn(sh(dir.path(), &script(OSC_11_QUERY)))
            .await
            .unwrap();
        // The background, then DA1's answer, each once: nothing else typed the replies.
        let expected = hex(&format!("\x1b]11;rgb:{background}\x1b\\\x1b[?62;22c"));
        assert_eq!(typed_back(&mut spawned).await, expected);
    }
}

#[tokio::test]
async fn x17_no_scheme_set_means_no_reply() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(dir.path(), &script(OSC_11_QUERY)))
        .await
        .unwrap();
    assert_eq!(typed_back(&mut spawned).await, "");
}

#[tokio::test]
async fn x17_a_switch_sends_one_notice_to_programs_that_asked_for_them() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    terminals.set_scheme(params(Scheme::Light)).await.unwrap();
    let mut subscribed = terminals
        .spawn(sh(dir.path(), &script(r"\033[?2031h")))
        .await
        .unwrap();
    let mut silent = terminals.spawn(sh(dir.path(), &script(""))).await.unwrap();
    until_ready(&mut subscribed).await;
    until_ready(&mut silent).await;

    terminals.set_scheme(params(Scheme::Dark)).await.unwrap();
    // The same scheme again changes nothing, so it sends nothing.
    terminals.set_scheme(params(Scheme::Dark)).await.unwrap();

    assert_eq!(typed_back(&mut subscribed).await, "1b5b3f3939373b316e");
    assert_eq!(typed_back(&mut silent).await, "");
}

#[tokio::test]
async fn x17_a_colour_that_is_not_hex_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut bad = params(Scheme::Light);
    bad.background = "white".into();
    assert!(terminals.set_scheme(bad).await.is_err());
}
