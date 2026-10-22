//! A3195, A3197: the Workstream cap and Queue, as the Daemon reads and changes them.
use super::*;
use contracts::workstream::QueueEntry;

impl Agents {
    pub fn workstream_cap(&self) -> Result<Option<u32>, RpcError> {
        self.shared.rail().get_workstream_cap()
    }

    pub fn set_workstream_cap(&self, cap: Option<u32>) -> Result<(), RpcError> {
        self.shared.rail().set_workstream_cap(cap)
    }

    pub fn queue_entries(&self) -> Result<Vec<QueueEntry>, RpcError> {
        self.shared.rail().queue_entries()
    }

    pub fn queue_push(&self, workstream: &str, after: Option<u32>) -> Result<(), RpcError> {
        self.shared.rail().queue_push(workstream, after)
    }

    pub fn queue_remove(&self, workstream: &str) -> Result<bool, RpcError> {
        self.shared.rail().queue_remove(workstream)
    }

    pub fn queue_place(&self, workstream: &str, index: usize) -> Result<bool, RpcError> {
        self.shared.rail().queue_place(workstream, index)
    }

    pub fn queue_fail(
        &self,
        workstream: &str,
        failure: Option<(i64, &str)>,
    ) -> Result<(), RpcError> {
        self.shared.rail().queue_fail(workstream, failure)
    }

    pub fn queue_free(&self, workstream: &str) -> Result<(), RpcError> {
        self.shared.rail().queue_free(workstream)
    }
}
