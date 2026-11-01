import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "./captures";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

let lane: LaneBrowser;

beforeAll(async () => { if (!captureDir("U3787d") && !captureDir("U5463c")) return; lane = await openLane(1512, "dark", "u3787d"); }, 60_000);

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
  const origin = await lane.evaluate<string>("location.origin");
  await capture("shelf");
  await lane.browser("find", "first", ".shelf .todo-row-button", "click");
  await lane.until("document.activeElement?.matches('.todo-row-button')");
  await lane.browser("press", "Enter");
  await lane.until("!!document.querySelector('.drawer[data-open=true] .todo-detail-title')");
  expect(await lane.evaluate<boolean>("!!document.querySelector('.drawer[data-open=true] .todo-detail-title')")).toBe(true);
  await capture("drawer");
  await lane.browser("open", `${origin}/harness.html?view=reactions&items=1&tabs=1&seed=${seed}`);
  await lane.until("!!window.__fake && !!document.querySelector('.ask-bar')");
  await lane.evaluate(`(() => {
    const record = {
      project: 'p', reason: null, id: 'cleanup-reaction', name: 'Review changes', actor: { kind: 'user', id: 'you', parent: null }, home: null, target: 'agent-1',
      instruction: 'Review the saved changes', condition: { kind: 'agents', ids: ['agent-1'], any: false }, max_firings: 1, remaining: 1, rearm: false,
      expires_at: '2026-11-02T09:00:00Z', created_at: '2026-11-01T09:00:00Z', state: 'active',
      observation: { health: 'observing', health_code: 'observing', cause_code: 'unknown', gap_code: 'unknown', recovery_code: 'unknown', cursor: null, gap: null, recovery: null, evidence: null }, firings: [],
    };
    window.__fake.app.handlers['reaction.list'] = () => [record];
    window.__fake.app.handlers['reaction.get'] = () => record;
    window.dispatchEvent(new Event('focus'));
    return true;
  })()`);
  await lane.browser("find", "role", "button", "click", "--name", "Reactions", "--exact");
  await lane.until("!!document.querySelector('[data-reaction-opener=cleanup-reaction]')");
  await lane.browser("click", "[data-reaction-opener=cleanup-reaction]");
  await lane.until("!!document.querySelector('.reaction-detail')");
  await capture("reactions");

  if (seed === "tree-40") {
    await lane.evaluate("(() => { window.__fake.app.handlers['reaction.get'] = () => { throw new Error('Storage unavailable. Retry.'); }; return true; })()");
    await lane.browser("click", ".reaction-actions button:first-child");
    await lane.until("document.body.textContent.includes('Storage unavailable. Retry.')");
    await capture("failure");

  }
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

  const origin = await lane.evaluate<string>("location.origin");
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
