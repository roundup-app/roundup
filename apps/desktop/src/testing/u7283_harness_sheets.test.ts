import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromePath, FULLSCREEN, openPage } from "./chromePage";
import { runChecks } from "./checks";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const importsOf = (source: string) => [...source.matchAll(/^import\s+"([^"]+)";/gm)].map(match => match[1] ?? "");

const LIST = importsOf(read("../sheets.ts"));

const chrome = chromePath();

const rendered = chrome || process.env.CI ? describe : describe.skip;

describe("U7283a the harness loads what the entry loads", () => {
  it("u7283a_main_and_the_harness_import_one_list_with_web_css_first", () => {
    expect(LIST[0]).toBe("@ui-sdk/core/web.css");
    expect(LIST.indexOf("./tokens.css")).toBeGreaterThan(0);
    expect(importsOf(read("../main.tsx"))).toContain("./sheets");
    expect(importsOf(read("./harness.tsx"))).toContain("../sheets");
    // A sheet imported beside the list would reach one page and not the other.
    expect(importsOf(read("../main.tsx")).filter(path => path.endsWith(".css"))).toEqual([]);
    expect(importsOf(read("./harness.tsx")).filter(path => path.endsWith(".css") && !path.startsWith("./todoWorstCase"))).toEqual([]);
  });
});

rendered("U7283a the harness page", () => {
  let page: Awaited<ReturnType<typeof openPage>>;

  beforeAll(async () => { page = await openPage(chrome ?? ""); }, 90_000);
  afterAll(async () => { await page?.close(); });

  it("u7283a_the_harness_loads_the_stylesheets_main_loads", async () => {
    await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=agents-10", FULLSCREEN.width, FULLSCREEN.height);
    await page.until(`() => Boolean(document.querySelector('.window'))`);

    const loaded = await page.call<string[]>(`() => [...document.querySelectorAll('style[data-vite-dev-id]')].map(el => el.dataset.viteDevId)`);
    // A dev id is the sheet's path, so a list entry names the sheet by its tail.
    const tail = (path: string) => path.replace(/^\.\//, "").replace(/^@ui-sdk\/core\//, "");
    const seen = LIST.map(entry => loaded.findIndex(id => (id.split("?")[0] ?? "").endsWith(`/${tail(entry)}`)));

    expect(seen.every(index => index >= 0), `missing: ${LIST.filter((_, index) => (seen[index] ?? -1) < 0).join(", ")}`).toBe(true);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[0]).toBeLessThan(seen[LIST.indexOf("./tokens.css")] ?? -1);
  }, 60_000);
});

describe("U7283b D1 and D2 judge the App's own styles", () => {
  const sheet = (css: string, devId?: string) => {
    const el = document.head.appendChild(document.createElement("style"));

    el.dataset.u7283 = "";

    if (devId) el.dataset.viteDevId = devId;
    el.textContent = css;
  };

  const VENDOR = "/node_modules/@ui-sdk/core/dist/web.css";

  afterEach(() => document.querySelectorAll("style[data-u7283]").forEach(el => el.remove()));

  it("u7283b_checks_skip_the_vendor_sheet_and_judge_the_app", () => {
    document.body.innerHTML = '<p class="rail-row">x</p>';
    sheet(":root { --space-2: 8px; --text-small: 12px; --text: #111111; }", "/src/tokens.css");
    sheet("@layer ui-sdk { .rail-row { color: #ff00ff; padding-top: 9.75px; font-size: 13.4px; } }", VENDOR);

    expect(runChecks().D1.status).toBe("pass");
    expect(runChecks().D2.status).toBe("pass");

    // The same literals in an App sheet fail.
    sheet(".rail-row { color: #ff00ff; }");
    expect(runChecks().D1.status).toBe("fail");
    sheet(".rail-row { padding-top: 9.75px; }");
    expect(runChecks().D2.status).toBe("fail");

    // A Token override of the vendor value is the App's, judged as any App value.
    document.querySelectorAll("style[data-u7283]:not([data-vite-dev-id])").forEach(el => el.remove());
    sheet(".rail-row { padding-top: var(--space-2); }");
    expect(runChecks().D2.status).toBe("pass");
  });
});

describe("U7283c every kept vendor rule is named", () => {
  it("u7283c_every_kept_vendor_rule_is_named", () => {
    const doc = read("../../../../docs/design-system.md");
    const section = doc.split("#### Vendor defaults kept")[1]?.split(/^#{1,4} /m)[0] ?? "";
    const entries = [...section.matchAll(/^- `([^`]+)`: (.+)$/gm)];
    const vendor = read("../../node_modules/@ui-sdk/core/dist/web.css");

    expect(entries.length).toBeGreaterThan(0);

    for (const [, selector, reason] of entries) {
      expect(vendor, `no rule of web.css has the selector ${selector}`).toContain(`  ${selector} {`);
      expect((reason ?? "").length, `${selector} names no reason`).toBeGreaterThan(10);
    }
  });
});
