# Reuse prepared Worktrees through Project commands

Keep dependency files in an explicitly enrolled Worktree at a stable path and assign it exclusively after a Project readiness command succeeds. Reuse Worktrunk hooks/discovery and vendor preparation where available; roundup retains the durable Agent-to-path ownership needed for Landing and recovery. This revises `docs/worktrees.md`'s blanket rejection of vendor worktree support: vendor tools can prepare directories, while their automatic creation/cleanup must not create a second checkout or delete a directory roundup still owns. Retaining files avoids per-assignment dependency materialization on managed Macs without assuming APFS clones avoid antivirus scans. The tradeoff is bounded capacity and explicit preparation when no compatible directory is ready; arbitrary dependency changes cannot promise a five-second cold install.


Acceptance: [G2542a–G2542e](../../scenarios/worktrees.md#prepared-directories-specification-implementation-pending). This decision is specified; implementation and performance evidence ship separately.
