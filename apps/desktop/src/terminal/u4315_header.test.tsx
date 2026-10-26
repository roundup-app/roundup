import { agent, door } from "../testing/nodes";
import { openProjectPage } from "../testing/menuProbe";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it("u4315a_navigation_survives_centre_switches", async () => {
  const { connected, nodes } = await mountNavigation();
  nodes.push(agent("closed", "done", "", { terminal_id: null }));
  nodes.push(door("running", "working", "Working"));
  await connected().rail.refresh();
  const row = screen.getByRole("navigation", { name: "Centre views" });

  for (const id of ["a0", "running", "home", "closed", null]) {
    connected().rail.select(id);
    await waitFor(() => expect(connected().rail.selected()).toBe(id));
    expect(screen.getByRole("navigation", { name: "Centre views" })).toBe(row);

    if (id === "home" || id === "running") {
      for (const name of ["Time", "Timeline"]) {
        fireEvent.click(await screen.findByRole("tab", { name }));
        await screen.findByRole("region", { name });
        expect(screen.getByRole("navigation", { name: "Centre views" })).toBe(row);
      }
    }
  }
});


it.each(["a0", "home", "Time", "Timeline", "ask-history", "reactions", "made", "notes", "resources"])("u4315b_back_to_ask_clears_centre_navigation: %s", async target => {
  const { connected, daemon } = await mountNavigation();
  connected().rail.select(target === "a0" ? "a0" : "home");

  if (["Time", "Timeline"].includes(target)) fireEvent.click(await screen.findByRole("tab", { name: target }));
  else if (!["home", "a0"].includes(target)) connected().showView(target);
  const row = screen.getByRole("navigation", { name: "Centre views" });
  fireEvent.click(within(row).getByRole("button", { name: "Back to Ask" }));
  await screen.findByRole("textbox", { name: "Ask" });
  expect(connected().rail.selected()).toBeNull();
  expect(connected().view()).toBeNull();
  expect(within(row).queryAllByRole("button")).toHaveLength(0);
  expect(daemon.calls.filter(call => ["agent.spawn", "terminal.open", "ask.send", "message.send"].includes(call.method))).toHaveLength(0);
});

it.each(["project-settings", "import-work", "app-settings"])("u4315a_requested_screens_share_navigation: %s", async command => {
  const { connected } = await mountNavigation();
  const row = screen.getByRole("navigation", { name: "Centre views" });
  connected().rail.select("a0");

  if (command === "app-settings") window.dispatchEvent(new Event("open-app-settings"));
  else openProjectPage(command, "/p");
  const name = command === "project-settings" ? "Project settings" : command === "import-work" ? "Import Claude Code work" : "Settings";
  const view = await screen.findByRole("region", { name });
  expect(screen.getByRole("navigation", { name: "Centre views" })).toBe(row);
  expect(view.querySelector(".settings-head")).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "Back to Ask" }));
  await waitFor(() => expect(screen.queryByRole("region", { name })).toBeNull());
  expect(connected().rail.selected()).toBeNull();
  await screen.findByRole("textbox", { name: "Ask" });
});

it.each(["a0", "Time", "Timeline", "ask-history"])("u4315b_back_to_ask_preserves_unsubmitted_work: %s", async target => {
  const { connected, daemon } = await mountNavigation();
  const draft = "  Keep this exact draft\nfor my original Project 🦉";
  fireEvent.input(screen.getByRole("textbox", { name: "Ask" }), { target: { value: draft } });
  connected().rail.select(target === "a0" ? "a0" : "home");

  if (target === "Time" || target === "Timeline") fireEvent.click(await screen.findByRole("tab", { name: target }));

  if (target === "ask-history") connected().showView(target);
  fireEvent.click(within(screen.getByRole("navigation", { name: "Centre views" })).getByRole("button", { name: "Back to Ask" }));
  const field = await screen.findByRole("textbox", { name: "Ask" });

  if (!(field instanceof HTMLTextAreaElement)) throw new Error("Ask must be editable");
  expect(field.value).toBe(draft);
  expect(connected().project.path).toBe("/p");
  expect(daemon.calls.filter(call => ["ask.send", "message.send"].includes(call.method))).toHaveLength(0);
});
