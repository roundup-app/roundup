import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath } from "./chromePage";
import { captureDir } from "./captures";
import type { Checks } from "./checks";
import { openFontPair, openFontScreen, U476_BASE } from "./u476Browser";

let pair: Awaited<ReturnType<typeof openFontPair>>;

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

const art = captureDir("U476");

beforeAll(async () => {
  if (!found) throw new Error("U476 requires CHROME_PATH");
  pair = await openFontPair(found);
}, 90_000);

afterAll(async () => { await pair?.close(); });

run("U476 rendered font inheritance", () => {
  it("u476_rendered_ui_and_mono_text_use_their_tokens", async () => {
    for (const scheme of ["light", "dark"] as const) {
      await pair.head.scheme(scheme);
      await openFontScreen(pair.head, "tree-40", 1280);

      const fonts = await pair.head.call<{ ui: string; mono: string; uiText: string[]; monoText: string[] }>(`async () => {
        const fixture = document.createElement('div');
        // Each technical category is present even when a seed has no diff or token count.
        fixture.innerHTML = '<span class="mono" data-category="path">/Users/you/harness</span><pre class="mono" data-category="diff">+ hello</pre><span class="mono" data-mono data-category="id">#5</span><span class="mono" data-category="tokens">1234 tokens</span><code class="mono" data-category="code">const x = 1</code>';
        document.querySelector('.drawer').append(fixture);
        const family = el => { if (!el) throw new Error('missing font category'); return getComputedStyle(el).fontFamily; };
        const token = name => { const el = document.createElement('span'); el.style.fontFamily = 'var(' + name + ')'; document.body.append(el); const value = family(el); el.remove(); return value; };
        const monoText = ['code','path','diff','id','tokens'].map(category => family(fixture.querySelector('[data-category="' + category + '"]')));
        fixture.remove();
        return { ui: token('--font-ui'), mono: token('--font-mono'), monoText, uiText: [document.body, document.querySelector('.rail-row .name'), document.querySelector('button'), document.querySelector('.todo-detail-title')].map(family) };
      }`);

      expect(fonts.ui.startsWith("-apple-system")).toBe(true);
      expect(fonts.mono).not.toBe(fonts.ui);
      expect(fonts.uiText).toEqual(Array(4).fill(fonts.ui));
      expect(fonts.monoText).toEqual(Array(5).fill(fonts.mono));
      expect(await pair.head.call<string>(`() => getComputedStyle(document.querySelector(".todo-dependencies .mono")).fontFamily`)).toBe(fonts.mono);
      await pair.head.load('/harness.html?seed=door-report', 1280, 800);
      await pair.head.until(`() => document.querySelector('.rail-row[data-id]')`);
      await pair.head.call(`() => document.querySelector('.rail-row[data-id]').dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: 40, clientY: 40}))`);
      await pair.head.until(`() => document.querySelector('[role=menuitem]')`);
      expect(await pair.head.call<string>(`() => getComputedStyle(document.querySelector('[role=menuitem]')).fontFamily`)).toBe(fonts.ui);
      await pair.head.call(`() => window.__fake.emit({ actor: { kind: "user", id: "you", parent: null }, name: "agent.status", data: { id: "review-agent", attempt: "1", status_revision: "9", status: { kind: "needs-you", label: "Please review the result", since: Date.now() } } })`);
      await pair.head.until(`() => document.querySelector('.toast-line')`);
      expect(await pair.head.call<string>(`() => getComputedStyle(document.querySelector('.toast-line')).fontFamily`)).toBe(fonts.ui);

    }
  }, 120_000);

  it("u476_rendered_checks_do_not_regress", async () => {
    const shas = { base: execFileSync("git", ["rev-parse", U476_BASE], { encoding: "utf8" }).trim(), head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() };

    // Contrast varies by scheme, so both stay; one window represents every supported width.
    const width = 1280;

    for (const scheme of ["light", "dark"] as const) for (const seed of ["tree-40", "conflict"]) {
      const readings: Checks[] = [];

      for (const [name, page] of [["base", pair.baseline], ["head", pair.head]] as const) {
        await page.scheme(scheme);
        await openFontScreen(page, seed, width);
        const checks = await page.call<Checks>(`() => window.__checks()`);
        readings.push(checks);

        if (art) {
          const dir = join(art, name);
          mkdirSync(dir, { recursive: true });
          const step = `${seed}-${scheme}-${width}x800`;
          writeFileSync(join(dir, `${step}.png`), Buffer.from(await page.shot(), "base64"));
          writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(checks, null, 2));
        }
      }

      const [base, head] = readings;

      for (const id of ["D2", "D5", "D6"] as const) {
        expect(base![id].status, `${seed} ${scheme} ${width} base ${id}: ${JSON.stringify(base![id])}`).toBe("pass");
        expect(head![id].status, `${seed} ${scheme} ${width} head ${id}: ${JSON.stringify(head![id])}`).toBe("pass");
      }

      for (const [id, check] of Object.entries(base!)) if (check.status === "pass") {
        // SAFETY: base and head are both the complete Checks result from window.__checks().
        expect(head![id as keyof Checks].status, `${seed} ${scheme} ${width} ${id}`).toBe("pass");
      }

      if (art) writeFileSync(join(art, `${seed}-${scheme}-${width}.json`), JSON.stringify({ shas, seed, scheme, width, height: 800, deviceScaleFactor: 1, clock: 1791936000000, base, head }));
    }
  }, 180_000);
});
