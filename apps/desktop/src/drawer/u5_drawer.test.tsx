import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { Touch } from "@contracts/Touch";
import type { Todo } from "@contracts/todo/Todo";
import { Layout } from "../app/Layout";
import { RpcError } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createDrawer } from "./drawer";
import { DrawerHost } from "./DrawerHost";
import { ItemDrawer } from "./ItemDrawer";
import { lastTouchLine } from "./touchLine";

const USER: Actor = { kind: "user", id: "you", parent: null };

const AGENT: Actor = { kind: "agent", id: "a", parent: null };

const TODO: Todo = { id: 3, title: "refresh tokens", body: "", done: false, blockers: [], blocked: false, created_at: 0, creator: USER, home: null, owner: null, estimate_minutes: null };

const names = (actor: Actor) => (actor.kind === "agent" ? "auth-refactor" : "you");

const at = (hours: number, minutes: number) => new Date(2026, 0, 5, hours, minutes).getTime();

const touch = (actor: Actor, verb: Touch["verb"], when: number): Touch => ({ actor, verb, item: "todo:3", at: when });

const drawerSetup = (reduced = false) => {
  const drawer = createDrawer();
  const [reducedMotion, setReducedMotion] = createSignal(reduced);
  render(() => <DrawerHost drawer={drawer} reducedMotion={reducedMotion} />);

  return { drawer, setReducedMotion, panel: screen.getByLabelText("Drawer") };
};

afterEach(cleanup);

