//! Ordered Terminal input and physical completion.
use super::*;

impl Terminals {
    /// A4899a: exercise physical prompt formatting without a program or PTY.
    #[cfg(feature = "test-support")]
    pub fn with_test_input(mut self, writer: impl Write + Send + 'static) -> Self {
        self.test_input = Some(Mutex::new(Box::new(writer)));
        self
    }

    /// Queue `bytes` to be typed into a running Terminal and return without waiting for the program to
    /// read them. `NOT_FOUND` if it is unknown or has exited; `CONFLICT` if the program has left
    /// [`WRITE_BACKLOG`] writes unread.
    pub async fn write(&self, id: &str, bytes: &[u8]) -> Result<(), RpcError> {
        self.write_at(id, bytes, (self.shared.clock)())
    }

    pub(super) fn write_at(&self, id: &str, bytes: &[u8], received: f64) -> Result<(), RpcError> {
        if let Some(remote) = self.remote(id)? {
            return remote.enqueue(Input::Bytes(bytes.to_vec(), Vec::new()));
        }
        let handle = self.running(id)?;
        let samples = match handle.recorder.get() {
            Some(recorder) => recorder
                .lock()
                .expect("recorder lock")
                .receive(bytes, received),
            None => Vec::new(),
        };
        handle.enqueue(id, Input::Bytes(bytes.to_vec(), samples))
    }

    /// Await the physical write and flush in input order. Refusal to enqueue has no effect;
    /// IO failure or a lost input-thread result is UNKNOWN_OUTCOME and must not be retried.
    /// Success leaves no bytes from this call queued (it does not await the child's read).
    pub async fn write_completed(&self, id: &str, bytes: Vec<u8>) -> Result<(), RpcError> {
        self.write_with(id, move |writer| {
            writer
                .write_all(&bytes)
                .and_then(|()| writer.flush())
                .map_err(|err| {
                    RpcError::unknown_outcome(format!(
                        "Terminal write may be partial: {err}; do not retry"
                    ))
                })
        })
        .await
    }

    /// Run an effect on the input thread at its place in the Terminal's write order, and
    /// return its result after it finishes. The effect may refuse before writing; a queued
    /// effect whose caller disappeared is skipped. B6 uses this to hold the prompt check
    /// through the physical write, rather than checking before the input queue.
    pub async fn write_with(
        &self,
        id: &str,
        effect: impl FnOnce(&mut dyn Write) -> Result<(), RpcError> + Send + 'static,
    ) -> Result<(), RpcError> {
        #[cfg(feature = "test-support")]
        if let Some(writer) = &self.test_input {
            return effect(&mut **writer.lock().expect("test input lock"));
        }
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.enqueue(id, Input::Effect(Box::new(effect), tx))?;
        rx.await.map_err(|_| {
            RpcError::unknown_outcome(
                "Terminal input ended before reporting its physical effect; do not retry",
            )
        })?
    }

    fn enqueue(&self, id: &str, input: Input) -> Result<(), RpcError> {
        if let Some(remote) = self.remote(id)? {
            return remote.enqueue(input);
        }
        self.running(id)?.enqueue(id, input)
    }
}
