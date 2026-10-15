import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u474-"));

const session = `u474-${process.pid}`;

let server: ViteDevServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await createServer({ cacheDir: join(profile, "vite"), server: { port: 0, hmr: false }, logLevel: "silent" });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!;
  await browser("--profile", profile, "open", new URL("/src/ui/u474.html", origin).href);

}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});


const load = async () => {
  await browser("open", new URL("/src/ui/u474.html", origin).href);
  await browser("wait", "--fn", `!!document.querySelector('[aria-label="Actions taken"]')`);
};

const focus = async (text: string) => browser("wait", "--fn", `document.activeElement?.textContent === ${JSON.stringify(text)}`);

it("u474_dialog_focus_returns", async () => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Open Dialog", "--exact");
  await focus("Cancel");
  expect(await read<string>(`document.getElementById(document.querySelector('[role=dialog]').getAttribute('aria-labelledby')).textContent`)).toBe("Project question");
  expect(await read<string>(`document.getElementById(document.querySelector('[role=dialog]').getAttribute('aria-describedby')).textContent`)).toBe("Keep the Project open?");
  await browser("press", "Tab"); await focus("Keep");
  await browser("press", "Tab"); await focus("Cancel");
  await browser("press", "Shift+Tab"); await focus("Keep");
  await browser("press", "Escape"); await focus("Open Dialog");
}, 60_000);

it("u474_alert_dialog_is_named", async () => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Open AlertDialog", "--exact");
  await browser("wait", "--fn", `!!document.querySelector('[role=alertdialog]')`);
  expect(await read<string>(`document.getElementById(document.querySelector('[role=alertdialog]').getAttribute('aria-labelledby')).textContent`)).toBe("Close Project?");
  expect(await read<string>(`document.getElementById(document.querySelector('[role=alertdialog]').getAttribute('aria-describedby')).textContent`)).toBe("Closing stops Agents.");
}, 60_000);

it("u474_menu_keyboard", async () => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Project actions", "--exact");
  await browser("wait", "--fn", `!!document.querySelector('[role=menu]')`);
  await browser("press", "ArrowDown");
  expect(await read<string>(`document.querySelector('[data-highlighted][role=menuitem]').textContent`)).toBe("Open Project");
  await browser("press", "ArrowDown");
  expect(await read<string>(`document.querySelector('[data-highlighted][role=menuitem]').textContent`)).toBe("Close Project");
  await browser("press", "Enter");
  await browser("wait", "--fn", `document.querySelector('output').textContent === '1'`);
  expect(await read<string>(`document.querySelector('output').textContent`)).toBe("1");
  await browser("find", "role", "button", "click", "--name", "Project actions", "--exact");
  await browser("press", "ArrowDown");
  await browser("press", "Escape"); await focus("Project actions");
}, 60_000);

it("u474_tooltip_pointer_and_keyboard", async () => {
  await load();
  await browser("hover", '[data-scope="tooltip"][data-part="trigger"]');
  await browser("wait", "--fn", `!!document.querySelector('[role=tooltip]')`);
  const linked = `document.getElementById(document.querySelector('[data-scope=tooltip][data-part=trigger]').getAttribute('aria-describedby'))?.textContent`;
  expect(await read<string>(linked)).toBe("Project contains Agents.");
  await browser("mouse", "move", "1200", "700");
  await browser("wait", "--fn", `!document.querySelector('[role=tooltip]')`);
  await browser("eval", `document.querySelector('[data-scope=menu][data-part=trigger]').focus()`);
  await browser("press", "Tab");
  await browser("wait", "--fn", `!!document.querySelector('[role=tooltip]')`);
  expect(await read<string>(linked)).toBe("Project contains Agents.");
  await browser("press", "Tab");
  await browser("wait", "--fn", `!document.querySelector('[role=tooltip]')`);
}, 60_000);

for (const path of ["hover", "focus"] as const) {
  it(`u477_icon_button_${path}_shows_its_name`, async () => {
    await load();
    const selector = '[aria-label="Open Project"]';
    if (path === "hover") await browser("hover", selector);
    else {
      await browser("eval", `document.querySelector('[data-scope=tooltip][data-part=trigger]').focus()`);
      await browser("press", "Tab");
    }
    await browser("wait", "--fn", `!!document.querySelector('[role=tooltip]')`);
    expect(await read<string>(`document.getElementById(document.querySelector('${selector}').getAttribute('aria-describedby'))?.textContent`)).toBe("Open Project");
  }, 60_000);
}
