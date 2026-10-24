import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { captureDir } from "../testing/captures";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";

// Browser inputs wait for Ark acknowledgements and the real renderer.
vi.setConfig({ testTimeout: 60_000 });

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u3512"); }, 180_000);

afterAll(async () => { await lane?.close(); });

const key = (value: string) => lane.browser("press", value);

const openForm = async () => {
  const [id] = await lane.order();
  await lane.browser("focus", `.shelf .todo-row[data-id="${id}"] .todo-row-button`);
  await key("o");
  await lane.until("!!document.querySelector('[role=menu]')");
  await lane.evaluate(`document.querySelector('[role=menuitem][data-value="new-workstream"]').scrollIntoView({block: 'nearest'})`);
  await lane.browser("click", '[role=menuitem][data-value="new-workstream"]');
  await lane.until("!!document.querySelector('.new-workstream textarea')");
};

const record = async (step: string) => {
  for (const id of ["U3512b", "U3512c"]) await lane.capture(id, step);
};

it("u3512b_shared_dialog_keeps_focus_and_drafts", async () => {
  await lane.seedTodos(["Long Unicode 雪 🪁 ".repeat(5), ...Array.from({ length: 9 }, (_, at) => `Todo ${at + 2}`)], false);
  await openForm();
  const field = '.new-workstream textarea';
  await lane.browser("fill", field, "  exact 雪 é  ");
  await lane.evaluate("document.querySelector('.new-workstream [data-part=close-trigger]').focus()");
  await key("Shift+Tab");
  await lane.until("document.querySelector('.new-workstream').contains(document.activeElement)");
  expect(await lane.evaluate<string>(`document.querySelector('${field}').value`)).toBe("  exact 雪 é  ");
  await record("new-workstream");
  await lane.evaluate("window.__fake.app.handlers['todo.startWorkstream'] = () => { throw new Error('The name was refused. Try another name.'); }");
  await lane.browser("find", "role", "button", "click", "--name", "Create", "--exact");
  await lane.until("!!document.querySelector('.new-workstream [role=alert]')");
  await record("new-workstream-failure");
  expect(await lane.evaluate<string>(`document.querySelector('${field}').value`)).toBe("  exact 雪 é  ");
  await key("Escape");
  await lane.until("!document.querySelector('.new-workstream')");
  expect(await lane.calls("todo.startWorkstream")).toHaveLength(1);
});

it("u3512b_nested_picker_keeps_keyboard_ownership", async () => {
  await lane.seedTodos(["First", "Second"], false);
  await openForm();
  await lane.browser("click", ".new-workstream .app-radio:last-of-type");
  await lane.browser("find", "role", "button", "click", "--name", "Choose a Todo", "--exact");
  await lane.until("!!document.querySelector('.todo-blocker-menu input')");
  await record("nested-picker");
  await key("Enter");
  await lane.until("!document.querySelector('.todo-blocker-menu')");
  expect(await lane.calls("todo.startWorkstream")).toEqual([]);
  await lane.browser("click", ".new-workstream .app-dialog-pick");
  await lane.until("!!document.querySelector('.todo-blocker-menu input')");
  await key("Escape");
  await lane.until("!document.querySelector('.todo-blocker-menu')");
  expect(await lane.evaluate<boolean>("!!document.querySelector('.new-workstream')")).toBe(true);
  await key("Escape");
  await lane.until("!document.querySelector('.new-workstream')");
});

it("u3512c_form_buttons_keep_submit_and_cancel", async () => {
  await lane.seedTodos(["First", "Second"], false);
  await key("Meta+Shift+t");
  await lane.until("!!document.querySelector('.capture-field')");
  await lane.browser("fill", ".capture-field", "Cancelled draft");
  await lane.browser("find", "role", "button", "click", "--name", "Cancel", "--exact");
  await lane.until("!document.querySelector('.capture')");
  expect(await lane.calls("todo.create")).toEqual([]);
  await key("Meta+Shift+t");
  await lane.until("!!document.querySelector('.capture-field')");
  expect(await lane.evaluate<string>("document.querySelector('.capture-field').value")).toBe("");
  await lane.browser("fill", ".capture-field", "Created from Capture 雪");
  await record("capture");
  await key("Enter");
  await lane.until("!document.querySelector('.capture')");
  expect(await lane.calls("todo.create")).toHaveLength(1);
  await lane.browser("focus", ".rail-row");
  await key("Shift+?");
  await lane.until("!!document.querySelector('.help')");
  await record("help");
  await key("Tab");
  await lane.until("document.activeElement?.closest('.help') !== null");
  await key("Escape");
  await lane.until("!document.querySelector('.help')");
});

