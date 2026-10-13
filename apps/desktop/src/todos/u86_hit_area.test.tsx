import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { mountTodos, todo } from "./testHarness";

import styles from "./rowButton.styles.css?inline";
import appStyles from "../styles.css?inline";

const sheet = document.createElement("style");

// jsdom does not apply :focus-visible; the browser measures keyboard focus with the original selector.
sheet.textContent = `${styles}\n${appStyles}`.replaceAll(":focus-visible", ":focus");

beforeEach(() => document.head.appendChild(sheet));

afterEach(() => {
  cleanup();
  sheet.remove();
});

it("u86_todo_rows_keep_the_hit_area_token_after_the_button_reset", async () => {
  await mountTodos([todo(1), todo(2, { done: true })]);

  const folded = await screen.findByRole("button", { name: "1 done" });
  fireEvent.click(folded);

  // jsdom has no layout; the browser proof measures the token's 24px hit height. An open row is 28px high with its padding (U359).
  expect(getComputedStyle(screen.getByRole("button", { name: "Idle #1 todo 1" })).minHeight).toBe("var(--space-5)");

  for (const row of [folded, screen.getByRole("button", { name: "Done #2 todo 2" })]) {
    expect(getComputedStyle(row).minHeight).toBe("var(--space-5)");
  }
});

it("u86_todo_rows_allow_a_visible_focus_outline_after_the_button_reset", async () => {
  await mountTodos([todo(1), todo(2, { done: true })]);

  for (const row of [
    await screen.findByRole("button", { name: "Idle #1 todo 1" }),
    screen.getByRole("button", { name: "1 done" }),
  ]) {
    row.focus();
    // jsdom caches computed styles before focus when native inputs are present;
    // reattaching the same sheet invalidates that cache without changing rules.
    sheet.remove();
    document.head.appendChild(sheet);
    expect([getComputedStyle(row).outlineWidth, getComputedStyle(row).outlineStyle, getComputedStyle(row).outlineColor, getComputedStyle(row).outlineOffset]).toEqual(["2px", "solid", "var(--accent)", "1px"]);
    expect(row.style.all).toBe("");
  }
});
