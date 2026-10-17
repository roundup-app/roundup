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
