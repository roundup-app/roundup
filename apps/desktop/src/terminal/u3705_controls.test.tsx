import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { fireEvent, mountSend, screen } from "./sendHarness";
import { mountSwitcher } from "../switcher/switcherFixture";

afterEach(cleanup);

it("u3705_controls_have_names_and_tooltips", async () => {
  const view = await mountSend([agent("d", "done", "finished")]);

  view.emulator.select("ls");

  const send = await screen.findByRole("button", { name: "Send to agent" });

  fireEvent.pointerMove(send);
  expect((await screen.findByRole("tooltip")).textContent).toBe("No running agent");
  expect(send.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
});

it("u3705_copy_is_catalogued", async () => {
  await mountSwitcher("ann");
  await waitFor(() => expect(document.querySelector(".pane-control[data-state=managed]")).not.toBeNull());

  const take = screen.getByRole("button", { name: "Take control" });

  expect(take.hasAttribute("title")).toBe(false);
  expect(document.querySelector(".pane-control[data-state=managed]")?.textContent).not.toMatch(/takeover/i);
  fireEvent.click(take);
  await waitFor(() => expect(screen.getByRole("button", { name: "Give control back" })).not.toBeNull());
  expect(document.querySelector(".pane")?.textContent).not.toMatch(/takeover/i);
});
