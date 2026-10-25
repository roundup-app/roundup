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

// Token -> light value, from the table's Light column and the prose lines under it (type and space steps).
const expectedLight = new Map<string, string>();

for (const row of rows) {
  const cells = row.split("|");
  const names = cells[1]?.match(/--[\w-]+/g) ?? [];
  const values = [...(cells[2] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");

  names.forEach((name, index) => expectedLight.set(name, values[index] ?? ""));
}

for (const [, name, value] of table.matchAll(/`(--font-[\w-]+)` is `([^`]+)`/g)) expectedLight.set(name ?? "", value ?? "");

for (const [, name, size] of table.matchAll(/`(--text-[\w-]+)` (\d+)/g)) expectedLight.set(name ?? "", `${size}px`);

const steps = /`--space-1` to `--space-6` are ([\d, ]+) px/.exec(table)?.[1]?.split(",") ?? [];

steps.forEach((step, index) => expectedLight.set(`--space-${index + 1}`, `${step.trim()}px`));

// Spelling only: case, spaces, a bare leading dot and trailing zeros differ between the table and CSS; hex colours compare as written.
const normalised = (value: string) =>
  value.startsWith("#") ? value.toLowerCase() : value.toLowerCase().replace(/\s+/g, "").replace(/\d*\.?\d+/g, (number) => String(Number(number)));

// Tokens whose light value is knowingly not the table's yet. Slice 2 of U130 moved `--text` to the table's
// `#1d1d1f` and deleted its entry; a later slice may add one.
const KNOWN_DIFFERENCES = new Map<string, string>();

function valueOf(section: string, token: string): string | undefined {
  return section.match(new RegExp(`(?:^|[\\s;{])${token}:\\s*([^;\\s][^;]*);`))?.[1];
}

describe("u130 tokens", () => {




  it("u130_every_token_has_the_tables_light_value_except_the_named_differences", () => {
    const css = Object.values(import.meta.glob<string>("../tokens.css", { query: "?raw", import: "default", eager: true }))[0] ?? "";

    const wrong = [...expectedLight].filter(
      ([name, value]) => normalised(valueOf(css, name) ?? "") !== normalised(KNOWN_DIFFERENCES.get(name) ?? value),
    );

    expect(wrong, "Tokens whose light value is not the table's").toEqual([]);

    for (const [name, difference] of KNOWN_DIFFERENCES)
      expect(normalised(difference), `the named difference for ${name} is real, or the entry goes`).not.toBe(
        normalised(expectedLight.get(name) ?? ""),
      );
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
