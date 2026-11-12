use std::path::PathBuf;

/// Why the App could not resolve its startup configuration.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("cannot find the App's own executable: IO {0:?}")]
    Executable(std::io::ErrorKind),
    #[error("the Daemon socket path is {bytes} bytes; a unix socket path must be under {limit}")]
    SocketPathTooLong { bytes: usize, limit: usize },
    #[error("{}: the socket path has no file name", .0.display())]
    SocketPathNoName(PathBuf),
}
