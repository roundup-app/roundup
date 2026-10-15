# Store migrations (retired before release 0)

Policy: N20 in `scenarios/project-store.md` replaces this specification. Until release 0, local application data need not survive an upgrade. Current-schema creation and persistence remain required there; historical schema adoption and its tests do not.

**N9 retired versioned store adoption.** Retired by N20 (policy). No requirement to preserve the former per-store migration-1 layout, baseline comparisons or migration history.

**N10 retired historical data adoption.** Retired by N20 (policy). No requirement to adopt pre-release rows or older schemas, or preserve unsupported-schema data during an upgrade.

**N11 retired historical migration recovery.** Retired by N20 (policy). No requirement for historical fixture migration-failure and rollback tests. Current transaction/removal guarantees remain under N18 and A34.
