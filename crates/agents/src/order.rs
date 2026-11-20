//! O2: the Steer an Agent's order becomes at its first `SessionStart`.

use crate::rail_view::{valid_explicit_order, valid_order};
use contracts::agent::Order;
use rpc::{RpcError, code};

/// What a Clarification order's Steer tells the Agent after the question.
const CLARIFY: &str = "Find the intent and elicit what is missing, asking whom \
    `agent_context` names under `ask`. Then record a Work order with `agent_set_order`.";

/// Whether `prompt` is the Steer of a Clarification order, which names no Agent: a question that
/// is no one's ask must not become the Agent's name (A44).
pub(crate) fn is_clarification_steer(prompt: &str) -> bool {
    prompt.contains(CLARIFY)
}

/// For a Work order, the ask, then `Done when:` and the done condition (left out when absent),
/// then `Limits:` and one line per limit (left out when there are none), then the Spawn prompt
/// under `Details:` (left out when there is none, O9). For a Clarification order, the question
/// and what to do about it.
pub(crate) fn steer(order: &Order, prompt: Option<&str>) -> String {
    match order {
        Order::Work {
            ask, done, limits, ..
        } => {
            let mut text = ask.clone();
            if let Some(done) = done {
                text.push_str(&format!("\n\nDone when: {done}"));
            }
            if !limits.is_empty() {
                let lines: String = limits.iter().map(|limit| format!("\n- {limit}")).collect();
                text.push_str(&format!("\n\nLimits:{lines}"));
            }
            if let Some(prompt) = prompt {
                text.push_str(&format!("\n\nDetails:\n{prompt}"));
            }
            text
        }
        Order::Clarification { question } => format!("{question}\n\n{CLARIFY}"),
    }
}

/// Supplied words, or an explicit order on its first Attempt; retained orders stay passive.
pub(crate) fn first_input(
    first: Option<String>,
    work: Option<&Order>,
    details: Option<&str>,
    has_order_revision: bool,
    attempt: &str,
) -> Option<String> {
    match first {
        Some(text) => (!text.is_empty()).then_some(text),
        None => work
            .filter(|_| has_order_revision && attempt == "1")
            .map(|work| steer(work, details)),
    }
}

/// DCL9: an Agent's spawn names Job, Consult or Mode; the user's names none.
pub(crate) fn check_role(
    role: Option<contracts::agent::SpawnRole>,
    by_agent: bool,
) -> Result<Option<contracts::agent::SpawnRole>, RpcError> {
    if by_agent && role.is_none() {
        return Err(RpcError::new(
            code::INVALID_PARAMS,
            "an Agent's spawn needs a `role`: `job` for one bounded outcome that ends with a \
             report, `consult` for a Subagent that answers questions and rests, `mode` for a \
             Mode under you that keeps a first prompt and asks the user",
        ));
    }
    if !by_agent && role.is_some() {
        return Err(RpcError::new(
            code::INVALID_PARAMS,
            "`role` is for an Agent's spawn",
        ));
    }
    Ok(role)
}

/// O2, O8: the Order a spawn starts with and the prompt kept beside it.
pub(crate) fn order_of(
    prompt: Option<String>,
    order: Option<Order>,
    by_agent: bool,
) -> Result<(Option<Order>, Option<String>), RpcError> {
    let explicit = order.is_some();
    let (order, spawn_prompt) = match (prompt, order) {
        (Some(prompt), Some(order)) if by_agent => (Some(order), Some(prompt)),
        (Some(_), Some(_)) => {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "prompt and order are exclusive",
            ));
        }
        (Some(_), None) if by_agent => {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "an Agent's spawn needs an `order` with the ask, the done condition and the \
                 limits; add it, and keep the working detail in `prompt`",
            ));
        }
        (Some(prompt), None) => (Some(Order::work(&prompt)), None),
        (None, order) => (order, None),
    };
    if let Some(order) = &order {
        if explicit {
            valid_explicit_order(order)?;
        } else {
            valid_order(order)?;
        }
    }
    Ok((order, spawn_prompt))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o2_a_work_order_steers_the_ask_then_one_line_per_limit() {
        let order = Order::Work {
            title: None,
            ask: "fix the build".into(),
            done: Some("CI is green".into()),
            limits: vec!["touch CI".into(), "push".into()],
        };
        assert_eq!(
            steer(&order, Some("see the log")),
            "fix the build\n\nDone when: CI is green\n\nLimits:\n- touch CI\n- push\n\nDetails:\nsee the log"
        );
        assert_eq!(steer(&Order::work("fix the build"), None), "fix the build");
    }
}
