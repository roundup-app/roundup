import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "./captures";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

let lane: LaneBrowser;

beforeAll(async () => { if (!captureDir("U3787d") && !captureDir("U5463c") && !captureDir("U5740a")) return; lane = await openLane(1512, "dark", "u3787d"); }, 60_000);

afterAll(async () => { await lane?.close(); }, 60_000);

it.skipIf(!captureDir("U3787d")).each(["tree-40", "tabs-8", "conflict"])("u3787d_rendered_literal_fields %s", async seed => {
  const dir = captureDir("U3787d")!;
  mkdirSync(dir, { recursive: true });
  await lane.browser("record", "start", join(dir, `${seed}-literal-fields.webm`));

  try {
      await lane.seedTodos(["same", "same", "長い é 🧭 ".repeat(12), "dependent", "fifth"], true, seed);
      await lane.browser("set", "media", "dark");
      await lane.capture("U3787d", `${seed}-rest`);
      const [id] = await lane.order();
      await lane.browser("focus", `.shelf [data-todo="${id}"] .todo-row-button`);
      await lane.browser("press", "F2");
      await lane.until("!!document.querySelector('.row-name-editor input')");
      await lane.browser("fill", ".row-name-editor input", "  é 🧭 日本語 /a_b --x='yes';  ");
      expect(await lane.evaluate("(() => { const f = document.querySelector('.row-name-editor input'); return [f.getAttribute('spellcheck'), f.getAttribute('autocorrect'), f.getAttribute('autocapitalize'), f.value]; })()")).toEqual(["false", "off", "off", "  é 🧭 日本語 /a_b --x='yes';  "]);
      await lane.capture("U3787d", `${seed}-editing`);
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('.row-name-editor input')");

      if (seed !== "tabs-8") {
        await lane.browser("press", "Meta+k");
        await lane.until("!!document.querySelector('.leader')");
        await lane.browser("press", "t");
        await lane.until("document.activeElement === document.querySelector('.capture-field:not([readonly])')");
        await lane.browser("fill", ".capture-field:not([readonly])", "  é 🧭 日本語 /a_b --x='yes';  ");
        await lane.evaluate("(() => { window.__fake.failNext(-32003, 'Storage unavailable. Retry.'); return true; })()");
        await lane.browser("press", "Enter");
        await lane.until("document.body.textContent.includes('Storage unavailable. Retry.')");
        await lane.capture("U3787d", `${seed}-failed-create-full`);
        await lane.browser("press", "Escape");
      }

      await lane.capture("U3787d", `${seed}-cancelled`);
  } finally { await lane.browser("record", "stop"); }
}, 60_000);


it.skipIf(!captureDir("U5463c")).each(["tree-40", "agents-10", "bubbles"])("u5463c_cleanup_rendered_surfaces %s", async seed => {
  const phase = process.env.U5463_PHASE === "base" ? "base" : "head";
  mkdirSync(join(captureDir("U5463c")!, phase), { recursive: true });

  const capture = async (step: string) => {
    const file = join(captureDir("U5463c")!, phase, `${seed}-${step}`);
    writeFileSync(`${file}.checks.json`, JSON.stringify(await lane.evaluate("window.__checks()")) + "\n");
    await lane.browser("screenshot", `${file}.png`);
  };

  await lane.seedTodos(["Review changes", "Update notes", "Check build", "Read report", "Open result", "Inspect tests", "Verify state", "Finish review"], true, seed);
  await capture("shelf");
  await lane.browser("find", "first", ".shelf .todo-row-button", "click");
  await lane.until("document.activeElement?.matches('.todo-row-button')");
  await lane.browser("press", "Enter");
  await lane.until("!!document.querySelector('.drawer[data-open=true] .todo-detail-title')");
  expect(await lane.evaluate<boolean>("!!document.querySelector('.drawer[data-open=true] .todo-detail-title')")).toBe(true);
  await capture("drawer");
}, 60_000);


