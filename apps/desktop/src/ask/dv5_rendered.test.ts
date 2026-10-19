import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer, type ViteDevServer } from "vite";
import { realDaemon, } from "../testing/realDaemonPlugin";
import { expect, it } from "vitest";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { chromePath } from "../testing/chromePage";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

it("dv5_discover_open_keyboard_and_failure_on_the_dense_reopened_project", async () => {
  const real = await startRealDaemon({}, true);
  const profile = mkdtempSync(join(tmpdir(), "dv5-profile-"));
  const session = `dv5-${process.pid}`;
  writeFileSync(join(profile, "config.json"), "{}");
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_"))), AGENT_BROWSER_DEFAULT_TIMEOUT: "60000" };
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--executable-path", chromePath()!, "--args", "--no-sandbox", "--config", join(profile, "config.json"), "--session", session, "--profile", profile, ...args], { env, timeout: 90_000 })).stdout;
  // SAFETY: agent-browser serialises the page expression's JSON value.
  const evaluate = async <T,>(source: string): Promise<T> => JSON.parse(await browser("eval", source)) as T;
  const until = (source: string) => browser("wait", "--fn", source);
  const app = createServedApp(real.base);

  const capture = async (step: string) => {
    const dir = captureDir("DV5");

    if (!dir) return;
    mkdirSync(join(dir, step.includes("/") ? "base" : "."), { recursive: true });
    writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
    await browser("screenshot", join(dir, `${step}.png`));
  };

  let baseline: ViteDevServer | undefined;

  try {
    const home = await app.rpc("rail.createWorkstream", { name: "Published work", parent: null });

    for (let n = 0; n < 10; n += 1) {
      const maker = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: home.id, name: `Maker ${n}` });
      await exec(resolve("../../target/debug/rup"), ["deliverable", "publish", `dense-${n}`, n === 9 ? "Long result " + "成果📖".repeat(35) : "Repeated title", "--agent", maker.id, "--target", JSON.stringify({ kind: "external", url: `https://example.com/${"long-target/".repeat(12)}${n}` })], { env: { ...process.env, RUPD_SOCKET: join(real.dir, "rupd.sock") } });
      await app.rpc("agent.stop", { id: maker.id });
    }

    await app.rpc("pad.create", { name: "published-pad", text: "Read-only published revision" });
    const pad = await app.rpc("pad.read", { name: "published-pad" });
    const record = await app.rpc("deliverable.publish", { key: "unavailable", title: "Retained Pad", target: { kind: "pad", name: pad.name, incarnation: pad.incarnation, revision: pad.revision } });
    writeFileSync(join(real.dir, "report.txt"), "Published file");
    await app.rpc("deliverable.publish", { key: "file", title: "Repeated title", target: { kind: "file", path: "report.txt" } });
    await real.restart();
    await browser("set", "viewport", "1512", "950");

    if (process.env.ROUNDUP_BASELINE_ROOT) {
      baseline = await createServer({ root: process.env.ROUNDUP_BASELINE_ROOT, configFile: join(process.env.ROUNDUP_BASELINE_ROOT, "vite.config.ts"), logLevel: "silent", plugins: [realDaemon({ project: real.dir, socket: join(real.dir, "rupd.sock"), proof: "0".repeat(64) })], server: { host: "127.0.0.1", port: 0 } });
      await baseline.listen();
      await browser("open", `${baseline.resolvedUrls!.local[0]}harness.html?daemon=1`);
      await until("!!document.querySelector('.ask-input')");
      await capture("base/overview");
    }

    await browser("open", `${real.base}/harness.html?daemon=1`);
    await until("!!document.querySelector('.ask-input')");
    await until("document.querySelectorAll('.made-row').length === 12 && document.querySelector('.made')?.getAttribute('aria-busy') === 'false'");
    await capture("overview");
    const button = `.made-row[data-deliverable="${record.id}"] button`;
    await browser("focus", button);
    await browser("press", "Enter");
    await until(`document.querySelector('.made-row[data-deliverable="${record.id}"]')?.dataset.selected === 'true' && document.querySelector('.made')?.getAttribute('aria-busy') === 'false'`);
    expect(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(button)})`)).toBe(true);
    await app.rpc("pad.delete", { name: pad.name });
    await browser("click", button);
    await until("!!document.querySelector('.made [role=alert]') && document.querySelector('.made')?.getAttribute('aria-busy') === 'false'");
    expect(await evaluate("document.querySelectorAll('.made-row').length")).toBe(12);
    await capture("failure");
    await browser("set", "media", "dark");
    await until("matchMedia('(prefers-color-scheme: dark)').matches");
    await capture("failure-dark");
    await browser("set", "media", "light");
    await until("matchMedia('(prefers-color-scheme: light)').matches");
    // Scope follows Rail selection without replacing its Terminal.
    await browser("click", `.rail [data-id="${home.id}"] [data-part="branch-control"]`);
    await until(`document.querySelector('.rail [data-id="${home.id}"] [data-part="branch-control"]')?.dataset.selected === 'true'`);
    await until("document.querySelectorAll('.made-row').length === 10");
    expect(await evaluate("!!document.querySelector('.pane')")).toBe(true);
    await capture("home");
  } finally {
    await browser("close").catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
    await baseline?.close();
    await real.stop();
  }
}, 120_000);
