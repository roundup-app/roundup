import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(__dirname, "..");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return sources(path);

    return entry.name.endsWith(".tsx") && !/\.test\./.test(entry.name) ? [path] : [];
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

/** The code a handler runs: an inline handler as written; one named by an identifier read whole at its `const` or `function` in the same file. */
const handler = (text: string, expression: string): string => {
  const name = /^\{\s*([A-Za-z_$][\w$]*)\s*\}$/.exec(expression)?.[1];

  if (!name) return expression;

  const at = new RegExp(`(?:const|function) ${name}\\b`).exec(text)?.index;

  if (at === undefined) return "";

  const open = text.indexOf("{", at);
  const semi = text.indexOf(";", at);

  // An expression-bodied arrow ends at its semicolon; a block body is braced.
  return semi >= 0 && (open < 0 || semi < open) ? text.slice(at, semi) : text.slice(at, open) + braced(text, open);
};

/** Every `<button` whose click, or whose form's submit for a submit button, awaits or returns a promise. */
const offenders = (file: string): string[] => {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];

  for (const tag of text.matchAll(/<button\b/g)) {
    const end = text.indexOf(">", tag.index);
    const click = text.indexOf("onClick={", tag.index);
    const form = text.lastIndexOf("<form", tag.index);
    const submit = form >= 0 ? text.indexOf("onSubmit={", form) : -1;

    const expression = click >= 0 && click <= end + 400
      ? braced(text, click + "onClick=".length)
      : /type="submit"/.test(text.slice(tag.index, end)) && submit >= 0 && submit < text.indexOf(">", form) + 400
        ? braced(text, submit + "onSubmit=".length)
        : "";

    if (PROMISING.test(handler(text, expression))) found.push(`${file.slice(root.length + 1)}:${text.slice(0, tag.index).split("\n").length}`);
  }

  return found;
};

it("u170_busy_every_async_button_uses_the_shared_busy_state", () => {
  expect(sources(root).flatMap(offenders)).toEqual([]);
});
