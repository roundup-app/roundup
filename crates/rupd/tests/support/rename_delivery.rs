//! B2704a: rename-note receipts alongside startup coordination.
use super::*;

impl Run {
    pub(super) async fn assert_rename_delivery(&mut self, ids: &[u32], names: &[&str]) {
        let expected: Vec<_> = ids.iter().map(|id| format!("rup-{id}")).collect();
        // A Door's start Context (A4452a) is an entry ahead of the rename notes.
        let renames = |run: &Self| -> Vec<String> {
            run.entries()
                .into_iter()
                .filter(|entry| expected.contains(entry))
                .collect()
        };
        until("ordered rename entries", async || {
            (renames(self) == expected).then_some(())
        })
        .await;
        let received: Vec<_> = self
            .received()
            .into_iter()
            .filter(|entry| {
                ids.iter()
                    .any(|id| entry["msg_id"] == format!("00000000-0000-4000-8000-{id:012x}"))
            })
            .collect();
        for ((entry, id), name) in received.iter().zip(ids).zip(names) {
            assert_eq!(
                entry["msg_id"],
                format!("00000000-0000-4000-8000-{id:012x}")
            );
            let content = entry["message"]["content"].as_str().unwrap();
            assert!(
                content.contains(&format!("from-name=\"{}\"", contracts::Actor::daemon().id)),
                "{content}"
            );
            assert!(
                content.contains(&format!("you are now called \"{name}\" on the Rail")),
                "{content}"
            );
            let message = self.message(*id).await;
            assert_eq!(message["from"]["id"], contracts::Actor::daemon().id);
            assert_eq!(message["kind"], "note");
            assert_eq!(message["status"], "pending");
        }
        assert_eq!(self.typed().await, 0);
        self.record(ids).await;
        until("rename acknowledgements", async || {
            let mut delivered = true;
            for id in ids {
                delivered &= self.status(*id).await.0 == "delivered";
            }
            delivered.then_some(())
        })
        .await;
        self.idle_edge().await;
        let delivered = self.seen().await;
        for id in ids {
            assert_eq!(delivered.iter().filter(|seen| *seen == id).count(), 1);
        }
        assert_eq!(renames(self), expected);
        assert_eq!(self.typed().await, 0);
    }
}
