use rpc::RpcError;

/// Every way the App's own code fails below a handler. Only a handler turns it into an
/// `RpcError`, once.
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    /// `INTERNAL`: the App's fault, never the caller's.
    #[error("{0}")]
    Internal(String),
    /// `INTERNAL`: a lock a panicking thread kept, so its state cannot be trusted.
    #[error("{0} poisoned")]
    Poisoned(&'static str),
    /// A refusal that already carries its code.
    #[error(transparent)]
    Rpc(#[from] RpcError),
}

impl Error {
    pub(crate) fn internal(err: impl std::fmt::Display) -> Self {
        Self::Internal(err.to_string())
    }
}

/// A poisoned lock answers `Error::Poisoned` instead of going on with state a panic left half-written.
pub(crate) trait Locked<T> {
    fn locked(&self, what: &'static str) -> Result<std::sync::MutexGuard<'_, T>, Error>;
}

impl<T> Locked<T> for std::sync::Mutex<T> {
    fn locked(&self, what: &'static str) -> Result<std::sync::MutexGuard<'_, T>, Error> {
        self.lock().map_err(|_| Error::Poisoned(what))
    }
}

/// A failure in a context that answers no caller: it is logged and the work stops.
pub(crate) trait Reported<T> {
    fn reported(self, operation: &str) -> Option<T>;
}

impl<T> Reported<T> for Result<T, Error> {
    fn reported(self, operation: &str) -> Option<T> {
        self.map_err(|error| crate::diagnostics::report(operation, &error.to_string()))
            .ok()
    }
}

impl From<Error> for RpcError {
    fn from(err: Error) -> Self {
        match err {
            Error::Internal(message) => RpcError::internal(message),
            Error::Poisoned(what) => RpcError::internal(format!("{what} poisoned")),
            Error::Rpc(err) => err,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rb3798b_a_poisoned_lock_answers_internal() {
        let lock = std::sync::Arc::new(std::sync::Mutex::new(0));
        let held = lock.clone();
        let _ = std::thread::spawn(move || {
            let _guard = held.lock();
            panic!("poison");
        })
        .join();
        let err: RpcError = lock.locked("test lock").unwrap_err().into();
        assert_eq!(err.code, rpc::code::INTERNAL);
    }
}
