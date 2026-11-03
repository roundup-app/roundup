import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { appServer } from "../testing/appServer";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";

const load = async (seed: string, width: number, scheme: "light" | "dark") => {
  await browser("set", "media", scheme);
  const path = `/harness.html?seed=${seed}`;
  await browser("set", "viewport", String(width), "950");
  await browser("open", url(`${path}&rest=1&view=workstreams&tabs=1`));
  await wait(`document.querySelectorAll('.rail-row').length >= 9`);
};

// U4707: hovering the Status Glyph shows the fold chevron, and the hover icons overlay the name's middle, so select by the name's first pixels.
const clickName = async (selector: string) => {
  const point = await read<{x:number;y:number}>(`(() => { const box = document.querySelector('${selector} .name').getBoundingClientRect(); return {x:box.x + 4,y:box.y + box.height / 2}; })()`);
  await browser("mouse", "move", String(Math.round(point.x)), String(Math.round(point.y)));
  await browser("mouse", "down");
  await browser("mouse", "up");
};

const rightClick = async (selector: string) => {
  const point = await read<{x:number;y:number}>(`(() => { const box = document.querySelector('${selector}').getBoundingClientRect(); return {x:box.x + box.width / 2,y:box.y + box.height / 2}; })()`);
  await browser("mouse", "move", String(Math.round(point.x)), String(Math.round(point.y)));
  await browser("mouse", "down", "right");
  await browser("mouse", "up", "right");
};

// Row controls keep Open; former tools retain their native menu paths.
it.skipIf(!!process.env.ROUNDUP_CAPTURES && !captureDir("U350"))("u426_menu_actions_run_without_selecting", async () => {
  await load("tree-40", 1280, "light");
  await browser("focus", '.rail-row[data-id="backend"]');
  const selected = await read("document.querySelector('.rail-row[data-selected=true]')?.dataset.id ?? null");
  await wait(`document.activeElement?.matches('.rail-row[data-id="backend"]')`);
  await browser("press", "Shift+F10");
  await wait("window.__fake.app.menuLabels().includes('Open in editor')");
  await browser("eval", "window.__fake.app.pickMenu('Open in editor')");
  await wait("window.__fake.app.editorOpened.length === 1");
  expect(await read("document.querySelector('.rail-row[data-selected=true]')?.dataset.id ?? null")).toBe(selected);
  await rightClick('.rail-row[data-id="backend"]');
  await wait("window.__fake.app.menuLabels().includes('Open directory')");
  await browser("eval", "window.__fake.app.pickMenu('Open directory')");
  await wait("window.__fake.app.openedTargets.length === 1");
  expect(await read("document.querySelector('.rail-row[data-selected=true]')?.dataset.id ?? null")).toBe(selected);
}, 60_000);

