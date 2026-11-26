//! A7686: the Readback call, one run of a fresh model that reads only its input. It takes the
//! one-shot seam's tool-free, session-free shape on the Model and Effort the user set for the
//! `readback` Role, and returns the model's text.

use super::one_shot::{Pair, run_on};
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

const BOUND: Duration = Duration::from_secs(120);

pub struct Call {
    pub(super) launcher: super::Launcher,
    pub(super) model: Option<String>,
    pub(super) effort: Option<String>,
}

#[derive(Deserialize)]
struct Answer {
    text: String,
}

impl Call {
    /// Read `input` under `system` and return what the model wrote. The Agent's conversation is
    /// never an input: the caller hands over only what is to be read.
    ///
    /// RS1: a `lens` follows the fixed `system` text under "Review lens"; it adds to the prompt and
    /// never replaces it.
    pub async fn read(
        &self,
        system: &str,
        lens: Option<&str>,
        input: &[u8],
    ) -> Result<String, String> {
        let system = match lens {
            Some(lens) => format!("{system}\n\nReview lens:\n{lens}"),
            None => system.to_owned(),
        };
        let schema = json!({
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
            "additionalProperties": false,
        })
        .to_string();
        run_on::<Answer>(
            &self.launcher,
            None,
            &system,
            &schema,
            input,
            BOUND,
            &Pair::Chosen {
                model: self.model.as_deref(),
                effort: self.effort.as_deref(),
            },
        )
        .await
        .map(|answer| answer.text)
    }
}