it("u3512d_instant_paths_release_focus_next_frame", async () => {
  await lane.seedTodos(["First", "Second"], false);
  await openForm();
  await lane.evaluate(`(async () => {
    window.__u3512Origin = document.activeElement;
    window.__u3512ReducedFrames = [];
    const sample = () => {
      const panel = document.querySelector('.new-workstream');
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.__u3512ReducedFrames.push({t: performance.now(), reduced, opacity: panel ? getComputedStyle(panel).opacity : null, inert: panel?.inert});
      if (panel || !reduced) requestAnimationFrame(sample);
    };
    sample();
    const original = document.querySelector('.new-workstream');
    const cancel = original.querySelector('[data-part=close-trigger]');
    cancel.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerType: 'mouse', width: 4, height: 4, pressure: 0.5}));
    cancel.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));
    await new Promise(resolve => requestAnimationFrame(resolve));
    // Slow the actual fade so Chromium changes its media preference before it completes.
    for (const element of document.querySelectorAll('.new-workstream, .app-dialog-backdrop'))
      for (const animation of element.getAnimations()) animation.playbackRate = 0.01;
    return true;
  })()`);
  await lane.browser("set", "media", "dark", "reduced-motion");

  const released = await lane.evaluate<boolean>(`new Promise(resolve => requestAnimationFrame(() =>
    resolve(!document.querySelector('.new-workstream') && document.activeElement !== window.__u3512Origin)))`);

  expect(released).toBe(true);
  const dir = captureDir("U3512d");
  const frames = await lane.evaluate("window.__u3512ReducedFrames");

  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "reduced-during-exit-frames.json"), JSON.stringify(frames));
  }

  await lane.browser("set", "media", "dark");
  await lane.until("!matchMedia('(prefers-reduced-motion: reduce)').matches");
});

it("u3512d_reopen_owns_exit_completion", async () => {
  await lane.seedTodos(["First", "Second"], false);
  await openForm();
  // The scenario's real 120 ms transition is the observer; frames are evidence for the critic, not layout assertions.
  await lane.evaluate(`(() => {
    window.__u3512Frames = [];
    window.__u3512Sampling = true;
    const sample = () => {
      const panel = document.querySelector('.new-workstream');
      const scrim = document.querySelector('.app-dialog-backdrop');
      window.__u3512Frames.push({t: performance.now(), opacity: panel ? getComputedStyle(panel).opacity : null,
        scrim: scrim ? getComputedStyle(scrim).opacity : null, bounds: panel?.getBoundingClientRect().toJSON(), inert: panel?.inert});
      if (window.__u3512Sampling) requestAnimationFrame(sample);
    };
    sample();
    return true;
  })()`);
  const [id] = await lane.order();

  const result = await lane.evaluate<{ draft: string; retained: boolean; inert: boolean }>(`(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const original = document.querySelector('.new-workstream');
    const cancel = original.querySelector('[data-part=close-trigger]');
    cancel.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerType: 'mouse', width: 4, height: 4, pressure: 0.5}));
    cancel.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));
    await frame();
    const retained = document.querySelector('.new-workstream') === original;
    const inert = original.inert;
    const row = document.querySelector('.shelf .todo-row[data-id="${id}"] .todo-row-button');
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', {key: 'o', code: 'KeyO', bubbles: true}));
    await frame();
    const item = document.querySelector('[role=menuitem][data-value="new-workstream"]');
    item.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerType: 'mouse', width: 4, height: 4, pressure: 0.5}));
    item.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));
    // Todos schedules NewWorkstream after the menu closes with its zero-delay naming timer.
    await frame();
    const field = document.querySelector('.new-workstream textarea');
    field.value = 'latest 雪';
    field.dispatchEvent(new Event('input', {bubbles: true}));
    await Promise.all(document.querySelector('.new-workstream').getAnimations().map(animation => animation.finished.catch(() => {})));
    await frame();
    return { draft: document.querySelector('.new-workstream textarea')?.value, retained, inert };
  })()`);

  expect(result).toEqual({ draft: "latest 雪", retained: true, inert: true });
  expect(await lane.evaluate<boolean>("!document.querySelector('.new-workstream').inert")).toBe(true);
  const dir = captureDir("U3512d");
  const frames = await lane.evaluate("(() => { window.__u3512Sampling = false; return window.__u3512Frames; })()");

  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pointer-close-reopen-frames.json"), JSON.stringify(frames));
    await lane.capture("U3512d", "reopened");
  }

  await key("Escape");
  await lane.until("!document.querySelector('.new-workstream')");
});
