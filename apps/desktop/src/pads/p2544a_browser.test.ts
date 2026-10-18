import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import type { AppServer } from "../testing/appServer";

const execute = promisify(execFile);
const session = `p2544a-${process.pid}`;
let server: AppServer;
const browser = async (...args: string[]) => {
  const { stdout } = await execute("agent-browser", ["--session", session, ...args], { timeout: 60_000 });

  return stdout;
};
const evaluate = async (source: string) => JSON.parse(await browser("eval", source));

beforeAll(async () => {
  server = await appServer();
  await browser("set", "viewport", "1512", "950");
}, 90_000);
afterAll(async () => {
  await browser("close");
  await server?.close();
});

const open = async () => {
  await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=tree-40`);
  await browser("wait", "#shelf-tab-pads");
  await browser("click", "#shelf-tab-pads");
  await browser("wait", "[data-shelf-row] .pad-name");
  await browser("eval", "document.querySelectorAll('[data-shelf-row] .pad-name')[3].click()");
  await browser("wait", ".ProseMirror[contenteditable=true]");
  await browser("click", ".ProseMirror");
  await browser("press", "Control+End");
  await browser("press", "Enter");
  await browser("keyboard", "type", "/");
};

it("p2544a_slash_menu_pointer_and_keys", async () => {
  await open();
  await browser("wait", ".milkdown-slash-menu[data-show=true]");
  await browser("click", ".milkdown-slash-menu li[data-index]:has-text('Heading 1')");
  await browser("keyboard", "type", "Pointer heading");
  expect(await evaluate("document.querySelector('.ProseMirror h1:last-child')?.textContent")).toBe("Pointer heading");
  await browser("press", "Enter");
  await browser("keyboard", "type", "/");
  await browser("wait", ".milkdown-slash-menu[data-show=true]");
  await browser("press", "ArrowDown");
  await browser("press", "Enter");
  await browser("keyboard", "type", "Keyboard heading");
  expect(await evaluate("document.querySelector('.ProseMirror h1:last-child')?.textContent")).toBe("Keyboard heading");
  await browser("press", "Enter");
  await browser("keyboard", "type", "/");
  await browser("wait", ".milkdown-slash-menu[data-show=true]");
  const before = await evaluate("document.querySelector('.ProseMirror').textContent");

  await browser("press", "Escape");
  expect(await evaluate("document.querySelector('.ProseMirror').textContent")).toBe(before);
  await browser("keyboard", "type", "continued");
  expect(await evaluate("document.querySelector('.ProseMirror').textContent.endsWith('/continued')")).toBe(true);
}, 180_000);
