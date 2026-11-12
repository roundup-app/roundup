//! N16–N17, N22: the one Project schema, its migration sequence and fresh image in `project.db`;
//! older per-store databases are never read.
mod codec;
mod image;
pub mod ledger;
pub mod migration;
mod project;
pub use codec::{Json, Word};
pub use image::memory;
pub use project::{connect, fixture, migrations};

mod added {
    include!(concat!(env!("OUT_DIR"), "/added_migrations.rs"));
    include!(concat!(env!("OUT_DIR"), "/fresh_regions.rs"));
}

#[cfg(test)]
use {
    image::{IDENTITIES, reference},
    project::apply,
    rusqlite::Connection,
    rusqlite_migration::{M, Migrations},
    std::path::Path,
};

#[cfg(test)]
mod migration_additive_tests;
#[cfg(test)]
mod refusal_tests;
#[cfg(test)]
mod tests;
