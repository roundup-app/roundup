import stylelint from "stylelint";
import { expect, it } from "vitest";

it("u3512e_shadow_lint_rejects_outside_tokens", async () => {
  for (const declaration of ["box-shadow: 0 2px 8px #0003", "box-shadow: var(--shadow-drawer)", "box-shadow: none", "@media (width > 0px) { & > div { box-shadow: none } }"]) {
    const result = await stylelint.lint({ code: `.panel { ${declaration} }`, codeFilename: "/tmp/apps/desktop/src/ui/probe.css", configFile: "../../stylelint.config.mjs" });
    expect(result.errored, declaration).toBe(true);
    expect(result.results[0]?.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "roundup/token-elevation" })]));
  }
  for (const [file, code] of [["tokens.css", ".panel { box-shadow: none }"], ["ui/probe.css", ".panel { --shadow: 0 2px 8px #0003; color: red; /* box-shadow: none */ }"]]) {
    const result = await stylelint.lint({ code, codeFilename: `/tmp/apps/desktop/src/${file}`, configFile: "../../stylelint.config.mjs" });
    expect(result.errored).toBe(false);
  }
});