it.skipIf(!captureDir("U5463c"))("u5463c_shared_editor_and_recovery_surfaces", async () => {
  const seed = "tree-40";
  const phase = process.env.U5463_PHASE === "base" ? "base" : "head";
  mkdirSync(join(captureDir("U5463c")!, phase), { recursive: true });

  const capture = async (step: string) => {
    const file = join(captureDir("U5463c")!, phase, `${seed}-${step}`);
    writeFileSync(`${file}.checks.json`, JSON.stringify(await lane.evaluate("window.__checks()")) + "\n");
    await lane.browser("screenshot", `${file}.png`);
  };

    await lane.browser("open", `${origin}/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40&menu=1`);
    await lane.until("!!document.querySelector('#shelf-tab-pads')");
    await lane.browser("click", "#shelf-tab-pads");
    await lane.until("!!document.querySelector('.pad-name')");
    await lane.evaluate("(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === 'pad-3')?.focus(); return true; })()");
    await lane.until("document.activeElement?.matches('.pad-name')");
    await lane.browser("press", "Enter");
    await lane.until("!!document.querySelector('.pad-editor .ProseMirror')");
    await capture("pad-editor");
    await lane.evaluate(`(() => {
      localStorage.clear();
      localStorage.setItem('roundup:drafts:/Users/you/harness', JSON.stringify({ version: 1, drafts: [
        { revision: 'cleanup-header', destination: { surface: 'header', object: '/Users/you/harness', recipient: null }, value: { name: 'Saved project name', base: 'harness' }, selection: null, status: 'failed', policy: 'ordinary' },
        { revision: 'cleanup-order', destination: { surface: 'orders', object: 'missing-agent', recipient: null }, value: { title: 'Saved order', ask: 'Review the changes', done: '' }, selection: null, status: 'failed', policy: 'ordinary' },
      ] }));
      return true;
    })()`);
    await lane.browser("reload");
    await lane.until("!!document.querySelector('.tab-recover')");
    await lane.browser("click", ".tab-recover");
    await lane.until("!!document.querySelector('.header-recovery')");
    await capture("project-recovery");
    await lane.browser("press", "Escape");
    await lane.until("!document.querySelector('.header-recovery')");
    await lane.browser("focus", "[data-todo-root]");
    await lane.browser("press", "ContextMenu");
    await lane.until("!!document.querySelector('[role=menuitem][data-value=recover]')");
    await lane.browser("click", "[role=menuitem][data-value=recover]");
    await lane.until("!!document.querySelector('.draft-revisions')");
    await capture("unfinished-work");
  expect(await lane.evaluate<number>("document.querySelectorAll('.draft-revisions button').length")).toBeGreaterThan(0);
}, 60_000);

it.skipIf(!captureDir("U5740a"))("u5740a_remaining_surfaces_rendered", { timeout: 90_000, retry: 0 }, async () => {
  const dir = captureDir("U5740a")!;
  mkdirSync(dir, { recursive: true });
  await lane.browser("record", "start", join(dir, "navigation.webm"));

  try {
    await lane.browser("set", "media", "dark");

    for (const seed of ["empty-project", "agents-10"]) {
      await lane.seedTodos([], false, seed);
      await lane.until("!!document.querySelector('.ask-input')");

      const capture = async (step: string) => {
        const checks = await lane.evaluate<Record<string, { status: string }>>("window.__checks()");

        for (const id of ["D2", "D5", "D6"]) expect(checks[id], `${seed} ${step} ${id}`).toMatchObject({ status: "pass" });
        expect(await lane.evaluate("document.body.textContent.includes('Reactions')")).toBe(false);
        await lane.capture("U5740a", `${seed}-${step}`);
      };

      await capture("overview");
      await lane.evaluate(`(async () => {
        const { projectMenu } = await import('/src/testing/menuProbe.ts');
        window.__remainingMenu = projectMenu.items;
      })()`);
      expect(await lane.evaluate("window.__remainingMenu.some(item => /reaction/i.test(item.id + item.label))")).toBe(false);
      writeFileSync(join(dir, `${seed}-project-menu.json`), JSON.stringify(await lane.evaluate("window.__remainingMenu")) + "\n");
      await capture("project-menu");

      if (seed === "empty-project") continue;
      await lane.browser("fill", ".ask-input", "keep exact unfinished draft  ");
      await lane.browser("press", "Meta+k");
      await lane.browser("press", "k");
      await lane.until("!!document.querySelector('[role=combobox]')");
      await capture("switcher");
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('[role=combobox]')");
      await lane.browser("focus", ".todo-project-root");
      await lane.browser("press", "Shift+?");
      await lane.until("!!document.querySelector('[role=dialog]')");
      await capture("help");
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('[role=dialog]')");
      expect(await lane.evaluate("document.querySelector('.ask-input').value")).toBe("keep exact unfinished draft  ");
      await lane.browser("focus", ".ask-input");
      await capture("draft-and-focus");
      await lane.evaluate(`(async () => {
        const { projectMenu } = await import('/src/testing/menuProbe.ts');
        window.__fake.app.handlers['deliverable.list'] = () => { throw new Error('Saved publications unavailable. Open Made again to retry.'); };
        window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:projectMenu.path,command:'view:made'}}));
        window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'deliverable.changed'});
      })()`);
      await lane.until("!!document.querySelector('.made [role=alert]')");
      await capture("made-failure");
    }
  } finally { await lane.browser("record", "stop"); }
});
