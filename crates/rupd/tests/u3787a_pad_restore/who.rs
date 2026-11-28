use rpc::Client;
use serde_json::Value;

/// A connection starts as the user and cannot claim to be one (EP2): the user and the identified Agent are two connections.
pub struct Who {
    pub user: Client,
    pub agent: Client,
    pub as_user: std::cell::Cell<bool>,
}
impl Who {
    pub async fn connect(socket: &std::path::Path) -> Self {
        let (user, agent) = (Client::connect(socket).await, Client::connect(socket).await);
        Self {
            user: user.unwrap(),
            agent: agent.unwrap(),
            as_user: true.into(),
        }
    }
    pub async fn request(
        &self,
        method: &str,
        params: impl serde::Serialize,
    ) -> Result<Value, rpc::RpcError> {
        let client = if self.as_user.get() {
            &self.user
        } else {
            &self.agent
        };
        client.request(method, params).await
    }
}
