import { globSync, existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import type { TestProjectInlineConfiguration } from "vitest/config";
import { afterEach, expect, test } from "vitest";
import { captureDir, captureTests, observers } from "./captures";

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

// U4590: selection is observed before Vitest starts any App/browser setup.
test("u4590_capture_selection_keeps_all_policy_observers_and_guards", async () => {
  named("U4590");
  const { loadConfigFromFile } = await import("vite");
  const loaded = await loadConfigFromFile({ command: "serve", mode: "test" }, resolve("vite.config.ts"));
  const config = loaded!.config.test!;

  // SAFETY: loadConfigFromFile widens our literal inline projects to Vitest's string/function/project union.
  const projects = config.projects! as TestProjectInlineConfiguration[];
  const files = projects.flatMap(project => globSync(project.test!.include!).filter(file => !project.test!.exclude!.includes(file)));

  expect([...new Set(files)].sort()).toEqual([
    "src/terminal/s3806c_scale.test.ts",
    "src/terminal/u3517_browser.test.ts",
    "src/terminal/u3517_type.test.ts",
    "src/terminal/u4590_preparation.test.tsx",
    "src/terminal/u59_real_daemon.test.ts",
    "src/testing/u463_real_daemon.test.ts",
  ].sort());
  expect(config.fileParallelism).toBe(false);

  for (const name of ["u4590_rendered_lifecycle_dom_agents-10_head", "u4590_rendered_lifecycle_webgl_bubbles_base", "u4590_visible_launch_params_match_first_pty_grid", "u4590_restored_terminal_keeps_its_program_and_paints_later_output", "u3517a_font_loading_keeps_live_terminal_input_available", "u3517d_rendering_changes_keep_input_and_scrollback", "u3517b_loaded_metrics_drive_terminal_resize"]) {
    expect(name).toMatch(config.testNamePattern!);
  }

  expect("u2875d_real_import_reopen_and_resume").not.toMatch(config.testNamePattern!);
});

test("u4590_capture_selection_leaves_ordinary_discovery_unchanged", async () => {
  named(undefined);
  const { loadConfigFromFile } = await import("vite");
  const loaded = await loadConfigFromFile({ command: "serve", mode: "test" }, resolve("vite.config.ts"));
  const config = loaded!.config.test!;

  // SAFETY: the local Vite config declares inline project objects, not paths or factories.
  const projects = config.projects! as TestProjectInlineConfiguration[];
  const files = projects.flatMap(project => globSync(project.test!.include!).filter(file => !project.test!.exclude!.includes(file)));

  expect([...new Set(files)].sort()).toEqual(globSync("src/**/*.test.{ts,tsx}").sort());
  expect(config.projects).toHaveLength(3);
  expect(config.fileParallelism).toBeUndefined();
  expect(config.testNamePattern).toBeUndefined();
});

test.each(["", "U999999", "U4590, U999999"])("u4590_capture_selection_refuses_unsupported_ids_%s", selection => {
  expect(() => captureTests(selection)).toThrow(selection.includes("U999999") ? "U999999" : "empty");
});

test("u4590_capture_selection_unions_existing_observers_once", () => {
  expect(captureTests("U4590, U3707, U4590")?.files).toEqual([
    ...captureTests("U4590")!.files, "src/terminal/u3707_browser.test.ts",
  ]);
});

test("u4590_mixed_capture_ids_do_not_start_unrelated_Claude_observers", async () => {
  named(" U4590, U3707 ");
  const { loadConfigFromFile } = await import("vite");
  const loaded = await loadConfigFromFile({ command: "serve", mode: "test" }, resolve("vite.config.ts"));
  const config = loaded!.config.test!;


  for (const name of ["u463_first_run_chooses_the_configured_project_and_reaches_its_real_door_terminal", "u2773g_journey_retains_unfinished_work", "u2773a_changes_real_project_reopen_and_reload_restore_exact_form", "u2875d_real_import_reopen_and_resume"]) expect(name).not.toMatch(config.testNamePattern!);
  expect("u4590_visible_launch_params_match_first_pty_grid").toMatch(config.testNamePattern!);
  expect("u3707_terminal_controls").toMatch(config.testNamePattern!);
  expect(process.env.ROUNDUP_CAPTURES).toBe("U4590,U3707");
});

test("u4590_capture_selection_activates_a_shared_observer_for_an_individual_id", async () => {
  named("U3299b");
  const { loadConfigFromFile } = await import("vite");

  await loadConfigFromFile({ command: "serve", mode: "test" }, resolve("vite.config.ts"));
  expect(process.env.ROUNDUP_CAPTURES?.split(",")).toEqual(expect.arrayContaining(["U3299a", "U3299b"]));
});

test("u4590_every_captureDir_id_in_an_observer_file_has_a_table_entry", () => {
  const missing: string[] = [];
  const table: Record<string, readonly string[] | undefined> = observers;

  for (const file of globSync("src/**/*.test.{ts,tsx}")) {
    if (file.endsWith("captures.test.ts")) continue;

    for (const [, id = ""] of readFileSync(file, "utf8").matchAll(/captureDir\("([A-Za-z0-9]+)"/g)) {
      if (id.startsWith("J")) continue;

      if (!table[file]?.includes(id)) missing.push(`${file} ${id}`);
    }
  }

  expect(missing).toEqual([]);
});
