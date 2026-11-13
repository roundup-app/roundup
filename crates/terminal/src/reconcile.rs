//! MC52, MC54: the core's live list, read by roundup's labels, decides what runs for an Agent.
//! A Terminal without the Project label is the user's own and is never read into a step.
use std::collections::BTreeMap;

use serde_json::{Value, json};

const PROJECT: &str = "roundup.project";
const AGENT: &str = "roundup.agent";
const ATTEMPT: &str = "roundup.attempt";

/// What a Terminal roundup starts is labelled with, so the core's list names its owner.
pub fn labels(project: &str, agent: &str, attempt: &str) -> Value {
    json!({PROJECT: project, AGENT: agent, ATTEMPT: attempt})
}

/// One roundup-labelled Terminal in the core's list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listed {
    pub address: String,
    pub agent: String,
    pub finished: bool,
    /// The program is working now; a busy extra is shown until it is idle.
    pub busy: bool,
}

/// One thing to do so the live list matches the Agents.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    /// One live program: attach to it.
    Attach(String),
    /// None: start one labelled program for this Agent.
    Start(String),
    /// An idle extra, or the Terminal of an Agent that no longer exists: end it.
    End(String),
    /// A finished Terminal, once roundup has kept its screen and exit code: remove it.
    Remove(String),
}

/// The roundup-labelled Terminals of `project` in a `terminal.list` reply. Terminals the Project
/// label does not name are left out, so no later step can touch one (MC54).
pub fn parse(project: &str, reply: &Value) -> Vec<Listed> {
    let Some(list) = reply.get("terminals").and_then(Value::as_array) else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|t| {
            let label = |key: &str| t.pointer(&format!("/labels/{key}"))?.as_str();
            if label(PROJECT)? != project {
                return None;
            }
            Some(Listed {
                address: t.get("address")?.as_str()?.to_owned(),
                agent: label(AGENT)?.to_owned(),
                finished: t.get("state").and_then(Value::as_str) == Some("finished"),
                busy: t.get("busy").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect()
}

/// The steps that make `listed` match `agents`. Of two or more live programs for an Agent the
/// busiest, else the most recent (last in the list), stays; each idle extra ends and a busy extra
/// stays until it is idle.
pub fn plan(listed: &[Listed], agents: &[String]) -> Vec<Step> {
    let mut by_agent: BTreeMap<&str, Vec<&Listed>> = BTreeMap::new();
    for t in listed {
        by_agent.entry(&t.agent).or_default().push(t);
    }
    let mut steps = Vec::new();
    for (agent, terminals) in &by_agent {
        let known = agents.iter().any(|a| a == agent);
        let (finished, live): (Vec<&&Listed>, Vec<&&Listed>) =
            terminals.iter().partition(|t| t.finished);
        steps.extend(finished.iter().map(|t| Step::Remove(t.address.clone())));
        if !known {
            steps.extend(live.iter().map(|t| Step::End(t.address.clone())));
            continue;
        }
        let keep = live
            .iter()
            .rposition(|t| t.busy)
            .or(live.len().checked_sub(1));
        for (at, t) in live.iter().enumerate() {
            if Some(at) == keep {
                steps.push(Step::Attach(t.address.clone()));
            } else if !t.busy {
                steps.push(Step::End(t.address.clone()));
            }
        }
    }
    for agent in agents {
        if !by_agent
            .get(agent.as_str())
            .is_some_and(|ts| ts.iter().any(|t| !t.finished))
        {
            steps.push(Step::Start(agent.clone()));
        }
    }
    steps
}

/// Read the core's list filtered by the Project label and plan against `agents`. It never reads
/// a record of roundup's own.
pub async fn reconcile(
    conn: &herdr::Conn,
    project: &str,
    agents: &[String],
) -> Result<(Vec<Listed>, Vec<Step>), herdr::Error> {
    let reply = conn
        .call("terminal.list", json!({"labels": {PROJECT: project}}))
        .await?;
    let listed = parse(project, &reply);
    let steps = plan(&listed, agents);
    Ok((listed, steps))
}

/// Carry out an `End` or `Remove`: kill a live program, and `terminal.rm` the Terminal.
pub async fn apply(conn: &herdr::Conn, step: &Step) -> Result<(), herdr::Error> {
    match step {
        Step::End(address) => {
            // An idle program that already ended is no failure.
            let _ = conn
                .call("terminal.kill", json!({"terminal": address}))
                .await;
            conn.call("terminal.rm", json!({"terminal": address}))
                .await?;
        }
        Step::Remove(address) => {
            conn.call("terminal.rm", json!({"terminal": address}))
                .await?;
        }
        Step::Attach(_) | Step::Start(_) => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(address: &str, agent: &str, finished: bool, busy: bool) -> Listed {
        Listed {
            address: address.into(),
            agent: agent.into(),
            finished,
            busy,
        }
    }
    fn agents() -> Vec<String> {
        vec!["a".into()]
    }

    #[test]
    fn mc52_one_live_program_is_attached() {
        let steps = plan(&[at("t1", "a", false, false)], &agents());
        assert_eq!(steps, [Step::Attach("t1".into())]);
    }

    #[test]
    fn mc52_none_starts_one_labelled_program() {
        assert_eq!(plan(&[], &agents()), [Step::Start("a".into())]);
    }

    #[test]
    fn mc52_two_programs_end_the_idle_extra() {
        let steps = plan(
            &[at("t1", "a", false, false), at("t2", "a", false, false)],
            &agents(),
        );
        assert_eq!(steps, [Step::End("t1".into()), Step::Attach("t2".into())]);
    }

    #[test]
    fn mc52_a_busy_extra_is_shown_until_idle() {
        let steps = plan(
            &[at("t1", "a", false, true), at("t2", "a", false, false)],
            &agents(),
        );
        assert_eq!(steps, [Step::Attach("t1".into()), Step::End("t2".into())]);
        // A second busy program is no step: it is left alone until it is idle.
        let both = plan(
            &[at("t1", "a", false, true), at("t2", "a", false, true)],
            &agents(),
        );
        assert_eq!(both, [Step::Attach("t2".into())]);
    }

    #[test]
    fn mc52_finished_terminal_is_removed_and_replaced() {
        let steps = plan(&[at("t1", "a", true, false)], &agents());
        assert_eq!(steps, [Step::Remove("t1".into()), Step::Start("a".into())]);
    }

    #[test]
    fn mc52_terminal_of_a_deleted_agent_is_ended() {
        let steps = plan(&[at("t1", "gone", false, false)], &[]);
        assert_eq!(steps, [Step::End("t1".into())]);
    }

    #[test]
    fn mc54_unlabelled_terminals_are_untouched() {
        let reply = json!({"terminals":[
            {"address":"u1","state":"live","labels":{}},
            {"address":"u2","state":"finished"},
            {"address":"o1","state":"live","labels":{PROJECT:"other",AGENT:"a"}},
            {"address":"t1","state":"live","labels":labels("p","a","1")},
        ]});
        let listed = parse("p", &reply);
        assert_eq!(listed, [at("t1", "a", false, false)]);
        assert_eq!(plan(&listed, &agents()), [Step::Attach("t1".into())]);
    }
}
