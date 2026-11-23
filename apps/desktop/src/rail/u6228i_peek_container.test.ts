import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const rules = (css: string) => [...css.matchAll(/(?<=^|[{}])\s*([^{}@;]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1].trim(), body: match[2] }));

describe("U6228i", () => {
  it("u6228i_a_peeked_rail_queries_measure_the_peek_width_not_the_strip", () => {
    const railStyles = rules(read("./styles.css"));
    const holders = railStyles.filter(rule => /container(-name|-type)?:/.test(rule.body) && /rail\b/.test(rule.body)).map(rule => rule.selector);
    expect(holders).toEqual([".rail-body"]);
    const layout = rules(read("../styles.css"));
    const peeked = layout.find(rule => rule.selector === ".rail[data-collapsed] .rail-body");
    expect(peeked?.body).toContain("width: var(--rail-peek-width)");
  });
});
