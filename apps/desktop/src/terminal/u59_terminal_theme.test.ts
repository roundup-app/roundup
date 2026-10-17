import { expect, it } from "vitest";
import { xtermOptions } from "./emulator";
import { lightTerminalTheme, darkTerminalTheme, terminalThemeFor } from "./theme";

it("u59_the_emulator_theme_follows_the_scheme", () => {
  expect(terminalThemeFor(false)).toBe(lightTerminalTheme);
  expect(terminalThemeFor(true)).toBe(darkTerminalTheme);
  expect(xtermOptions.theme).toBe(lightTerminalTheme);
});
