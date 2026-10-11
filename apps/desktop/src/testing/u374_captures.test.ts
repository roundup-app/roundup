import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U374 in a real Chromium: the rewind prompt with its plan, its pending state and its result, at 1280x800 and 700x800. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U374");

beforeAll(async () => {
  if (!found) throw new Error("U374 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const save = async (name: string, width: number, height: number) => {
  mkdirSync(ART, { recursive: true });
  writeFileSync(join(ART, `${name}-${width}x${height}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(ART, `${name}-${width}x${height}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
};

run("u374 the rewind prompt", () => {
  vi.setConfig({ testTimeout: 90_000 });

  for (const [width, height] of [[1280, 800], [700, 800]] as const) {
    it(`u374_the_prompt_plan_pending_and_result_render_cleanly at ${width}x${height}`, async () => {
      await page.load("/harness.html?seed=rewind", width, height);
      await page.until(`() => document.querySelectorAll("[data-checkpoint] .thread-checkpoint-rewind").length === 2`, 60_000);
      await page.call(`() => document.querySelector("[data-checkpoint='2'] .thread-checkpoint-rewind").click()`);
      await page.until(`() => document.querySelectorAll("[data-rewind-files] li").length > 0`);

      const fits = await page.call<boolean>(`() => { const box = document.querySelector("[data-rewind-prompt]"); return [...box.querySelectorAll("li, p, label")].every((each) => each.scrollWidth <= each.clientWidth + 1); }`);

      expect(fits).toBe(true);
      expect(await page.call<number>(`() => document.querySelectorAll(".thread-rewind-paths li").length`)).toBe(6);
      await save("plan", width, height);

      await page.call(`() => { document.querySelector("[data-rewind-prompt] input[type=radio]").click(); window.__fake.app.handlers["workstream.rewind"] = () => new Promise(() => {}); }`);
      await page.call(`() => [...document.querySelectorAll("[data-rewind-prompt] button")].find((each) => each.textContent.trim() === "rewind").click()`);
      await page.until(`() => document.querySelector("[data-rewind-prompt] button[data-button=quiet]").disabled`);
      await save("pending", width, height);

      await page.call(`() => window.__fake.emit({ actor: { kind: "user", id: "you", parent: null }, name: "workstream.rewound", data: { id: "r1", checkpoint: 2 } })`);
      await page.until(`() => Boolean(document.querySelector("[data-rewound]")) && !document.querySelector("[data-rewind-prompt]")`);
      expect(await page.call<string>(`() => document.querySelector("[data-rewound]").textContent`)).toBe("rewound to here");
      await save("result", width, height);
    });
  }
});
