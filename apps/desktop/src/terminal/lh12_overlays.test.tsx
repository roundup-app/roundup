import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { LinksView, specOf } from "../links/catalogue";
import { copy } from "../links/copy";

afterEach(cleanup);

it("lh13_the_plus_n_reveal_opens_beside_the_count_never_below_the_inset", async () => {
  const entries = Array.from({ length: 6 }, (_, n) => ({ kind: "asked" as const, url: `https://example.test/${n}`, tooltip: `asked ${n}` }));

  render(() => <LinksView spec={specOf({ entries })} env={{ editor() {}, terminal() {}, open() {} }} shown={0} />);
  fireEvent.click(screen.getByRole("button", { name: copy.moreName(8) }));

  const popover = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".links-popover");

    if (!found) throw new Error("not open");

    return found;
  });

  expect(popover.getAttribute("data-side")).toBe("left");
  expect(popover.querySelectorAll("button").length).toBe(8);
});
