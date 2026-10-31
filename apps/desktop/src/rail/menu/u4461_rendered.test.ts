import { copyFileSync, writeFileSync } from "node:fs";
import { agent, workstream, info } from "../../testing/nodes";
import { join } from "node:path";
import { captureDir } from "../../testing/captures";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { openLane, type LaneBrowser } from "../../todos/laneBrowser";

vi.setConfig({ testTimeout: 60_000 });

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u4461"); }, 180_000);

afterAll(async () => { await lane?.close(); });

it("u4461_removal_failure_keeps_the_captured_workstream_in_the_rendered_app", async () => {
  await lane.browser("open", await lane.evaluate<string>("location.href"));
  await lane.until("!!document.querySelector('.rail-row[data-id=backend]')");
  await lane.capture("U4461", "before");
  const dir = captureDir("U4461");

  if (dir) {
    const url = await lane.evaluate<string>("location.href");
    await lane.browser("record", "start", "/tmp/u4461.webm");
    await lane.browser("set", "media", "dark");
    await lane.browser("open", url);
    await lane.until("!!document.querySelector('.rail-row[data-id=backend]')");
  }

  let target = "backend";

  if (captureDir("U4601")) {
    target = "workstream";

    // U4601: observe each specified request in the surrounding App; native alerts have no Chromium DOM.
    const fixtures = [
      { step: "only-workstream", agents: [], done: 0, open: 0 },
      { step: "owners-case", agents: [agent("new-agent", "working", "busy", { parent: "workstream" })], done: 1, open: 1 },
      { step: "three-agents-five-todos", agents: [agent("finished", "done", "finished", { parent: "workstream" }), agent("alpha", "working", "busy", { parent: "workstream" }), agent("beta", "working", "busy", { parent: "workstream" })], done: 2, open: 3 },
    ];

    const todoTemplate = await lane.evaluate("window.__fake.app.rpc('todo.list', null).then(todos => todos[0])");

    for (const fixture of fixtures) {
      const nodes = [workstream("workstream"), ...fixture.agents];
      await lane.evaluate(`(async () => {
        const fake = window.__fake;
        const template = ${JSON.stringify(todoTemplate)};
        fake.app.menuChoice = 'remove';
        fake.app.handlers['rail.tree'] = () => ${JSON.stringify(nodes)};
        fake.app.handlers['terminal.list'] = () => ${JSON.stringify([info("live-shell", { owner: "workstream" })])};
        fake.app.handlers['todo.list'] = () => Array.from({length: ${fixture.done + fixture.open}}, (_, i) => ({...template, id: i+1, home: 'workstream', done: i < ${fixture.done}}));
        fake.app.handlers['pad.list'] = () => [];
        const actor = {kind:'user', id:'you', parent:null};
        fake.emit({actor, name:'rail.changed'});
        fake.emit({actor, name:'terminal.changed'});
        fake.emit({actor, name:'todo.updated', data:template});
        fake.emit({actor, name:'pad.changed', data:{name:'fixture'}});
        return true;
      })()`);
      await lane.until("!!document.querySelector('.rail-row[data-id=workstream]')");
      await lane.browser("focus", '.rail-row[data-id="workstream"]');
      await lane.browser("press", "ContextMenu");
      await lane.until("window.__question.shown !== null");
      await lane.capture("U4601", fixture.step);
      const captures = captureDir("U4601");

      if (captures) writeFileSync(join(captures, `${fixture.step}.request.json`), JSON.stringify(await lane.evaluate("window.__question.shown"), null, 2));
      await lane.evaluate("(() => { window.__question.answer(false); return true; })()");
      await lane.until("window.__question.shown === null && document.activeElement?.dataset.id === 'workstream'");
    }

    await lane.evaluate(`(() => { window.__fake.app.questionFailure = new Error('Alert failed. Retry.'); return true; })()`);
    await lane.browser("press", "ContextMenu");
    await lane.until("document.body.textContent.includes('Alert failed. Retry.')");
    await lane.capture("U4601", "native-alert-failure");
    await lane.evaluate("(() => { window.__fake.app.questionFailure = null; return true; })()");
    await lane.browser("click", ".native-alert-failure button:first-child");
    await lane.until("window.__question.shown !== null");
  } else {
    // Removing this Workstream closes its owned shell, so this path requires consent.
    const terminal = await lane.evaluate<string>("window.__fake.app.rpc('terminal.open', { workstream: 'backend' }).then(result => result.terminal_id)");
    // Hover reveals the row's controls over its middle, so press the start of the name.
    const name = await lane.evaluate<{ x: number; y: number }>(`(() => { const b = document.querySelector('.rail-row[data-id="backend"] .name').getBoundingClientRect(); return { x: Math.round(b.left + 8), y: Math.round(b.top + b.height / 2) }; })()`);
    await lane.browser("mouse", "move", String(name.x), String(name.y));
    await lane.browser("mouse", "down");
    await lane.browser("mouse", "up");
    await lane.until(`!!document.querySelector('.terminal-tab[data-bubble="${terminal}"]')`);
    await lane.browser("focus", '.rail-row[data-id="backend"]');
    await lane.browser("press", "Meta+Backspace");
    await lane.until("window.__question.shown !== null");
  }

  await lane.capture("U4461", "question-request");
  await lane.evaluate(`(() => {
    window.__fake.app.handlers['rail.remove'] = () => { throw window.__fake.refusal(-32003, 'Stop failed. Retry Remove.'); };
    window.__question.answer('all');
    return true;
  })()`);
  await lane.until("document.body.textContent.includes('Stop failed. Retry Remove.')");
  expect(await lane.calls("rail.remove")).toEqual([{ method: "rail.remove", params: { id: target, scope: "all" } }]);
  await lane.capture("U4461", "failure");
  await lane.capture("U4601", "removal-failure");
  await lane.browser("set", "viewport", "1512", "800");
  await lane.capture("U4461", "failure-800");

  if (dir) {
    await lane.browser("record", "stop");
    copyFileSync("/tmp/u4461.webm", join(dir, "removal.webm"));
  }
});
