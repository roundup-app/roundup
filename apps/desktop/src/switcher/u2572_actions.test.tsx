import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, info, workstream } from "../testing/nodes";
import { field, mountSwitcher, openSwitcher } from "./switcherFixture";

afterEach(cleanup);

it("u2572a_searches_destinations_then_grouped_actions", async () => {
  await mountSwitcher("ws", [
    workstream("ws", { name: "new-onboarding" }),
    agent("a", "idle", "idle", { parent: "ws", name: "renew-token" }),
    agent("b", "idle", "idle", { parent: "ws", name: "New Agent" }),
  ], [info("7", { owner: "ws", title: "new-shell" })]);
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());
  fireEvent.input(field()!, { target: { value: " NeW " } });
  await waitFor(() => expect([...document.querySelectorAll('.switcher [role="option"]')].map((row) => row.querySelector('.switcher-name')?.textContent)).toEqual([
    "new-onboarding", "renew-token", "New Agent", "new-shell", "New Agent", "New Agent with a prompt", "New Terminal",
  ]));
  expect(document.querySelector('.switcher [role="group"]')?.getAttribute("aria-labelledby")).toBeTruthy();
});
