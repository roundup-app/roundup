import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { captureDir } from "../testing/captures";
import { CHECK_IDS, type Checks } from "../testing/checks";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U378 requires isolated Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const capture = async (name: string) => {
  const dir = captureDir("U378");

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`)) + "\n");
};

const load = async (seed: string, scheme: "light" | "dark", base = false) => {
  await page.scheme(scheme);
  const path = `/harness.html?seed=${seed}`;
  await page.load(base ? `${process.env.ROUNDUP_RAIL_BASELINE}${path}` : path, 1280, 800);
  await page.until(`() => window.__fake && typeof window.__checks === 'function'`);

  if (seed === "first-run") {
    await page.until(`() => [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Choose folder'))`);
    await page.call(`() => { window.__fake.app.chooser.path='/Users/you/harness'; [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Choose folder')).click(); }`);
  }

  if (seed !== "tree-40") {
    await page.until(`() => document.querySelector('[aria-label="Add Workstream"]') && !document.querySelector('[aria-label="Add Workstream"]').hasAttribute('aria-disabled')`);
    await page.call(`() => document.querySelector('[aria-label="Add Workstream"]').click()`);
  }

  await page.until(`() => document.querySelector('[aria-label="Add Agent"]')`);
  await page.call(`() => document.querySelector('[aria-label="Add Agent"]').closest('.rail-row').focus()`);
};

const FAILURE = "Cannot start Agent: retry with another Model";

const failAdd = async () => {
  await page.call(`() => { window.__fake.failNext(-32602,'${FAILURE}'); document.querySelector('[aria-label="Add Agent"]').click(); }`);
  await page.until(`() => [...document.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('Cannot start Agent'))`);
};

for (const scheme of ["light", "dark"] as const) {
  it(`u378_the_row_actions_have_one_even_gap ${scheme}`, async () => {
    await load("tree-40", scheme);

    const row = await page.call<{ labels: string[]; gaps: number[]; token: number; borders: string[] }>(`() => {
      const icons = document.activeElement.querySelector('.row-icons');
      const buttons = [...icons.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0 && getComputedStyle(b).position !== 'absolute');
      const boxes = buttons.map(b => b.getBoundingClientRect());
      return {
        labels: buttons.map(b => b.getAttribute('aria-label')),
        gaps: boxes.slice(1).map((b, i) => b.left - boxes[i].right),
        token: parseFloat(getComputedStyle(icons).getPropertyValue('--space-1')),
        borders: buttons.map(b => getComputedStyle(b).borderLeftWidth + getComputedStyle(b).borderRightWidth),
      };
    }`);

    expect(row.labels[0]).toBe("Add Agent");
    expect(row.labels).not.toContain("Choose Model and Effort");
    expect(row.gaps.length).toBeGreaterThan(1);
    expect(row.gaps.every(gap => gap === row.token)).toBe(true);
    expect(row.borders.every(border => border === "0px0px")).toBe(true);
  }, 60_000);
}

