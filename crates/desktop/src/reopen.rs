//! The automatic Daemon reopen schedule (U6249b).

use tokio::time::Duration;

/// Waits before each automatic reopen; a reopen that fails after the last wait is final.
const WAITS: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(3),
    Duration::from_secs(9),
];

/// The failure count at which recovery gives up: the first exit plus one per reopen.
pub const GIVE_UP: u8 = WAITS.len() as u8 + 1;

/// The wait after the `failures`-th failure, or `None` once recovery is spent.
pub fn wait(failures: u8) -> Option<Duration> {
    WAITS.get(usize::from(failures).checked_sub(1)?).copied()
}
