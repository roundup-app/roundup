import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { captureDir, readCapture } from "./captures";

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

test("l105_captureDir_maps_a_named_journey_partition", () => {
  named("U361, J13");
  expect(captureDir("J13")).toBe(resolve(process.cwd(), "../../artifacts/ux/journey/J13"));
});

test.each([undefined, "", "J14"])("l105_captureDir_skips_an_uncited_journey_%s", (value) => {
  named(value);
  expect(captureDir("J13")).toBeNull();
});

test.each(["J13-invalid", "J13aa", "J13/elsewhere"])("l105_captureDir_rejects_a_malformed_journey_%s", (id) => {
  named(id);
  expect(captureDir(id)).toBeNull();
});

test("l105_captureDir_journey_writes_nothing", () => {
  named("J990");
  captureDir("J990");
  expect(existsSync(resolve(process.cwd(), "../../artifacts/ux/journey/J990"))).toBe(false);
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

// Stub only the browser: selection must cross Python into the real TypeScript helper.
const pythonObserver = resolve("src/drawer/u430_browser.test.py");

const pythonCapture = (observer: string, variant: string) => execFileSync("python3", ["-B", "-c", `
import importlib.util
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("u430", ${JSON.stringify(observer)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
output = module.capture_output(${JSON.stringify(variant)})
with patch.object(module, "browser", side_effect=lambda command, path: Path(path).write_bytes(b"PNG")) as browser:
    module.capture(output, "checks.json", "{}")
    module.capture(output, "screen.png")
    if output is None:
        assert not browser.called
    else:
        assert (output / "checks.json").read_text() == "{}"
        assert (output / "screen.png").read_bytes() == b"PNG"
        browser.assert_called_once_with("screenshot", str(output / "screen.png"))
print(output if output is not None else "disabled")
`], { encoding: "utf8", timeout: 10000, stdio: "pipe" }).trim();

const withPythonObserver = (probe: (observer: string, root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), "roundup-captures-"));
  const desktop = join(root, "apps/desktop");
  mkdirSync(join(desktop, "src/drawer"), { recursive: true });
  mkdirSync(join(desktop, "src/testing"), { recursive: true });
  const observer = join(desktop, "src/drawer/u430_browser.test.py");

  copyFileSync(pythonObserver, observer);
  copyFileSync(resolve("src/testing/captures.ts"), join(desktop, "src/testing/captures.ts"));

  try {
    probe(observer, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test.each([undefined, "", "U361"])("l105_python_observer_writes_nothing_when_U430_is_not_selected_%s", (selection) => {
  named(selection);
  withPythonObserver((observer, root) => {
    expect(pythonCapture(observer, "head")).toBe("disabled");
    expect(existsSync(join(root, "artifacts"))).toBe(false);
  });
});

test.each(["head", "base"])("l105_python_observer_uses_the_helpers_U430_directory_%s", (variant) => {
  named("U361, U430");
  withPythonObserver((observer, root) => {
    expect(pythonCapture(observer, variant)).toBe(join(root, "artifacts/ux/U430", variant));
    expect(readdirSync(join(root, "artifacts/ux"))).toEqual(["U430"]);
  });
});

test.each(["../U361", "/tmp/elsewhere", "head/../../U361"])("l105_python_observer_rejects_a_callers_capture_directory_%s", (variant) => {
  named("U430, U361");
  withPythonObserver((observer, root) => {
    expect(() => pythonCapture(observer, variant)).toThrow("capture variant must be head or base");
    expect(existsSync(join(root, "artifacts"))).toBe(false);
  });
});

test("u453_committed_capture_reads_do_not_enable_writes", () => {
  named(undefined);
  expect(readCapture("U453", "base/first-run-1280x800-light-rest.checks.json")).toContain("1280x800");
  expect(captureDir("U453")).toBeNull();
});
