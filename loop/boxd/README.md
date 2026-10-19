# Agent runners on boxd

L121 keeps GitHub's permissions, independent review and merge gates. A private controller receives signed job webhooks, restores one isolated VM per agent job and registers a GitHub runner that accepts exactly that job. GitHub-hosted jobs still select work, post answers and run checks.

```text
GitHub queued job → signed webhook → private controller
                                      ├─ restore prepared snapshot
                                      ├─ restore scoped history + role's project memory
                                      └─ register and start one-job runner
GitHub completed/cancelled job ────────→ save memory + diagnostics → remove VM/runner
```

## Memory

Every job starts a fresh process. Claude conversations and Codex session/state files survive under their Issue/PR; builder and fix jobs share the linked Issue. Claude auto-memory is explicitly enabled in its user settings. Codex's `features.memories`, `memories.generate_memories` and `memories.use_memories` are enabled when its retained home is used. Retained conversations are available to the agent; a new job does not automatically resume an old conversation.

Project memory is shared across jobs of one role, with separate builder, review, critic and smoke directories. A job receives current project memory alongside its scoped conversations. Changed notes merge against the job's starting revision. Concurrent edits keep the first published file and save the other under `<vendor>/conflicts/<job>/`; every job archive also remains available. Deletions apply when the current note still matches the starting revision.

Only allowlisted conversation, SQLite state and memory paths are archived. Login files, agent settings and runner credentials are excluded. Tar members are checked before extraction; links and traversal are refused. State and diagnostics stay privately on `roundup-ci-control`, never in public GitHub artifacts. The controller's `/home/boxd/roundup-ci-state/` contains:

| Path | Purpose |
|---|---|
| `jobs.sqlite` | Durable job admission, lifecycle and startup timestamps |
| `history/<role>/<issue-or-pr>/` | Immutable job archives and latest retained conversation |
| `projects/<role>/` | Current project auto-memory, including concurrent revisions |
| `work/<job>/` | Starting revision and transfer files for recovery |
| `diagnostics/<job>/` | Private runner diagnostics |

Retention has no automatic expiry. Monitor the controller's disk usage; deleting this controller deletes its retained data unless separately backed up. The runner has no controller credential or boxd metadata access. boxd may inject owner credentials into remote-command environments even on an isolated VM, so the runner process inherits only an explicit environment allowlist; GitHub supplies the job's own credentials separately. A job-start hook verifies the assigned repository, run, attempt and role before steps execute. Docker's boot services are disabled so a foreign container job cannot execute before this check.

## Provision and refresh

The controller uses boxd's in-VM CLI and its managed GitHub credential wrapper. No personal GitHub token or boxd API key is copied into Actions secrets. The only additional credential is a random webhook secret stored in the controller's mode-600 configuration.

Prepare an isolated image machine from the existing `ru-toolchain` snapshot. Clone the trusted revision at `/opt/actions-runner/_work/roundup/roundup` (create the parent with ownership `boxd:boxd`), then run:

```sh
python3 /opt/actions-runner/_work/roundup/roundup/loop/boxd/image.py build /opt/actions-runner/_work/roundup/roundup
```

The image builder requires Python's distro `python3-yaml` package. It derives the tool versions from `.github/actions/setup/action.yml`, installs the official agent packages, warms pnpm/Rust caches and checks the downloaded GitHub runner's SHA-256 digest. The existing setup action verifies the image fingerprint on self-hosted machines and still reconciles the current pnpm lockfile. Checkout keeps ignored package files because each VM starts from the clean snapshot.

After the build passes, cold-stop and start the image machine, then save it **without running another command inside it**:

```sh
boxd machine stop roundup-ci-image
boxd machine start roundup-ci-image
boxd snapshots save roundup-ci-image roundup-ci
```

`start` can return `starting`; wait until `boxd machine get` reports `running` before saving. Cold boot removes transient command credentials from RAM. No runner is registered and no agent state is present when the snapshot is saved. Remove the image machine once the snapshot is ready.

