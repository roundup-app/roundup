import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage, FULLSCREEN } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { workstream } from "../testing/nodes";
import { captureDir } from "../testing/captures";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U469 requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const geometry = `() => {
  return {focused:document.activeElement?.outerHTML, shown:[...document.querySelectorAll('.bubble:not([hidden])')].map(e => e.dataset.bubble),
    calls:window.__fake.app.calls.filter(c => ['terminal.open','terminal.close'].includes(c.method)), checks:window.__checks()};
}`;

const capture = async (name: string): Promise<void> => {
  const observed = await page.call<{ checks: Record<string, { status: string }> }>(geometry);

  for (const [id, check] of Object.entries(observed.checks)) expect(check.status, `${name} ${id}`).toBe("pass");
  const dir = captureDir("U469");

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(observed.checks));
  writeFileSync(join(dir, `${name}.geometry.json`), JSON.stringify(observed));
  const baseline = process.env["ROUNDUP_U469_BASELINE"];

  if (baseline && name === "bar-1280-light") writeFileSync(join(dir, "main-observer.json"), JSON.stringify(JSON.parse(readFileSync(baseline, "utf8"))));
};

it("u469_the_bar_is_the_last_line_and_no_dock_remains", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);

    for (const width of [FULLSCREEN.width]) {
      await page.load('/harness.html?seed=bubbles', width, FULLSCREEN.height);
      await page.until(`() => Boolean(window.__fake)`);
      await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
      await page.until(`() => document.querySelector('.terminal-tabs') && document.querySelector('.resource-agent .resource-num')`);

      const read = await page.call<{last:boolean; dock:boolean}>(`() => {
        const bar = document.querySelector('.resource-strip');
        return {last:bar.parentElement.lastElementChild===bar, dock:!!document.querySelector('.bubble-dock')};
      }`);

      expect(read).toEqual({last:true, dock:false});
      await capture(`bar-${width}-${scheme}`);
    }
  }
}, 120_000);

it("u469_dense_tabs_with_stale_resources_and_a_failure_pass_the_checks", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);

    for (const width of [FULLSCREEN.width]) {
      await page.load('/harness.html?seed=resources', width, FULLSCREEN.height);
      await page.until(`() => Boolean(window.__fake)`);
      await page.call(`() => { document.querySelector('[aria-label="Hide work items"]')?.click(); document.querySelector('[data-id="worktree-agent"]').click(); }`);
      await page.until(`() => document.querySelector('.resource-agent .resource-num')`);
      await page.call(`(workstream) => {
        const app = window.__fake.app;
        const tree = app.handlers['rail.tree']();
        app.handlers['rail.tree'] = () => [workstream, ...tree.map(node => ({...node,parent:'workstream-1'}))];
        window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
        app.handlers['terminal.list'] = () => Array.from({length:16}, (_, i) => ({id:String(200+i),owner:i<8?'workstream-1':'worktree-agent',title:'A'.repeat(60),program:'zsh',running:true,exit_code:null,cwd:'/p'}));
        window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'terminal.changed'});
        app.handlers['project.resources'] = () => { throw new Error('not updating'); };
      }`, workstream('workstream-1'));
      await page.until(`() => document.querySelectorAll('.terminal-tab').length === 16 && document.querySelector('.resource-stale')`);
      await page.call(`() => { window.__fake.app.handlers['terminal.close'] = () => { throw new Error('cannot close this Terminal'); }; document.querySelector('.terminal-tab-pair button:last-child').click(); }`);
      await page.until(`() => document.querySelector('.bubble-failure [role="alert"]')`);

      await capture(`dense-${width}-${scheme}`);
    }
  }
}, 120_000);

it("u524_the_bar_message_passes_the_moved_checks", async () => {
  type Read = { checks: Record<string, { status: string }> };

  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [FULLSCREEN.width]) {
      await page.scheme(scheme, 'more');
      await page.load('/harness.html?seed=empty-project', width, FULLSCREEN.height);
      await page.until(`() => document.querySelector('.terminal-new') && document.querySelector('.resource-strip')`);
      await page.call(`() => document.querySelector('.terminal-new').click()`);
      await page.until(`() => document.querySelector('.resource-strip .terminal-note')?.textContent === 'Select a Workstream first'`);
      const shown = await page.call<Read>(geometry);

      for (const id of ['D2', 'D5', 'D6']) expect(shown.checks[id]?.status, `${width} ${scheme} ${id}`).toBe('pass');
    }
  }
}, 120_000);

