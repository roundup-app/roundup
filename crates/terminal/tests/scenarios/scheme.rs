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
async fn x17_an_owner_started_after_the_scheme_answers_at_once() {
    let dir = tempfile::tempdir().unwrap();
    let terminals = owner_terminals(&dir);
    terminals.set_scheme(params(Scheme::Light)).await.unwrap();
    let mut spawned = terminals
        .spawn(sh(dir.path(), &script(r"\033[c\033]11;?\033\\")))
        .await
        .unwrap();
    assert_eq!(
        typed_back(&mut spawned).await,
        hex("\x1b[?62;22c\x1b]11;rgb:ffff/ffff/ffff\x1b\\")
    );
}

fn owner_terminals(dir: &tempfile::TempDir) -> terminal::Terminals {
    let (terminals, _) = open(dir);
    let helper = std::env::var_os("ROUNDUP_TEST_APP_BIN")
        .map(|dir| std::path::PathBuf::from(dir).join("terminal-owner"))
        .unwrap_or_else(|| env!("CARGO_BIN_EXE_terminal-owner").into());
    terminals.with_terminal_owner(&helper)
}

#[tokio::test]
async fn x17_a_reattached_owner_answers_in_the_daemons_scheme() {
    for (scheme, background) in [
        (Scheme::Light, "ffff/ffff/ffff"),
        (Scheme::Dark, "1c1c/1c1c/1e1e"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let original = owner_terminals(&dir);
        let program = format!(
            "stty raw -echo min 0 time 30; echo ready; dd bs=1 count=1 >/dev/null 2>&1; {}",
            script(r"\033[c\033]11;?\033\\")
        );
        let mut spawned = original.spawn(sh(dir.path(), &program)).await.unwrap();
        until_ready(&mut spawned).await;
        let owner = original.terminal_owners().pop().unwrap();
        drop(spawned);
        drop(original);

        let (terminals, _) = open(&dir);
        terminals.set_scheme(params(Scheme::Light)).await.unwrap();
        let mut spawned = terminals.reattach_owner(&owner).await.unwrap();
        if scheme == Scheme::Dark {
            terminals.set_scheme(params(scheme)).await.unwrap();
        }
        terminals
            .write_completed(&spawned.id, vec![b'x'])
            .await
            .unwrap();
        assert_eq!(
            typed_back(&mut spawned).await,
            hex(&format!("\x1b[?62;22c\x1b]11;rgb:{background}\x1b\\"))
        );
    }
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
async fn x17_an_xtversion_query_is_answered_as_iterm2_before_da1() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    terminals.set_scheme(params(Scheme::Dark)).await.unwrap();
    let mut spawned = terminals
        .spawn(sh(dir.path(), &script(r"\033[>q\033[c")))
        .await
        .unwrap();
    let expected = hex("\x1bP>|roundup\x1b\\\x1b[?62;22c");
    assert_eq!(typed_back(&mut spawned).await, expected);
}

#[tokio::test]
async fn x17_an_xtversion_query_is_answered_before_any_scheme_is_set() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(dir.path(), &script(r"\033[>q\033[c")))
        .await
        .unwrap();
    // DA1 still waits for the scheme.
    assert_eq!(typed_back(&mut spawned).await, hex("\x1bP>|roundup\x1b\\"));
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

#[tokio::test]
async fn z3799g_scheme_hex_keeps_its_input_language() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut mixed = params(Scheme::Light);
    mixed.background = "#AbCdEf".into();
    assert!(terminals.set_scheme(mixed).await.is_ok());
    for refused in [
        "#fff",
        "ffffff",
        "#ffffff00",
        "#gggggg",
        "#ffffé",
        "# fffff",
        "#+fffff",
    ] {
        let mut bad = params(Scheme::Light);
        bad.foreground = refused.into();
        assert!(terminals.set_scheme(bad).await.is_err(), "{refused:?}");
    }
}

/// Claude Code's second probe batch: DECRQM 2026, a Kitty query, `CSI 16 t`, DECRQM 1016, DA1.
const PROBE_BATCH: [&str; 2] = [
    r"\033[?2026\$p\033_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA",
    r"\033\\\033[16t\033[?1016\$p\033[c",
];

#[tokio::test]
async fn u6144a_the_kitty_ok_reaches_the_program_before_da1_in_one_chunk() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    terminals.set_scheme(params(Scheme::Dark)).await.unwrap();
    let mut spawned = terminals
        .spawn(sh(dir.path(), &script(&PROBE_BATCH.concat())))
        .await
        .unwrap();
    let expected = hex("\x1b_Gi=31;OK\x1b\\\x1b[?62;22c");
    assert_eq!(typed_back(&mut spawned).await, expected);
}

#[tokio::test]
async fn u6144a_the_order_holds_when_the_chunk_splits_inside_the_kitty_query() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    terminals.set_scheme(params(Scheme::Dark)).await.unwrap();
    let split = format!(
        "stty raw -echo min 0 time 10; printf '{}'; sleep 0.3; printf '{}'; echo ready; dd bs=1 count=200 2>/dev/null | od -An -v -tx1",
        PROBE_BATCH[0], PROBE_BATCH[1]
    );
    let mut spawned = terminals.spawn(sh(dir.path(), &split)).await.unwrap();
    let expected = hex("\x1b_Gi=31;OK\x1b\\\x1b[?62;22c");
    assert_eq!(typed_back(&mut spawned).await, expected);
}

#[tokio::test]
async fn u6144b_a_terminal_claims_only_this_emulator() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut params = sh(
        dir.path(),
        r#"echo "term=$TERM program=${TERM_PROGRAM-none} version=${TERM_PROGRAM_VERSION-none} kitty=${KITTY_WINDOW_ID-none}""#,
    );
    params.env.insert("TERM".into(), "xterm-ghostty".into());
    params.env.insert("TERM_PROGRAM".into(), "ghostty".into());
    params.env.insert("TERM_PROGRAM_VERSION".into(), "1".into());
    params.env.insert("KITTY_WINDOW_ID".into(), "1".into());
    let mut spawned = terminals.spawn(params).await.unwrap();
    let printed = drain(&mut spawned.output).await;
    assert!(
        printed.contains("term=xterm-256color program=none version=none kitty=none"),
        "{printed:?}"
    );
}