it.skipIf(!!process.env.ROUNDUP_CAPTURES && !captureDir("U350")).each(["tree-40", "agents-10", "door-stopped", "conflict"])("u350_rendered_workstream_actions_have_no_clear_%s", async seed => {
  const directory = captureDir("U350");

  const capture = async (step: string) => {
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, `${step}.png`));
    writeFileSync(join(directory, `${step}.checks.json`), JSON.stringify(await read(`window.__checks()`)) + "\n");
  };

  if (directory) {
    mkdirSync(directory, { recursive: true });
    await browser("record", "start", join(directory, `${seed}-intervene.webm`));
  }

  try {
    await browser("set", "media", "dark");
    await browser("set", "viewport", "1512", "950");
    await browser("open", url(`/harness.html?seed=${seed}&rest=1&view=workstreams&tabs=1`));
    await wait(`document.querySelector('.rail-row')`);

    // Exercise Workstream actions without the unrelated seeded attention redirect.
    if (seed === "tree-40") await read("window.__fake.setStatus('migrate', 'idle', 'idle')");
    const id = await read<string>(`document.querySelector('.rail-row:has(.rail-chevron)')?.dataset.id ?? document.querySelector('.rail-row').dataset.id`);
    const selector = `.rail-row[data-id="${id}"]`;
    await clickName(selector);
    await wait(`document.querySelector('${selector}').dataset.selected === 'true'`);
    await browser("focus", selector);
    await wait(`document.activeElement.matches('${selector}')`);
    await browser("press", "Shift+F10");
    await wait(`window.__fake.app.shownMenus.length > 0`);
    expect(await read(`window.__fake.app.menuLabels().some(label => /clear/i.test(label))`)).toBe(false);
    await read(`window.__fake.app.closeMenu()`);

    if (seed === "tree-40" || seed === "door-stopped") {
      await rightClick(selector);
      await wait(`window.__fake.app.menuLabels().includes('First prompt…')`);
      await read(`window.__fake.app.pickMenu('First prompt…')`);
      await wait(`document.querySelector('.opening-prompt-dialog')`);
      await capture(`${seed}-opening-prompt`);
      await browser("press", "Escape");
      await wait(`!document.querySelector('.opening-prompt-dialog')`);
    }

    if (seed === "tree-40") {
      await read(`window.__fake.app.openFailure = new Error('Folder unavailable; try again')`);
      await rightClick(selector);
      await read(`window.__fake.app.pickMenu('Open directory')`);
      await wait(`document.body.textContent.includes('Folder unavailable; try again')`);
      await capture("tree-40-failure");
    }

    const agent = await read<string | null>(`document.querySelector('.rail-row:not(:has(.rail-chevron))')?.dataset.id ?? null`);

    if (agent) {
      await browser("click", `.rail-row[data-id="${agent}"] .row-state`);
      await wait(`document.querySelector('.rail-row[data-id="${agent}"]').dataset.selected === 'true'`);
      await wait(`window.__fake.app.calls.some(call => call.method === 'terminal.snapshot')`);
    }

    await capture(`${seed}-terminal`);
    expect(await read(`window.__fake.app.calls.filter(call => call.method === 'workstream.clear')`)).toEqual([]);
  } finally {
    if (directory) await browser("record", "stop");
  }
}, 60_000);

