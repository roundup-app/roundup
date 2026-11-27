//! C7704: the Spots tools post on an Agent's files, kept in memory as the Readbacks are: a restart
//! drops them and a tool's next post brings them back.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;

use super::*;
use crate::worktree::PlacedSpot;
use contracts::agent::{CompareTarget, OwnedGroupKey, PostSpotsParams, Spots};

/// The posted Spots of each Agent, by source.
#[derive(Default)]
pub(crate) struct Posted(Mutex<HashMap<String, BTreeMap<String, Vec<PlacedSpot>>>>);

impl Posted {
    /// `source`'s Spots for `id` become `spots`; none removes the source.
    fn replace(&self, id: &str, source: String, spots: Vec<PlacedSpot>) {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let sources = all.entry(id.to_owned()).or_default();
        if spots.is_empty() {
            sources.remove(&source);
        } else {
            sources.insert(source, spots);
        }
    }

    fn of(&self, id: &str) -> Vec<(String, PlacedSpot)> {
        let all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        all.get(id)
            .into_iter()
            .flatten()
            .flat_map(|(source, spots)| spots.iter().map(|spot| (source.clone(), spot.clone())))
            .collect()
    }
}

impl Agents {
    /// C7704b, C7704c: replace the Spots `source` posted for the Agent, after checking each. Paths
    /// are read from the Agent's Worktree, else from its folder, and must sit in the Worktree or in
    /// a checkout the Agent wrote in (C7704f).
    pub(super) async fn post_spots(&self, p: PostSpotsParams) -> Result<(), RpcError> {
        let source = p.source.trim().to_owned();
        if source.is_empty() || source.chars().count() > 40 {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "bad_source: a source holds 1 to 40 characters",
            ));
        }
        let node = self.shared.node(&p.id)?;
        let edits = self.recorded_edits(&p.id)?;
        let worktree = node.worktree().map(|record| record.path);
        let folder =
            worktree
                .clone()
                .map(PathBuf::from)
                .or_else(|| match self.shared.runs().slot(&p.id) {
                    Some(Slot::Running(run)) => Some(PathBuf::from(run.cwd())),
                    _ => None,
                });
        let Some(folder) = folder else {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("no_folder: {} has no folder to read paths from", p.id),
            ));
        };
        let git = self.shared.git.bounded();
        let placed = tokio::task::spawn_blocking(move || {
            let roots = match worktree {
                Some(path) => std::fs::canonicalize(path).into_iter().collect(),
                None => git.written_tops(&edits),
            };
            git.place_spots(&roots, &folder, &p.spots)
        })
        .await
        .map_err(|err| RpcError::from(worktree::WorktreeError::Failed(err.to_string())))??;
        self.shared.posted.replace(&p.id, source, placed);
        Ok(())
    }

    /// C7704b, C7704d: the Spots tools posted that sit in the Agent's Worktree, or in the checkout
    /// of `group` for an Agent with no Worktree (C7704f), with the stale ones marked.
    pub(super) async fn spots(
        &self,
        id: &str,
        group: Option<OwnedGroupKey>,
    ) -> Result<Spots, RpcError> {
        let posted = self.shared.posted.of(id);
        let git = self.shared.git.bounded();
        let top = self
            .readback_worktree(id, group, CompareTarget::Tree)
            .await?
            .path;
        let spots = tokio::task::spawn_blocking(move || {
            let top = std::fs::canonicalize(top).map_err(|err| err.to_string())?;
            Ok::<_, String>(git.read_spots(
                &top,
                posted.iter().map(|(source, spot)| (source.as_str(), spot)),
            ))
        })
        .await
        .map_err(|err| RpcError::from(worktree::WorktreeError::Failed(err.to_string())))?
        .map_err(|err| RpcError::from(worktree::WorktreeError::Failed(err)))?;
        Ok(Spots { spots })
    }
}
