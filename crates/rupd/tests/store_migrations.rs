//! Project migration acceptance now lives in `storage::tests` in `src/storage.rs`:
//! N16 checks the complete schema and reopened store behavior, N17 checks that old
//! per-store files never block the open. Per-store N9/N10 tests
//! continue to check each store's production migrations.
//!
//! Retain this retired integration target while L118 freezes the launch inventory
//! that names it; duplicating those acceptance tests here would violate rule 10.