describe("u5 Drawer and last touch", () => {
  it("u5_under_prefers_reduced_motion_the_drawer_is_instant", () => {
    const { drawer, panel } = drawerSetup(true);

    drawer.open(() => <p>detail</p>);

    expect(panel.style.transition).toBe("none");
  });

  it("u5_the_drawer_shows_a_light_close_word_that_closes_it", () => {
    const { drawer } = drawerSetup();
    drawer.open(() => <p>detail</p>);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(drawer.content()).toBeNull();
  });

  it("u5_opening_another_drawer_replaces_the_open_one", () => {
    const { drawer } = drawerSetup();
    drawer.open(() => <p>first</p>);

    drawer.open(() => <p>second</p>);

    expect([screen.queryByText("first"), screen.queryByText("second")].map(Boolean)).toEqual([false, true]);
  });

  it("u5_a_closed_drawer_unmounts_its_content_when_the_slide_out_ends", () => {
    const { drawer, panel } = drawerSetup();
    drawer.open(() => <p>detail</p>);
    drawer.close();

    fireEvent.transitionEnd(panel);

    expect(screen.queryByText("detail")).toBeNull();
  });

  it("u5_a_closed_drawer_unmounts_its_content_at_once_under_reduced_motion", () => {
    const { drawer } = drawerSetup(true);
    drawer.open(() => <p>detail</p>);

    drawer.close();

    expect(screen.queryByText("detail")).toBeNull();
  });

  it("u5_opening_a_drawer_narrows_only_the_columns_by_the_drawers_span", async () => {
    const connected = await connectProject(createFakeApp(), { name: "p", path: "/p" }, () => false, () => 0);

    const { container } = render(() => (
      <ConnectedProjectContext.Provider value={connected}>
        <Layout
          header="roundup"
          rail={null}
          centre={<div data-testid="pane" />}
          shelf={null}
          overlay={<DrawerHost drawer={connected.drawer} reducedMotion={() => false} />}
        />
      </ConnectedProjectContext.Provider>
    ));

    const columns = container.querySelector(".columns");
    const boxes = () => [...(columns?.children ?? [])].map((box) => [box.className, box.getAttribute("style")]);
    const before = boxes();

    connected.drawer.open(() => <p>detail</p>);

    expect(boxes()).toEqual(before);
    expect(screen.getByLabelText("Drawer").dataset.open).toBe("true");
  });

  it("u5_the_last_touch_line_reads_the_newest_touch_in_the_history", () => {
    const history = [touch(USER, "read", at(9, 5)), touch(AGENT, "wrote", at(14, 2)), touch(USER, "read", at(11, 30))];

    expect(lastTouchLine(history, names)).toBe("Last  auth-refactor wrote 14:02");
  });

  it("u5_an_item_nobody_touched_has_no_last_touch_line", () => {
    expect(lastTouchLine([], names)).toBeNull();
  });

  it("u5_an_item_drawer_does_not_read_until_provenance_history_has_answered", async () => {
    const app = createFakeApp();
    const history = Promise.withResolvers<Touch[]>();
    app.handlers["provenance.history"] = () => history.promise;
    app.handlers["todo.get"] = () => TODO;
    const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);

    render(() => (
      <ConnectedProjectContext.Provider value={connected}>
        <ItemDrawer item="todo:3" read={() => connected.app.rpc("todo.get", { id: 3 })}>
          {(todo) => <p>{todo.title}</p>}
        </ItemDrawer>
      </ConnectedProjectContext.Provider>
    ));
    const waiting = app.calls.map((call) => call.method);
    history.resolve([]);
    await screen.findByText(TODO.title);

    expect([waiting, app.calls.map((call) => call.method)]).toEqual([
      ["daemon.ping", "terminal.scheme", "rail.tree", "terminal.list", "decision.list", "provenance.history"],
      ["daemon.ping", "terminal.scheme", "rail.tree", "terminal.list", "decision.list", "provenance.history", "todo.get"],
    ]);
  });

  it("u5_the_last_touch_line_is_from_the_history_fetched_before_the_read", async () => {
    const app = createFakeApp();
    const history = [touch(AGENT, "wrote", at(8, 7))];
    app.handlers["provenance.history"] = () => [...history];
    app.handlers["todo.get"] = () => {
      history.push(touch(USER, "read", at(23, 59)));

      return TODO;
    };

    const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);

    render(() => (
      <ConnectedProjectContext.Provider value={connected}>
        <ItemDrawer item="todo:3" read={() => connected.app.rpc("todo.get", { id: 3 })}>
          {(todo) => <p>{todo.title}</p>}
        </ItemDrawer>
      </ConnectedProjectContext.Provider>
    ));

    expect((await screen.findByText(/^Last/)).textContent).toBe("Last  a wrote 08:07");
  });

  it("u190_the_last_touch_line_is_the_newest_read_when_an_older_read_resolves_last", async () => {
    const app = createFakeApp();
    const reads: PromiseWithResolvers<Touch[]>[] = [];
    let calls = 0;
    app.handlers["provenance.history"] = () => {
      // The first call is the Drawer's own; each later one waits for the test.
      if (calls++ === 0) return [touch(USER, "read", at(8, 0))];
      const read = Promise.withResolvers<Touch[]>();
      reads.push(read);

      return read.promise;
    };

    app.handlers["todo.get"] = () => TODO;
    const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);

    render(() => (
      <ConnectedProjectContext.Provider value={connected}>
        <ItemDrawer
          item="todo:3"
          read={() => connected.app.rpc("todo.get", { id: 3 })}
          touchedBy={(event) => event.name === "pad.changed"}
        >
          {(todo) => <p>{todo.title}</p>}
        </ItemDrawer>
      </ConnectedProjectContext.Provider>
    ));
    await screen.findByText(TODO.title);

    const changed = { name: "pad.changed" as const, actor: AGENT, data: { name: "n" } };
    app.emit(changed);
    app.emit(changed);
    await vi.waitFor(() => expect(reads.length).toBe(2));

    reads[1]!.resolve([touch(AGENT, "wrote", at(9, 0))]);
    await screen.findByText(/^Last\s+a wrote 09:00/);
    reads[0]!.resolve([touch(USER, "read", at(8, 0))]);
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText(/^Last/).textContent).toBe("Last  a wrote 09:00");
  });

  it("u5_a_failed_read_shows_its_message_in_the_drawer_and_keeps_the_window", async () => {
    const app = createFakeApp();
    app.handlers["todo.get"] = () => Promise.reject(new RpcError(-32001, "no todo 3"));
    const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);

    render(() => (
      <ConnectedProjectContext.Provider value={connected}>
        <p>window</p>
        <ItemDrawer item="todo:3" read={() => connected.app.rpc("todo.get", { id: 3 })}>
          {(todo) => <p>{todo.title}</p>}
        </ItemDrawer>
      </ConnectedProjectContext.Provider>
    ));

    expect([(await screen.findByText("no todo 3")).className, screen.getByText("window").textContent]).toEqual([
      "ink",
      "window",
    ]);
  });
});
