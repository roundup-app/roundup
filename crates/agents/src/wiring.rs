//! What the Daemon supplies to Agents at its composition root, as one trait object.

use super::*;

/// The global naming settings, read together.
pub struct Naming {
    /// Whether the first prompt names an Agent.
    pub automatic_renaming: bool,
    /// The guide each new vendor launch carries, if any.
    pub guide: Option<String>,
}

/// Whether roundup's own text reached an Agent's Claude inbox.
#[derive(Debug, PartialEq, Eq)]
pub enum Delivery {
    Sent,
    /// No inbox is wired: the Agent did not accept the text.
    Refused,
}

/// The capabilities Agents lack the dependencies to build themselves: the Daemon implements it
/// once and `Agents::open` takes it, so a missing one is a compile error.
#[async_trait]
pub trait Wiring: Send + Sync {
    /// Read the global naming settings.
    fn naming(&self) -> Result<Naming, RpcError>;

    /// E3: the Context text kept by the Daemon for the first Steer, or `None` for no Context.
    /// A failed or timed-out read leaves that Steer unchanged.
    async fn context(&self, nodes: Vec<RailNode>, id: String) -> Result<Option<String>, RpcError>;

    /// A4452a, A4452d: send `text` as a Message from `from` to the Agent `id`'s Claude inbox.
    async fn coordinate(&self, from: Actor, id: String, text: String)
    -> Result<Delivery, RpcError>;
}

/// The test double: renaming on, no guide, no Context, no inbox. Each part a
/// test needs is set explicitly.
#[cfg(any(test, feature = "test-support"))]
#[derive(Default)]
pub struct Quiet {
    renaming: Option<Arc<dyn Fn() -> bool + Send + Sync>>,
    context: Option<Arc<dyn Fn() -> String + Send + Sync>>,
    inbox: Option<Arc<dyn Fn(String, String) + Send + Sync>>,
}

#[cfg(any(test, feature = "test-support"))]
impl Quiet {
    #[must_use]
    pub fn with_renaming(mut self, read: impl Fn() -> bool + Send + Sync + 'static) -> Self {
        self.renaming = Some(Arc::new(read));
        self
    }

    #[must_use]
    pub fn with_context(mut self, text: impl Fn() -> String + Send + Sync + 'static) -> Self {
        self.context = Some(Arc::new(text));
        self
    }

    /// Deliver each `(agent id, text)` to `inbox`.
    #[must_use]
    pub fn with_inbox(mut self, inbox: impl Fn(String, String) + Send + Sync + 'static) -> Self {
        self.inbox = Some(Arc::new(inbox));
        self
    }

    #[must_use]
    pub fn shared(self) -> Arc<dyn Wiring> {
        Arc::new(self)
    }
}

#[cfg(any(test, feature = "test-support"))]
#[async_trait]
impl Wiring for Quiet {
    fn naming(&self) -> Result<Naming, RpcError> {
        Ok(Naming {
            automatic_renaming: self.renaming.as_ref().is_none_or(|read| read()),
            guide: None,
        })
    }

    async fn context(&self, _: Vec<RailNode>, _: String) -> Result<Option<String>, RpcError> {
        Ok(self.context.as_ref().map(|text| text()))
    }

    async fn coordinate(&self, _: Actor, id: String, text: String) -> Result<Delivery, RpcError> {
        Ok(match &self.inbox {
            Some(inbox) => {
                inbox(id, text);
                Delivery::Sent
            }
            None => Delivery::Refused,
        })
    }
}
