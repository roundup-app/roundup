import { resolve } from "node:path";
import stylelint from "stylelint";
import { expect, it } from "vitest";

const config = {
  rules: { "declaration-no-important": true, "unit-disallowed-list": ["px", "ms", "s"] },
  overrides: [{ files: ["**/tokens.css"], rules: { "unit-disallowed-list": null } }],
};

it("u130_authored_styles_have_no_importance_or_unowned_dimensions", async () => {
  const result = await stylelint.lint({ files: resolve(import.meta.dirname, "../**/*.css"), config });

  expect(result.results.flatMap(file => file.warnings.map(warning => `${file.source}:${warning.line}:${warning.column} ${warning.rule}`))).toEqual([]);
});

it.each([
  [".a { opacity: var(--press-opacity) !important; }", "spec-fixture.css", "declaration-no-important"],
  [".a { width: 1px; }", "spec-fixture.css", "unit-disallowed-list"],
  [".a { transition-duration: 1ms; }", "spec-fixture.css", "unit-disallowed-list"],
  [".a { transition-duration: .1s; }", "spec-fixture.css", "unit-disallowed-list"],
  [".a { width: var(--missing, 1px); }", "spec-fixture.css", "unit-disallowed-list"],
  ["@media (min-width: 1px) { .a { margin: 0; } }", "spec-fixture.css", "unit-disallowed-list"],
  [".a { opacity: 1 !important; }", "tokens.css", "declaration-no-important"],
  [":root { --example: 1px; --example-time: 1ms; }", "tokens.css", null],
  [".a { width: var(--space-1); margin: 0; }", "spec-fixture.css", null],
])("u130_stylelint_rejects_unowned_values_and_complex_selectors: %s", async (code, path, rule) => {
  const result = await stylelint.lint({ code, codeFilename: resolve(import.meta.dirname, "..", path), config });

  expect(result.errored).toBe(rule !== null);

  if (rule) expect(result.results[0]?.warnings).toEqual([expect.objectContaining({ rule, line: 1, column: expect.any(Number) })]);
});
