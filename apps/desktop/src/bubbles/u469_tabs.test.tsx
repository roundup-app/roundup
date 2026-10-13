import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { bubbleCalls, mountBubbles } from "./bubblesFixture";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });
afterEach(cleanup);

it("u469_tabs_show_one_bubble_and_toggle_the_shown_one_off", async () => {
  await mountBubbles();
  await waitFor(() => expect(document.querySelectorAll('.terminal-tab')).toHaveLength(2));
  const tab = document.querySelector<HTMLButtonElement>('.terminal-tab[data-bubble="1"]')!;
  fireEvent.click(tab);
  expect(tab.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1);
  fireEvent.click(tab);
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(0);
  await waitFor(() => expect(document.activeElement).toBe(tab));
});
