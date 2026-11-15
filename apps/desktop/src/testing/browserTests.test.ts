import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { browserTests } from "./browserTests";

const tree = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "browser-tests-"));

  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }

  return root;
};

// Built from parts: a literal import of either module in this file would send this file to the project that starts them.
const importing = (name: string, path: string) => `import { ${name} } from "${path}";`;

const helpers = { "src/testing/chromePage.ts": "export const openPage = 1;", "src/testing/appServer.ts": "export const appServer = 1;" };

// T7187a: a file that reaches Chrome or the App server, however deep, runs in the project that starts them; no other file does.
test("t7187a_a_test_reaches_chrome_or_the_app_server_through_its_imports", () => {
  const root = tree({
    ...helpers,
    "src/a/rig.ts": importing("openPage", "../testing/chromePage"),
    "src/a/direct.test.ts": importing("appServer", "../testing/appServer"),
    "src/a/indirect.test.tsx": importing("rig", "./rig"),
    "src/a/dynamic.test.ts": `const { rig } = await import("./rig");`,
    "src/a/plain.test.ts": importing("value", "./util"),
    "src/a/util.ts": "export const value = 1;",
  });

  expect(browserTests(root)).toEqual(["src/a/direct.test.ts", "src/a/dynamic.test.ts", "src/a/indirect.test.tsx"]);
});

test("t7187a_a_missing_browser_module_fails_instead_of_selecting_nothing", () => {
  expect(() => browserTests(tree({ "src/testing/appServer.ts": "" }))).toThrow("src/testing/chromePage.ts is missing");
});
