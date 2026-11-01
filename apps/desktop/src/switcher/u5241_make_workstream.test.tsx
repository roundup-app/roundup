import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { door, workstream } from "../testing/nodes";
import { field, mountSwitcher, openSwitcher, switcherKey } from "./switcherFixture";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

const search = async (text: string) => {
  await waitFor(() => expect(field()).not.toBeNull());
  fireEvent.input(field()!, { target: { value: text } });
  await waitFor(() => expect(field()!.value).toBe(text));
};

const made = (app: Awaited<ReturnType<typeof mountSwitcher>>["app"]) => app.calls.filter(call => call.method === "rail.createWorkstream");

it("u5241a_enter_on_no_match_makes_the_named_workstream_once_and_selects_it", async () => {
  const tree = [workstream("ops", { name: "ops" })];
  const { app, connected } = await mountSwitcher(null, tree, []);

  app.handlers["rail.createWorkstream"] = () => {
    tree.push(workstream("made", { name: "zzz plan" }));

    return door("made", "idle", "idle");
  };

  app.handlers["rail.startDoor"] = () => door("made", "working", "starting");
  openSwitcher();
  await search("  zzz plan ");
  switcherKey("Enter", { shiftKey: true });
  switcherKey("Enter");
  await waitFor(() => expect(connected.rail.selected()).toBe("made"));
  await waitFor(() => expect(field()).toBeNull());
  expect(made(app).map(call => call.params)).toEqual([{ name: "zzz plan", parent: null }]);
  await waitFor(() => expect(app.calls.filter(call => call.method === "rail.startDoor")).toHaveLength(1));
});

it("u5241a_a_blank_query_makes_nothing", async () => {
  const { app } = await mountSwitcher(null, [workstream("ops", { name: "ops" })], []);

  openSwitcher();
  await search("   ");
  switcherKey("Enter");
  expect(made(app)).toEqual([]);
});

it("u5241b_enter_with_a_match_opens_the_match_and_creates_nothing", async () => {
  const { app, connected } = await mountSwitcher(null, [workstream("ops", { name: "ops" })], []);

  openSwitcher();
  await search("op");
  switcherKey("Enter");
  await waitFor(() => expect(connected.rail.selected()).toBe("ops"));
  expect(made(app)).toEqual([]);
});

it("u5241b_a_second_enter_while_creating_calls_nothing", async () => {
  const { app } = await mountSwitcher(null, [workstream("ops", { name: "ops" })], []);

  app.handlers["rail.createWorkstream"] = () => new Promise(() => {});
  openSwitcher();
  await search("zzz");
  switcherKey("Enter");
  switcherKey("Enter");
  expect(made(app)).toHaveLength(1);
});

it("u5241c_a_failed_create_keeps_the_query_and_shows_the_message", async () => {
  const { app, connected } = await mountSwitcher(null, [workstream("ops", { name: "ops" })], []);

  app.handlers["rail.createWorkstream"] = () => { throw new RpcError(-32602, "disk full"); };

  openSwitcher();
  await search("zzz");
  switcherKey("Enter");
  await waitFor(() => expect(made(app)).toHaveLength(1));
  expect(field()!.value).toBe("zzz");
  expect(document.activeElement).toBe(field());
  expect(connected.rail.selected()).toBeNull();
  await waitFor(() => {
    switcherKey("Enter");
    expect(made(app)).toHaveLength(2);
  });
});
