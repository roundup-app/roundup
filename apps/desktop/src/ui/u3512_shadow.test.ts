import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";

// U3512e names the CLI exit contract, so this observer runs the real CLI with stdin fixtures.
it("u3512e_shadow_lint_rejects_outside_tokens", () => {
  const cli = resolve(dirname(createRequire(import.meta.url).resolve("stylelint")), "../bin/stylelint.mjs");

  for (const [file, code, exit] of [
    ["ui/probe.css", ".panel { box-shadow: 0 2px 8px #0003 }", 2],
    ["ui/probe.css", ".panel { box-shadow: var(--shadow-drawer) }", 2],
    ["ui/probe.css", ".panel { box-shadow: none }", 2],
    ["ui/probe.css", ".panel { @media (width > 0px) { & > div { box-shadow: none } } }", 2],
    ["tokens.css", ".panel { box-shadow: none }", 0],
    ["ui/probe.css", ".panel { --shadow: 0 2px 8px #0003; color: red; /* box-shadow: none */ }", 0],
  ] as const) {
    const result = spawnSync(process.execPath, [cli, "--stdin", "--stdin-filename", `/tmp/apps/desktop/src/${file}`, "--config", "../../stylelint.config.mjs"], { input: code, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(exit);

    if (exit === 2) expect(result.stdout + result.stderr).toContain("roundup/token-elevation");
  }
});
