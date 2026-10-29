import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openTabs } from "../header/stripFixture";
import { agent } from "../testing/nodes";
import { leaderArmed } from "./registry";

afterEach(cleanup);

it("u4690b_leader_clicks_and_keys_share_one_wait", async () => {
  await openTabs({ api: [agent("a1", "needs-you", "x")] });
  const row = document.querySelector<HTMLElement>(".rail-row")!;
  row.focus();
  await waitFor(() => expect(document.querySelector('.hint-line [data-hint="⌘K"]')).not.toBeNull());
  fireEvent.click(document.querySelector('.hint-line [data-hint="⌘K"]')!);
  expect(leaderArmed()).toBe(true);
  const choice = document.querySelector<HTMLButtonElement>('.hint-line [data-hint="K"]')!;
  fireEvent.pointerDown(choice);
  expect(leaderArmed()).toBe(true);
  fireEvent.click(choice);
  await waitFor(() => expect(document.querySelector('.switcher input')).not.toBeNull());
  expect(leaderArmed()).toBe(false);
});
