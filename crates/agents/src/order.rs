//! O2: the Steer an Agent's order becomes at its first `SessionStart`.

use contracts::agent::Order;

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

pub(crate) fn first_input(
    first: Option<String>,
    work: Option<&Order>,
    details: Option<&str>,
    explicit: bool,
) -> Option<String> {
    match first {
        Some(text) => (!text.is_empty()).then_some(text),
        None => work.filter(|_| explicit).map(|work| steer(work, details)),
    }
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
