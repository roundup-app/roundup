use agents::placement::{AskPart, Destination, Placement, Request, place};
use async_trait::async_trait;
use std::sync::Mutex;

struct Answer(Vec<AskPart>);
#[async_trait]
impl Placement for Answer {
    async fn call(&self, _id: &str, _request: &Request) -> Result<Vec<AskPart>, String> {
        Ok(self.0.clone())
    }
}

#[tokio::test]
async fn a39_an_answer_that_is_not_a_checked_span_is_unclear() {
    let request = Request::new("fix café then ship".into(), vec![], vec![]);
    for (parts, cause) in [
        (
            vec![part(
                "repair café",
                Destination::New {
                    title: "Repair".into(),
                },
            )],
            "span",
        ),
        (
            vec![part(
                "fix café",
                Destination::Routed {
                    workstream: "gone".into(),
                },
            )],
            "unknown",
        ),
        (
            vec![part(
                "fix café",
                Destination::New {
                    title: "one two three four five six seven".into(),
                },
            )],
            "title",
        ),
        (
            vec![part("fix café", Destination::New { title: "  ".into() })],
            "title",
        ),
        (
            vec![part(
                "",
                Destination::New {
                    title: "Repair".into(),
                },
            )],
            "empty",
        ),
        (
            vec![
                part(
                    "fix café",
                    Destination::New {
                        title: "Repair".into(),
                    },
                ),
                part(
                    "café",
                    Destination::New {
                        title: "Ship".into(),
                    },
                ),
            ],
            "overlap",
        ),
        (vec![], "empty"),
        (
            vec![part(
                "fix café",
                Destination::Unclear {
                    question: "Where?".into(),
                    candidates: vec!["x".into(); 4],
                },
            )],
            "three",
        ),
        (
            vec![part(
                "fix café",
                Destination::Unclear {
                    question: "Where?".into(),
                    candidates: vec!["gone".into()],
                },
            )],
            "unknown",
        ),
    ] {
        let logs = Mutex::new(vec![]);
        let result = place(&Answer(parts), "ask-39", &request, |id, cause| {
            logs.lock().unwrap().push((id.to_owned(), cause.to_owned()))
        })
        .await;
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].text, "fix café then ship");
        let Destination::Unclear {
            question,
            candidates,
        } = &result[0].destination
        else {
            panic!("{result:?}")
        };
        assert!(
            question.starts_with("Couldn't place this: ") && question.contains(cause),
            "{question}"
        );
        assert!(candidates.is_empty());
        let logs = logs.lock().unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].0, "ask-39");
        assert_eq!(question, &format!("Couldn't place this: {}", logs[0].1));
    }
}
fn part(text: &str, destination: Destination) -> AskPart {
    AskPart {
        text: text.into(),
        destination,
    }
}

