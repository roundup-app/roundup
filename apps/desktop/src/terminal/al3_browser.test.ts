import { expect, it } from "vitest";
import { read, wait } from "../ui/tabsBrowser";
import { click, load, move, output, settled } from "./linkBrowser";

const KEY = "project-0000000000000000";

/** The fake Daemon reads an Agent other than the selected row for a link to it, as `link.read` does for an Agent of this Project; answers its id. */
const readsAgent = () => read<string>(`(() => {
  const app = window.__fake.app;
  const current = document.querySelector('.rail-row[data-selected=true]')?.dataset.id;
  const node = app.handlers['rail.tree']().find(each => each.kind === 'agent' && each.id !== current);
  app.handlers['link.read'] = () => ({ kind: 'agent', id: node.id, node, digest: null });
  return node.id;
})()`);

const reads = () => read<{ url: string }[]>("window.__fake.app.calls.filter(c => c.method === 'link.read').map(c => c.params)");

it.each(["agent", "door", "shell"])("al3_a_plain_roundup_link_selects_its_object_%s", async kind => {
  await load(kind);
  const id = await readsAgent();
  await output(`\x1b[2J\x1b[Hsee roundup://agent/${id}?project=${KEY}.`);
  await move(8); await click();
  await wait("window.__fake.app.calls.some(c => c.method === 'link.read')");
  await wait(`document.querySelector('.rail-row[data-selected=true]')?.dataset.id === '${id}'`);
  await settled();
  expect(await reads()).toEqual([{ url: `roundup://agent/${id}?project=${KEY}` }]);
  expect(await read("window.__fake.app.attemptedTargets")).toEqual([]);
}, 60_000);

it("al3_an_osc8_agent_link_shows_its_text_and_selects_the_agent", async () => {
  await load();
  const id = await readsAgent();
  await output(`\x1b[2J\x1b[H\x1b]8;;roundup://agent/${id}?project=${KEY}\x1b\\researcher-checks-free-routes\x1b]8;;\x1b\\ waits`);
  await move(5); await click();
  await wait(`document.querySelector('.rail-row[data-selected=true]')?.dataset.id === '${id}'`);
  await settled();
  expect(await reads()).toEqual([{ url: `roundup://agent/${id}?project=${KEY}` }]);
  expect(await read("window.__fake.app.attemptedTargets")).toEqual([]);
}, 60_000);

it("al3_http_and_path_links_still_open", async () => {
  await load();
  const id = await readsAgent();
  await output(`\x1b[2J\x1b[H/abs/path/a.ts https://example.com roundup://agent/${id}?project=${KEY}`);
  await move(2); await click();
  await wait("window.__fake.app.openedTargets.length === 1");
  await move(17); await click();
  await wait("window.__fake.app.openedTargets.length === 2");
  expect(await read("window.__fake.app.openedTargets")).toEqual([{ kind: "path", path: "/abs/path/a.ts", line: null }, { kind: "url", url: "https://example.com" }]);
  await move(40); await click();
  await wait("window.__fake.app.calls.some(c => c.method === 'link.read')");
  expect(await read("window.__fake.app.openedTargets.length")).toBe(2);
}, 60_000);

it("al4_a_link_to_a_missing_agent_shows_not_found", async () => {
  await load();
  const message = "The linked Agent no longer exists.";
  await read(`window.__fake.app.handlers['link.read'] = () => { throw new Error(${JSON.stringify(message)}); }`);
  await output(`\x1b[2J\x1b[Hroundup://agent/gone?project=${KEY}`);
  await move(5); await click();
  await wait(`document.body.textContent.includes(${JSON.stringify(message)})`);
  expect(await read("!!document.querySelector('.pane-screen .xterm-screen')")).toBe(true);
  expect(await read("window.__fake.app.attemptedTargets")).toEqual([]);
}, 60_000);
