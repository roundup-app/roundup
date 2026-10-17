import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import appCss from "../styles.css?inline";
import tokenCss from "../tokens.css?raw";

const [guide = ""] = Object.values(import.meta.glob<string>("../../../../docs/design-system.md", { query: "?raw", import: "default", eager: true }));

const KINDS = ["primary", "quiet", "add", "row-action", "icon"];

/** The Milkdown editor builds its own toolbar buttons; `buttons.css` styles them by their place, they carry no kind. */
const MILKDOWN = ".milkdown";

const shell = (() => {
  const sheet = document.createElement("style");
  sheet.textContent = `${tokenCss}\n${appCss}`;

  return sheet;
})();

afterEach(() => {
  shell.remove();
  cleanup();
});

// U170 checks attributes on the full App; readiness queries must not compute every button's style.
const mountEverything = async () => {
  document.head.prepend(shell);
  const controls = seedApp("tree-40", Date.now());
  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);

  const todo = await waitFor(() => {
    const row = document.querySelector<HTMLButtonElement>('[data-todo="5"] .todo-row-button');

    expect(document.querySelector('[role="treeitem"]')).not.toBeNull();
    expect(row).not.toBeNull();

    return row!;
  });

  fireEvent.click(todo);
  await waitFor(() => expect(document.querySelector('aside[aria-label="Drawer"][data-open="true"] .todo-detail')).not.toBeNull());
};

/** A row is not a button (U170): a Rail `treeitem` row, a Shelf row and a Todo's title. */
const isRow = (el: Element) => (el.getAttribute("role") === "treeitem" && el.hasAttribute("data-id")) || el.matches(".rail-row[data-id]") || el.matches(".pad-name, .todo-row-button") || el.closest(MILKDOWN) !== null;

describe("u170 button kinds", () => {
  it("u170_every_button_carries_one_kind_and_a_row_carries_none", async () => {
    await mountEverything();
    const targets = [...document.querySelectorAll("button, [role=button], [role=treeitem]")];
    const buttons = targets.filter((el) => el.tagName === "BUTTON" || el.getAttribute("role") === "button");

    expect(buttons.length).toBeGreaterThan(15);

    for (const el of buttons) {
      const name = `${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20)} (${el.className})`;

      if (isRow(el)) expect(el.hasAttribute("data-button"), name).toBe(false);
      else expect(KINDS, name).toContain(el.getAttribute("data-button"));
    }

    for (const row of targets.filter((el) => el.tagName !== "BUTTON" && el.hasAttribute("data-id"))) expect(row.hasAttribute("data-button")).toBe(false);

    // `primary` is the Door's start action of an empty pane; this screen holds the other four.
    expect(new Set(buttons.flatMap((el) => el.getAttribute("data-button") ?? []))).toEqual(new Set(KINDS.filter((kind) => kind !== "primary")));
  });

  it("u170_the_new_tokens_are_in_the_table_with_a_light_and_a_dark_value", () => {
    for (const token of ["--pressed", "--disabled"]) {
      expect(guide, token).toMatch(new RegExp(`\\| \`${token}\` \\| [^|]+ \\| [^|]+ \\|`));
      const roots = [...tokenCss.matchAll(/:root\s*\{([^}]*)\}/g)].map((block) => block[1]).join("\n");

      expect(roots.match(new RegExp(`${token}:`, "g")), token).toHaveLength(2);
    }
  });
});
