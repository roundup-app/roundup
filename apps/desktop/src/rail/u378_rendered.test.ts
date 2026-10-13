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

const load = async (seed: string, width: number, scheme: "light" | "dark", base = false) => {
  await page.scheme(scheme);
  const path = `/harness.html?seed=${seed}`;
  await page.load(base ? `${process.env.ROUNDUP_RAIL_BASELINE}${path}` : path, width, 800);
  await page.until(`() => window.__fake && typeof window.__checks === 'function'`);

  if (seed === "first-run") {
    await page.until(`() => [...document.querySelectorAll('button')].some(b=>b.textContent.includes('choose folder'))`);
    await page.call(`() => { window.__fake.app.chooser.path='/Users/you/harness'; [...document.querySelectorAll('button')].find(b=>b.textContent.includes('choose folder')).click(); }`);
  }

  if (seed !== "tree-40") {
    await page.until(`() => document.querySelector('[aria-label="Add Workstream"]') && !document.querySelector('[aria-label="Add Workstream"]').hasAttribute('aria-disabled')`);
    await page.call(`() => document.querySelector('[aria-label="Add Workstream"]').click()`);
  }

  await page.until(`() => document.querySelector('[aria-label="Add Agent"]')`);
  await page.call(`() => document.querySelector('[aria-label="Add Agent"]').closest('[role="treeitem"]').focus()`);
};

for (const seed of ["first-run", "agents-10", "tree-40"]) {
  for (const width of [1280, 1440]) {
    for (const scheme of ["light", "dark"] as const) {
      it(`u378_the_split_add_renders_without_overflow ${seed} ${width} ${scheme}`, async () => {
        const name = `${seed}-${width}-${scheme}`;
        await load(seed, width, scheme);

        if (seed === "tree-40") {
          await page.call(`async () => {
            const tree = window.__fake.app.handlers['rail.tree'];
            const nodes = await tree();
            const parent = nodes.find(node => node.id === 'auth');
            window.__fake.app.handlers['rail.tree'] = () => [...nodes, {...parent, id:'schema', name:'schema-migration', parent:'auth'}];
            window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
          }`);
          await page.until(`() => document.querySelector('[data-id="schema"]')`);

          for (const [id, minNameWidth] of [["backend", 88], ["auth", 60], ["schema", 32]] as const) {
            await page.call(`id => document.querySelector('[data-id="'+id+'"]').focus()`, id);

            const bounds = await page.call<{ fits: boolean; nameWidth: number; iconsSquare: boolean }>(`() => {
              const row = document.activeElement;
              const box = row.getBoundingClientRect();
              const list = document.querySelector('.rail-scroll:not(.rail-actions)');
              const buttons = [...row.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width > 0);
              return {fits: list.scrollWidth <= list.clientWidth && buttons.every(button => {
                const b = button.getBoundingClientRect();
                return b.left >= box.left && b.right <= box.right;
              }), nameWidth: row.querySelector('.name').getBoundingClientRect().width,
                iconsSquare: buttons.filter(button => button.closest('.row-icons') && !button.closest('.rail-split-add')).every(button => {
                  const b = button.getBoundingClientRect();
                  return b.width === 24 && b.height >= 24;
                })};
            }`);

            expect(bounds.iconsSquare, `${name} ${id} other icons keep U426 dimensions`).toBe(true);
            expect(bounds.fits, `${name} ${id} actions overflow`).toBe(true);
            expect(bounds.nameWidth, `${name} ${id} name width`).toBeGreaterThanOrEqual(minNameWidth);
            await capture(`${name}-focused-${id}`);
          }

          await page.call(`() => document.querySelector('[aria-label="Add Agent"]').closest('[role="treeitem"]').focus()`);
        }

        await capture(`${name}-closed`);
        await page.call(`() => {
          window.__fake.app.handlers['models.list'] = () => ({models: Array.from({length:20},(_,i)=>({id:'m'+i,label:('Model '+i+' ').padEnd(40,'x')})), efforts:[{id:'high',label:'High'}]});
          window.__fake.app.handlers['project.get'] = () => ({worktrees:{on:false,check:null},models:{roles:[{role:'subagent',model:'m0',effort:'high'}],allowed:[]}});
          document.querySelector('[aria-label="Choose Model and Effort"]').click();
        }`);
        await page.until(`() => document.querySelector('[aria-label="Model"]') && !document.querySelector('.rail-agent-picker button').hasAttribute('aria-disabled')`);
        await capture(`${name}-open`);
        await page.call(`() => { for (const [label,value] of [['Model','m19'],['Effort','high']]) {const select=document.querySelector('[aria-label="'+label+'"]');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));} }`);
        await capture(`${name}-changed`);
        await page.call(`() => { window.__fake.failNext(-32602,'Cannot start Agent: retry with another Model'); document.querySelector('.rail-agent-picker button').click(); }`);
        await page.until(`() => [...document.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('Cannot start Agent'))`);
        await capture(`${name}-failed`);
        const checks = await page.call<Checks>(`() => window.__checks()`);

        for (const id of ["D1", "D2", "D5", "D6"] as const) expect(checks[id].status, `${name} failed ${id}: ${JSON.stringify(checks[id])}`).toBe("pass");
        expect(await page.call(`() => [...document.querySelectorAll('.rail-agent-picker select,.rail-agent-picker button,.rail-agent-picker label')].every(e=>{const b=e.getBoundingClientRect();const rail=document.querySelector('.rail').getBoundingClientRect();return b.left>=rail.left && b.right<=rail.right && b.width>0;})`)).toBe(true);
        expect(await page.call(`() => {const e=[...document.querySelectorAll('[role="alert"]')].find(e=>e.textContent.includes('Cannot start Agent'));const b=e.getBoundingClientRect();return b.top>=0 && b.bottom<=innerHeight && e.scrollWidth<=e.clientWidth;}`)).toBe(true);
      }, 90_000);
    }
  }
}

