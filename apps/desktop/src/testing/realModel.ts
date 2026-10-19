import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The model boundary of the real-Claude web tests (E10); it scripts nothing of what Claude does. */
const REPO = resolve(process.cwd(), "../..");

const KEY = "sk-mock-key-000000000000000000000001";

/** The pinned Claude behind the model route. The Launcher strips `ANTHROPIC_BASE_URL` from a child's environment (A30) and a lean child (LC2) reads none of the user's `env` setting, so only a program in front of Claude can carry the route. */
export const routedClaude = async (dir: string, url: string) => {
  const path = join(dir, "claude-routed");

  await writeFile(path, `#!/bin/sh\nexport ANTHROPIC_BASE_URL='${url}' CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1 CLAUDE_CODE_MAX_RETRIES=0\nexec '${join(REPO, "node_modules/.bin/claude")}' "$@"\n`, { mode: 0o755 });

  return path;
};

export type Model = { url: string; journal: () => Promise<Journal[]>; assertMatched: (failed?: number) => Promise<void>; stop: () => Promise<void> };

type Journal = { body: { messages?: { role: string; tool_call_id?: string; content?: unknown }[] }; response: { fixture: unknown; status: number } };

const freePort = () =>
  new Promise<number>((found, fail) => {
    const server = createServer();

    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      // SAFETY: a server listening on a TCP port reports an address object, never a pipe string.
      const { port } = server.address() as { port: number };

      server.close(() => found(port));
    });
  });

const get = async (url: string, resource: string) => {
  const response = await fetch(`${url}/__aimock/${resource}`, { headers: { "x-api-key": KEY } }).catch(() => null);

  return response?.ok ? response.json() : null;
};

/** aimock on loopback with scenario turns and shared rename-note acknowledgements: an unmatched request fails (`--strict`). */
export const startModel = async (fixture: string): Promise<Model> => {
  const port = await freePort();

  const child: ChildProcess = spawn(
    join(REPO, "node_modules/.bin/llmock"),
    ["--port", String(port), "--host", "127.0.0.1", "--strict", "--validate-on-load", "--strict-tool-arguments", "--journal-max", "0", "--log-level", "warn", "--fixtures", join(REPO, "crates/rup/tests/e2e/fixtures/rail_rename_note.json"), "--fixtures", fixture],
    { env: { ...process.env, AIMOCK_API_KEYS: KEY }, stdio: ["ignore", "ignore", "inherit"] },
  );

  const url = `http://127.0.0.1:${port}`;

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;

    await new Promise<void>((done) => {
      child.once("exit", () => done());
      child.kill();
    });
  };

  for (let tries = 0; ; tries += 1) {
    if (child.exitCode !== null) throw new Error("aimock exited during startup");

    if (await get(url, "health")) break;

    if (tries > 400) {
      await stop();
      throw new Error("aimock health deadline");
    }

    await new Promise((done) => setTimeout(done, 25));
  }

  const journal = async () => {
    const entries = await get(url, "journal");

    if (!entries) throw new Error("aimock journal does not answer");

    // SAFETY: aimock's journal endpoint answers the array of its request entries.
    return entries as Journal[];
  };

  return {
    url,
    journal,
    stop,
    // `failed` is the number of scripted error responses (a fixture's `status: 500`) the test expects; any other failure or unmatched request throws.
    assertMatched: async (failed = 0) => {
      const entries = await journal();

      if (!entries.length) throw new Error("real Claude made no model request");

      const bad = entries.filter((entry) => !entry.response.fixture);
      const errors = entries.filter((entry) => entry.response.status !== 200);

      if (bad.length || errors.length !== failed) throw new Error(`unmatched or failed aimock request (${failed} scripted errors expected): ${[...bad, ...errors].map((entry) => `${entry.response.status} ${entry.response.fixture ? "matched" : "unmatched"} ${JSON.stringify(entry.body.messages?.at(-1)?.content).slice(0, 160)}`).join("; ")}`);
    },
  };
};

/** A test-owned `CLAUDE_CONFIG_DIR`: a dummy credential, onboarding and trust seeded; the Project pins the default permission mode. */
export const configureClaude = async (config: string, cwd: string) => {
  await mkdir(config, { recursive: true });
  await writeFile(
    join(config, "settings.json"),
    JSON.stringify({
      apiKeyHelper: `printf ${KEY}`,
    }),
  );
  // A lean child (LC2) reads no user `permissions.defaultMode`; the Project's settings pin it.
  await mkdir(join(cwd, ".claude"), { recursive: true });
  await writeFile(join(cwd, ".claude/settings.json"), JSON.stringify({ permissions: { defaultMode: "default" } }));

  const projects: Record<string, { hasTrustDialogAccepted: boolean }> = {};

  for (const path of [cwd, realpathSync(cwd)]) projects[path] = { hasTrustDialogAccepted: true };

  await writeFile(
    join(config, ".claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: "dark",
      lastOnboardingVersion: "2.1.300",
      lastReleaseNotesSeen: "2.1.300",
      customApiKeyResponses: { approved: ["00000000000000000001"], rejected: [] },
      hasSeenAutoDefaultNudge: true,
      hasResetAutoModeOptInForDefaultOffer: true,
      hasSeenAutoModeEntryWarning: true,
      projects,
    }),
  );
};

/** E14: at most this many real Claudes run at once across the web files. */
const REAL_CLAUDE_SLOTS = 4;

/** Holds one of the slots until the returned function runs; a slot older than ten minutes belongs to a dead run. */
export const takeSlot = async (): Promise<() => Promise<void>> => {
  for (;;) {
    for (let each = 0; each < REAL_CLAUDE_SLOTS; each += 1) {
      const slot = join(tmpdir(), `roundup-real-claude-slot-${each}`);

      try {
        await mkdir(slot);

        return () => rm(slot, { recursive: true, force: true });
      } catch {
        const age = await stat(slot).then((found) => Date.now() - found.mtimeMs, () => 0);

        if (age > 600_000) await rm(slot, { recursive: true, force: true });
      }
    }

    await new Promise((done) => setTimeout(done, 200));
  }
};
