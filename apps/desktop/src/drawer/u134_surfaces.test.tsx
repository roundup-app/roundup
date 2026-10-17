import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { runChecks } from "../testing/checks";
import { seedApp } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import inkCss from "../ink/styles.css?inline";
import padsCss from "../pads/styles.css?inline";
import railCss from "../rail/styles.css?inline";
import terminalCss from "../terminal/styles.css?inline";
import rowButtonCss from "../todos/rowButton.styles.css?inline";
import stripCss from "../header/strip.styles.css?inline";

const sheet = (() => {
  const style = document.createElement("style");
  style.textContent = [tokenCss, appCss, inkCss, padsCss, railCss, terminalCss, rowButtonCss, stripCss].join("\n");

  return style;
})();

afterEach(() => {
  sheet.remove();
  cleanup();
});

const openDrawer = async () => {
  document.head.prepend(sheet);
  const controls = seedApp("tree-40", Date.now());
  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);

  // A full button-role query computes styles across the tree; U441 adds scoped rules to that scan.
  const todo = await waitFor(() => {
    const row = document.querySelector<HTMLButtonElement>('[data-todo="5"] .todo-row-button');

    expect(row).not.toBeNull();

    return row!;
  });

  fireEvent.click(todo);
  await waitFor(() => expect(document.querySelector('aside[aria-label="Drawer"][data-open="true"] .todo-detail')).not.toBeNull());

  return screen.getByRole("complementary", { name: "Drawer" });
};

// Fixture setup and computed-style reads can exceed 5 s under full-suite load
// (#1496; full-tree scans also exceeded 5 s in CI run 38321010723). Bound each
// observer at 30 s without extending the application waits in openDrawer or waitFor.
describe("u134 surfaces and depth", () => {
  it("u134_no_border_is_wider_than_1px_or_any_colour_but_hairline", async () => {
    await openDrawer();

    expect(runChecks().D8.status).toBe("pass");
  }, 30_000);
});
