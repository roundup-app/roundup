import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { field, mountSwitcher, openSwitcher } from "./switcherFixture";

afterEach(cleanup);

it("u2228c_inbox_and_switcher_rows_open_no_tooltip", async () => {
  await mountSwitcher();
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());

  const rows = document.querySelectorAll<HTMLElement>(".switcher .switcher-row");

  expect(rows.length).toBeGreaterThan(0);

  for (const row of rows) {
    fireEvent.pointerMove(row, { pointerType: "mouse" });
    row.focus();
  }

  await new Promise((done) => setTimeout(done, 600));
  expect(screen.queryByRole("tooltip")).toBeNull();
});
