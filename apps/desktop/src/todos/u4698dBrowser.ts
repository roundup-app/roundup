import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

export const output = captureDir("U4698d");

export const title = "UnbrokenTitle".repeat(16).slice(0, 200);

const openDocumentOn = ({ browser, evaluate, settle, rig }: ReturnType<typeof shelfBrowser>) => async (width: number, height: number, recording = false) => {
  await browser("set", "media", "dark");
  await browser("open", `${rig.server.resolvedUrls.local[0]}harness.html?view=workstreams&items=1&seed=tree-40`);
  await browser("wait", ".shelf-tabs");

  // Screenshots during recording restore its starting viewport. Size that context first.
  await browser("set", "viewport", String(width), String(height));

  if (output && recording) {
    mkdirSync(output, { recursive: true });
    await browser("record", "start", join(output, `todo-${width}.webm`));
    await browser("wait", ".shelf-tabs");
    // Recording starts a fresh browser context; restore the requested media there.
    await browser("set", "media", "dark");
  }

  await evaluate(`(async () => {
    const app = window.__fake.app;
    const ids = [];
    for (let i = 0; i < 30; i++) ids.push((await app.rpc('todo.create', { title: 'Review dependency ' + i, body: '', blockers: null })).id);
    await app.rpc('todo.update', { id: 1, title: ${JSON.stringify(title)}, body: ${JSON.stringify("# Release plan\n\n| Task | Result |\n| --- | --- |\n| " + "LongUnbrokenCell".repeat(30) + " | Wrap this text |\n\n```text\n" + "UnbrokenCode".repeat(35) + "\n```\n\n" + "A long document retains its original contents and readable failure feedback. ".repeat(150))} });
    const done = await app.rpc('todo.create', { title: 'Completed dependency', body: '', blockers: null });
    await app.rpc('todo.complete', { id: done.id });
    await app.rpc('todo.setBlockers', { id: 1, blockers: [...ids, done.id] });
    await app.rpc('todo.create', { title: 'Open dependent', body: '', blockers: [1] });
    const dependent = await app.rpc('todo.create', { title: 'Completed dependent', body: '', blockers: [1] });
    await app.rpc('todo.complete', { id: dependent.id });
    await app.rpc('todo.assign', { id: 1, owner: null });
    const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
    return true;
  })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] .shelf-group-control'); if (group?.getAttribute('aria-expanded') === 'false') group.click(); return true; })()`);
  await browser("wait", '[data-todo="1"] .todo-row-button');
  await browser("focus", '[data-todo="1"] .todo-row-button');
  await browser("press", "Enter");
  await browser("wait", ".todo-detail-title");
  await browser("wait", ".drawer .ProseMirror");
  await settle();


  await settle();
  await browser("wait", ".todo-header");
};

/** The App's Todo document on the Bench's browser rig. Each test file calls it once at its top level, as it registers the file's hooks. */
export const documentBrowser = () => {
  const shelf = shelfBrowser(`
  localStorage.clear();
  localStorage.setItem('roundup:viewer', JSON.stringify({rail:288, shelf:320}));
`);

  const { browser, evaluate, settle } = shelf;

  return { browser, evaluate, settle, openDocument: openDocumentOn(shelf) };
};