it("u469_every_tab_close_and_plus_is_named_and_keyboard_reachable", async () => {
  await page.load('/harness.html?seed=bubbles', 1280, 800);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
  await page.until(`() => document.querySelectorAll('.terminal-tab').length === 3`);
  const names = await page.call<string[]>(`() => [...document.querySelectorAll('.terminal-tabs button')].map(e=>e.getAttribute('aria-label'))`);

  expect(names.every(Boolean)).toBe(true);
  await page.call(`() => document.querySelector('.terminal-tab').focus()`);

  for (const name of names) {
    expect(await page.call(`() => document.activeElement.getAttribute('aria-label')`)).toBe(name);
    await page.press('Tab','Tab');
  }

  expect(await page.call(`() => document.querySelector('.terminal-tabs button button')`)).toBeNull();
}, 60_000);

it("u469_the_bar_uses_tokens_and_all_controls_pass_the_moved_checks", async () => {
  for (const scheme of ['light','dark'] as const) {
    await page.scheme(scheme, 'more');
    await page.load('/harness.html?seed=bubbles', 1440, 800);
    await page.until(`() => Boolean(window.__fake)`);
    await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
    await page.until(`() => document.querySelector('.terminal-tab')`);
    const checks = await page.call<Record<string,{status:string}>>(`() => window.__checks()`);

    for (const id of ['D2','D5','D6','D10']) expect(checks[id]?.status, id).toBe('pass');
    await capture(`checks-more-${scheme}`);
  }
}, 60_000);

it("u469_the_observer_records_open_switch_minimise_pull_close_failure_and_selection", async () => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.scheme(scheme);

    for (const width of [FULLSCREEN.width]) {
      await page.load('/harness.html?seed=bubbles', width, FULLSCREEN.height);
      await page.until(`() => Boolean(window.__fake)`);
      await page.call(`() => { document.querySelector('[aria-label="Hide work items"]')?.click(); document.querySelector('[data-id="runner"]').click(); }`);
      await page.until(`() => document.querySelectorAll('.terminal-tab').length===3`);

      const record = async (state: string): Promise<void> => {
        expect(await page.call(`() => document.querySelectorAll('.bubble:not([hidden])').length`)).toBeLessThanOrEqual(1);
        await capture(`journey-${width}-${scheme}-${state}`);
      };

      await record('selected');
      await page.call(`() => document.querySelector('.terminal-new').click()`);
      await page.until(`() => document.querySelectorAll('.terminal-tab').length===4`);
      await record('opened');
      await page.call(`() => document.querySelector('.terminal-tab[data-bubble="101"]').click()`);
      await record('switched');
      await page.call(`() => document.querySelector('.terminal-tab[data-bubble="101"]').click()`);
      await record('minimised');
      await page.call(`() => document.querySelector('.terminal-tab[data-bubble="102"]').click()`);
      await record('restored');
      await page.call(`() => {
        window.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',button:2,buttons:2,clientX:500,clientY:300}));
        window.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',button:-1,buttons:2,clientX:520,clientY:300}));
        window.dispatchEvent(new PointerEvent('pointerup',{pointerType:'mouse',button:2,buttons:0,clientX:520,clientY:300}));
      }`);
      await record('pulled');
      await page.call(`() => document.querySelector('.terminal-tab-pair[data-bubble="101"] button:last-child').click()`);
      await page.until(`() => document.querySelectorAll('.terminal-tab').length===3`);
      await record('closed');
      await page.call(`() => {
        window.__fake.app.handlers['terminal.close']=()=>{throw new Error('cannot close this Terminal');};
        document.querySelector('.terminal-tab-pair button:last-child').click();
      }`);
      await page.until(`() => document.querySelector('.bubble-failure [role="alert"]')`);
      await record('rejected');
      await page.call(`() => document.querySelector('[data-id="dense"]').click()`);
      await page.until(`() => document.querySelectorAll('.terminal-tab').length===10`);
      await record('selection');
      await page.call(`() => document.querySelector('.todo-project-root').click()`);
      await page.until(`() => document.querySelector('.todo-project-root').getAttribute('aria-pressed') === 'true' && document.querySelector('.terminal-new')`);
      await page.call(`() => document.querySelector('.terminal-new').click()`);
      await page.until(`() => document.querySelectorAll('.terminal-tab').length===1 && document.querySelector('.todo-project-root').getAttribute('aria-pressed') === 'true'`);
      await record('missing-selection');
    }
  }
}, 120_000);

it.each([["Enter", "Enter"], [" ", "Space"]])("u469_visibility_buttons_activate_from_the_keyboard_%s", async (key, code) => {
  await page.load('/harness.html?seed=bubbles', 1280, 800);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
  await page.until(`() => document.querySelectorAll('.terminal-tab').length===3`);
  await page.call(`() => document.querySelector('.terminal-tab[data-bubble="101"]').focus()`);
  await page.press(key, code);
  await page.until(`() => document.querySelector('.terminal-tab[data-bubble="101"]').getAttribute('aria-pressed')==='true'`);
  expect(await page.call(`() => [...document.querySelectorAll('.bubble:not([hidden])')].map(e=>e.dataset.bubble)`)).toEqual(['101']);
}, 60_000);
