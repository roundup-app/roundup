import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const capture = async (id: string, step: string) => {
  const root = captureDir(id);

  if (!root) return;
  const dir = join(root, process.env.U5742_BASELINE ? "base" : "head");
  await mkdir(dir, { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
};

it.each(["agents-10", "tree-40"])("u5742a_rendered_rail_choices_and_controls_%s", async seed => {
  const baseline = !!process.env.U5742_BASELINE;
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await read("localStorage.clear(); sessionStorage.clear()");
  await browser("open", url(`/harness.html?seed=${seed}&renderer=dom&menu=1`, baseline));
  await wait("!!window.__fake && !!document.querySelector('.rail-row[data-id]')");
  const root = captureDir("U5742a");

  if (root) {
    const dir = join(root, baseline ? "base" : "head");
    await mkdir(dir, { recursive: true });
    await browser("record", "restart", join(dir, `${seed}.webm`));
  }

  try {
    await capture("U5742a", `${seed}-rest`);
    const target = await read<string>("document.querySelector('.rail-row[data-kind=\"needs-you\"]')?.dataset.id");
    await browser("click", `.rail-row[data-id="${target}"] .name`);
    await wait("!!document.querySelector('.pane-screen .xterm-helper-textarea')");

    if (!baseline) {
      await wait("!!document.activeElement?.closest('.pane-screen')");
      await browser("keyboard", "type", "marker");
      await wait("window.__fake.app.calls.filter(c => c.method === 'terminal.write').map(c => atob(c.params.data)).join('') === 'marker'");
      expect(await read("window.__fake.app.calls.filter(c => c.method === 'terminal.write').every(c => c.params.id === 't-' + document.querySelector('.rail-row[data-selected=true]').dataset.id)")).toBe(true);
    }

    await capture("U5742a", `${seed}-chosen`);
    await read(`document.querySelector('.rail-row[data-id="${target}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))`);
    await wait("!!document.activeElement?.closest('.rail')");
    await capture("U5742b", `${seed}-multiple`);
    await browser("press", "ArrowDown");
    await wait("!!document.activeElement?.matches('.rail-row')");
    await browser("press", "Enter");
    await wait("!!document.activeElement?.closest('.pane-screen')");
    await capture("U5742c", `${seed}-enter`);
    const fold = '.rail-row button.rail-chevron';

    if (await read(`!!document.querySelector('${fold}')`)) {
      await browser("click", fold);
      await wait("!!document.activeElement?.closest('.rail')");
      await capture("U5742b", `${seed}-control`);
      await browser("click", fold);
      await wait(`!!document.querySelector('.rail-row[data-id="${target}"]')`);
    }

    await read(`(async () => {
      const app = window.__fake.app;
      const todo = await app.rpc('todo.create', { title: 'Focus check', body: null, blockers: null });
      window.focusCheckTodo = todo.id;
      app.handlers['link.read'] = () => ({ kind: 'todo', id: String(todo.id), todo });
      app.nativeOpen({ kind: 'link', url: 'roundup://todo/' + todo.id + '?project=project-0000000000000000' });
    })()`);
    await wait("!!document.querySelector('.drawer[data-open=true]')");
    await capture("U5742a", `${seed}-drawer`);
    await browser("click", `.rail-row[data-id="${target}"] .name`);

    if (!baseline) {
      await wait("!document.querySelector('.drawer[data-open=true]') && !!document.activeElement?.closest('.pane-screen')");
    } else {
      await browser("press", "Escape");
      await wait("!document.querySelector('.drawer[data-open=true]')");
    }

    await capture("U5742a", `${seed}-drawer-choice`);

    if (!baseline) {
      await read(`window.__fake.app.nativeOpen({ kind: 'link', url: 'roundup://todo/' + window.focusCheckTodo + '?project=project-0000000000000000' })`);
      await wait("!!document.querySelector('.drawer[data-open=true]')");
      const destination = await read<string>("[...document.querySelectorAll('.rail-row[data-id]')].find(row => row.dataset.selected !== 'true' && row.dataset.id.startsWith('agent-'))?.dataset.id");
      await browser("focus", `.rail-row[data-id="${destination}"]`);
      await read(`(() => {
        const drawer = document.querySelector('.drawer');
        const observer = new MutationObserver(() => {
          if (drawer.dataset.open !== 'false') return;
          observer.disconnect();
          requestAnimationFrame(() => {
            window.drawerKeyFrame = { open: drawer.dataset.open, motion: drawer.dataset.motion, animations: drawer.getAnimations().length, mounted: drawer.dataset.mounted };
          });
        });
        observer.observe(drawer, { attributes: true, attributeFilter: ['data-open'] });
      })()`);
      await browser("press", "Enter");
      await wait("!!window.drawerKeyFrame && !!document.activeElement?.closest('.pane-screen')");
      await capture("U5742c", `${seed}-drawer-enter`);
      const dir = captureDir("U5742c");

      if (dir) await writeFile(join(dir, "head", `${seed}-drawer-enter-frames.json`), JSON.stringify(await read("window.drawerKeyFrame"), null, 2));
    }

    // Hold the actual snapshot boundary, then make a newer Ask focus choice before releasing it.
    await read(`(() => { const app = window.__fake.app, snapshot = app.handlers['terminal.snapshot']; app.handlers['terminal.snapshot'] = params => new Promise(resolve => { window.releaseSnapshot = () => resolve(snapshot(params)); }); })()`);
    const next = await read<string>("(async () => { const nodes = await window.__fake.app.rpc('rail.tree', {}); return nodes.find(node => node.kind === 'agent' && !window.__terminals.has(node.terminal_id) && document.querySelector('.rail-row[data-id=\"' + node.id + '\"]'))?.id; })()");
    await browser("click", `.rail-row[data-id="${next}"] .name`);
    await browser("find", "role", "button", "click", "--name", "⌘/ Focus Ask bar", "--exact");
    await wait("document.activeElement?.matches('.ask-input')");
    await browser("keyboard", "type", "newer draft");
    await read("window.newerFocus = document.activeElement; window.releaseSnapshot?.()");
    await wait("!!document.querySelector('.pane-screen .xterm-helper-textarea')");
    expect(await read("document.activeElement === window.newerFocus && (window.newerFocus.value ?? window.newerFocus.textContent) === 'newer draft'")).toBe(true);
    await capture("U5742d", `${seed}-ready`);
    await browser("press", "Escape");
    await wait("document.activeElement !== window.newerFocus");

    if (seed === "tree-40") {
      await read("window.__fake.app.handlers['terminal.open'] = () => { throw new Error('Terminal could not open: retry New Terminal'); }");
      await browser("press", "Meta+t");
      await wait("document.body.textContent.includes('Terminal could not open: retry New Terminal')");
      await capture("U5742a", `${seed}-failure`);
    }
  } finally {
    if (root) await browser("record", "stop");
  }
}, 90_000);
