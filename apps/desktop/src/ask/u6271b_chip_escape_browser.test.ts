import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u6271b-escape"); }, 180_000);

afterAll(async () => { await lane?.close(); }, 180_000);

const place = (parts: string) => `(() => {
  window.__fake.app.handlers['ask.place'] = () => ${parts};
  return true;
})()`;

it.each([
  ["two-part", [["fix login", 2], ["pay invoices", 8]], "Project for pay invoices", "fix login. pay invoices"],
  ["single", [["pay invoices", 8]], "Project", "pay invoices"],
] as const)("u6271b_escape_in_the_open_list_closes_only_the_list_%s", async (_name, parts, chip, text) => {
  await lane.seedTodos(["one"], false, "tabs-8");
  await lane.evaluate(place(JSON.stringify(parts.map(([t, n]) => ({ text: t, placement: { kind: "routed", workstream: "w" + n, project: `/Users/you/project-number-${n}` } })))));
  await lane.openAsk();
  await lane.browser("fill", ".ask-input", text);
  await lane.until(`!!document.querySelector('[role=combobox][aria-label="${chip}"]')`);
  await lane.browser("click", `[role=combobox][aria-label="${chip}"]`);
  await lane.until("!!document.querySelector('.app-select-list [role=option]')");
  await new Promise(resolve => setTimeout(resolve, 400));
  await lane.browser("press", "Escape");
  await new Promise(resolve => setTimeout(resolve, 600));
  expect(await lane.evaluate(`({ ask: !!document.querySelector('.ask-input'), list: !!document.querySelector('.app-select-list [role=option]'), focus: document.activeElement?.getAttribute('aria-label') })`)).toEqual({ ask: true, list: false, focus: chip });
}, 120_000);
