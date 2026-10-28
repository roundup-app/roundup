import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { captureDir } from "../../testing/captures";
import { chromePath } from "../../testing/chromePage";
import { startRealDaemon } from "../../testing/realDaemonFixture";
import { createServedApp } from "../../testing/realSeam";

// U4457 names the real Daemon and native button activation, which jsdom cannot prove.
it("u4457_the_real_daemon_pads_control_supports_pointer_enter_and_space", async () => {
  const executable = chromePath();

  if (!executable) throw new Error("U4457 needs Chromium");
  const real = await startRealDaemon({}, true);
  const profile = await mkdtemp(join(tmpdir(), "u4457-browser-"));
  const config = join(profile, "config.json");
  await writeFile(config, "{}");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));

  const browser = async (...args: string[]) => {
    const { stdout } = await promisify(execFile)("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", `u4457-${process.pid}`, "--profile", profile, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const reply = JSON.parse(stdout);
    expect(reply.success, stdout).toBe(true);

    return reply.data;
  };

  const evaluate = async (source: string) => (await browser("eval", source)).result;
  const until = (source: string) => browser("wait", "--fn", source);
  const app = createServedApp(real.base);

  const capture = async (step: string) => {
    const dir = captureDir("U4457");

    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")) + "\n");
    await browser("screenshot", join(dir, `${step}.png`));
  };

  try {
    const alpha = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name: "Pad author" });
    const beta = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name: "Selected Agent" });

    for (const name of ["notes", "plan"]) {
      await app.rpc("pad.create", { name, text: null });
      await app.rpc("pad.setOwner", { name, owner: { kind: "agent", id: alpha.id, parent: null } });
    }

    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await browser("wait", `[data-id="${alpha.id}"] [data-pads-control]`);
    await browser("click", `.rail-row[data-id="${beta.id}"] .name`);
    await until(`document.querySelector('.rail-row[data-id="${beta.id}"]')?.getAttribute('aria-selected') === 'true'`);
    const before = await evaluate("document.querySelectorAll('.rail-row').length");
    await capture("before");
    const control = `.rail-row[data-id="${alpha.id}"] [data-pads-control]`;
    const group = `.pads-tab [data-shelf-group="${alpha.id}"]`;

    for (const activation of ["click", "Enter", "Space"]) {
      if (activation === "click") {
        await browser("hover", `.rail-row[data-id="${alpha.id}"]`);
        await until(`getComputedStyle(document.querySelector('${control}')).pointerEvents === 'auto'`);
        await browser("click", control);
      }
      else {
        await browser("click", "#shelf-tab-todos");
        await until("!!document.querySelector('.todos-tab')");
        await browser("focus", control);
        await browser("press", activation);
      }

      await until(`document.querySelector('${group}')?.getAttribute('aria-expanded') === 'true' && document.activeElement === document.querySelector('${group} .shelf-group-control')`);
      expect(await evaluate("document.querySelectorAll('.rail-row').length")).toBe(before);
      expect(await evaluate(`document.querySelector('.rail-row[data-id="${beta.id}"]')?.getAttribute('aria-selected')`)).toBe("true");
      expect(await evaluate(`document.querySelectorAll('${group} [data-pad]').length`)).toBe(2);
      await capture(activation);
    }
  } catch (error) {
    await capture("failure");
    console.error(await evaluate("JSON.stringify({active:document.activeElement.outerHTML,text:document.body.innerText})").catch(() => "browser unavailable"));
    throw error;
  } finally {
    try { await browser("close"); } finally { await real.stop(); await rm(profile, { recursive: true, force: true }); }
  }
}, 60_000);
