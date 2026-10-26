import { resolve } from "node:path";
import stylelint from "stylelint";
import { expect, it } from "vitest";
import fixtures from "./u130_styles.fixtures.json";

const configFile = resolve(import.meta.dirname, "../../../../stylelint.config.mjs");


it.each(fixtures)("u130_stylelint_rejects_unowned_values_and_complex_selectors: $code", async ({ code, path, rule, column }) => {
  const result = await stylelint.lint({ code, codeFilename: resolve(import.meta.dirname, "..", path), configFile });

  expect(result.errored).toBe(rule !== null);

  if (rule) expect(result.results[0]?.warnings).toEqual([expect.objectContaining({ rule, line: 1, column })]);
});
