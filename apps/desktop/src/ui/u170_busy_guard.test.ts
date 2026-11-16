import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(__dirname, "..");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return sources(path);

    return entry.name.endsWith('.tsx') && !/\.test\./.test(entry.name) ? [path] : [];
  });

/** The `{…}` value that starts at `from`, braces balanced. */
const braced = (text: string, from: number): string => {
  let depth = 0;

  for (let at = from; at < text.length; at += 1) {
    if (text[at] === "{") depth += 1;

    if (text[at] === "}" && (depth -= 1) === 0) return text.slice(from, at + 1);
  }

  return text.slice(from);
};

const PROMISING = /\basync\b|\bawait\b|\bvoid\b|\.then\(/;

/** Every `<button` whose click handler awaits or returns a promise; a handler named by an identifier is read at its `const` in the same file. */
const offenders = (file: string): string[] => {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];

  for (const tag of text.matchAll(/<button\b/g)) {
    const click = text.indexOf("onClick={", tag.index);
    const end = text.indexOf(">", tag.index);

    if (click < 0 || click > end + 400) continue;

    const expression = braced(text, click + "onClick=".length);
    const name = /^\{\s*([A-Za-z_$][\w$]*)\s*\}$/.exec(expression)?.[1];
    const body = name ? (new RegExp(`(?:const|function) ${name}\\b[^;]*?\\b(async)\\b`).exec(text)?.[0] ?? "") : expression;

    if (PROMISING.test(body)) found.push(`${file.slice(root.length + 1)}:${text.slice(0, tag.index).split("\n").length}`);
  }

  return found;
};

/** Files the audit has not converted yet (#7280's remainder). A file leaves this list when its buttons use BusyButton; the test fails for a listed file with nothing left to convert, so the list only shrinks. */
const PENDING = new Set([
  "App.tsx", "ask/AskBar.tsx", "ask/askFixture.tsx", "bubbles/Bubbles.tsx", "bubbles/close.tsx", "changes/NoteBatch.tsx",
  "importer/ImportPanel.tsx", "pads/PadContent.tsx", "rail/RailRow.tsx", "settings/AddMachineDialog.tsx",
  "settings/AppSettings.tsx", "settings/MachinesSettings.tsx", "settings/ResetWarnings.tsx", "settings/ShortcutSetting.tsx",
  "terminal/Pane.tsx", "todos/CapturePanel.tsx", "todos/EditableText.tsx", "todos/TodoComments.tsx", "todos/TodoDrawer.tsx",
  "todos/TodoRefs.tsx", "ui/NativeAlert.tsx",
]);

it("u170_busy_every_async_button_uses_the_shared_busy_state", () => {
  const files = sources(root).flatMap(offenders).map((site) => site.split(":").slice(0, 1).join(""));

  expect(files.filter((file) => !PENDING.has(file))).toEqual([]);
  expect([...PENDING].filter((file) => !files.includes(file))).toEqual([]);
});
