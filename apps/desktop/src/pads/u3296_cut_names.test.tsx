import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LONG = "a-pad-with-a-very-long-name-here-ok";

/** jsdom has no layout: a box 100 wide holds text `width` wide. */
const layout = (width: number) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(width);
};

const drawerName = async () => {
  await openShelf([padOf(LONG, USER, "x")]);
  await openPad(LONG);

  return await waitFor(() => {
    const name = document.querySelector<HTMLElement>(".pad-head-name");

    if (!name) throw new Error("drawer not ready");

    return name;
  });
};

it("u3296b_a_cut_pad_name_has_its_full_text_as_title", async () => {
  layout(400);
  await openShelf([padOf(LONG, USER)]);

  const name = await screen.findByText(LONG);

  await waitFor(() => expect(name.getAttribute("title")).toBe(LONG));
});

it("u3296b_a_cut_pad_drawer_name_has_its_full_text_as_title", async () => {
  layout(400);
  const name = await drawerName();

  await waitFor(() => expect(name.getAttribute("title")).toBe(LONG));
});

it("u3296b_a_pad_name_that_fits_has_no_title", async () => {
  layout(50);
  await openShelf([padOf(LONG, USER)]);
  const name = await screen.findByText(LONG);

  await Promise.resolve();
  expect(name.hasAttribute("title")).toBe(false);
});

it("u3296a_a_pad_name_opens_no_tooltip", async () => {
  layout(400);
  await openShelf([padOf(LONG, USER)]);
  const row = await screen.findByText(LONG);

  fireEvent.pointerMove(row, { pointerType: "mouse" });
  row.closest("button")?.focus();
  await new Promise((done) => setTimeout(done, 600));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("u3296a_a_drawer_pad_name_opens_no_tooltip", async () => {
  layout(400);
  const name = await drawerName();

  fireEvent.pointerMove(name, { pointerType: "mouse" });
  await new Promise((done) => setTimeout(done, 600));
  expect(screen.queryByRole("tooltip")).toBeNull();
});
