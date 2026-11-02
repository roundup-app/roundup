import { createRoot } from "solid-js";
import { lazyEmulators } from "./lazyEmulator";
import { createScreens } from "./screens";
import { connectFakeProject, fakeEmulators } from "./paneHarness";
import { cleanup } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { callsTo, mountPane } from "./paneHarness";
import { info, terminal } from "../testing/nodes";

afterEach(cleanup);

it.each(["other-terminal", "field", "hidden"])("u5552b_unfocused_terminal_cannot_write %s", async (destination) => {
  const { app, connected, emulators, container } = await mountPane([terminal("a"), terminal("b")], [info("t-a"), info("t-b")]);
  connected.rail.select("a");
  const former = emulators.get("t-a")!;
  connected.rail.select("b");
  const current = emulators.get("t-b")!;

  if (destination === "field") {
    connected.rail.select("a");
    const field = document.createElement("textarea");
    container.append(field);
    field.focus();
  } else if (destination === "hidden") connected.rail.select("a");

  (destination === "hidden" ? current : former).type(new TextEncoder().encode("wrong"));
  expect(callsTo(app, "terminal.write")).toEqual([]);

  if (destination !== "other-terminal") connected.rail.select("b");
  current.focus();
  current.type(new TextEncoder().encode("right"));
  expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-b", data: "cmlnaHQ=" }]);
});


it("u5552b_loading_restored_emulators_cannot_replace_the_latest_destination", async () => {
  const { connected, app } = await connectFakeProject([terminal("a"), terminal("b")], [info("t-a"), info("t-b")]);
  const load = Promise.withResolvers<ReturnType<typeof fakeEmulators>["factory"]>();
  const { factory, made } = fakeEmulators();
  const lazy = lazyEmulators(() => load.promise);
  const { screens, dispose } = createRoot(dispose => ({ screens: createScreens(connected, lazy), dispose }));
  const host = document.createElement("div");
  document.body.append(host);
  screens.show("t-a", host);
  screens.hide("t-a");
  screens.show("t-b", host);
  screens.hide("t-b");
  screens.show("t-a", host);
  load.resolve(factory);
  await screens.emulatorFor("t-b").ready;
  expect(document.activeElement?.closest<HTMLElement>("[data-terminal]")?.dataset.terminal).toBe("t-a");
  made.get("t-b")!.type(new TextEncoder().encode("wrong"));
  made.get("t-a")!.type(new TextEncoder().encode("right"));
  expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: "cmlnaHQ=" }]);
  screens.dispose(); dispose(); host.remove();
});
