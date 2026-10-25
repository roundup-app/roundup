import { resolve } from "node:path";
import stylelint from "stylelint";
import { expect, it } from "vitest";
import fixtures from "./u130_styles.fixtures.json";

const configFile = resolve(import.meta.dirname, "../../../../stylelint.config.mjs");

const config = {
  extends: configFile,
  rules: { "roundup/container-token-threshold": true, "declaration-no-important": true, "unit-disallowed-list": ["px", "ms", "s"] },
  overrides: [{ files: ["**/tokens.css"], rules: { "unit-disallowed-list": null } }],
};

it("u130_authored_styles_have_no_importance_or_unowned_dimensions", async () => {
  const result = await stylelint.lint({ files: resolve(import.meta.dirname, "../**/*.css"), config });

  expect(result.results.flatMap(file => file.warnings.map(warning => `${file.source}:${warning.line}:${warning.column} ${warning.rule}`))).toEqual([]);
});

it.each(fixtures)("u130_stylelint_rejects_unowned_values_and_complex_selectors: $code", async ({ code, path, rule, column }) => {
  const result = await stylelint.lint({ code, codeFilename: resolve(import.meta.dirname, "..", path), config });

  expect(result.errored).toBe(rule !== null);

  if (rule) expect(result.results[0]?.warnings).toEqual([expect.objectContaining({ rule, line: 1, column })]);
});