#[tokio::test]
async fn a39_a_failed_or_slow_call_is_unclear_and_logged_once() {
    use agents::claude_code::Launcher;
    use std::{os::unix::fs::PermissionsExt, sync::Arc, time::Duration};
    for (body, cause) in [
        ("sys.exit(7)", "exit"),
        ("print('{}')", "structured output"),
        (
            r#"print('{"structured_output":{"parts":[{"text":"/skill 原文","kind":"routed"}]}}')"#,
            "structured output",
        ),
        ("pass", "structured output"),
        ("while True: pass", "timed out after 60 seconds"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("fault");
        let started = dir.path().join("started");
        std::fs::write(&bin, format!("#!/usr/bin/env python3\nimport os, sys\nsys.stdin.read()\nwith open({:?}, 'w') as f: f.write(str(os.getpid()))\nos.replace({:?}, {:?})\n{body}\n", started.with_extension("tmp").to_str().unwrap(), started.with_extension("tmp").to_str().unwrap(), started.to_str().unwrap())).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let call = Launcher::new(
            bin.to_str().unwrap(),
            dir.path().join("config"),
            dir.path().join("rup"),
            None,
        )
        .placement(dir.path());
        let logs = Arc::new(Mutex::new(vec![]));
        let sink = logs.clone();
        let task = tokio::spawn(async move {
            place(
                &call,
                "ask-failed",
                &Request::new("/skill 原文".into(), vec![], vec![]),
                |id, cause| sink.lock().unwrap().push((id.to_owned(), cause.to_owned())),
            )
            .await
        });
        if cause.starts_with("timed") {
            tokio::time::timeout(Duration::from_secs(10), async {
                while !started.exists() {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            tokio::time::pause();
            tokio::time::advance(Duration::from_secs(59)).await;
            assert!(!task.is_finished());
            tokio::time::advance(Duration::from_secs(1)).await;
        }
        let result = task.await.unwrap();
        if cause.starts_with("timed") {
            tokio::time::resume();
        }
        assert_eq!(
            result,
            vec![part(
                "/skill 原文",
                Destination::Unclear {
                    question: format!("Couldn't place this: {}", logs.lock().unwrap()[0].1),
                    candidates: vec![]
                }
            )]
        );
        let logs = logs.lock().unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].0, "ask-failed");
        assert!(logs[0].1.contains(cause), "{logs:?}");
        let pid: i32 = std::fs::read_to_string(started).unwrap().parse().unwrap();
        assert!(
            rustix::process::test_kill_process(rustix::process::Pid::from_raw(pid).unwrap())
                .is_err(),
            "call still running or unreaped"
        );
    }
}

#[tokio::test]
async fn a39_checked_parts_preserve_the_original_bytes() {
    let request = Request::new("café café /ship 原文".into(), vec![], vec![]);
    let parts = vec![
        part(
            "café",
            Destination::New {
                title: "Repair".into(),
            },
        ),
        part(
            "café",
            Destination::New {
                title: "More repair".into(),
            },
        ),
        part(
            "/ship 原文",
            Destination::Unclear {
                question: "Where?".into(),
                candidates: vec![],
            },
        ),
    ];
    assert_eq!(
        place(
            &Answer(parts.clone()),
            "accepted",
            &request,
            |_, cause| panic!("{cause}")
        )
        .await,
        parts
    );
}

#[test]
fn a39_input_holds_five_newest_asks_and_all_workstream_facts() {
    use agents::placement::EarlierAsk;
    use serde_json::json;
    let rail = rail();
    let earlier = (0..7)
        .map(|at| EarlierAsk {
            at,
            parts: vec![part(
                &format!("earlier {at}"),
                Destination::Routed {
                    workstream: "work".into(),
                },
            )],
        })
        .collect();
    let value = serde_json::to_value(Request::new("now".into(), earlier, rail)).unwrap();
    assert_eq!(
        value["earlier"]
            .as_array()
            .unwrap()
            .iter()
            .map(|ask| ask["at"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        [6, 5, 4, 3, 2]
    );
    assert_eq!(
        value["earlier"][0]["parts"][0],
        json!({"text":"earlier 6", "kind":"routed", "workstream":"work"})
    );
    assert_eq!(
        value["workstreams"],
        json!([
            {"id":"work", "name":"Repair", "title":"Fix café", "ask":"Fix the coffee", "question":null, "status":"idle"},
            {"id":"question", "name":"Question", "title":null, "ask":null, "question":"Which ship?", "status":null}
        ])
    );
}

#[tokio::test]
async fn a39_repeated_text_can_use_a_later_nonoverlapping_span() {
    let request = Request::new("ababa".into(), vec![], vec![]);
    let parts = vec![
        part(
            "aba",
            Destination::New {
                title: "Long".into(),
            },
        ),
        part(
            "ab",
            Destination::New {
                title: "Short".into(),
            },
        ),
    ];
    assert_eq!(
        place(
            &Answer(parts.clone()),
            "repeated",
            &request,
            |_, cause| panic!("{cause}")
        )
        .await,
        parts
    );
}

fn rail() -> Vec<contracts::agent::RailNode> {
    use serde_json::json;
    [
        json!({"id":"work", "kind":"workstream", "name":"Repair", "parent":null, "order":0, "status":{"kind":"idle", "label":"idle", "since":0}, "attempt":null, "status_revision":null, "terminal_id":null, "worktree":null, "can_resume":false, "channel":null, "work":{"kind":"work", "title":"Fix café", "ask":"Fix the coffee", "limits":[]}, "stray":[], "model":null, "effort":null}),
        json!({"id":"question", "kind":"workstream", "name":"Question", "parent":null, "order":1, "status":null, "attempt":null, "status_revision":null, "terminal_id":null, "worktree":null, "can_resume":false, "channel":null, "work":{"kind":"clarification", "question":"Which ship?"}, "stray":[], "model":null, "effort":null}),
    ].into_iter().map(|node| serde_json::from_value(node).unwrap()).collect()
}

#[tokio::test]
async fn a39_known_workstreams_can_be_routed_or_candidates() {
    let request = Request::new("repair; question".into(), vec![], rail());
    let parts = vec![
        part(
            "repair",
            Destination::Routed {
                workstream: "work".into(),
            },
        ),
        part(
            "question",
            Destination::Unclear {
                question: "Which?".into(),
                candidates: vec!["work".into(), "question".into()],
            },
        ),
    ];
    assert_eq!(
        place(
            &Answer(parts.clone()),
            "known",
            &request,
            |_, cause| panic!("{cause}")
        )
        .await,
        parts
    );
}

#[test]
fn a39_unplaceable_repeated_spans_return_unclear_promptly() {
    let (sent, received) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let request = Request::new(
            format!("{}{}", "ab".repeat(12), "b".repeat(20)),
            vec![],
            vec![],
        );
        let parts = vec![
            part(
                "a",
                Destination::New {
                    title: "Repair".into()
                }
            );
            13
        ];
        let result = runtime.block_on(place(&Answer(parts), "repeated", &request, |_, _| {}));
        let _ = sent.send((request.text, result));
    });
    // A synchronous parser cannot be interrupted by a Tokio timeout on its own executor.
    let (text, result) = received
        .recv_timeout(std::time::Duration::from_secs(2))
        .expect("unplaceable repeated spans must finish promptly");
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].text, text);
    assert!(
        matches!(&result[0].destination, Destination::Unclear { candidates, .. } if candidates.is_empty())
    );
}

