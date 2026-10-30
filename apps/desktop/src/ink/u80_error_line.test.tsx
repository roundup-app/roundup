import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";
import { ResourceStrip } from "../resources/ResourceStrip";
import { ErrorLine } from "./ErrorLine";

afterEach(cleanup);

it("u80_a_failure_announces_one_line_and_keeps_the_whole_message_in_its_tooltip", async () => {
  const failure = new Error("could not open\r\ndetails\nlast line");
  const message = failure.message;

  render(() => <ErrorLine message={message} />);
  const line = screen.getByRole("alert");

  expect(line.textContent).toBe(message.split(/\r\n|[\r\n]/, 1)[0]);
  expect(line.hasAttribute("title")).toBe(false);
  fireEvent.pointerMove(line, { pointerType: "mouse", clientX: 0, clientY: 0 });
  expect((await screen.findByRole("tooltip")).textContent).toBe(message);
  fireEvent.pointerLeave(line, { pointerType: "mouse" });
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  fireEvent.keyDown(document, { key: "Tab" });
  line.focus();
  expect((await screen.findByRole("tooltip")).textContent).toBe(message);
});

it("u501_resource_tooltip_preserves_the_full_label", async () => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => [agent("a", "working", "building")];
  app.handlers["project.resources"] = () => ({ agents: [{ id: "a", memory_bytes: 412e6, cpu_percent: 18, disk_bytes: 2.1e9 }], total: { memory_bytes: 412e6, cpu_percent: 18, disk_bytes: 2.1e9 } });
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0, () => null);

  connected.showView("resources");
  connected.rail.select("a");
  const { container } = render(() => <ConnectedProjectContext.Provider value={connected}><ResourceStrip /></ConnectedProjectContext.Provider>);
  await waitFor(() => expect(container.querySelectorAll(".resource-value")).toHaveLength(3));
  const value = container.querySelector<HTMLElement>(".resource-value")!;
  const label = value.querySelector(".resource-name")!.textContent;

  expect(label).toMatch(/\S/);
  fireEvent.pointerMove(value, { pointerType: "mouse", clientX: 0, clientY: 0 });
  expect((await screen.findByRole("tooltip")).textContent).toBe(label);
});