for (const seed of ["first-run", "agents-10", "tree-40"]) {
  for (const scheme of ["light", "dark"] as const) {
    it(`u378_the_row_renders_one_add_with_even_gaps ${seed} ${scheme}`, async () => {
      const name = `${seed}-1280-${scheme}`;
      await load(seed, scheme);

      if (seed === "tree-40") {
        for (const [id, minNameWidth] of [["backend", 32], ["auth", 32]] as const) {
          await page.call(`id => document.querySelector('[data-id="'+id+'"]').focus()`, id);

          const bounds = await page.call<{ fits: boolean; nameWidth: number }>(`() => {
            const row = document.activeElement;
            const box = row.getBoundingClientRect();
            const list = document.querySelector('.rail-scroll:not(.rail-actions)');
            const buttons = [...row.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width > 0);
            return {fits: list.scrollWidth <= list.clientWidth && buttons.every(button => {
              const b = button.getBoundingClientRect();
              return b.left >= box.left && b.right <= box.right;
            }), nameWidth: row.querySelector('.name').getBoundingClientRect().width};
          }`);

          expect(bounds.fits, `${name} ${id} actions overflow`).toBe(true);
          expect(bounds.nameWidth, `${name} ${id} name width`).toBeGreaterThanOrEqual(minNameWidth);
          await capture(`${name}-focused-${id}`);
        }

        await page.call(`() => document.querySelector('[aria-label="Add Agent"]').closest('.rail-row').focus()`);
      }

      expect(await page.call(`() => {
        const add = document.activeElement.querySelector('[aria-label="Add Agent"]');
        return getComputedStyle(add.querySelector('.rail-add-label')).display !== 'none'
          && add.getBoundingClientRect().height === 24
          && document.querySelectorAll('[aria-label="Choose Model and Effort"], .rail-agent-picker, [aria-label="Model"]').length === 0;
      }`)).toBe(true);
      await capture(`${name}-closed`);
      await failAdd();
      await capture(`${name}-failed`);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      for (const id of ["D1", "D2", "D5", "D6"] as const) expect(checks[id].status, `${name} failed ${id}: ${JSON.stringify(checks[id])}`).toBe("pass");
      expect(await page.call(`() => {const e=[...document.querySelectorAll('[role="alert"]')].find(e=>e.textContent.includes('Cannot start Agent'));const b=e.getBoundingClientRect();return b.top>=0 && b.bottom<=innerHeight && e.scrollWidth<=e.clientWidth;}`)).toBe(true);
    }, 90_000);
  }
}

it("u378_the_add_keeps_design_checks", async () => {
  for (const seed of ["first-run", "agents-10", "tree-40"]) {
    for (const scheme of ["light", "dark"] as const) {
      let baseline: Checks | null = null;
      let failedBaseline: Checks | null = null;

      if (process.env.ROUNDUP_RAIL_BASELINE) {
        await load(seed, scheme, true);
        baseline = await page.call<Checks>(`() => window.__checks()`);
        await failAdd();
        failedBaseline = await page.call<Checks>(`() => window.__checks()`);
      }

      await load(seed, scheme);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      for (const id of ["D1", "D2", "D5", "D6"] as const) expect(checks[id].status, `${seed} ${scheme} ${id}`).toBe("pass");

      if (baseline) for (const id of CHECK_IDS) {
        if (baseline[id].status === "pass") expect(checks[id].status, `${seed} ${id}`).toBe("pass");
      }

      if (failedBaseline) {
        await failAdd();
        const failed = await page.call<Checks>(`() => window.__checks()`);

        for (const id of CHECK_IDS) {
          if (failedBaseline[id].status === "pass") expect(failed[id].status, `${seed} failed ${id}`).toBe("pass");
        }
      }
    }
  }
}, 90_000);

it("u172_the_add_keeps_the_default_rail_inset_and_focus_ring", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await load("tree-40", scheme);
    expect(await page.call(`() => {
      const rail = document.querySelector('.rail');
      const list = rail.querySelector('.rail-scroll:not(.rail-actions)');
      const row = document.activeElement;
      const style = getComputedStyle(list);
      const inset = parseFloat(getComputedStyle(rail).getPropertyValue('--space-4'));
      const box = row.getBoundingClientRect();
      const bounds = list.getBoundingClientRect();
      const focus = getComputedStyle(row);
      const ring = parseFloat(focus.outlineWidth) + parseFloat(focus.outlineOffset);
      return style.paddingInlineStart === '0px' && style.paddingInlineEnd === '0px'
        && focus.paddingInlineStart === inset + 'px' && focus.paddingInlineEnd === inset + 'px'
        && list.scrollHeight > list.clientHeight && box.left - ring >= bounds.left
        && box.right + ring <= bounds.right;
    }`)).toBe(true);
  }
}, 60_000);
