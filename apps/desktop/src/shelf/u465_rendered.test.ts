import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { captureDir, readCapture } from "../testing/captures";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";

const exec = promisify(execFile);

let page: ChromePage;

let cache: string;

// One representative case: the densest seed, the only one that reaches the failed add, in the narrowest supported layout.
const [seed, windowWidth, shelfWidth] = ["tree-40", 1280, 240] as const;

const tag = `${seed}-${windowWidth}-light-${shelfWidth}`;

const evaluate = <T,>(script: string): Promise<T> => page.call<T>(`() => (${script})`);

// The page's action timeout for an element or text to appear.
const wait = (predicate: string) => page.until(`() => ${predicate}`, 25_000);

// Shelf.select queues focus; its microtask finishes before the next rendered frame.
const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => resolve(true)))");

// The head harness is the page's own server; `main` serves main's Shelf for capture baselines.
let main: ViteDevServer | undefined;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U465 requires headless Chromium");
  page = await openPage(chrome);
  await page.scheme("light");
  cache = mkdtempSync(join(tmpdir(), "u465-vite-"));

  // CI uses a shallow web checkout; normal checks read the committed main observations.
  if (captureDir("U465")) {
    main = await createServer({ cacheDir: cache, logLevel: "silent", server: { port: 0, hmr: false }, plugins: [{
      name: "u465-main-baseline", enforce: "pre",
      async load(id) {
        const path = ["Shelf.tsx", "styles.css"].find(file => id.split("?")[0]?.endsWith(`/shelf/${file}`));

        if (path) return (await exec("git", ["show", `origin/main:apps/desktop/src/shelf/${path}`])).stdout;
      },
    }] });
    await main.listen();
  }
}, 60_000);

afterAll(async () => {
  await page?.close();
  await main?.close();
  rmSync(cache, { recursive: true, force: true });
});

// Loads `seed` from `server`, or from the page's own head server, in a `windowWidth` by 800 window, once the document has loaded.
const open = async (server: ViteDevServer | undefined, seed: string, width: number, windowWidth: number) => {
  const path = `harness.html?seed=${seed}`;

  await page.load(server ? `${server.resolvedUrls!.local[0]}${path}` : `/${path}`, windowWidth, 800);

  try { await wait("document.readyState === 'complete' && !!document.querySelector('.shelf-tabs')"); } catch (error) { console.error(await evaluate<string>("document.body.outerHTML")); throw error; }

  await evaluate(`(() => { localStorage.clear(); document.querySelector('.window').style.setProperty('--shelf-span', '${width}px'); document.querySelector('#shelf-tab-todos').click(); return true; })()`);
  await settle();
};

const select = async (tab: string) => {
  await evaluate(`(() => { document.querySelector('#shelf-tab-${tab}').click(); return true; })()`);
  await settle();
};

const capture = async (side: "base" | "head", tag: string, checks: Checks) => {
  const dir = captureDir("U465");

  if (!dir) return;

  mkdirSync(join(dir, side), { recursive: true });

  const path = join(dir, side, tag);

  writeFileSync(`${path}.checks.json`, JSON.stringify(checks) + "\n");
  writeFileSync(`${path}.png`, Buffer.from(await page.shot(), "base64"));
};

it("u465_heads_preserve_checks_and_visible_failure", async () => {
  const baseline = new Map<string, Checks>();

  for (const side of main ? ["base", "head"] as const : ["head"] as const) {
    await open(side === "base" ? main : undefined, seed, shelfWidth, windowWidth);

    const observe = async (step: string) => {
      const checks = await evaluate<Checks>("window.__checks()");

      if (side === "base") baseline.set(step, checks);
      else {
        const reference: Checks = baseline.get(step) ?? JSON.parse(readCapture("U465", `base/${tag}-${step}.checks.json`));

        for (const id of CHECK_IDS) if (reference[id].status === "pass") expect(checks[id].status, `${tag} ${step} ${id}`).toBe("pass");

        for (const id of ["D2", "D5", "D6"] as const) expect(checks[id].status, `${tag} ${step} ${id}`).toBe("pass");
      }

      await capture(side, `${tag}-${step}`, checks);
    };

    await observe("todos");
    await select("pads");
    await observe("pads");
    await evaluate(`(() => { document.querySelector('#shelf-tab-pads').focus(); return true; })()`);
    await page.press("Home", "Home");
    await settle();
    expect(await evaluate<string>("document.activeElement.id")).toBe("shelf-tab-todos");
    await observe("focus");
    await wait(`!!document.querySelector('button[aria-label="Add Todo"]')`);
    const add = await evaluate<{ x: number; y: number }>(`(() => { const button = document.querySelector('button[aria-label="Add Todo"]'); button.scrollIntoView({ block: 'nearest' }); const box = button.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
    await page.click(add.x, add.y);
    await wait(`!!document.querySelector('[aria-label="New Todo title"]')`);
    await evaluate(`(() => { window.__fake.failNext(-32003, 'U465 Todo add failed'); const input = document.querySelector('[aria-label="New Todo title"]'); input.value = 'U465 rejected Todo'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    await wait("document.body.innerText.includes('U465 Todo add failed')");
    await observe("failure");
  }
}, 120_000);
