import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { captureDir } from "./captures";

const named = (value: string | undefined) => {
  if (value === undefined) delete process.env.ROUNDUP_CAPTURES;
  else process.env.ROUNDUP_CAPTURES = value;
};

afterEach(() => named(undefined));

test("l105_captureDir_names_a_directory_only_for_a_listed_id", () => {
  named(undefined);
  expect(captureDir("U361")).toBeNull();
  named("");
  expect(captureDir("U361")).toBeNull();
  named("U361, U196");
  expect(captureDir("U361")).toBe(resolve(process.cwd(), "../../artifacts/ux/U361"));
  expect(captureDir("U196")).toBe(resolve(process.cwd(), "../../artifacts/ux/U196"));
  expect(captureDir("U35")).toBeNull();
  expect(captureDir("U3611")).toBeNull();
});

test("l105_captureDir_writes_nothing", () => {
  named("U990");
  const dir = captureDir("U990");

  expect(dir).toBe(resolve(process.cwd(), "../../artifacts/ux/U990"));
  expect(existsSync(resolve(process.cwd(), "../../artifacts/ux/U990"))).toBe(false);
});

test("l105_no_capture_test_defines_its_own_artifact_path", () => {
  const own = new Set(["testing/captures.ts", "testing/captures.test.ts"]);
  const files = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((f) => /\.(tsx?|py)$/.test(f) && !own.has(f));

  for (const file of files) {
    const text = readFileSync(join("src", file), "utf8");

    expect(text.includes("artifacts/ux"), `${file} holds its own artifact path`).toBe(false);
  }
});

// Execute the Python observer's real capture boundary without launching a browser.
const pythonObserver = resolve("src/drawer/u430_browser.test.py");
const pythonCapture = (variant: string) => execFileSync("python3", ["-B", "-c", `
import importlib.util
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("u430", ${JSON.stringify(pythonObserver)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
output = module.capture_output(${JSON.stringify(variant)})
with patch.object(module, "browser") as browser:
    module.capture(output, "checks.json", "{}")
    module.capture(output, "screen.png")
    if output is None:
        assert not browser.called
    else:
        assert (output / "checks.json").read_text() == "{}"
        browser.assert_called_once_with("screenshot", str(output / "screen.png"))
print(output if output is not None else "disabled")
`], { encoding: "utf8", timeout: 10000 }).trim();

test.each([undefined, "", "U361"])("l105_python_observer_writes_nothing_when_U430_is_not_selected_%s", (selection) => {
  const cwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "roundup-captures-"));
  named(selection);
  try {
    // The helper resolves relative to the desktop directory, even from a foreign caller cwd.
    process.chdir(root);
    expect(pythonCapture("head")).toBe("disabled");
    expect(readdirSync(root)).toEqual([]);
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test.each(["head", "base"])("l105_python_observer_uses_the_helpers_U430_directory_%s", (variant) => {
  named("U361, U430");
  const output = resolve(captureDir("U430")!, variant);
  const existed = existsSync(output);
  // Preserve committed captures: the probe writes only disposable names.
  const files = ["checks.json", "screen.png"];
  try {
    expect(pythonCapture(variant)).toBe(output);
  } finally {
    for (const file of files) rmSync(join(output, file), { force: true });
    if (!existed) rmSync(output, { recursive: true, force: true });
  }
});

test.each(["../U361", "/tmp/elsewhere", "head/../../U361"])("l105_python_observer_rejects_a_callers_capture_directory_%s", (variant) => {
  named("U430, U361");
  expect(() => pythonCapture(variant)).toThrow();
});
