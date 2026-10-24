//! Decisions: the Card that blocks an Agent on a live hook or tool call (`GLOSSARY.md`). The user
//! answers any; an Agent answers those of Agents in its Reach (H21); see `scenarios/decisions.md`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "decision/")]
pub struct Decision {
    pub id: String,
    pub agent: String,
    pub tool: String,
    pub args: String,
    /// Milliseconds since the Unix epoch.
    #[ts(type = "number")]
    pub opened_at: i64,
    /// `false` when the Daemon opened it without a live hook to reply to (H2's `AskUserQuestion`,
    /// H7(c), H8's unreadable payload): `decision.answer` is then `INVALID_PARAMS`.
    pub answerable: bool,
    /// H23: how long an allow may last, `once` first; empty when the Decision is not an answerable
    /// permission request.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<Scope>>")]
    pub scopes: Vec<Scope>,
    /// H23: `destructive` for a command the Daemon recognises; absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub risk: Option<Risk>,
    /// U468: the latest refused Agent answer to this live request. Read through
    /// decision.list with its usual Reach filtering; no history entry is created.
    /// Replacement, clearing and successful delivery discard this observation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub failure: Option<FailedAnswer>,
}

/// H23: how long an allow lasts. `session` ends with the Agent; `project` is kept in the Project's
/// local Claude Code settings until `decision.revoke`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "decision/")]
pub enum Scope {
    Once,
    Session,
    Project,
}

/// H23: the only risk level; a command that deletes or overwrites work beyond undo.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "decision/")]
pub enum Risk {
    Destructive,
}

/// H23: remove the rule a `project` Grant added. The user's `proof` is required (H4).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "decision/")]
pub struct RevokeParams {
    pub id: String,
    #[ts(optional)]
    pub proof: Option<String>,
}

/// A refused answer, never an accepted AnsweredDecision. Only the latest failure
/// is retained, in memory with its original Decision. No Proof or submitted text
/// is retained. The App may refresh decision.list to read it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "decision/")]
pub struct FailedAnswer {
    pub attempt: String,
    pub answered_by: crate::Actor,
    #[ts(type = "number")]
    pub failed_at: i64,
    #[ts(type = "number")]
    pub error_code: i64,
    pub message: String,
}

/// U468: one successful answer, retained in Project data after its live hook ends.
/// `prompt` is the complete original tool input as JSON (the live Card's args may
/// be truncated for display). `answer` and `note` retain
/// exactly the accepted AnswerParams, without Proof. The Actor is authenticated.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "decision/")]
pub struct AnsweredDecision {
    pub decision: Decision,
    pub kind: RequestKind,
    pub prompt: String,
    pub attempt: String,
    pub answer: Option<String>,
    pub note: String,
    pub answered_by: crate::Actor,
    #[ts(type = "number")]
    pub answered_at: i64,
}

/// Whether the original Decision asks a question or requests permission. This is
/// independent of the tool name: a permission hook can name any tool.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "decision/")]
pub enum RequestKind {
    Question,
    Permission,
}

/// U468: read one Agent's answered Decisions, oldest first. The user may read any
/// Agent; an Agent may read only Agents in its Reach, just as with decision.list.
/// Records remain readable by the user even after the requesting Agent is removed.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "decision/")]
pub struct AnswersParams {
    pub agent: String,
}

/// A Decision's original prompt, scoped to one Daemon run and Attempt. It is an
/// identity, not permission: Proof and Reach are checked separately.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "decision/")]
pub struct PromptIdentity {
    pub daemon: String,
    pub agent: String,
    pub attempt: String,
    pub decision: String,
}

/// B6: capture the original prompt of a live Decision; unavailable identity is CONFLICT.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "decision/")]
pub struct CaptureParams {
    pub id: String,
}

/// Called by `rup permission`; waits until the Decision it opens is answered or cleared, except
/// when the Decision is not `answerable` (H2's `AskUserQuestion`), which returns at once with an
/// empty [`PermissionOutput`].
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "decision/")]
pub struct PermissionParams {
    pub id: String,
    #[ts(type = "Record<string, unknown>")]
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "decision/")]
pub struct PermissionOutput {
    /// What `rup permission` prints on stdout; empty for the `AskUserQuestion` case (H2).
    pub output: String,
}

