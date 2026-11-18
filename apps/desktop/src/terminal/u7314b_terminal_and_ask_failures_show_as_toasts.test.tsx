import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { flush } from "solid-js";
import { RpcError } from "../app/seam";
import { info, node } from "../testing/nodes";
import { notice, notices } from "../testing/notices";
import { mountPane } from "./paneHarness";

afterEach(cleanup);

it("u7314b_terminal_and_ask_failures_show_as_toasts", async () => {
  const { app, connected } = await mountPane([node("a")], [info("t-a")]);

  const pane = () => {
    const found = document.querySelector(".pane");

    if (!found) throw new Error("no pane");

    return found;
  };

  const order = () => [...pane().querySelectorAll(".pane-origin > *, .pane-origin")].map(element => element.className);

  const lines = () => [...document.querySelectorAll(".reserved-line:not([data-empty='true'])")].filter(line => !line.closest(".app-toasts"));

  const before = order();

  app.outputFailure = new RpcError(-32603, "channel refused");
  connected.rail.select("a");
  flush();
  const shown = await screen.findByRole("alert", { name: /channel refused/ });
  const region = screen.getByRole("region", { name: "Updates" });
  expect(notices("alert")).toEqual([shown]);
  expect(region.contains(shown)).toBe(true);
  within(region).getByRole("button", { name: "Dismiss" });
  expect(lines()).toHaveLength(0);
  expect(pane().querySelector(".pane-failure")).toBeNull();
  expect(order()).toEqual(before);

  fireEvent.click(within(region).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(order()).toEqual(before);
  expect(notice).toBeTypeOf("function");
});
