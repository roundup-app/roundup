//! Z3788a: bounded raw replay through the real Terminal owner and dispatch.
use base64::{Engine, engine::general_purpose::STANDARD};
use contracts::Actor;
use rpc::{Module, code};
use serde_json::{Value, json};
use terminal::Output;

use crate::common::{ctx, open, sh, until_exit, until_printed};

#[tokio::test]
async fn z3788a_raw_catch_up_and_subscription_overlap_keep_binary_bytes_once() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, bus) = open(&dir);
    // Each read gates a split UTF-8, SIXEL or IIP sequence; no timing-dependent chunk split.
    let spawned = terminals.spawn(sh(dir.path(),
        r"stty -opost -echo; printf '\303'; read x; printf '\251\033Pq'; read x; printf '#0!2~\033'; read x; printf '\\\033]1337;File=inline=1:'; read x; printf 'AA==\007later'; read x; printf 'tail\000\377'; read x"
    )).await.unwrap();
    let info = terminals
        .list()
        .await
        .into_iter()
        .find(|t| t.id == spawned.id)
        .unwrap();
    let mut observer = spawned.output;
    let first = observer.next().await.unwrap();
    assert!(matches!(first, Output::Bytes { offset: 0, ref bytes } if bytes.as_ref() == b"\xc3"));
    let mut live = terminals.subscribe_output(&spawned.id).unwrap();
    let start = live.start();
    let mut observed = 1;
    // Wait for each complete stage at the public output seam before releasing the next read.
    for length in [5, 11, 33, 43] {
        terminals.write(&spawned.id, b"go\n").await.unwrap();
        while observed < length {
            match observer.next().await.unwrap() {
                Output::Bytes { bytes, .. } => observed += bytes.len(),
                Output::Gap { .. } => panic!("split sequence lost"),
            }
        }
        assert_eq!(observed, length);
    }
    let value = terminals
        .call(
            &ctx(&dir, &bus),
            "terminal.catchUp",
            json!({
                "id": spawned.id, "incarnation": info.incarnation, "after": 0
            }),
        )
        .await
        .unwrap();
    assert_eq!(value["kind"], "contiguous");
    assert_eq!(value["id"], spawned.id);
    assert_eq!(value["incarnation"], info.incarnation);
    assert_eq!(value["from"], 0);
    let bytes = STANDARD.decode(value["data"].as_str().unwrap()).unwrap();
    let expected = b"\xc3\xa9\x1bPq#0!2~\x1b\\\x1b]1337;File=inline=1:AA==\x07later";
    assert_eq!(bytes, expected);
    let cut = value["after"].as_u64().unwrap();
    assert_eq!(cut, expected.len() as u64);
    // A known offset can be inside UTF-8; catch-up never decodes or rounds it.
    match terminals
        .catch_up(&contracts::terminal::CatchUpParams {
            id: spawned.id.clone(),
            incarnation: info.incarnation.clone(),
            after: 1,
        })
        .unwrap()
    {
        contracts::terminal::CatchUp::Contiguous {
            from, after, data, ..
        } => {
            assert_eq!((from, after), (1, cut));
            assert_eq!(STANDARD.decode(data).unwrap(), &expected[1..]);
        }
        contracts::terminal::CatchUp::Gap { .. } => panic!("retained offset became a gap"),
    }
    // Live delivery overlaps the catch-up. Skip bytes through the cut, then continue normally.
    let mut next = start;
    while next < cut {
        match live.next().await.unwrap() {
            Output::Bytes { offset, bytes } => {
                assert_eq!(offset, next);
                next += bytes.len() as u64;
                assert_eq!(&expected[offset as usize..next as usize], bytes.as_ref());
            }
            Output::Gap { .. } => panic!("small replay must fit the live backlog"),
        }
    }
    terminals.write(&spawned.id, b"done\n").await.unwrap();
    until_printed(&mut observer, "tail").await;
    let mut tail = Vec::new();
    while tail.len() < 6 {
        match live.next().await.unwrap() {
            Output::Bytes { offset, bytes } => {
                assert_eq!(offset, cut + tail.len() as u64);
                tail.extend_from_slice(&bytes);
            }
            Output::Gap { .. } => panic!("tail lost"),
        }
    }
    assert_eq!(tail, b"tail\x00\xff");
    let replay = terminals
        .call(
            &ctx(&dir, &bus),
            "terminal.catchUp",
            json!({
                "id":spawned.id, "incarnation":info.incarnation, "after":cut,
            }),
        )
        .await
        .unwrap();
    assert_eq!(replay["after"], cut + 6);
    assert_eq!(
        STANDARD.decode(replay["data"].as_str().unwrap()).unwrap(),
        tail
    );
    terminals.kill(&spawned.id).await.unwrap();
}

