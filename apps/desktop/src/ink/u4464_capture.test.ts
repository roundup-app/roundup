import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

// U4464's rendered policy observer: appearance is recorded for the independent critic.
it.skipIf(!captureDir("U4464"))("u4464_capture_empty_views_in_both_themes", async () => {
  const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";
  const root = process.env.U4464_ROOT ?? process.cwd();
  const server = await appServer({ root });
  const profile = mkdtempSync(join(tmpdir(), "u4464-"));
  const session = `u4464-${process.pid}`;
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })).stdout;

  const read = async (expression: string) => {
    const reply = JSON.parse(await browser("eval", expression));

    if (!reply.success) throw new Error(reply.error);

    return reply.data.result;
  };

  const wait = (expression: string) => browser("wait", "--fn", expression);
  const origin = server.resolvedUrls.local[0]!;
  const dir = join(captureDir("U4464")!, phase, ...(process.env.U4464_CONTRAST ? ["increased-contrast"] : []));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  mkdirSync(dir, { recursive: true });

  const snap = async (name: string) => {
    await browser("screenshot", join(dir, `${name}.png`));
    const observation = await read(`({ revision: ${JSON.stringify(revision)}, checks: window.__checks(), empty: [...document.querySelectorAll('.empty-state')].map(el => ({name: el.querySelector('h3')?.textContent, artHidden: el.querySelector('.empty-state-art')?.getAttribute('aria-hidden')})), failures: [...document.querySelectorAll('[role=alert]')].map(el => el.textContent) })`);
    const palette = await read(`(() => { const root = getComputedStyle(document.documentElement); const tokens = Object.fromEntries(['accent','ground','sunken','selected','selected-hover','button-accent-fill','button-accent-ink','button-key-ink','text-selection','text-selection-ink','doodle-line','doodle-patch','doodle-offset','doodle-blend'].map(name => [name, root.getPropertyValue('--'+name).trim()])); return {increasedContrast:matchMedia('(prefers-contrast: more)').matches,tokens,buttons:[...document.querySelectorAll('.empty-state button')].map(el => ({label:el.textContent,ink:getComputedStyle(el).color,fill:getComputedStyle(el).backgroundColor,key:el.querySelector('kbd') ? getComputedStyle(el.querySelector('kbd')).color : null})),selection:{fill:getComputedStyle(document.body,'::selection').backgroundColor,ink:getComputedStyle(document.body,'::selection').color},formRings:[...document.querySelectorAll('.app-select-trigger,.app-combobox-input,[data-scope="field"][data-part="input"]')].map(el => ({ink:getComputedStyle(el).outlineColor,ground:getComputedStyle(el).backgroundColor}))}; })()`);
    writeFileSync(join(dir, `${name}.palette.json`), JSON.stringify(palette, null, 2));
    writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(observation.checks, null, 2));
    writeFileSync(join(dir, `${name}.observation.json`), JSON.stringify(observation, null, 2));
  };

  const load = async (seed: string, view = "") => {
    await browser("open", new URL(`/harness.html?seed=${seed}&items=1${view ? `&view=${view}` : ""}`, origin).href);
    await wait(`!!window.__fake && !!document.querySelector('.rail-tree,.choose-project')`);
  };

  try {
    await browser("--profile", profile, "--executable-path", "/opt/google/chrome/chrome", "--args", `--no-sandbox${process.env.U4464_CONTRAST ? ",--force-high-contrast,--disable-blink-features=ForcedColors" : ""}`, "open", origin);
    await browser("set", "viewport", "1512", "950");

    for (const theme of ["light", "dark"]) {
      await browser("set", "media", "color-scheme", theme);
      await load("first-run");
      await snap(`${theme}-first-run`);
      await load("first-run-five");
      await wait(`document.querySelectorAll('.choose-project li').length === 5`);
      await snap(`${theme}-first-run-five`);
      await load("empty-project", "workstreams");
      await wait(`!!document.querySelector('.window[data-shelf="open"]')`);

      if (await read(`document.querySelector('[role="tab"][data-value="todos"]').getAttribute('aria-selected') !== 'true'`)) await browser("click", '[role="tab"][data-value="todos"]');

      await wait(`!!document.querySelector('.todos-tab .empty-state')`);
      await snap(`${theme}-rail-centre-todos`);
      await browser("click", '[role="tab"][data-value="pads"]');
      await wait(`!!document.querySelector('.pads-tab .empty-state')`);
      await snap(`${theme}-pads`);
      await browser("press", "Meta+k");
      await browser("press", "i");
      await wait(`!!document.querySelector('.inbox .empty-state')`);
      await snap(`${theme}-inbox`);

      for (const view of ["made", "reactions"]) {
        await load("empty-project", view);
        await wait(view === "made" ? `!!document.querySelector('.made .empty-state')` : `!!document.querySelector('.reactions .empty-state')`);
        await snap(`${theme}-${view}`);
      }

      await load("agents-10");
      await read(`(async () => { const nodes = await window.__fake.app.rpc('rail.tree',{}); window.__fake.app.handlers['rail.tree'] = () => nodes.map((node, index) => index === 0 ? {...node, terminal_id:null} : node); window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'}); })()`);
      await browser("click", '.rail-row[data-id="agent-1"]');
      await wait(`!!document.querySelector('.pane-body > .empty-state')`);
      await snap(`${theme}-earlier-output`);
      await load("agents-10");
      await read(`(async () => { const {seedApp} = await import('/src/testing/seeds.ts'); const stopped = await seedApp('door-stopped', Date.now()).app.rpc('rail.tree', {}); const nodes = await window.__fake.app.rpc('rail.tree',{}); window.__fake.app.handlers['rail.tree'] = () => [...nodes, ...stopped.map(node => ({...node, terminal_id:null}))]; window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'}); })()`);
      await wait(`!!document.querySelector('.rail-row[data-id="first-workstream"]')`);
      await browser("focus", '.rail-row[data-id="first-workstream"]');
      await wait(`document.activeElement.matches('.rail-row[data-id="first-workstream"]')`);
      await browser("press", "Enter");
      await wait(`!!document.querySelector('.pane-door .empty-state')`);
      await snap(`${theme}-stopped-door`);
      await load("door-stopped");
      await wait(`!!document.querySelector('.pane-door .empty-state') && !!document.querySelector('.xterm-screen')`);
      await read(`(async () => { const emulator = window.__terminals.get('t-first-workstream'); await emulator.ready; const output = Array.from({length:60}, (_, index) => 'Retained output line ' + (index + 1) + ' — completed work remains available across the stopped Door pane.').join('\\r\\n') + '\\r\\n'; await new Promise(resolve => emulator.write(new TextEncoder().encode(output), resolve)); })()`);
      await snap(`${theme}-stopped-door-output`);
      await load("resources", "resources");
      await read(`window.__fake.app.handlers['agent.changedFiles'] = () => ({files:[]})`);
      await browser("click", '.rail-row[data-id="worktree-agent"]');
      await read(`(async () => { const {openProjectPage} = await import('/src/testing/menuProbe.ts'); openProjectPage('view:notes', window.__fake.app.opened.project.path); })()`);
      await wait(`!!document.querySelector('.note-recovery .empty-state')`);
      await snap(`${theme}-note-drafts`);
      await load("empty-project");
      await read(`(async () => { const {draftStorage} = await import('/src/state/storage.ts'); draftStorage(window.__fake.app.opened.project.path).edit({surface:'terminal_selection', object:'missing', recipient:'missing'}, {note:'Unfinished selection', excerpt:'Earlier output', source:'gone'}, null, 'ordinary'); })()`);
      await browser("reload");
      await wait(`!!window.__fake && !!document.querySelector('[aria-label="Overview"]')`);
      await read(`document.querySelector('[aria-label="Overview"]').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,clientX:30,clientY:60}))`);
      await read(`(async () => { const {menuProbe} = await import('/src/testing/menuProbe.ts'); const item = menuProbe.shown.find(item => item.id === 'recover'); if (!item) throw new Error('Recovery menu unavailable'); menuProbe.answer(item.id); })()`);
      await wait(`!!document.querySelector('.draft-recovery')`);
      await read(`[...document.querySelectorAll('.draft-recovery button')].find(button => button.textContent === 'Discard').click()`);
      await wait(`!!document.querySelector('.draft-recovery .empty-state')`);
      await snap(`${theme}-draft-recovery`);
      await load("tree-40");
      await read(`window.__fake.failNext(-32003,'Creation rejected: choose another Workstream name'); document.querySelector('[aria-label="Add Workstream"]').click()`);
      await wait(`document.querySelector('[role=alert]')?.textContent.includes('Creation rejected')`);
      await snap(`${theme}-dense-failure`);
      expect(await read(`document.querySelectorAll('[role=alert]').length`)).toBe(1);
      await load("empty-project");
      await browser("press", "Meta+Comma");
      await wait(`!!document.querySelector('.app-select-trigger')`);
      await browser("focus", '.app-select-trigger');
      await wait(`document.activeElement.matches('.app-select-trigger:focus-visible')`);
      await snap(`${theme}-form-ring`);
      await load("empty-project");

      if (await read(`!!document.querySelector('.window[data-shelf="open"]')`)) {
        await browser("click", '[aria-label="Close the Bench"]');
        await wait(`!document.querySelector('.window[data-shelf="open"]')`);
      }

      await snap(`${theme}-overview`);

      if (theme === "dark") {
        await browser("set", "viewport", "800", "600");
        await snap("dark-narrow");
        await browser("set", "viewport", "640", "320");
        await snap("dark-short");
        await browser("eval", `document.querySelectorAll('.empty-state').forEach(el => { el.scrollTop = el.scrollHeight; })`);
        await snap("dark-short-scrolled");
        await browser("set", "viewport", "1512", "950");
      }
    }
  } finally {
    try { await browser("close"); } finally { await server.close(); rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  }
}, 240_000);

