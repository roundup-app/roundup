import { afterAll, beforeAll, it } from "vitest";
import { browser, closeBrowser, openBrowser, read } from "./u484_support";
import { expectControlPressNeverDrags, harness, liftAndCancel, pointIn, todos } from "./u7276_support";

beforeAll(openBrowser, 90_000);

afterAll(closeBrowser);

const changesIcon = async () => {
  await read(`(() => {
    window.__fake.app.handlers['agent.ownedChanges'] = () => ({ groups: [{ repo: '/p', branch: 'main', base: 'main', files: [{ path: 'a.ts', status: 'modified', line: 1 }] }] });
    window.__fake.setStatus('tokens', 'idle', 'idle');
    return true;
  })()`);
};

const renameField = async () => {
  await browser("eval", `document.querySelector('.rail-row[data-id="tokens"]').focus()`);
  await browser("press", "F2");
};

const CONTROLS = [
  { control: "hover icon", seed: "tree-40", open: null, target: '.rail-row[data-id="tokens"] .row-icons button' },
  { control: "changes icon", seed: "tree-40", open: changesIcon, target: '.rail-row[data-id="tokens"] .changes-icon' },
  { control: "chevron", seed: "tree-40", open: null, target: ".rail-row .rail-chevron" },
  { control: "tick box", seed: "tree-40", open: todos, target: '.todos-tab [data-todo="1"] input[type=checkbox]' },
  { control: "rename field", seed: "tree-40", open: renameField, target: '.rail-row[data-id="tokens"] input' },
] as const;

it.each(CONTROLS)("u7276b_a_press_on_a_control_never_drags ($control)", expectControlPressNeverDrags, 60_000);

it("u7276b_a_todo_title_button_drags", async () => {
  const surface = '.todos-tab [data-todo="1"] .todo-row-button';
  await harness("tree-40", todos, surface);
  await liftAndCancel(surface, await pointIn(surface, null), 6);
}, 60_000);
