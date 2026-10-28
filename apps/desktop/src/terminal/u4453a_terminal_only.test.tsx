import { copy } from "../copy";
import { door } from "../testing/nodes";
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it.each(["agent", "door", "workstream"])("u4453a_agent_view_mounts_only_the_terminal: %s", async kind => {
  const { connected, nodes } = await mountNavigation();
  nodes.push(door("running", "working", "Working"));
  await connected().rail.refresh();
  connected().rail.select(kind === "agent" ? "a0" : kind === "door" ? "running" : "home");
  await waitFor(() => expect(connected().rail.selected()).not.toBeNull());

  const centre = screen.getByRole("region", { name: "Centre" });

  expect(within(centre).queryByRole("navigation")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(within(centre).queryByRole("textbox", { name: copy.askBarLabel })).toBeNull();
});
