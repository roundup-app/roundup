# Agent runners on boxd

L121 keeps GitHub's permissions, independent review and merge gates. Agent jobs use GitHub-hosted runners by default. For explicitly opted-in build, fix, review and critic jobs, a private controller receives signed job webhooks, restores one isolated VM and registers a GitHub runner that accepts exactly that job. Work selection and answers remain unchanged; the opt-ins below can also move light jobs and the Rust/web check lanes.

The `loop` workflow runs on PRs only. `loop/affected.py boxd` scopes its package installation and runner tests to runner code, agent integration, workflows/setup, package configuration and the L121 contract; ordinary product/documentation PRs skip those steps while retaining the required `rules` check. This removes the 12 s those steps took in [run 39336136408](https://github.com/saadshahd/roundup/actions/runs/39336136408) from unrelated PRs. The web-shard compatibility regression lives in the boxd suite so general workflow tests need no pnpm installation.

```text
GitHub queued job → signed webhook → private controller
                                      ├─ restore prepared snapshot
                                      ├─ restore scoped history + role's project memory
                                      └─ register and start one-job runner
GitHub completed/cancelled job ────────→ save memory + diagnostics → remove VM/runner
```

## Opt in

Repository variables choose which jobs use paid boxd compute:

```sh
gh variable set BOXD_ISSUES --body '[123]'
gh variable set BOXD_PRS --body '[456]'
gh variable set BOXD_LIGHT --body 1
gh variable set BOXD_CHECK --body '[456]'  # canary PR
# After observing the canary:
gh variable set BOXD_CHECK --body 1
```

Unset variables or `[]` keep every agent job on GitHub. `BOXD_PRS` moves a PR's fix, review and critic jobs together. A build's Issue opt-in does not opt its subsequent fix PR in; set that PR's ID separately when needed. An explicit boxd opt-in waits for its prepared runner and fails visibly if provisioning fails. It does not fall back silently. The controller and stored snapshot have costs independent of worker opt-ins.

`BOXD_LIGHT=1` moves the short jobs around agent jobs (`pick`, `task`, `after`, `post`) onto boxd, so none waits behind the hosted test lanes. They keep no memory and take free capacity first; delete the variable to move them back.

`BOXD_CHECK` moves only `check.yml`'s `rust` and `web` matrix jobs: `1` selects every run, a JSON array of numeric PR IDs selects those PRs, and unset or `[]` selects none. The controller admits only same-repository `pull_request` runs or `push` runs on `main`; forks, other workflows and other events/branches get no machine. Agent kinds remain unavailable to PR events. An opted-in job outside admission waits without a machine; use an eligible PR or a main push for the canary.

Check machines use `checkSnapshot` (`roundup-check`), built without owner instructions, and `maxCheckRunners`, initially **0** even when the variable is set. Agent/light machines share `maxRunners`; checks never consume that capacity. Each tick selects light jobs, then agents, then checks, persists their capacity claims, and provisions the selected machines concurrently. Check jobs seed and retain no memory, save diagnostics and remove the machine and registration at completion. Delete `BOXD_CHECK` to put subsequent lanes back on GitHub; already queued jobs keep their labels.

The expression uses `fromJSON(vars.BOXD_CHECK || '[]')`: unset becomes valid JSON `[]`, an array stays an array, and `1` is itself valid JSON. GitHub's `||` short-circuits after the `== '1'` comparison; the final `fromJSON` receives either a nonempty JSON label array or the JSON string `"ubuntu-24.04"`. Actionlint checks syntax/types; evaluation with the installed `@actions/expressions` package checks unset, `1`, empty/matching/nonmatching arrays and push events. The runtime selection relies on [GitHub's logical-operator evaluation](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#operators), not actionlint alone.

## Memory

Every boxd job starts a fresh process. Review and critic jobs judge from the PR and main alone (AGENTS.md rule 5): they start with no conversation or project memory, and the controller keeps only their diagnostics. For build, fix and smoke jobs, Claude conversations and Codex session/state files survive under their Issue/PR; builder and fix jobs share the linked Issue. Claude auto-memory is explicitly enabled in its user settings. Codex's `features.memories`, `memories.generate_memories` and `memories.use_memories` are enabled when its retained home is used. Retained conversations are available to the agent; a new job does not automatically resume an old conversation.

Project memory is shared across builder/fix jobs, with a separate directory for smoke-test memory. A job receives current project memory alongside its scoped conversations. Changed notes merge against the job's starting revision. Concurrent edits keep the first published file and save the other under `<vendor>/conflicts/<job>/`; every job archive also remains available. Deletions apply when the current note still matches the starting revision.

GitHub-hosted agents keep their current fresh-memory behavior. Encrypted GitHub artifact retention is a separate follow-up; this change does not implement it.

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

Prepare an isolated image machine from the current `roundup-ci` snapshot; `image.py build` reinstalls every pinned tool over it. Clone the trusted revision at `/opt/actions-runner/_work/roundup/roundup` (create the parent with ownership `boxd:boxd`), then run:

```sh
python3 /opt/actions-runner/_work/roundup/roundup/loop/agent-runners/image.py build /opt/actions-runner/_work/roundup/roundup
```

The image builder requires Python's distro `python3-yaml` package. It derives the tool versions from `.github/actions/setup/action.yml`, installs the official agent packages, warms pnpm/Rust caches and checks the downloaded GitHub runner's SHA-256 digest. The existing setup action verifies the image fingerprint on self-hosted machines and still reconciles the current pnpm lockfile. Checkout keeps ignored package files because each VM starts from the clean snapshot.

The builder also installs [codegraph](https://github.com/colbymchenry/codegraph) 1.6.2 (pinned in `image.py`; the archive's published SHA-256 digest must match, as for the GitHub runner) and runs `codegraph init -y` on the checkout, so the snapshot holds a code index in the ignored `.codegraph/`. `agent-browser` and its headless Chrome come from the setup action's pin, as before. Before each Claude Code or Codex run, `builder.engine` runs `codegraph sync .` once; a failed sync prints a `::warning::` and the run goes on. Codex reads MCP servers only from its per-run `CODEX_HOME`, so `builder.codex_home` adds `[mcp_servers.codegraph]` to that `config.toml` when `codegraph` is on PATH; Claude Code reads the repository's `.mcp.json`. Any tool that fails to install fails the build.

To give every job the owner's instructions, pass a file that is safe for unattended runs. Do not commit it: the repository is public.

```sh
python3 .../loop/agent-runners/image.py build <checkout> --instructions ~/.claude/loop-ci/AGENTS.md
```

It is installed, owner `boxd`, mode 0644, as `/home/boxd/.claude/CLAUDE.md` and `/home/boxd/.codex/AGENTS.md`; `builder.codex_home` copies the second into each run's Codex home. Without the option neither file exists.

`verify` fails on a TLS error for `https://api.anthropic.com`; an HTTP status error passes. boxd's egress proxy re-signs that host with a CA whose key boxd rotates, and a stale copy in the snapshot fails the Claude App token exchange with `CERTIFICATE_VERIFY_FAILED`. `build` never installs that CA itself, since the chain the proxy presents proves nothing about who signed it: when `verify` reports a stale CA, install the current one as `/usr/local/share/ca-certificates/boxd-egress.crt` from a source you trust, run `update-ca-certificates`, and rebuild.

The running snapshot has none of this. After this change merges, rebuild and re-save `roundup-ci` (steps here); `verify` on a rebuilt image also checks the codegraph version.

After the build passes, cold-stop and start the image machine, then save it **without running another command inside it**:

```sh
boxd machine stop roundup-ci-image
boxd machine start roundup-ci-image
boxd snapshots save roundup-ci-image roundup-ci
```

`start` can return `starting`; wait until `boxd machine get` reports `running` before saving. Cold boot removes transient command credentials from RAM. No runner is registered and no agent state is present when the snapshot is saved. Remove the image machine once the snapshot is ready.

For checks, build a **separate** image machine at the hosted runner size. Snapshot restores keep their source's size; passing sizing flags while restoring a smaller snapshot does not resize it. Create this machine fresh, not from the owner-instruction-bearing agent snapshot:

```sh
boxd machine new roundup-check-image --vcpu 4 --memory 16G --isolated --json
```

On that machine, prepare the trusted checkout at `/opt/actions-runner/_work/roundup/roundup`, owned by `boxd`, and install `python3-yaml` and rustup if absent (the toolchain-image prerequisites). Run this command **without `--instructions`**:

```sh
python3 /opt/actions-runner/_work/roundup/roundup/loop/agent-runners/image.py build /opt/actions-runner/_work/roundup/roundup
```

The build removes existing agent instructions and memory. It installs the setup action's Rust/Node/browser tools and native build libraries, plus `bpftrace`, `libfuse3-dev`, `fuse3` and `pkg-config` for U26 and `strace`, `iproute2` and `util-linux` for E12. Python pip and venv are installed; `/opt/roundup-ci/python/bin` leads the runner PATH so E14's pre-setup `python3 -m pip install` works without modifying Ubuntu's managed Python. The venv can also read distro `python3-yaml`. The image build itself uses `sudo apt-get`; lane steps keep their existing sudo installs. Both lanes keep builds under checkout `target/`; web refreshes runtime binaries after checkout because prepared setup skips its hosted build step. Rust's cache regression fetches the real cache action that prepared setup skips.

Cold-stop/start as above, wait for `running`, then save without another command inside:

```sh
boxd machine stop roundup-check-image
boxd machine start roundup-check-image
boxd machine get roundup-check-image --json
boxd snapshots save roundup-check-image roundup-check
boxd machine remove roundup-check-image --confirm --json
```

A real canary must still verify sudo, kernel BPF/FUSE support and the full setup/test steps on boxd; local controller tests do not establish those capabilities.

From a checkout with `pnpm install`, authenticated `boxd` and `gh`:

```sh
python3 loop/agent-runners/deploy.py --check-snapshot roundup-check --max-check-runners 12
```

This installs the locked controller package, a restarting systemd service, HTTPS forwarding and the repository's signed `workflow_job` webhook. Controller and isolated runners join the explicit `roundup-ci` network so registration and memory transfer work. Re-deployment preserves the secret and private history. `--ref <branch>` admits an explicitly selected branch during pre-merge smoke testing; production uses `main`. boxd's 8-vCPU/32-GiB quota is per machine; the controller's `maxRunners` bounds how many 2-vCPU/8-GiB runners run at once, and a redeploy keeps it. Deployment writes `checkSnapshot` and `maxCheckRunners`, which bounds the 4-vCPU/16-GiB check machines the same way; omitting the cap preserves it on redeploy and defaults a new controller to 0.

Budget estimate: 4 vCPU/16 GiB costs approximately €0.35/h; a full run of 12 machines for about 20 minutes costs €1.4. At roughly 150 check runs/day, most narrower, budget approximately €40–80/day. Build the snapshot, redeploy with the chosen cap, canary `BOXD_CHECK='[<pr>]'`, then set `1`.

Refresh both snapshots when setup pins change and at least weekly to track GitHub runner releases. GitHub stops assigning jobs to runner versions outside its supported update age. A fingerprint mismatch fails visibly; it never silently reinstalls the environment or routes the agent to GitHub-hosted capacity.

## Recovery and observation

The controller persists admission before acknowledging a webhook and reconciles unfinished jobs every 15 seconds after restart. Deterministic machine names prevent duplicate creation after an unknown command outcome. Active jobs checkpoint memory every five minutes. Completion, failure and cancellation take a final checkpoint and retain diagnostics before removal; a save failure returns degraded health and retries with the machine preserved.

Each VM has a three-hour wall-clock deletion deadline to bound compute leakage if the controller is unavailable. This emergency backstop can lose writes after the last checkpoint. The controller hibernates after ten idle minutes; HTTPS wakes it on the next webhook. Active GitHub status checks keep it awake while jobs run.

```sh
pnpm --filter @roundup/agent-runners test:runners
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
