import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "./captures";
import { join } from "node:path";

let lane: LaneBrowser;

beforeAll(async () => { if (!captureDir("U3787d")) return; lane = await openLane(1512, "dark", "u3787d"); }, 60_000);

afterAll(async () => { await lane?.close(); }, 60_000);

it.skipIf(!captureDir("U3787d")).each(["tree-40", "tabs-8", "conflict"])("u3787d_rendered_literal_fields %s", async seed => {
  const dir = captureDir("U3787d")!;
  await lane.browser("record", "start", join(dir, `${seed}-literal-fields.webm`));

  try {
      await lane.seedTodos(["same", "same", "長い é 🧭 ".repeat(12), "dependent", "fifth"], true, seed);
      await lane.browser("set", "media", "dark");
      await lane.capture("U3787d", `${seed}-rest`);
      const [id] = await lane.order();
      await lane.browser("focus", `.shelf [data-todo="${id}"] .todo-row-button`);
      await lane.browser("press", "F2");
      await lane.until("!!document.querySelector('.row-name-editor input')");
      await lane.browser("fill", ".row-name-editor input", "  é 🧭 日本語 /a_b --x='yes';  ");
      expect(await lane.evaluate("(() => { const f = document.querySelector('.row-name-editor input'); return [f.getAttribute('spellcheck'), f.getAttribute('autocorrect'), f.getAttribute('autocapitalize'), f.value]; })()")).toEqual(["false", "off", "off", "  é 🧭 日本語 /a_b --x='yes';  "]);
      await lane.capture("U3787d", `${seed}-editing`);
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('.row-name-editor input')");

      if (seed === "conflict") {
        await lane.browser("focus", `.shelf [data-todo="${id}"] .todo-row-button`);
        await lane.browser("press", "o");
        await lane.until("!!document.querySelector('[role=menu]')");
        await lane.browser("press", "End");
        await lane.browser("press", "ArrowUp");
        await lane.browser("press", "Enter");
        await lane.until("!!document.querySelector('.new-workstream textarea')");
        await lane.evaluate("(() => { window.__fake.failNext(-32003, 'Storage unavailable. Retry.'); return true; })()");
        await lane.browser("click", ".new-workstream button[type=submit]");
        await lane.until("document.body.textContent.includes('Storage unavailable. Retry.')");
        await lane.capture("U3787d", `${seed}-failed-create-full`);
        await lane.browser("press", "Escape");
      }

      await lane.capture("U3787d", `${seed}-cancelled`);
  } finally { await lane.browser("record", "stop"); }
}, 60_000);
