import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { Help } from "../keys/Help";

afterEach(cleanup);

it("u458_help_lists_shelf_selection_keys", () => {
  render(() => <><div class="pane" tabIndex={0} data-testid="pane" /><Help /></>);
  fireEvent.keyDown(screen.getByTestId("pane"), { key: "?" });
  const help = screen.getByRole("dialog", { name: "Help" });
  expect(help.textContent).toContain("⌘Enter");
  expect(help.textContent).toContain("⇧↑ / ⇧↓");
  expect(help.textContent).toContain("⌫ / Esc");
});