it("u378_the_split_add_preserves_design_checks", async () => {
  for (const seed of ["first-run", "agents-10", "tree-40"]) {
    for (const width of [1280, 1440]) {
      for (const scheme of ["light", "dark"] as const) {
        let baseline: Checks | null = null;
        let failedBaseline: Checks | null = null;

        if (process.env.ROUNDUP_RAIL_BASELINE) {
          await load(seed, width, scheme, true);
          baseline = await page.call<Checks>(`() => window.__checks()`);
          await capture(`${seed}-${width}-${scheme}-base`);
          await page.call(`() => { window.__fake.failNext(-32602,'Cannot start Agent: retry with another Model'); document.querySelector('[aria-label="Add Agent"]').click(); }`);
          await page.until(`() => [...document.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('Cannot start Agent'))`);
          failedBaseline = await page.call<Checks>(`() => window.__checks()`);
          await capture(`${seed}-${width}-${scheme}-base-failed`);
        }

        await load(seed, width, scheme);
        const checks = await page.call<Checks>(`() => window.__checks()`);

        for (const id of ["D1", "D2", "D5", "D6"] as const) expect(checks[id].status, `${seed} ${width} ${scheme} ${id}`).toBe("pass");

        if (baseline) for (const id of CHECK_IDS) {
          if (baseline[id].status === "pass") expect(checks[id].status, `${seed} ${id}`).toBe("pass");
        }

        if (failedBaseline) {
          await page.call(`() => { window.__fake.failNext(-32602,'Cannot start Agent: retry with another Model'); document.querySelector('[aria-label="Add Agent"]').click(); }`);
          await page.until(`() => [...document.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('Cannot start Agent'))`);
          const failed = await page.call<Checks>(`() => window.__checks()`);

          for (const id of CHECK_IDS) {
            if (failedBaseline[id].status === "pass") expect(failed[id].status, `${seed} failed ${id}`).toBe("pass");
          }
        }
      }
    }
  }
}, 180_000);

it("u378_the_split_add_runs_from_the_keyboard", async () => {
  await load("tree-40", 1280, "light");
  await page.call(`() => {
    window.__fake.app.handlers['models.list']=()=>({models:[{id:'sonnet',label:'Sonnet'}],efforts:[{id:'high',label:'High'}]});
    window.__fake.app.handlers['project.get']=()=>({worktrees:{on:false,check:null},models:{roles:[],allowed:[]}});
    document.querySelector('[aria-label="Add Agent"]').focus();
  }`);
  await page.press("Tab", "Tab");
  expect(await page.call(`() => document.activeElement.getAttribute('aria-label')`)).toBe("Choose Model and Effort");
  await page.press("Enter", "Enter");
  await page.until(`() => Boolean(document.querySelector('[aria-label="Model"]'))`);
  await page.call(`() => document.querySelector('[aria-label="Model"]').focus()`);
  await page.press("Tab", "Tab");
  expect(await page.call(`() => document.activeElement.getAttribute('aria-label')`)).toBe("Effort");
  await page.press("Tab", "Tab");
  expect(await page.call(`() => document.activeElement.textContent`)).toBe("Add agent");
  await page.press("Escape", "Escape");
  expect(await page.call(`() => document.activeElement.getAttribute('aria-label')`)).toBe("Choose Model and Effort");
  expect(await page.call(`() => window.__fake.app.calls.filter(c=>c.method==='agent.spawn').length`)).toBe(0);
  await page.press(" ", "Space");
  await page.until(`() => Boolean(document.querySelector('[aria-label="Model"]'))`);
}, 60_000);

it("u172_the_split_add_keeps_the_default_rail_inset_and_focus_ring", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await load("tree-40", 1280, scheme);
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
      return style.paddingInlineStart === inset + 'px' && style.scrollbarWidth !== 'none'
        && list.scrollHeight > list.clientHeight && box.left - ring >= bounds.left
        && box.right + ring <= bounds.right;
    }`)).toBe(true);
  }
}, 60_000);