// U427/U428 policy: readings and paired pixels are evidence for the critic, not layout tests.
it.skipIf(!captureDir("U427") && !captureDir("U428")).each(["agents-10", "tree-40"])("u427_u428_menu_only_policy_capture_%s", async seed => {
  const root = resolve("../..");
  const checkout = mkdtempSync(join(tmpdir(), "rail-actions-base-"));
  const revision = execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim();
  execFileSync("tar", ["-x", "-C", checkout], { input: execFileSync("git", ["-C", root, "archive", revision, "apps/desktop", "contracts/generated", "tsconfig.json"], { maxBuffer: 64 * 1024 * 1024 }) });
  symlinkSync(join(root, "node_modules"), join(checkout, "node_modules"));
  symlinkSync(join(root, "apps/desktop/node_modules"), join(checkout, "apps/desktop/node_modules"));
  const selection = process.env.ROUNDUP_CAPTURES;
  delete process.env.ROUNDUP_CAPTURES;
  let baseline;

  try {
    baseline = await appServer({ root: join(checkout, "apps/desktop") });
  } finally {
    process.env.ROUNDUP_CAPTURES = selection;
  }

  try {
    for (const base of [true, false]) {
      await browser("set", "media", "dark");
      await browser("set", "viewport", "1512", "950");
      await browser("open", base ? new URL(`/harness.html?seed=${seed}&view=workstreams&items=1&tabs=1`, baseline.resolvedUrls.local[0]!).href : url(`/harness.html?seed=${seed}`));
      await wait("!!window.__fake && !!document.querySelector('.rail-row')");

      const ids = await read<{ workstream: string; agent: string }>(`(async () => {
        const app = window.__fake.app;
        const nodes = await app.rpc('rail.tree', null);
        const workstream = nodes.find(n => n.kind === 'workstream' && n.terminal_id) ?? nodes.find(n => n.kind === 'workstream') ?? await app.rpc('rail.createWorkstream', {name:'Product work',parent:null});
        const agent = nodes.find(n => n.kind === 'agent');
        for (const node of [workstream, agent]) await app.rpc('rail.rename', {id:node.id,name:(node.kind === 'agent' ? 'Agent implementation review ' : 'Workstream implementation review ').padEnd(60,'abcdefghij')});
        document.querySelector('.window').style.setProperty('--rail-width','288px');
        return {workstream:workstream.id,agent:agent.id};
      })()`);

      await wait(`document.querySelector('.rail-row[data-id="${ids.workstream}"] .name')?.textContent.length === 60 && document.querySelector('.rail-row[data-id="${ids.agent}"] .name')?.textContent.length === 60`);

      for (const [kind, id] of Object.entries(ids)) {
        const directory = captureDir(kind === "workstream" ? "U427" : "U428");

        if (!directory) continue;
        const dir = join(directory, base ? "base" : "head");
        mkdirSync(dir, { recursive: true });
        const selector = `.rail-row[data-id="${id}"]`;

        const snap = async (state: string) => {
          const name = `${seed}-${state}`;
          await browser("screenshot", join(dir, `${name}.png`));

          const audit = await read<{ checks: unknown }>(`(() => {
            const row = document.querySelector('${selector}');
            const name = row.querySelector('.name');
            const icons = row.querySelector('.row-icons');
            const box = el => {const b=el.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width,height:b.height};};
            return {revision:${JSON.stringify(base ? revision : "working-tree")},checks:window.__checks(), row:box(row), name:box(name), uncoveredWidth:Math.min(name.getBoundingClientRect().right, icons && Number(getComputedStyle(icons).opacity) > 0 ? icons.getBoundingClientRect().left : name.getBoundingClientRect().right) - name.getBoundingClientRect().left, icons:icons ? {box:box(icons),opacity:getComputedStyle(icons).opacity,buttons:[...icons.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'))}:null, selected:row.dataset.selected, focus:document.activeElement?.getAttribute('aria-label'), menus:window.__fake.app.menuLabels(), failure:document.querySelector('.rail-command-notice')?.textContent};
          })()`);

          writeFileSync(join(dir, `${name}.audit.json`), JSON.stringify(audit, null, 2) + "\n");
          writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(audit.checks, null, 2) + "\n");
        };

        await browser("eval", "document.activeElement?.blur()");
        await browser("mouse", "move", "1400", "900");
        await snap("rest");
        await browser("hover", `${selector} .name`);
        await snap("hover");
        await browser("mouse", "move", "1400", "900");
        await browser("focus", selector);
        await wait(`document.activeElement.matches('${selector}')`);
        await snap("focus");
        await clickName(selector);
        await wait(`document.querySelector('${selector}').dataset.selected === 'true'`);
        await snap("selected-hover");
        await browser("eval", "document.activeElement?.blur()");
        await browser("mouse", "move", "1400", "900");
        await snap("selected");
        await browser("focus", selector);
        await snap("selected-focus");
        await rightClick(selector);
        await wait("window.__fake.app.menuLabels().includes('Open in editor')");
        await snap("menu");
        await read("window.__fake.app.closeMenu()");

        if (seed === "tree-40") {
          await read("window.__fake.app.editorFailure = new Error('Editor unavailable; install VS Code or Cursor')");
          await rightClick(selector);
          await read("window.__fake.app.pickMenu('Open in editor')");
          await wait("document.body.textContent.includes('Editor unavailable; install VS Code or Cursor')");
          await snap("failure");
          await read("window.__fake.app.editorFailure = null");
        }
      }
    }
  } finally {
    await baseline.close();
    rmSync(checkout, { recursive: true, force: true });
  }
}, 180_000);