#[test]
fn a3507c_placement_extends_settings_without_tools() {
    use agents::claude_code::Launcher;
    use serde_json::{Value, json};
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("custom-config");
    let project = dir.path().join("project");
    let cwd = dir.path().join("empty");
    std::fs::create_dir_all(&config).unwrap();
    std::fs::create_dir_all(project.join(".claude")).unwrap();
    std::fs::create_dir(&cwd).unwrap();
    std::fs::write(config.join("settings.json"), json!({"future": {"user": true}, "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "user-hook"}]}]}}).to_string()).unwrap();
    std::fs::write(
        project.join(".claude/settings.json"),
        json!({"future": {"project": true, "winner": "project"}}).to_string(),
    )
    .unwrap();
    std::fs::write(
        project.join(".claude/settings.local.json"),
        json!({"future": {"winner": "local"}}).to_string(),
    )
    .unwrap();
    let launcher = Launcher::from_vars(
        |key| match key {
            "CLAUDE_CONFIG_DIR" => Some(config.clone().into_os_string()),
            _ => None,
        },
        &dir.path().join("rupd"),
    )
    .unwrap();
    let call = launcher.placement(&project);
    let command = call.command(&cwd).unwrap();
    let command = command.as_std();
    let argv: Vec<_> = command.get_args().map(|s| s.to_str().unwrap()).collect();
    let after = |flag| argv[argv.iter().position(|arg| *arg == flag).unwrap() + 1];
    let settings: Value = serde_json::from_str(after("--settings")).unwrap();
    assert_eq!(
        settings["future"],
        json!({"user": true, "project": true, "winner": "local"})
    );
    assert_eq!(
        settings["hooks"]["Stop"][0]["hooks"][0]["command"],
        "user-hook"
    );
    assert_eq!(after("--model"), "haiku");
    assert_eq!(after("--effort"), "low");
    assert_eq!(after("--tools"), "");
    for flag in [
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--json-schema",
    ] {
        assert!(argv.contains(&flag));
    }
    assert!(!argv.contains(&"--setting-sources"));
    assert!(!argv.contains(&"--mcp-config"));
    assert_eq!(command.get_current_dir(), Some(cwd.as_path()));
    let removals: Vec<_> = command
        .get_envs()
        .filter_map(|(key, value)| value.is_none().then_some(key.to_str().unwrap()))
        .collect();
    assert_eq!(removals.len(), agents::claude_code::MARKERS.len());
    for marker in agents::claude_code::MARKERS {
        assert!(removals.contains(&marker));
    }
}
