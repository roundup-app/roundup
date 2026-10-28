import { door } from "../testing/nodes";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it.each(["agent", "door", "workstream"])("u4453a_agent_view_mounts_only_the_terminal: %s", async kind => {
  const { connected, nodes, emulators } = await mountNavigation();
  nodes.push(door("running", "working", "Working"));
  await connected().rail.refresh();
  expect(screen.getByRole("navigation", { name: "Centre" })).toBeTruthy();
  connected().rail.select(kind === "agent" ? "a0" : kind === "door" ? "running" : "home");
  await waitFor(() => expect(connected().rail.selected()).not.toBeNull());
  await waitFor(() => expect(emulators.made.size > 0 || kind === "workstream").toBe(true));

  expect(screen.queryByRole("navigation", { name: "Centre" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Back to Ask" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Ask" })).toBeNull();

  if (kind === "workstream") {
    for (const name of ["Time", "Timeline"]) {
      fireEvent.click(await screen.findByRole("tab", { name }));
      await screen.findByRole("region", { name });
      expect(screen.queryByRole("navigation", { name: "Centre" })).toBeNull();
    }
  }

  connected().rail.select(null);
  await screen.findByRole("textbox", { name: "Ask" });
  expect(screen.getByRole("navigation", { name: "Centre" })).toBeTruthy();
});
