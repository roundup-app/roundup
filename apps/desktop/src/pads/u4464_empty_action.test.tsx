import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { copy } from "../copy";
import { afterEach, expect, it } from "vitest";
import { openShelf } from "./padsFixture";

afterEach(cleanup);

it("u4464_empty_actions_do_what_the_existing_buttons_do_pad", async () => {
  await openShelf([]);
  const empty = await screen.findByRole("group", { name: "No Pads yet" });
  expect(within(empty).getByText(copy.emptyPadsLine)).toBeTruthy();
  fireEvent.click(within(empty).getByRole("button", { name: "+ Pad" }));
  const field = await screen.findByRole("textbox", { name: /name/i });
  expect(document.activeElement).toBe(field);
});
