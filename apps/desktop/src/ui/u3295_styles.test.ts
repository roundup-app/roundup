import { resolve } from "node:path";
import stylelint from "stylelint";
import { expect, it } from "vitest";

const configFile = resolve(import.meta.dirname, "../../../../stylelint.config.mjs");

it.each([
  ...["-1", "0", "1", "drawer", "popover", "dialog", "menu", "tooltip", "toast"].map(value => [value.length > 2 ? `var(--layer-${value})` : value, false] as const),
  ...["2", "3", "20", "100", "-2", "auto", "inherit", "initial", "unset", "revert", "revert-layer", "var(--space-1)", "var(--layer-missing)", "var(--layer-dialog, 999)", "calc(var(--layer-dialog) + 1)"].map(value => [value, true] as const),
])("u3295c_stylelint_accepts_only_layer_tokens_or_local_levels: %s", async (value, rejected) => {
  const result = await stylelint.lint({ code: `.fixture { z-index: ${value}; }`, codeFilename: "apps/desktop/src/layer-fixture.css", configFile });

  expect(result.errored).toBe(rejected);
  if (rejected) expect(result.results[0]?.warnings).toEqual([expect.objectContaining({ rule: "roundup/layer-token", line: 1, column: 12 })]);
});
