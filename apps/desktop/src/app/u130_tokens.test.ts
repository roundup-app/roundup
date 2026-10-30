import { describe, expect, it } from "vitest";
import { inlineStyleCss, lookLiterals } from "../testing/lookLiterals";

const [table = ""] = Object.values(
  import.meta.glob<string>("../../../../docs/design-system.md", { query: "?raw", import: "default", eager: true }),
);

// The Tokens of the "Starting values" table, read from it so a Token added there fails here until tokens.css defines it.
const TOKENS = table
  .split("\n")
  .filter((row) => row.startsWith("| `--"))
  .flatMap((row) => row.split("|")[1]?.match(/--[\w-]+/g) ?? []);

const rows = table.split("\n").filter((row) => row.startsWith("| `--"));

function valueOf(section: string, token: string): string | undefined {
  return section.match(new RegExp(`(?:^|[\\s;{])${token}:\\s*([^;\\s][^;]*);`))?.[1];
}

describe("u130 tokens", () => {

  it("u130_every_documented_token_has_a_light_definition", () => {
    const css = Object.values(import.meta.glob<string>("../tokens.css", { query: "?raw", import: "default", eager: true }))[0] ?? "";
    const light = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

    expect(TOKENS.filter(token => !valueOf(light, token))).toEqual([]);
  });

  it("u130_main_and_the_harness_import_tokens_css_before_styles_css", () => {
    const entries = import.meta.glob<string>(["../main.tsx", "../testing/harness.tsx"], { query: "?raw", import: "default", eager: true });

    const positions = Object.values(entries).map((code) => [code.search(/import "\.{1,2}\/tokens\.css"/), code.search(/import "\.{1,2}\/styles\.css"/)]);

    expect(positions).toHaveLength(2);
    expect(positions.map(([tokens = -1, styles = -1]) => tokens >= 0 && tokens < styles)).toEqual([true, true]);
  });

  it("u130_every_token_has_a_dark_value", () => {
    const css = Object.values(import.meta.glob<string>("../tokens.css", { query: "?raw", import: "default", eager: true }))[0] ?? "";
    const dark = /@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    // A Token whose table cell reads the same in both columns is defined once, in the light block.
    const differing = rows.filter((row) => row.split("|")[3]?.trim() !== "same").flatMap((row) => row.split("|")[1]?.match(/--[\w-]+/g) ?? []);

    expect(differing).toEqual(expect.arrayContaining(["--ground", "--elevation-contact", "--elevation-ambient", "--elevation-ring"]));
    expect(differing.filter((token) => !valueOf(dark, token)), "Tokens missing a dark value").toEqual([]);
  });

  it("u130_styles_css_does_not_shadow_a_shared_token", () => {
    const files = import.meta.glob<string>("../styles.css", {
      query: "?raw",
      import: "default",
      eager: true,
    });

    const css = Object.values(files)[0];
    expect(css, "styles.css is read").toBeTruthy();

    const shadowed = TOKENS.filter((token) => valueOf(css!, token));

    expect(shadowed, "tokens.css's values must not be shadowed in styles.css").toEqual([]);
  });

  it("u130_no_look_literal_outside_tokens_css", () => {
    const sheets = import.meta.glob<string>(["../**/*.css", "!../tokens.css"], { query: "?raw", import: "default", eager: true });

    const sources = import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../testing/**", "!../terminal/emulator.ts"], {
      query: "?raw",
      import: "default",
      eager: true,
    });

    expect(Object.keys(sheets).length, "stylesheets are read").toBeGreaterThan(8);
    expect(Object.keys(sources).length, "components are read").toBeGreaterThan(20);
    expect([
      ...Object.entries(sheets).flatMap(([path, css]) => lookLiterals(css).map((literal) => `${path}: ${literal}`)),
      ...Object.entries(sources).flatMap(([path, source]) => lookLiterals(inlineStyleCss(source)).map((literal) => `${path}: ${literal}`)),
    ]).toEqual([]);
  });
});
