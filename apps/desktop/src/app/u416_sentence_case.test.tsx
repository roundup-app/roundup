import { cleanup, fireEvent } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, pinnedAdd, rowOf } from "../rail/railFixture";

afterEach(cleanup);

/** GLOSSARY.md terms that keep their capital inside a phrase (U416). */
const TERMS = new Set(["Workstream", "Agent", "Pad", "Door", "Rail", "Daemon", "Todo", "Shelf", "Drawer", "Takeover", "Terminal"]);

/** D15's measure on one label: a capital first, and no later word capitalised unless a term or the first word after a colon. */
const isSentenceCase = (label: string): boolean => {
  const words = label.replace(/^\+\s*/, "").split(/\s+/).filter(Boolean);
  const first = words[0];

  if (first === undefined || !/^[\p{Lu}\d]/u.test(first)) return false;

  return words.slice(1).every((word, at) => {
    const bare = word.replace(/[^\p{L}]/gu, "");
    const afterColon = words[at]?.endsWith(":") === true;

    return bare === "" || !/^\p{Lu}/u.test(bare) || TERMS.has(bare) || afterColon;
  });
};

/** The names of the Rail's buttons and open menu items, as a reader or a screen reader meets them. Rail rows are names, exempt. */
const names = (): string[] =>
  [...document.querySelectorAll<HTMLElement>(".rail button, .rail-actions button, [role=menuitem], [role=menu]")].flatMap((each) => {
    const label = each.getAttribute("aria-label") ?? each.textContent?.trim() ?? "";

    return label === "" ? [] : [label];
  });

describe("u416 every word the App writes is in sentence case", () => {
  it("u416_every_label_on_the_seeds_is_sentence_case", async () => {
    await mountRail([workstream("g"), agent("a", "working", "busy", { parent: "g" })]);
    fireEvent.contextMenu(rowOf("a"), { clientX: 10, clientY: 10 });

    const labels = names();

    expect(labels.length).toBeGreaterThan(3);
    expect(labels.filter((label) => !isSentenceCase(label))).toEqual([]);
  });

  it("u416_a_glossary_term_keeps_its_capital_in_a_phrase", () => {
    expect([isSentenceCase("Add Agent"), isSentenceCase("Starting Door…"), isSentenceCase("Take Over")]).toEqual([true, true, false]);
  });

  it("u416_a_workstream_named_workstream_stays_lower_case", async () => {
    await mountRail([workstream("workstream")]);

    expect(rowOf("workstream").textContent).toContain("workstream");
  });

  it("u416_the_rail_add_reads_plus_workstream", async () => {
    await mountRail([]);

    expect([pinnedAdd().textContent?.trim(), pinnedAdd().getAttribute("aria-label")]).toEqual(["Workstream", "Add Workstream"]);
  });
});
