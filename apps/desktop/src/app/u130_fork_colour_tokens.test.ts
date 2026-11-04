import { describe, expect, it } from "vitest";

const [doc = ""] = Object.values(import.meta.glob<string>("../../../../docs/design-system.md", { query: "?raw", import: "default", eager: true }));

const [css = ""] = Object.values(import.meta.glob<string>("../tokens.css", { query: "?raw", import: "default", eager: true }));

const cells = (row: string) => row.split("|").slice(1, -1).map((c) => c.trim().replaceAll("`", ""));

const colours = doc.split("\n").filter((r) => /^\| `\w+` \| \d+°/.test(r)).map(cells);

const rgba = (v: string) => v.replace(/rgba\((\d+),(\d+),(\d+),\.(\d+)\)/, "rgba($1, $2, $3, 0.$4)");

const norm = (v: string) => rgba(v.replace(/\s+/g, " ").trim());

const hover = (band: string, alpha: string) => band.replace(/\.\d+\)$/, `${alpha})`);

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);

  return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
}

const token = (body: string, name: string) => /(?:^|\s)--NAME:\s*([^;]+);/.exec(body.replace(`--${name}`, `\n--NAME`).replace(/^[\s\S]*?(?=\n--NAME)/, ""))?.[1];

describe("u130 fork colour tokens", () => {
  it("u130_fork_colour_sets_each_define_every_accent_token", () => {
    expect(colours.map((c) => c[0])).toEqual(["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"]);

    for (const [name = "", , light = "", dark = "", fill = "", ink = "", sel = "", selDark = ""] of colours) {
      const [band = "", hov = ""] = sel.split(" / ");
      const [bandDark = "", hovDark = ""] = selDark.split(" / ");
      const root = `:root[data-fork-colour="${name}"]`;

      for (const [selector, accent, b, h] of [
        [root, light, band, hov],
        [`${root}[data-mode="light"]`, light, band, hov],
        [`${root}:not([data-mode="light"])`, dark, bandDark, hovDark],
        [`${root}[data-mode="dark"]`, dark, bandDark, hovDark],
      ] as const) {
        const body = block(selector);
        expect([name, selector, token(body, "accent")]).toEqual([name, selector, accent]);
        expect(token(body, "button-accent-fill")).toBe(fill);
        expect(token(body, "button-key-ink")).toBe(ink);
        expect(norm(token(body, "selected") ?? "")).toBe(norm(b));
        expect(norm(token(body, "selected-hover") ?? "")).toBe(norm(hover(b, h)));
      }
    }
  });
});
