//! M5159b: roundup keeps no save points; a Rewind asks the Agent's provider to rewind through its
//! own feature. A provider joins only by naming a call it documents (`scenarios/mcp.md`).

use rpc::RpcError;

use crate::Agents;

/// The program an Agent runs on. Claude Code is the only Adapter roundup starts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    ClaudeCode,
    /// Codex rolls back context through its app-server `thread/rollback`, which roundup's Terminal
    /// Agents do not speak; it restores no files.
    Codex,
    /// pi's RPC mode documents no rewind call; `/tree` and `/fork` are interactive.
    Pi,
}

impl Provider {
    pub fn name(self) -> &'static str {
        match self {
            Self::ClaudeCode => "Claude Code",
            Self::Codex => "Codex",
            Self::Pi => "pi",
        }
    }

    /// The result for an Agent whose provider documents no native rewind call.
    fn unavailable(self) -> Option<Outcome> {
        (self != Self::ClaudeCode)
            .then(|| Outcome::Unavailable(format!("rewind unavailable for {}", self.name())))
    }
}

/// What happened to one Agent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Rewound,
    Unavailable(String),
    Failed(String),
}

impl Agents {
    /// The provider Agent `id` runs on.
    pub fn provider(&self, _id: &str) -> Provider {
        Provider::ClaudeCode
    }

    /// Ask `provider` to rewind Agent `id` to `turn`.
    pub async fn rewind_native(&self, id: &str, provider: Provider, turn: &str) -> Outcome {
        if let Some(unavailable) = provider.unavailable() {
            return unavailable;
        }
        let saved = match self.shared.rail().conversation(id) {
            Ok(Some(saved)) => saved,
            Ok(None) => return Outcome::Failed("it has no saved conversation yet".into()),
            Err(RpcError { message, .. }) => return Outcome::Failed(message),
        };
        match self
            .launcher
            .rewind_files(&saved.0, std::path::Path::new(&saved.1), turn)
            .await
        {
            Ok(()) => Outcome::Rewound,
            Err(why) => Outcome::Failed(why),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn m5159b_a_provider_without_rewind_reports_unavailable() {
        assert_eq!(Provider::ClaudeCode.unavailable(), None);
        assert_eq!(
            Provider::Codex.unavailable(),
            Some(Outcome::Unavailable("rewind unavailable for Codex".into()))
        );
        assert_eq!(
            Provider::Pi.unavailable(),
            Some(Outcome::Unavailable("rewind unavailable for pi".into()))
        );
    }
}
