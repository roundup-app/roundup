//! T27: the Pad half of a Todo's refs. The Todos module stores links; the Pads are read here.

use contracts::todo::{Ref, RefParams, RefState, TodoId};
use rpc::{RpcError, code, params};
use serde_json::Value;

use crate::Daemon;

impl Daemon {
    /// An `addRef` link must be a Pad link of this Project and name a Pad, and a heading, that exist.
    pub(crate) fn require_ref_target(&self, args: &Value) -> Result<(), RpcError> {
        let RefParams { url, .. } = params(args.clone())?;
        let link = pads::reference::parse(&url)
            .map_err(|why| RpcError::new(code::INVALID_PARAMS, format!("not a Pad link: {why}")))?;
        if link.project != self.project_key {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("not a Pad link of this Project: `{}`", link.project),
            ));
        }
        if !self.pads.holds(&link)? {
            let what = link.heading.as_deref().map_or_else(
                || format!("pad {}", link.name),
                |heading| format!("pad {} with a heading \"{heading}\"", link.name),
            );
            return Err(RpcError::not_found(what));
        }
        Ok(())
    }

    /// `todo.refs`: each link with whether its Pad and heading exist now. It logs no Touch.
    pub(crate) fn todo_refs(&self, args: Value) -> Result<Value, RpcError> {
        let TodoId { id } = params(args)?;
        let refs = self
            .todos
            .refs(id)?
            .into_iter()
            .map(|url| {
                let held = match pads::reference::parse(&url) {
                    Ok(link) => link.project == self.project_key && self.pads.holds(&link)?,
                    Err(_) => false,
                };
                Ok(Ref {
                    url,
                    state: if held {
                        RefState::Ok
                    } else {
                        RefState::Missing
                    },
                })
            })
            .collect::<Result<Vec<_>, RpcError>>()?;
        rpc::reply(&refs)
    }
}
