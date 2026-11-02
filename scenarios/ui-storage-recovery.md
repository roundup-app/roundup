# Legacy storage recovery retired

**U4086a retired.** N5467b/d (`scenarios/local-data-retirement.md`, #5467) replace legacy-record validation and Retry/Continue with incompatible-data refusal. Current-schema storage failures retain their existing recovery contracts.

**U4086b retired.** Historical-key quarantine, readback, source removal and partial migration are removed; older browser data is neither read into the App nor deleted.

**U4086c retired.** Historical quarantine retry/interruption recovery and its exclusive tests are removed. Keep current durable-save failures, exact in-memory work and retry behaviour under P11.

**U4086d retired.** Per-legacy-record continuation, quarantine enumeration and their exclusive Storage recovery machinery are removed. No old record grants permission to partly open a Project or App. N5467a/b provide the refusal observers; this specification claims no runtime or rendered pass.
