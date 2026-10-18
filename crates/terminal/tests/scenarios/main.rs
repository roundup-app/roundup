//! One test binary for scenarios/terminal.md (one binary so shared helpers are never dead code).
//! Each module groups the tests of related scenario ids.

mod common;
mod control;
mod in_process;
mod owned;
mod plain_text;
mod read;
mod scheme;
mod shell_marks;
mod snapshot;
mod spawn;
mod stream;
mod stuck;
mod title;