#[tokio::test]
async fn z3788a_eviction_is_a_gap_and_future_offsets_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, bus) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(dir.path(), "stty -opost -echo; yes x | head -c 1048600"))
        .await
        .unwrap();
    until_exit(&mut spawned).await;
    let info = terminals.list().await.remove(0);
    let request =
        |after| json!({"id": spawned.id, "incarnation": info.incarnation, "after": after});
    let context = ctx(&dir, &bus);
    let gap = terminals
        .call(&context, "terminal.catchUp", request(0))
        .await
        .unwrap();
    assert_eq!(
        gap,
        json!({"kind":"gap", "id":spawned.id,"incarnation":info.incarnation,"from":24,"after":1048600})
    );
    let retained = terminals
        .call(&context, "terminal.catchUp", request(24))
        .await
        .unwrap();
    assert_eq!(
        STANDARD.decode(retained["data"].as_str().unwrap()).unwrap(),
        b"x\n".repeat(524288)
    );
    let empty = terminals
        .call(&context, "terminal.catchUp", request(1048600))
        .await
        .unwrap();
    assert_eq!(empty["data"], "");
    assert_eq!(
        terminals
            .call(&context, "terminal.catchUp", request(1048601))
            .await
            .unwrap_err()
            .code,
        code::INVALID_PARAMS
    );
    // A gap leaves the existing authoritative snapshot recovery available.
    assert_eq!(terminals.snapshot(&spawned.id).unwrap().after, 1048600);
}

#[tokio::test]
async fn z3788a_catch_up_refuses_other_incarnations_projects_and_roles() {
    let dir = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let (terminals, bus) = open(&dir);
    let (foreign, _) = open(&other);
    let mut a = terminals.spawn(sh(dir.path(), "true")).await.unwrap();
    let mut b = foreign.spawn(sh(other.path(), "true")).await.unwrap();
    until_exit(&mut a).await;
    until_exit(&mut b).await;
    let info = terminals.list().await.remove(0);
    let foreign_info = foreign.list().await.remove(0);
    let request = |incarnation: &str| json!({"id":a.id,"incarnation":incarnation,"after":0});
    let mut context = ctx(&dir, &bus);
    assert_eq!(
        terminals
            .call(
                &context,
                "terminal.catchUp",
                request(&foreign_info.incarnation)
            )
            .await
            .unwrap_err()
            .code,
        code::CONFLICT
    );
    for kind in [contracts::ActorKind::Agent, contracts::ActorKind::Ext] {
        let actor = Actor {
            kind,
            id: "other".into(),
            parent: None,
        };
        context.actor = actor;
        assert_eq!(
            terminals
                .call(&context, "terminal.catchUp", request(&info.incarnation))
                .await
                .unwrap_err()
                .code,
            code::FORBIDDEN
        );
    }
    context.actor = Actor::user();
    let result: Value = terminals
        .call(&context, "terminal.catchUp", request(&info.incarnation))
        .await
        .unwrap();
    assert_eq!(result["kind"], "contiguous");
}
