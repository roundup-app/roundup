//! The one client of herdr-core's public JSON-RPC (generation 1, 0.1.x): plain-mode `hello`, then
//! frames `[channel u32 LE][kind u8][len u32 LE][payload]` with channel 0 carrying JSON-RPC.
//! A core is reached through a local program or `ssh <host> herdr-core connect`, never a port.

mod conn;
mod error;
mod exec;
mod file;
mod stream;
mod types;
mod wire;

pub use conn::{Conn, GENERATION, MIN_CORE, display};
pub use error::{Error, Result, RpcError};
pub use exec::Exec;
pub use file::Edit;
pub use stream::{Sender, Stream};
pub use types::{Ev, Event, Hello, Machine};

#[cfg(test)]
mod tests;