/// Called by the `ask_user` tool of `rup mcp` (H14) for the Agent that calls it; waits until the
/// user answers with one of `answers` (zero to four), or with their own words, or the Decision is
/// cleared.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "decision/")]
pub struct AskParams {
    pub question: String,
    pub answers: Vec<AskAnswer>,
}

/// One answer the Agent offers (H14): the names are those of Claude Code's `AskUserQuestion`
/// options. A `label` ending ` (recommended)` marks the recommended answer.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "decision/")]
pub struct AskAnswer {
    pub label: String,
    /// The tradeoff: what the pick gains and what it costs.
    pub description: String,
    /// Markdown: a sketch of what the pick builds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub preview: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "decision/")]
pub struct AskOutput {
    /// The picked label, or `None` for the user's own answer.
    pub answer: Option<String>,
    /// The user's text, maybe empty.
    pub note: String,
}

/// The two words that answer a permission Decision (H3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "decision/")]
pub enum Answer {
    Allow,
    Deny,
}

impl Answer {
    pub fn from_word(word: &str) -> Option<Self> {
        match word {
            "allow" => Some(Self::Allow),
            "deny" => Some(Self::Deny),
            _ => None,
        }
    }
}

/// `answer` is `allow` or `deny` for a permission Decision (H3) and one of the asked labels, or
/// `None` for the user's own answer, for an `ask_user` Decision (H14); anything else is
/// `INVALID_PARAMS`. `note` is the user's text (up to 2000 characters), empty for a permission
/// Decision.
/// `proof` is checked against the value the Daemon holds (H4); a missing or wrong one is
/// `FORBIDDEN`, so the field must deserialize even when the caller sends none. An Agent's call is
/// judged by Reach instead (H21) and its `proof` is ignored.
/// U468: success durably retains the original prompt, answer and authenticated Actor.
/// A storage failure before delivery leaves the request actionable; a failure after
/// delivery is UNKNOWN_OUTCOME and must not be retried blindly.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "decision/")]
pub struct AnswerParams {
    /// The prompt the answer is for; a mismatch is CONFLICT with no effect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub identity: Option<PromptIdentity>,
    pub id: String,
    pub answer: Option<String>,
    #[serde(default)]
    #[ts(optional, as = "Option<String>")]
    pub note: String,
    /// H23: how long an allow lasts; absent is `once`. Only an `allow` of a Decision that lists
    /// the scope takes one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scope: Option<Scope>,
    #[ts(optional)]
    pub proof: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "decision/")]
pub enum Outcome {
    Allow,
    Deny,
    Replaced,
    AgentGone,
    Terminal,
    Answered,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "decision/")]
pub struct ClearedEvent {
    pub id: String,
    pub outcome: Outcome,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Decision {
        Decision {
            id: "d1".into(),
            agent: "a1".into(),
            tool: "Bash".into(),
            args: "touch spike_out.txt".into(),
            opened_at: 1_700_000_000_000,
            answerable: true,
            scopes: vec![],
            risk: None,
            failure: None,
        }
    }

    #[test]
    fn h2_decision_round_trips_through_json() {
        let decision = sample();

        let wire = serde_json::to_value(&decision).unwrap();
        let back: Decision = serde_json::from_value(wire).unwrap();

        assert_eq!(back, decision);
    }

    #[test]
    fn h2_decision_wire_shape_has_every_field_h2_names() {
        let wire = serde_json::to_value(sample()).unwrap();

        assert_eq!(
            wire,
            json!({
                "id": "d1",
                "agent": "a1",
                "tool": "Bash",
                "args": "touch spike_out.txt",
                "opened_at": 1_700_000_000_000i64,
                "answerable": true,
            })
        );
    }

    #[test]
    fn h2_permission_params_round_trip_the_payload_untouched() {
        let params = PermissionParams {
            id: "a1".into(),
            payload: json!({"hook_event_name": "PermissionRequest", "tool_name": "Bash"}),
        };

        let wire = serde_json::to_value(&params).unwrap();
        let back: PermissionParams = serde_json::from_value(wire).unwrap();

        assert_eq!(back.payload, params.payload);
    }