// U401 is a critic-only observer: record production marks and the four shared surfaces.
it.skipIf(!captureDir("U401"))("u401_capture_shared_glyphs_for_the_critic", async () => {
  const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";
  const server = await appServer();
  const profile = mkdtempSync(join(tmpdir(), "u401-"));
  const session = `u401-${process.pid}`;
  const dir = join(captureDir("U401")!, phase);
  mkdirSync(dir, { recursive: true });

  const browser = async (...args: string[]) => {
    const reply = JSON.parse((await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })).stdout);

    if (!reply.success) throw new Error(reply.error);

    return reply.data.result;
  };

  const origin = server.resolvedUrls.local[0]!;

  const load = async (seed: string, view = "") => {
    await browser("open", new URL(`/harness.html?seed=${seed}&items=1${view ? `&view=${view}` : ""}`, origin).href);
    await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-tree')");
  };

  const snap = async (name: string) => {
    await browser("screenshot", join(dir, `${name}.png`));
    writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await browser("eval", "window.__checks()"), null, 2));
  };

  try {
    await browser("--profile", profile, "--executable-path", "/opt/google/chrome/chrome", "--args", "--no-sandbox", "open", origin);
    await browser("set", "viewport", "1512", "950");

    for (const theme of ["light", "dark"]) {
      await browser("set", "media", "color-scheme", theme);
      await load("agents-10");
      await browser("eval", `(async () => {
        const {render} = await import('/node_modules/solid-js/web/dist/web.js');
        const {createComponent} = await import('/node_modules/solid-js/dist/solid.js');
        const {KindGlyph} = await import('/src/ink/KindGlyph.tsx');
        const sheet = document.createElement('div');
        sheet.id = 'glyph-contact-sheet';
        sheet.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;gap:32px;background:var(--ground);filter:grayscale(1)';
        document.body.append(sheet);
        for (const kind of ['idle','blocked','working','needs-you','error','done','working','working']) {
          const slot = document.createElement('div');
          sheet.append(slot);
          render(() => createComponent(KindGlyph, {kind}), slot);
        }
        await document.fonts.ready;
        await new Promise(requestAnimationFrame);
        [...sheet.querySelectorAll('.working-arc')].forEach((arc, i) => {
          for (const animation of arc.getAnimations()) {
            animation.pause();
            animation.currentTime = Number(animation.effect.getTiming().duration) * i / 3;
          }
        });
      })()`);
      await browser("screenshot", join(dir, `${theme}-greyscale-contact.png`));
    }

    await browser("set", "media", "color-scheme", "dark");

    for (const seed of ["agents-10", "tree-40"]) {
      await load(seed, "workstreams");
      await browser("eval", `(async () => {
        const node = await window.__fake.app.rpc('rail.createWorkstream', {name:'Release review', parent:null});
        window.__fake.setStatus(node.id, 'blocked', 'Waiting on review');
        window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
      })()`);
      await browser("wait", "--fn", "[...document.querySelectorAll('.rail-row')].some(row => row.textContent.includes('Release review') && row.querySelector('[aria-label=Blocked]'))");
      await snap(`${seed}-workstreams`);
      await browser("eval", `(async () => {
        const {seedApp} = await import('/src/testing/seeds.ts');
        const todos = (await seedApp('tree-40', Date.now()).app.rpc('todo.list', null)).slice(0, 5).map((todo, i) => ({...todo, done:false, blocked:i < 2, blockers:i < 2 ? [3] : [], owner:null, home:null}));
        window.__fake.app.handlers['todo.list'] = () => todos;
        window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'todo.updated',data:{todo:todos[0]}});
      })()`);

      if (await browser("eval", `document.querySelector('[role="tab"][data-value="todos"]').getAttribute('aria-selected') !== 'true'`)) await browser("click", '[role="tab"][data-value="todos"]');
      await browser("wait", "--fn", "document.querySelectorAll('.todos-tab [aria-label=Blocked]').length === 2 && document.querySelectorAll('.todos-tab [aria-label=Idle]').length === 3");

      if (await browser("eval", `document.querySelector('.todos-tab [data-shelf-group="unassigned"]').getAttribute('aria-expanded') !== 'true'`)) await browser("click", '.todos-tab [data-shelf-group="unassigned"] .shelf-group-control');
      await browser("wait", "--fn", "document.querySelector('.todos-tab [data-shelf-group=unassigned]').getAttribute('aria-expanded') === 'true'");
      await snap(`${seed}-todos`);
      await load(seed);
      await browser("eval", `(async () => {
        const node = await window.__fake.app.rpc('rail.createWorkstream', {name:'Release review', parent:null});
        window.__fake.setStatus(node.id, 'blocked', 'Waiting on review');
        window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
        window.__u401Workstream = node.id;
      })()`);
      await browser("wait", "--fn", "[...document.querySelectorAll('.rail-row')].some(row => row.textContent.includes('Release review') && row.querySelector('[aria-label=Blocked]'))");
      await browser("eval", `window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'ask.changed',data:{ask:{id:'u401',at:'1',text:'Review the changes',parts:[{text:'Review the changes',placement:{kind:'routed',workstream:window.__u401Workstream},state:'typed'},{text:'Publish the result',placement:{kind:'routed',workstream:window.__u401Workstream},state:'failed',reason:'The Door stopped before delivery. Start it and try again.'}]}}})`);
      await browser("wait", "--fn", "!!document.querySelector('.ask-row [aria-label=Blocked]')");
      expect(await browser("eval", "document.querySelectorAll('.ask-row [role=img][aria-label=Blocked]').length")).toBe(1);
      await snap(`${seed}-ask-failure`);
    }
  } finally {
    await browser("close").catch(() => {});
    await server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}, 60_000);
