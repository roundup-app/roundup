import { describe, expect, it } from "vitest";
import { contrastRgb, tokensOf } from "../testing/contrast";

const [doc = ""] = Object.values(import.meta.glob<string>("../../../../docs/design-system.md", { query: "?raw", import: "default", eager: true }));

const [css = ""] = Object.values(import.meta.glob<string>("../tokens.css", { query: "?raw", import: "default", eager: true }));

const others = Object.entries(import.meta.glob<string>(["../**/*.css", "!../tokens.css"], { query: "?raw", import: "default", eager: true }));

const cells = (row: string) => row.split("|").slice(1, -1).map((c) => c.trim().replaceAll("`", ""));

const rows = doc.split("\n").filter((r) => /^\| `\w+` \| \d+°/.test(r)).map(cells).map(([name = "", hue = "", light = "", dark = "", fill = "", ink = "", sel = "", selDark = ""]) => ({
  name, hue: parseInt(hue, 10), light, dark, fill, ink, band: sel.split(" / ")[0] ?? "", bandDark: selDark.split(" / ")[0] ?? "",
}));

/** Radix gray 1 and 2, the `--ground` and `--sunken` of each scheme (tokens.css `--ground: var(--gray-1)`). */
const GROUNDS = { light: ["#fcfcfc", "#f9f9f9"], dark: ["#111111", "#191919"] } as const;

const rgb = (hex: string) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });

const wash = (band: string, ground: string) => {
  const [r = 0, g = 0, b = 0, a = 0] = (/rgba\((\d+),(\d+),(\d+),\.?(\d+)\)/.exec(band.replace(/\s/g, "")) ?? []).slice(1).map(Number);
  const under = rgb(ground);
  const mix = (top: number, bottom: number) => top * (a / 100) + bottom * (1 - a / 100);

  return { r: mix(r, under.r), g: mix(g, under.g), b: mix(b, under.b) };
};

const hue = (hex: string) => {
  const { r, g, b } = rgb(hex);
  const [R, G, B] = [r / 255, g / 255, b / 255] as const;
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;

  return (h * 60 + 360) % 360;
};

describe("u130 fork colour proofs", () => {
  it("u130_fork_colour_accents_pass_d5_in_each_scheme", () => {
    expect(rows).toHaveLength(8);

    // Increased contrast redefines only lines and the grey, never an accent Token, so its values are these.
    const more = [...css.matchAll(/@media \(prefers-contrast: more\)[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");

    expect(more).not.toMatch(/--(accent|button-accent-fill|button-key-ink|selected)\b/);

    for (const c of rows) {
      for (const scheme of ["light", "dark"] as const) {
        const accent = scheme === "light" ? c.light : c.dark;
        const band = scheme === "light" ? c.band : c.bandDark;

        for (const ground of GROUNDS[scheme]) {
          expect([c.name, scheme, "text", contrastRgb(rgb(accent), rgb(ground)) >= 4.5]).toEqual([c.name, scheme, "text", true]);
          const selected = wash(band, ground);

          expect([c.name, scheme, "on band", contrastRgb(rgb(accent), selected) >= 4.5]).toEqual([c.name, scheme, "on band", true]);
        }
      }

      expect([c.name, "white on fill", contrastRgb(rgb("#ffffff"), rgb(c.fill)) >= 4.5]).toEqual([c.name, "white on fill", true]);
      expect([c.name, "key ink on fill", contrastRgb(rgb(c.ink), rgb(c.fill)) >= 4.5]).toEqual([c.name, "key ink on fill", true]);
    }
  });

  it("u130_fork_colour_accent_hue_matches_the_plate_hue", () => {
    for (const c of rows) {
      for (const tone of [c.light, c.dark, c.fill]) {
        const off = Math.abs(((hue(tone) - c.hue + 540) % 360) - 180);

        expect([c.name, tone, off <= 6]).toEqual([c.name, tone, true]);
      }
    }
  });

  it("u130_live_app_tokens_are_unchanged_by_fork_colours", () => {
    const orange = rows.find((c) => c.name === "orange")!;
    const live = tokensOf(css);

    expect([live.get("accent"), live.get("button-accent-fill"), live.get("button-key-ink")]).toEqual([orange.light, orange.fill, orange.ink]);
    expect(live.get("selected")?.replace(/\s/g, "")).toBe(orange.band.replace(/\s/g, "").replace(/\.07\)/, "0.07)"));
    // Only the Fork section at the end of tokens.css reads the attribute, and no other stylesheet does.
    expect(css.slice(0, css.indexOf("/* U130: Fork colour accents"))).not.toContain("data-fork-colour");
    expect(others.filter(([, text]) => text.includes("data-fork-colour")).map(([path]) => path)).toEqual([]);
  });
});