From a checkout with `pnpm install`, authenticated `boxd` and `gh`:

```sh
python3 loop/boxd/deploy.py
```

This installs the locked controller package, a restarting systemd service, HTTPS forwarding and the repository's signed `workflow_job` webhook. Controller and isolated runners join the explicit `roundup-ci` network so registration and memory transfer work. Re-deployment preserves the secret and private history. `--ref <branch>` admits an explicitly selected branch during pre-merge smoke testing; production uses `main`. The account's 8-vCPU/32-GiB quota fits the controller plus three 2-vCPU/8-GiB runners.

Refresh the snapshot when setup pins change and at least weekly to track GitHub runner releases. GitHub stops assigning jobs to runner versions outside its supported update age. A fingerprint mismatch fails visibly; it never silently reinstalls the environment or routes the agent to GitHub-hosted capacity.

## Recovery and observation

The controller persists admission before acknowledging a webhook and reconciles unfinished jobs every 15 seconds after restart. Deterministic machine names prevent duplicate creation after an unknown command outcome. Active jobs checkpoint memory every five minutes. Completion, failure and cancellation take a final checkpoint and retain diagnostics before removal; a save failure returns degraded health and retries with the machine preserved.

Each VM has a three-hour wall-clock deletion deadline to bound compute leakage if the controller is unavailable. This emergency backstop can lose writes after the last checkpoint. The controller hibernates after ten idle minutes; HTTPS wakes it on the next webhook. Active GitHub status checks keep it awake while jobs run.

```sh
pnpm --filter @roundup/boxd-runners test:boxd
gh workflow run qa.yml -f boxd-smoke=true
gh workflow run qa.yml -f boxd-smoke=true -f expect-memory=true
```

The second run must restore the first run's synthetic history and auto-memory on a fresh VM. `smoke-wait=true` holds after writing so cancellation and cleanup can be observed. The public `/health` returns counts only; errors produce HTTP 503. Inspect detailed records privately:

```sh
boxd machine exec roundup-ci-control -- 'tail -n 50 /home/boxd/roundup-ci-state/controller.log'
```

Job records retain receipt, machine readiness, registration and job-start timestamps; use these to distinguish VM startup from GitHub scheduling and runner connection time.

Live observation on 2026-10-19: [run 39334559220](https://github.com/saadshahd/roundup/actions/runs/39334559220) restored the snapshot in 0.93 s, registered its runner 10.3 s after webhook receipt and started the job after 17.7 s. Checkout took 14 s and the prepared setup action took 20 s. The fresh machine restored the preceding job's history and project memory. [Run 39334976654](https://github.com/saadshahd/roundup/actions/runs/39334976654) was cancelled after writing memory; the controller saved its state and diagnostics and removed its machine and runner within 1.8 s of the completion event. These are individual observations, not percentile guarantees.

## Reuse

- Selected: [Octokit webhooks 14.2.0](https://github.com/octokit/webhooks.js/releases/tag/v14.2.0) for signature verification and HTTP handling; Node's maintained SQLite implementation for durable job claims; Python's tarfile/SQLite libraries for validated retention; the official boxd CLI and [GitHub runner 2.338.0](https://github.com/actions/runner/releases/tag/v2.338.0) for provisioning and one-job execution.
- [Actions Runner Controller 0.15.0](https://github.com/actions/actions-runner-controller/releases/tag/gha-runner-scale-set-0.15.0), released 2026-10-01, provisions Kubernetes Pods; it has no boxd machine provisioner.
- [ec2-github-runner 2.6.1](https://github.com/machulav/ec2-github-runner/releases/tag/v2.6.1), released 2026-04-10, provisions AWS EC2 instances; it cannot consume boxd snapshots or credit.

The provider-specific orchestration remains here; signature verification, VM operations, runner execution and archive parsing use the maintained implementations above.
