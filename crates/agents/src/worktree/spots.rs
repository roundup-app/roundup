//! C7704: the Spots tools post on files, checked as they are posted and read back against the
//! working copy: a post names files inside the folders the Agent works in, and a read tells which
//! of them changed since.

use std::path::{Path, PathBuf};

use contracts::agent::{Spot, SpotInput, SpotSource};
use rpc::RpcError;

use super::{Git, invalid};

/// The most Spots one post holds.
pub const MAX_SPOTS: usize = 200;
/// The longest message a Spot holds, in characters.
const MAX_MESSAGE: usize = 500;

/// A posted Spot: the file's canonical path and git's id of it at the post (U7673a).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlacedSpot {
    pub path: PathBuf,
    pub start: u32,
    pub end: u32,
    pub message: String,
    pub blob: String,
}

impl Git {
    /// The `spots` as placed: each `path` is resolved from `base` when relative and must be a file
    /// inside one of `roots` (canonical folders). One bad Spot refuses the whole post.
    pub fn place_spots(
        &self,
        roots: &[PathBuf],
        base: &Path,
        spots: &[SpotInput],
    ) -> Result<Vec<PlacedSpot>, RpcError> {
        if spots.len() > MAX_SPOTS {
            return Err(invalid(
                "too_many",
                format!(
                    "a post holds at most {MAX_SPOTS} spots, not {}",
                    spots.len()
                ),
            ));
        }
        spots
            .iter()
            .map(|spot| {
                if spot.start == 0 || spot.end < spot.start {
                    return Err(invalid(
                        "bad_range",
                        format!("lines {}-{} of {}", spot.start, spot.end, spot.path),
                    ));
                }
                let message = spot.message.trim();
                if message.is_empty() || message.chars().count() > MAX_MESSAGE {
                    return Err(invalid(
                        "bad_message",
                        format!("a message holds 1 to {MAX_MESSAGE} characters"),
                    ));
                }
                let path = std::fs::canonicalize(base.join(&spot.path))
                    .ok()
                    .filter(|path| path.is_file())
                    .ok_or_else(|| invalid("no_file", &spot.path))?;
                let root = roots
                    .iter()
                    .find(|root| path.starts_with(root))
                    .ok_or_else(|| invalid("outside_tree", &spot.path))?;
                let rel = path.strip_prefix(root).ok().and_then(Path::to_str);
                let blob = rel
                    .and_then(|rel| self.hash_path(root, rel))
                    .ok_or_else(|| invalid("no_file", &spot.path))?;
                Ok(PlacedSpot {
                    path,
                    start: spot.start,
                    end: spot.end,
                    message: message.to_owned(),
                    blob,
                })
            })
            .collect()
    }

    /// The posted Spots of each source that sit in `top`, with their path relative to it, sorted by
    /// path then start. A Spot is `stale` when its file is not what it was at the post.
    pub fn read_spots<'a>(
        &self,
        top: &Path,
        posted: impl IntoIterator<Item = (&'a str, &'a PlacedSpot)>,
    ) -> Vec<Spot> {
        let mut spots: Vec<Spot> = posted
            .into_iter()
            .filter_map(|(source, placed)| {
                let rel = placed.path.strip_prefix(top).ok()?.to_str()?;
                Some(Spot {
                    source: SpotSource::Tool {
                        name: source.to_owned(),
                    },
                    path: rel.to_owned(),
                    start: placed.start,
                    end: placed.end,
                    message: Some(placed.message.clone()),
                    other: None,
                    stale: self.hash_path(top, rel).as_deref() != Some(placed.blob.as_str()),
                })
            })
            .collect();
        spots.sort_by(|a, b| (&a.path, a.start).cmp(&(&b.path, b.start)));
        spots
    }
}
