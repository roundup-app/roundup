//! H21: roundup is the team lead of each Agent's Claude Code (`claude_code::mailbox`). A teammate
//! asks its permissions in the lead's inbox, not in a hook; this opens each as a Decision and
//! writes the answer to the teammate's own inbox.

use std::collections::HashSet;

use notify::{RecursiveMode, Watcher};
use tokio::task::JoinSet;

use super::claude_code::mailbox::{Request, Team};
use super::*;

impl Shared {
    /// Serve the lead's inbox of Agent `id`'s `attempt` until `stop_requests`, replacing an earlier Attempt's.
    pub(super) fn serve_requests(self: &Arc<Self>, id: &str, attempt: &str, team: Team) {
        let task = tokio::spawn(serve(Arc::clone(self), id.to_owned(), team));
        let earlier = self
            .serving
            .lock()
            .expect("serving lock")
            .insert(id.to_owned(), (attempt.to_owned(), task.abort_handle()));
        if let Some((_, earlier)) = earlier {
            earlier.abort();
        }
    }

    /// Stop serving Agent `id`'s `attempt`, unless a later Attempt already took its place.
    pub(super) fn stop_requests(&self, id: &str, attempt: &str) {
        let mut serving = self.serving.lock().expect("serving lock");
        if serving.get(id).is_some_and(|(live, _)| live == attempt)
            && let Some((_, task)) = serving.remove(id)
        {
            task.abort();
        }
    }
}

async fn serve(shared: Arc<Shared>, id: String, team: Team) {
    let inbox = team.lead_inbox();
    let (wake, mut woken) = tokio::sync::mpsc::unbounded_channel();
    // Watch the folder, never the file: Claude Code replaces the file whole on each write.
    let watching = notify::recommended_watcher(move |_| {
        let _ = wake.send(());
    })
    .and_then(|mut watcher| {
        let folder = inbox.parent().expect("an inbox has a folder");
        watcher.watch(folder, RecursiveMode::NonRecursive)?;
        Ok(watcher)
    });
    let _watcher = match watching {
        Ok(watcher) => watcher,
        Err(err) => return eprintln!("agents: {id}: cannot watch the lead's inbox: {err}"),
    };
    let mut seen = HashSet::new();
    let mut answering = JoinSet::new();
    loop {
        // Reading follows watching, so a request that lands between the two is not missed.
        match mailbox_requests(&inbox).await {
            Ok(requests) => {
                for request in requests.into_iter().filter(|r| seen.insert(r.id.clone())) {
                    answering.spawn(answer(
                        Arc::clone(&shared),
                        id.clone(),
                        team.clone(),
                        request,
                    ));
                }
            }
            Err(err) => eprintln!("agents: {id}: cannot read the lead's inbox: {err}"),
        }
        if woken.recv().await.is_none() {
            return;
        }
    }
}

async fn mailbox_requests(inbox: &Path) -> std::io::Result<Vec<Request>> {
    let inbox = inbox.to_owned();
    tokio::task::spawn_blocking(move || claude_code::mailbox::requests(&inbox))
        .await
        .map_err(std::io::Error::other)?
}

/// One request: a Decision until it is answered, then the answer in the teammate's inbox. A
/// Decision cleared without an answer (the tool ran or the Agent ended) writes nothing.
async fn answer(shared: Arc<Shared>, id: String, team: Team, request: Request) {
    let reply = match shared
        .permission(Actor::daemon(), &id, request.payload.clone())
        .await
    {
        Ok(permission) => permission.output,
        Err(err) => return eprintln!("agents: {id}: request {} not answered: {err}", request.id),
    };
    let written = tokio::task::spawn_blocking(move || team.answer(&request, &reply)).await;
    if let Ok(Err(err)) | Err(err) = written.map_err(std::io::Error::other) {
        eprintln!("agents: {id}: cannot answer in the teammate's inbox: {err}");
    }
}
