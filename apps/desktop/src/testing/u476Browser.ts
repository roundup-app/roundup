import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openPage } from "./chromePage";

// The accepted specification's main revision precedes every implementation change.
export const U476_BASE = "63f64619";

export async function openFontPair(found: string) {
  const base = mkdtempSync(join(tmpdir(), "u476-base-"));
  const root = resolve(process.cwd(), "../..");
  const archive = execFileSync("git", ["archive", U476_BASE, "apps/desktop", "contracts/generated", "tsconfig.json", "package.json"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", base], { input: archive });
  symlinkSync(join(root, "node_modules"), join(base, "node_modules"), "dir");
  symlinkSync(join(process.cwd(), "node_modules"), join(base, "apps/desktop/node_modules"), "dir");
  const baseline = await openPage(found, join(base, "apps/desktop"), 1791936000000);

  try {
    const head = await openPage(found, process.cwd(), 1791936000000);

    return {
      baseline, head,
      close: async () => {
        await head.close();
        await baseline.close();
        rmSync(base, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await baseline.close();
    rmSync(base, { recursive: true, force: true });
    throw error;
  }
}

export async function openFontScreen(page: Awaited<ReturnType<typeof openPage>>, seed: string, width: number) {
  await page.load(`/harness.html?seed=${seed}`, width, 800);
  await page.until(`() => Boolean(window.__fake && document.querySelector('.rail-row'))`);
  await page.call(`() => { if (!document.querySelector('.shelf[data-open="true"]')) document.querySelector('.shelf-toggle').click(); }`);

  if (seed === "conflict") {
    await page.call(`() => document.querySelector('[aria-label="Add Todo"]').click()`);
    await page.until(`() => document.activeElement?.getAttribute('aria-label') === 'New Todo title'`);
    await page.call(`() => { const input = document.querySelector('[aria-label="New Todo title"]'); input.value = 'Keep the draft'; window.__fake.failNext(-32003, 'name already taken'); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }`);
    await page.until(`() => [...document.querySelectorAll('[role=alert]')].some(el => el.textContent.includes('name already taken'))`);
  } else {
    await page.until(`() => document.querySelector('.shelf[data-open="true"] .todo-row-button[aria-label*="#5"]')`);
    await page.call(`() => document.querySelector('.todo-row-button[aria-label*="#5"]').click()`);
    await page.until(`() => document.querySelector('.drawer[data-open="true"] .todo-detail-title')`);
  }

  await page.call(`async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.target?.closest(".drawer")).map(animation => animation.finished)); await document.fonts.ready; }`);
}