    #[test]
    fn h2_permission_output_is_empty_for_ask_user_question() {
        let output = PermissionOutput {
            output: String::new(),
        };

        let wire = serde_json::to_value(&output).unwrap();

        assert_eq!(wire, json!({"output": ""}));
    }

    #[test]
    fn h2_answer_is_the_word_allow_or_deny_on_the_wire() {
        assert_eq!(serde_json::to_value(Answer::Allow).unwrap(), json!("allow"));
        assert_eq!(serde_json::to_value(Answer::Deny).unwrap(), json!("deny"));
    }

    #[test]
    fn h2_answer_params_round_trip_with_the_proof() {
        let params = AnswerParams {
            identity: None,
            id: "d1".into(),
            answer: Some("deny".into()),
            note: String::new(),
            scope: None,
            proof: Some("secret".into()),
        };

        let wire = serde_json::to_value(&params).unwrap();
        let back: AnswerParams = serde_json::from_value(wire).unwrap();

        assert_eq!(back.id, params.id);
        assert_eq!(back.answer, params.answer);
        assert_eq!(back.proof, params.proof);
    }

    /// H3 and H14: any text deserializes, so an `ask_user` answer reaches the Daemon, which
    /// judges it against the Decision; only the two words answer a permission Decision.
    #[test]
    fn h14_answer_params_carry_any_text_and_the_two_words_parse() {
        let text = json!({"id": "d1", "answer": "cats", "proof": "secret"});

        let params: AnswerParams = serde_json::from_value(text).unwrap();

        assert_eq!(params.answer.as_deref(), Some("cats"));
        assert_eq!(Answer::from_word("allow"), Some(Answer::Allow));
        assert_eq!(Answer::from_word("deny"), Some(Answer::Deny));
        assert_eq!(Answer::from_word("ask"), None);
    }

    #[test]
    fn h14_an_own_answer_is_null_and_a_note_defaults_to_empty() {
        let own = json!({"id": "d1", "answer": null, "note": "both"});
        let bare = json!({"id": "d1", "answer": "a"});

        let own: AnswerParams = serde_json::from_value(own).unwrap();
        let bare: AnswerParams = serde_json::from_value(bare).unwrap();

        assert_eq!((own.answer, own.note.as_str()), (None, "both"));
        assert_eq!(bare.note, "");
    }

    #[test]
    fn h14_an_answer_takes_label_description_and_an_optional_preview() {
        let wire = json!({"label": "A", "description": "fast, costly"});

        let answer: AskAnswer = serde_json::from_value(wire.clone()).unwrap();

        assert_eq!(answer.preview, None);
        assert_eq!(serde_json::to_value(&answer).unwrap(), wire);
        assert!(serde_json::from_value::<AskAnswer>(json!("A")).is_err());
    }

    #[test]
    fn h14_outcome_answered_is_a_word_on_the_wire() {
        assert_eq!(
            serde_json::to_value(Outcome::Answered).unwrap(),
            json!("answered")
        );
    }

    /// H4: a missing `proof` must still deserialize, as `None`, so the Daemon can answer
    /// `FORBIDDEN` instead of `rpc::params` turning it into `INVALID_PARAMS` first.
    #[test]
    fn h4_a_missing_proof_deserializes_as_none() {
        let no_proof = json!({"id": "d1", "answer": "allow"});

        let params: AnswerParams = serde_json::from_value(no_proof).unwrap();

        assert_eq!(params.proof, None);
    }

    #[test]
    fn h2_outcome_agent_gone_is_hyphenated_on_the_wire() {
        assert_eq!(
            serde_json::to_value(Outcome::AgentGone).unwrap(),
            json!("agent-gone")
        );
    }

    #[test]
    fn h2_cleared_event_round_trips_through_json() {
        let event = ClearedEvent {
            id: "d1".into(),
            outcome: Outcome::Replaced,
        };

        let wire = serde_json::to_value(&event).unwrap();
        let back: ClearedEvent = serde_json::from_value(wire).unwrap();

        assert_eq!(back.id, event.id);
        assert_eq!(back.outcome, event.outcome);
    }
}
