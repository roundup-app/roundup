import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("u2749c_lint_rejects_tooltip_bypasses", () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const temporary = mkdtempSync(join(tmpdir(), "u2749-"));

  const cases = [
    ["ark", "ask", 1], ["root", "ask", 1], ["alias", "ask", 1], ["title", "ask", 1], ["component-title", "ask", 1],
    ["tip", "ask", 0], ["primitive", "ui", 0],
  ] as const;

  try {
    for (const [fixture, directory, expected] of cases) {
      const folder = join(temporary, "apps/desktop/src", directory);
      mkdirSync(folder, { recursive: true });
      const path = join(folder, `${fixture}.tsx`);
      writeFileSync(path, readFileSync(join(root, "tools/oxlint/tooltip-fixtures", `${fixture}.tsx.txt`)));
      const result = spawnSync(join(root, "node_modules/.bin/oxlint"), ["--config", join(root, ".oxlintrc.json"), path], { cwd: root, encoding: "utf8" });
      console.log(`${fixture}: exit ${result.status}`);
      expect(result.status, result.stdout + result.stderr).toBe(expected);

      if (expected !== 0) expect(result.stdout + result.stderr).toContain("no-tooltip-bypass");
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("u3512a_lint_rejects_inline_delete_confirmation_copy", () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const temporary = mkdtempSync(join(tmpdir(), "u3512-"));

  const cases = [
    ["copy.ts", 'export const copy = { deletePad: name => `Delete ${name}?` };', 1],
    ["copy.ts", 'export const copy = { "unsavedChangesAreLost": "Unsaved changes are lost" };', 1],
    ["copy.ts", 'export const copy = { ownsItYouMayDeleteAnyPad: name => `${name} owns it` };', 1],
    ["pads/PadDrawer.tsx", 'const view = <p>{copy.padDeleteQuestion(name)}</p>;', 1],
    ["todos/TodoDrawer.tsx", 'const view = <p>{copy["deleteTodoQuestion"]}</p>;', 1],
    ["pads/PadDrawer.tsx", 'const view = <NativeAlert question={{ title: copy.padDeleteQuestion(name), message: copy.padDeleteUnsaved }} />;', 0],
    ["copy.ts", 'export const copy = { padDeleteQuestion: name => `Delete ${name}?`, delete: "Delete" };', 0],
    ["bubbles/Bubbles.tsx", 'app.ask({ title: copy.closeQuestion(name), message: copy.closeTerminalWarning });', 0],
  ] as const;

  try {
    const fixtures = cases.map(([file, code, expected], index) => {
      const path = join(temporary, String(index), "apps/desktop/src", file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, code);

      return { path, expected };
    });

    for (const expected of [0, 1]) {
      const group = fixtures.filter(fixture => fixture.expected === expected);
      const result = spawnSync(join(root, "node_modules/.bin/oxlint"), ["--config", join(root, ".oxlintrc.json"), "--format", "unix", ...group.map(fixture => fixture.path)], { cwd: root, encoding: "utf8" });
      expect(result.status, result.stdout + result.stderr).toBe(expected);

      for (const fixture of group) {
        const diagnostics = result.stdout.split("\n").filter(line => line.includes(fixture.path) && line.includes("no-inline-delete-confirmation"));
        expect(diagnostics.length, fixture.path).toBe(expected);
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
