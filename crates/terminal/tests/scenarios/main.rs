//! One test binary for scenarios/terminal.md (one binary so shared helpers are never dead code).
//! Each module groups the tests of related scenario ids.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

mod catch_up;
mod common;
mod control;
mod in_process;
mod owned;
mod plain_text;
mod program_status;
mod read;
mod scheme;
mod shell_marks;
mod snapshot;
mod spawn;
mod stream;
mod stuck;
mod title;
