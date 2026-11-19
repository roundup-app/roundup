import { cleanup, fireEvent, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { copy } from "./copy";
import { agent } from "../testing/nodes";
import { tipName } from "../ui/universalIcons";
import { mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

it("u7559_the_row_stop_button_tooltip_names_stop", async () => {
  await mountRail([agent("a", "working", "busy")]);
  const stop = within(rowOf("a")).getByRole("button", { name: "Stop" });

  fireEvent.pointerEnter(stop, { pointerType: "mouse" });
  expect((await within(document.body).findByRole("tooltip")).textContent).toBe(copy.stop);
  fireEvent.pointerLeave(stop, { pointerType: "mouse", clientX: 900, clientY: 900 });
  fireEvent.keyDown(document, { key: "Tab" });
  stop.focus();
  expect((await within(document.body).findByRole("tooltip")).textContent).toBe(copy.stop);
});

it("u7559_other_stop_buttons_keep_a_nameless_tooltip", () => {
  expect(tipName("stop", undefined, "Stop")).toBeUndefined();
});
