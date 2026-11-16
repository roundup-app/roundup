import { agentBrowserExecutable } from "../testing/chromePage";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appServer, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u484-"));

const session = `u484-${process.pid}`;

let server: AppServer;

/** The App server's origin: set by `openBrowser`, read by the tests of the file that called it. */
export let origin: string;

export const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "15000" }, maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

export const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

/** Starts the App server and the browser session; each test file calls it from its own `beforeAll`. */
export const openBrowser = async () => {
  server = await appServer();
  const [local] = server.resolvedUrls.local;

  if (!local) throw new Error("the App server has no local URL");
  origin = local;
  await browser("--profile", profile, "set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
};

/** Closes the session and the server `openBrowser` started; each test file calls it from its own `afterAll`. */
export const closeBrowser = async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
};
