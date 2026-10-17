import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream, USER } from "../testing/nodes";
import { itemOf, mountRail, pinnedAdd, rowOf } from "../rail/railFixture";
import { openPad, openShelf, padOf, AGENT } from "../pads/padsFixture";
import { mountTodos, todo } from "../todos/testHarness";
import { resolveToken, tokensFrom, withStylesheets } from "../testing/contrast";
import tokens from "../tokens.css?raw";
import styles from "./styles.css?inline";
import buttonStyles from "../buttons.css?inline";

afterEach(cleanup);

const vector = (element: Element, name: string) => {
  const svg = element.querySelector(`svg.lucide-${name}`);
  expect(svg).not.toBeNull();
  expect(svg?.getAttribute("aria-hidden")).toBe("true");
};

it("u86_disclosure_uses_vectors_and_preserves_expansion", async () => {
  await mountRail([workstream("topic")]);
  const button = screen.getByRole("button", { name: "Collapse" });
  vector(button, "chevron-down");
  fireEvent.click(button);
  vector(button, "chevron-right");
  expect(itemOf("topic").getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(itemOf("topic").getAttribute("aria-expanded")).toBe("true");
});

it("u86_rail_add_actions_keep_their_names", async () => {
  const mounted = await mountRail([workstream("g")]);
  mounted.rail.select("g");

  vector(pinnedAdd(), "plus");

  vector(screen.getByLabelText("Add Agent"), "plus");
});

it("u86_todo_add_and_drawer_close_are_named_vector_actions", async () => {
  await mountTodos([todo(1)]);
  const add = screen.getByRole("button", { name: "Add Todo" });
  vector(add, "plus");
  fireEvent.click(add);
  expect(screen.getByRole("textbox", { name: "New Todo title" })).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: /todo 1/ }));
  const drawer = screen.getByLabelText("Drawer");
  vector(within(drawer).getByRole("button", { name: "Close" }), "x");
  vector(await within(drawer).findByRole("button", { name: "Blocker" }), "plus");
  expect(drawer.contains(document.activeElement)).toBe(true);
});

it("u86_pad_ownership_and_add_use_vectors_without_duplicate_drawer_names", async () => {
  await openShelf([padOf("notes", AGENT), padOf("draft", USER)]);
  vector(screen.getByRole("button", { name: "Add Pad" }), "plus");
  vector(screen.getByRole("button", { name: "Make notes yours" }), "diamond-plus");
  vector(screen.getByRole("img", { name: "User owned" }), "diamond");
  await openPad("notes");
  const drawer = screen.getByLabelText("Drawer");
  expect(within(drawer).queryByRole("img", { name: "Agent owned" })).toBeNull();
  vector(drawer, "diamond-plus");
});

it("u86_rail_marks_share_the_disclosures_scan_line_when_selected", async () => {
  const sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = `${styles}\n${buttonStyles}`;

  try {
    await withStylesheets(async () => {
      const { rail } = await mountRail([workstream("topic"), agent("a", "working", "w")]);
      const values = tokensFrom(tokens);

      for (const name of ["topic", "a"]) {
        const row = rowOf(name);

        for (const selected of [false, true]) {
          if (selected) rail.select(name);

          expect(itemOf(name).getAttribute("aria-selected")).toBe(String(selected));
          const band = getComputedStyle(row);
          const line = getComputedStyle(row.querySelector(".line")!);
          const icon = getComputedStyle(row.querySelector("svg")!);
          const mark = getComputedStyle(row.querySelector(".line > button, .line > .glyph")!);

          expect(resolveToken(band.minHeight, values)).toBe("32px");
          expect(resolveToken(line.minHeight === "inherit" ? band.minHeight : line.minHeight, values)).toBe("32px");
          expect(line.display).toBe("flex");
          expect(line.alignItems).toBe("center");
          expect([icon.width, icon.height].map((value) => resolveToken(value, values))).toEqual(["16px", "16px"]);
          // U402: an Agent's Glyph is its 16 px box, left-aligned on the Glyph column; the chevron is a 16 px wide, 24 px tall icon button.
          expect(resolveToken(name === "topic" ? mark.minWidth : mark.width, values)).toBe("16px");

          if (name === "topic") expect(mark.justifyContent).toBe("center");

          if (name === "topic") expect(resolveToken(mark.minHeight, values)).toBe("24px");
        }
      }
    });
  } finally {
    sheet.remove();
  }
});
