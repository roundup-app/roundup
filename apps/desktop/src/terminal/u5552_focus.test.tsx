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
    const field = document.createElement("textarea");
    container.append(field);
    field.focus();
  } else if (destination === "hidden") connected.rail.select("a");

  (destination === "hidden" ? current : former).type(new TextEncoder().encode("wrong"));
  expect(callsTo(app, "terminal.write")).toEqual([]);
  current.focus();

  if (destination === "hidden") connected.rail.select("b");
  current.type(new TextEncoder().encode("right"));
  expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-b", data: "cmlnaHQ=" }]);
});
