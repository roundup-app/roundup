import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { copy } from "../ink/copy";
import { field, mountSwitcher, openSwitcher } from "./switcherFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u5231a_switcher_row_reveals_reason_and_age", async () => {
  const blocked = agent("bl", "needs-you", "Waiting for approval", { name: "Bea", status: { kind: "needs-you", label: "Waiting for approval", since: Date.now() - 12 * 60_000, finished: "0" } });

  await mountSwitcher(null, [blocked]);
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());

  const name = [...document.querySelectorAll<HTMLElement>(".switcher .switcher-row")].find(row => row.textContent?.includes("Bea"))!;

  // The first move names the row as the Tooltip's owner inside the modal; the next opens it.
  fireEvent.pointerMove(name, { pointerType: "mouse" });
  fireEvent.pointerMove(name, { pointerType: "mouse" });
  expect((await screen.findByRole("tooltip", { hidden: true })).textContent).toBe(copy.statusReveal("Waiting for approval", copy.statusAge.minutes(12)));
});
