import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it("u4315a_navigation_survives_centre_switches", async () => {
  const { connected } = await mountNavigation();
  const row = screen.getByRole("navigation", { name: "Centre views" });
  for (const id of ["a0", "home", "a1", null]) {
    connected().rail.select(id);
    await waitFor(() => expect(connected().rail.selected()).toBe(id));
    expect(screen.getByRole("navigation", { name: "Centre views" })).toBe(row);
  }
});

it("u4315b_sub_links_switch_by_click_and_arrow", async () => {
  const { connected } = await mountNavigation();
  connected().rail.select("home");
  const time = await screen.findByRole("tab", { name: "Time" });
  fireEvent.click(time);
  await screen.findByRole("region", { name: "Time" });
  const timeline = screen.getByRole("tab", { name: "Timeline" });
  fireEvent.click(timeline);
  await screen.findByRole("region", { name: "Timeline" });
  timeline.focus();
  fireEvent.keyDown(timeline, { key: "ArrowLeft", code: "ArrowLeft" });
  await waitFor(() => expect(time.getAttribute("aria-selected")).toBe("true"));
  expect(document.activeElement).toBe(time);
  fireEvent.keyDown(time, { key: "ArrowRight", code: "ArrowRight" });
  await waitFor(() => expect(timeline.getAttribute("aria-selected")).toBe("true"));
  expect(document.activeElement).toBe(timeline);
  expect(connected().rail.selected()).toBe("home");
});

it.each(["a0", "home", "Time", "Timeline", "ask-history", "reactions", "made", "recovered-notes", "resources"])("u4315b_back_to_ask_clears_centre_navigation: %s", async target => {
  const { connected, daemon } = await mountNavigation();
  connected().rail.select(target === "a0" ? "a0" : "home");
  if (["Time", "Timeline"].includes(target)) fireEvent.click(await screen.findByRole("tab", { name: target }));
  else if (!["home", "a0"].includes(target)) connected().showView(target);
  const row = screen.getByRole("navigation", { name: "Centre views" });
  fireEvent.click(within(row).getByRole("button", { name: "Back to Ask" }));
  await screen.findByRole("textbox", { name: "Ask" });
  expect(connected().rail.selected()).toBeNull();
  expect(connected().view()).toBeNull();
  expect(within(row).queryByRole("button", { name: "Back to Ask" })).toBeNull();
  expect(daemon.calls.filter(call => ["agent.spawn", "terminal.open", "ask.send", "message.send"].includes(call.method))).toHaveLength(0);
});
