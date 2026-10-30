import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { bubbleNames, mountBubbles, TERMINALS } from "./bubblesFixture";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(cleanup);

const screens = () => [...document.querySelectorAll<HTMLElement>("[data-terminal]")].flatMap((screen) => (screen.closest(".bubble") ? [] : [screen.dataset.terminal]));

it("u467_bubbles_keep_their_owners_over_the_door_terminal", async () => {
  const { connected } = await mountBubbles("w");

  await waitFor(() => expect(bubbleNames()).toEqual(["zsh"]));
  connected.rail.select("a");
  await waitFor(() => expect(bubbleNames()).toEqual(["cargo test", "zsh"]));
  expect(screens()).toEqual(["t-a"]);
  expect(screen.getByRole("group", { name: TERMINALS[0]!.title! })).toBeTruthy();

  connected.rail.select("other");
  await waitFor(() => expect(bubbleNames()).toEqual([]));

  connected.rail.select("w");
  await waitFor(() => expect(bubbleNames()).toEqual(["zsh"]));
});
