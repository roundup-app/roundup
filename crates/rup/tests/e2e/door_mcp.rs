//! B24 and DCL7a through the real Daemon and the pinned Claude behind aimock: a Door reads its
//! Brief, calls its tools over MCP, and the Daemon's effects and authentication are read back.

use std::time::Duration;

use contracts::agent::RailNode;
use contracts::pad::Pad;
use contracts::todo::Todo;
use contracts::{Actor, ActorKind, EventData};
use serde_json::json;

use super::daemon::{self, Project};
use crate::{HOLD_PLAIN, REDUCE, SHOW_ME, actor, client_as, start_door};

#[tokio::test]
async fn b24_a_door_reads_its_brief_then_creates_and_updates_a_todo_over_mcp() {
    let project = daemon::start_real(
        "b24_a_door_reads_its_brief_then_creates_and_updates_a_todo_over_mcp",
        &[],
    );
    let mut client = project.subscribed().await;
    let workstream = client
        .request(
            "rail.createWorkstream",
            json!({"name": "workstream", "parent": null, "order":{"kind":"work","ask":"What is this Workstream for?","limits":[]}}),
        )
        .await
        .unwrap();
    let door = workstream["id"].as_str().unwrap().to_owned();
    client
        .request("rail.startDoor", json!({ "id": door }))
        .await
        .unwrap();

    let updated = project
        .next(&mut client, |data| match data {
            EventData::TodoUpdated(todo) if !todo.body.is_empty() => Some(todo),
            _ => None,
        })
        .await;
    let model = project.model.as_ref().unwrap();
    let result = model.tool_result("toolu_update_todo").await;
    assert!(
        result["content"]
            .as_str()
            .unwrap()
            .contains("owned files: none yet"),
        "{result}"
    );
    let journal = model.journal();
    let request = &journal
        .iter()
        .find(|entry| entry["body"]["tools"].is_array())
        .unwrap()["body"];
    let brief = request["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["role"] == "system")
        .map(|m| m["content"].as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(brief.contains("coordinating Door"), "{request}");
    assert!(
        !brief.contains(HOLD_PLAIN),
        "LC3: the Door's Brief omits the pinned hold:Plain body"
    );
    assert!(
        brief.contains(REDUCE) && brief.contains(SHOW_ME),
        "Q6: the pinned reduce and show-me bodies"
    );
    assert!(!brief.contains(&format!("Agent id is {door}")));
    assert_eq!(updated.title, "plan the workstream");
    assert_eq!(updated.body, "owned files: none yet");
    assert_eq!(
        updated.creator,
        Actor {
            kind: ActorKind::Agent,
            id: door,
            parent: None
        }
    );
    let stored: Vec<Todo> = serde_json::from_value(
        project
            .client()
            .await
            .request("todo.list", json!(null))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(
        (&stored[0].title, &stored[0].body),
        (&updated.title, &updated.body)
    );
}

/// DCL7a: wait until the fake model has been asked something containing `needle`.
async fn model_saw(project: &Project, needle: &str) {
    let model = project.model.as_ref().unwrap();
    let asked = || {
        model
            .journal()
            .iter()
            .map(|entry| entry["body"]["messages"].to_string())
            .collect::<Vec<_>>()
    };
    let seen = tokio::time::timeout(project.bound(), async {
        let mut tick = tokio::time::interval(Duration::from_millis(25));
        while !asked().iter().any(|body| body.contains(needle)) {
            tick.tick().await;
        }
    })
    .await;
    assert!(
        seen.is_ok(),
        "the model was never asked {needle:?}: {:#?}",
        asked().last()
    );
}

/// DCL7a: a Door at `door`, a Job `open-job` and, when `consult`, a Consult `idle-consult` under
/// it, each having finished its first turn.
async fn door_with_children(project: &Project, consult: bool) -> (String, String, String) {
    let user = project.client().await;
    let door = start_door(&user).await;
    let as_door = client_as(project, actor(ActorKind::Agent, &door)).await;
    let spawn = |name: &str, role: &str, ask: &str| {
        json!({"name": name, "parent": door, "cwd": project.dir.path(), "role": role,
            "prompt": ask, "order": {"kind": "work", "ask": ask, "limits": []}})
    };
    let job = as_door
        .request("agent.spawn", spawn("open-job", "job", "Do the one thing."))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut ids = vec![job.clone()];
    let mut idle = String::new();
    if consult {
        idle = as_door
            .request(
                "agent.spawn",
                spawn("idle-consult", "consult", "Answer when asked."),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        ids.push(idle.clone());
    }
    daemon::h21_poll("every child to finish a turn", async || {
        let tree = project.rail_tree(&user).await;
        ids.iter()
            .all(|id| {
                tree.iter()
                    .any(|n| n.id == *id && n.status.as_ref().is_some_and(|s| s.finished != "0"))
            })
            .then_some(())
    })
    .await;
    (door, job, idle)
}

#[tokio::test]
async fn dcl7_update_reconciles_todos_and_pads_through_mcp() {
    let project = daemon::start_real("dcl7_update_reconciles_todos_and_pads_through_mcp", &[]);
    let user = project.client().await;
    for title in ["untouched", "reconcile"] {
        user.request("todo.create", json!({ "title": title }))
            .await
            .unwrap();
    }
    user.request(
        "pad.create",
        json!({"name": "notes", "text": "before the update"}),
    )
    .await
    .unwrap();

    door_with_children(&project, false).await;

    // The Daemon's own stop note about the open Job is the delivered update; the Door answers it
    // with the two scripted tool calls.
    let model = project.model.as_ref().unwrap();
    model.tool_result("toolu_dcl7_pad").await;
    let todos: Vec<Todo> =
        serde_json::from_value(user.request("todo.list", json!(null)).await.unwrap()).unwrap();
    let by_title = |title: &str| todos.iter().find(|t| t.title == title).unwrap();
    assert_eq!(by_title("reconcile").body, "job ended");
    assert_eq!(by_title("untouched").body, "");
    let pad: Pad = serde_json::from_value(
        user.request("pad.read", json!({"name": "notes"}))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(pad.text, "after the update");
}

#[tokio::test]
async fn dcl7_restart_resumes_only_jobs_selected_by_door() {
    let mut project = daemon::start_real("dcl7_restart_resumes_only_jobs_selected_by_door", &[]);
    let (door, job, consult) = door_with_children(&project, true).await;
    model_saw(&project, "[stopped]").await;
    begin_second_turn(&project, &job).await;
    let before = project.model.as_ref().unwrap().journal().len();
    quit_and_relaunch(&mut project).await;
    let user = project.client().await;
    let tree = project.rail_tree(&user).await;
    let node = |tree: &[RailNode], id: &str| tree.iter().find(|n| n.id == id).cloned().unwrap();
    let (job_before, consult_before) = (node(&tree, &job), node(&tree, &consult));
    // (c) Nothing is launched or resumed by the restart itself.
    assert!(job_before.terminal_id.is_none() && consult_before.terminal_id.is_none());
    assert_eq!(project.model.as_ref().unwrap().journal().len(), before);

    start_door_again(&user, &door).await;
    // (b) The Door's start text holds the open-Job snapshot, and only the Job is resumed, by the
    // Door's own call.
    model_saw(&project, "[open jobs]").await;
    model_saw(&project, &format!("- {job} open-job (attempt 1)")).await;
    resume_result(&project).await;
    let tree = project.rail_tree(&user).await;
    assert_ne!(node(&tree, &job).attempt, job_before.attempt);
    let consult_after = node(&tree, &consult);
    assert_eq!(consult_after.attempt, consult_before.attempt);
    assert!(consult_after.terminal_id.is_none());
}

/// DCR4: a quit cuts off one Job mid-turn while another has reported; after the relaunch the Door
/// calls `agent_resume` without `mode` and only the cut-off Job carries on.
#[tokio::test]
async fn dcr4_relaunch_carries_on_the_cut_off_job_only() {
    let mut project = daemon::start_real("dcr4_relaunch_carries_on_the_cut_off_job_only", &[]);
    let (door, job, _) = door_with_children(&project, false).await;
    let reported = reported_job(&project, &door).await;
    model_saw(&project, "[stopped]").await;
    begin_second_turn(&project, &job).await;
    quit_and_relaunch(&mut project).await;
    let user = project.client().await;
    let node = |tree: &[RailNode], id: &str| tree.iter().find(|n| n.id == id).cloned().unwrap();
    let tree = project.rail_tree(&user).await;
    let (job_before, reported_before) = (node(&tree, &job), node(&tree, &reported));

    start_door_again(&user, &door).await;
    model_saw(&project, "[open jobs]").await;
    resume_result(&project).await;
    let tree = project.rail_tree(&user).await;
    assert_ne!(node(&tree, &job).attempt, job_before.attempt);
    // The reported Job is not launched again and the start note never names it.
    let reported_after = node(&tree, &reported);
    assert_eq!(reported_after.attempt, reported_before.attempt);
    assert!(reported_after.terminal_id.is_none());
    let model = project.model.as_ref().unwrap();
    assert!(
        model
            .journal()
            .iter()
            .map(|entry| entry["body"]["messages"].to_string())
            .filter(|asked| asked.contains("[open jobs]"))
            .all(|asked| !asked.contains(&format!("- {reported} "))),
        "the start note names the reported Job"
    );
}

/// DCR4: the Job's own process reports from inside its Claude tree, the only place the Daemon
/// takes a report from.
const JOB_REPORT: &str = r#"import hashlib,json,os,socket,time
id=os.environ['ROUNDUP_AGENT']
s=socket.socket(socket.AF_UNIX);s.settimeout(10);s.connect(os.environ['RUPD_SOCKET']);f=s.makefile('rb')
n=0
def call(method,p):
 global n
 n+=1;s.sendall((json.dumps({'jsonrpc':'2.0','id':n,'method':method,'params':p})+'\n').encode())
 while True:
  r=json.loads(f.readline())
  if r.get('id')==n:
   assert 'result' in r,r
   return r['result']
call('daemon.identify',{'actor':{'kind':'agent','id':id,'parent':None}})
end=time.monotonic()+10
while True:
 ins=call('agent.instructions',{'id':id})
 ds=[d for d in ins['deliveries'] if d['state']=='submitted']
 if ds:break
 assert time.monotonic()<end,'no submitted instruction'
 time.sleep(.05)
text=b'job output'
open(os.path.join(ins['project'],'output.txt'),'wb').write(text)
pub=call('deliverable.publish',{'key':'out','title':'Output','target':{'kind':'file','path':'output.txt'}})
call('message.report',{'project':ins['project'],'id':id,'key':'out','delivery':ds[-1]['id'],'target':{'id':'out','revision':'v1'},'output':{'project':pub['project'],'id':pub['id']},'result':'Done.','next':'','state':'reported','check':{'kind':'publication','sha256':hashlib.sha256(text).hexdigest()}})
"#;

/// DCR4: a Job that sent its report: it finished a turn and published its output.
async fn reported_job(project: &Project, door: &str) -> String {
    let as_door = client_as(project, actor(ActorKind::Agent, door)).await;
    std::fs::write(project.dir.path().join("report-job.py"), JOB_REPORT).unwrap();
    // The Project's settings pin the permission mode; allow only the reporting script.
    std::fs::write(
        project.dir.path().join(".claude/settings.json"),
        json!({"permissions": {"defaultMode": "default", "allow": ["Bash(python3 report-job.py)"]}})
            .to_string(),
    )
    .unwrap();
    let id = as_door
        .request(
            "agent.spawn",
            json!({"name": "reported-job", "parent": door, "cwd": project.dir.path(),
                "role": "job", "prompt": "Report the one thing.",
                "order": {"kind": "work", "ask": "Report the one thing.", "limits": []}}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    project
        .model
        .as_ref()
        .unwrap()
        .tool_result("toolu_dcr4_report")
        .await;
    let user = project.client().await;
    daemon::h21_poll("the reporting Job to finish its turn", async || {
        let tree = project.rail_tree(&user).await;
        tree.iter()
            .any(|n| {
                n.id == id
                    && n.status
                        .as_ref()
                        .is_some_and(|s| s.kind == contracts::Kind::Idle)
            })
            .then_some(())
    })
    .await;
    id
}

/// DCL7a, DCR4: the Job begins a second turn that the quit interrupts.
async fn begin_second_turn(project: &Project, job: &str) {
    daemon::signal(
        &project.client().await,
        job,
        json!({"hook_event_name": "UserPromptSubmit"}),
    )
    .await;
}

/// DCL7a, DCR4: the App quits and relaunches with the routed fake Claude.
async fn quit_and_relaunch(project: &mut Project) {
    let claude = daemon::aimock::routed_claude(project.dir.path());
    let home = project.dir.path().join("home");
    let url = project.model.as_ref().unwrap().url.clone();
    project.close().await;
    project.restart(&[
        ("ROUNDUP_CLAUDE_BIN", claude.to_str().unwrap()),
        ("HOME", home.to_str().unwrap()),
        ("CLAUDE_CODE_OAUTH_TOKEN", ""),
        ("AIMOCK_URL", &url),
    ]);
}

/// DCL7a, DCR4: the Door starts again; its first batch carries the snapshot.
async fn start_door_again(user: &::rpc::Client, door: &str) {
    user.request("rail.startDoor", json!({ "id": door }))
        .await
        .unwrap();
    user.request(
        "message.send",
        json!({"to": door, "kind": "note", "body": "Where do things stand?"}),
    )
    .await
    .unwrap();
}

/// DCL7a, DCR4: the Door's own `agent_resume` call, with no `mode`, was accepted.
async fn resume_result(project: &Project) {
    let result = project
        .model
        .as_ref()
        .unwrap()
        .tool_result("toolu_dcl7_resume")
        .await;
    assert!(result["is_error"] != true, "{result}");
}
