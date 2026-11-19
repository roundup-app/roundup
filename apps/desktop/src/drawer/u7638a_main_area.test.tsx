import { flush, useContext } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { info, node } from "../testing/nodes";
import { Pane } from "../terminal/Pane";
import type { Emulator } from "../terminal/emulator";
import { ToastHost } from "../testing/toastHost";
import { mountTodos, todo, todoRowOf } from "../todos/testHarness";
import { createDrawer } from "./drawer";
import { DrawerHost, DrawerMaximisedContext } from "./DrawerHost";

afterEach(() => { cleanup(); localStorage.clear(); });

/** A Pane whose Terminal is a focusable field inside a `.window`/`.centre` as Layout draws them; its emulator counts what it is given. */
const mountTerminal = async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [node("a")];
  app.handlers["terminal.list"] = () => [info("t-a")];
  app.handlers["terminal.write"] = () => null;
  app.handlers["terminal.resize"] = () => null;

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);
  const field = document.createElement("textarea");
  const written: string[] = [];
  const disposed = vi.fn();

  const emulator: Emulator = {
    write: bytes => { written.push(new TextDecoder().decode(bytes)); },
    setSize: () => {},
    setFontSize: () => {},
    reset: () => {},
    selection: () => "",
    turns: () => [],
    selectTurn: () => {},
    onLink: () => {},
    paste: () => {},
    onInput: () => {},
    show: host => { host.replaceChildren(field);

 return { cols: 80, rows: 24 }; },
    fit: () => ({ cols: 80, rows: 24 }),
    focus: () => field.focus(),
    isAtBottom: () => true,
    onScroll: () => {},
    scrollToBottom: () => {},
    dispose: disposed,
  };

  render(() => (
    <ToastHost><ConnectedProjectContext value={connected}>
      <div class="window"><section class="centre"><Pane createEmulator={() => emulator} /></section>
        <DrawerHost drawer={connected.drawer} reducedMotion={connected.reducedMotion} /></div>
    </ConnectedProjectContext></ToastHost>
  ));

  connected.rail.select("a");
  await vi.waitFor(() => expect(field.isConnected).toBe(true));

  return { app, connected, field, written, disposed };
};

const panel = () => screen.getByLabelText("Drawer");

it("u7638a_a_todo_and_a_pad_open_in_the_main_area_by_every_route", () => {
  const drawer = createDrawer();
  render(() => <DrawerHost drawer={drawer} reducedMotion={() => false} />);

  for (const kind of ["todo", "pad"]) {
    for (const source of ["pointer", "key"] as const) {
      drawer.open(() => <p>{kind}</p>, source, { kind, project: "/one" });
      flush();
      expect(panel().dataset.open).toBe("true");
      expect(panel().dataset.fill).toBe("true");
      expect(panel().dataset.reserve).toBe("false");
      expect(panel().querySelectorAll(".drawer-controls button").length).toBe(1);
      drawer.close(source);
      flush();
    }
  }
});

it("u7638a_a_todo_opened_by_its_row_key_shows_in_the_main_area", async () => {
  const { connected } = await mountTodos([todo(1)]);
  const row = await screen.findByRole("button", { name: /#1 / });
  const covered = () => document.querySelector(".window")?.hasAttribute("data-main-area");

  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await vi.waitFor(() => expect(panel().dataset.fill).toBe("true"));
  expect(panel().dataset.reserve).toBe("false");
  expect(covered()).toBe(true);
  connected.drawer.close("key");
  await vi.waitFor(() => expect(covered()).toBe(false));
});

it("u7638a_opening_and_closing_move_nothing_over_time", () => {
  for (const reduced of [false, true]) {
    const drawer = createDrawer();
    const view = render(() => <DrawerHost drawer={drawer} reducedMotion={() => reduced} />);
    drawer.open(() => <p>item</p>, "pointer", { kind: "todo", project: "/one" });
    flush();
    expect(panel().style.transition).toBe("none");
    expect(panel().style.transform).toBe("translateX(0)");
    expect(panel().dataset.motion).toBe("none");
    drawer.close("pointer");
    flush();
    // Gone in the frame it closes: no exit slide keeps it mounted.
    expect(panel().dataset.open).toBe("false");
    expect(panel().dataset.mounted).toBe("false");
    view.unmount();
  }
});

it("u7638a_esc_brings_the_terminal_back_with_focus", async () => {
  const { connected, field } = await mountTerminal();
  field.focus();
  connected.drawer.open(() => <p>item</p>, "key", { kind: "pad", project: "/p" });
  await vi.waitFor(() => expect(document.querySelector(".window")?.hasAttribute("data-main-area")).toBe(true));

  // Esc outside a field (U28) shows the Terminal again in the same frame, focus back in its element (U40).
  fireEvent.keyDown(document.body, { key: "Escape" });
  flush();
  expect(connected.drawer.content()).toBeNull();
  expect(document.querySelector(".window")?.hasAttribute("data-main-area")).toBe(false);
  await vi.waitFor(() => expect(document.activeElement).toBe(field));

  connected.drawer.open(() => <p>item</p>, "key", { kind: "todo", project: "/p" });
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toBe(document.activeElement));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await vi.waitFor(() => expect(document.activeElement).toBe(field));
});

it("u7638a_the_pad_column_follows_the_pad_width_setting", () => {
  const drawer = createDrawer();
  const Probe = () => <p data-wide={String(useContext(DrawerMaximisedContext)())}>pad</p>;
  render(() => <DrawerHost drawer={drawer} reducedMotion={() => false} />);
  drawer.open(() => <Probe />, "key", { kind: "pad", project: "/one" });
  flush();
  // The Pad's width control and `data-pad-width` show only while this is true, as in the maximised Drawer.
  expect(panel().querySelector<HTMLElement>("[data-wide]")?.dataset.wide).toBe("true");
});

it("u7638a_a_work_order_still_opens_in_the_drawer", () => {
  const drawer = createDrawer();
  render(() => <DrawerHost drawer={drawer} reducedMotion={() => false} />);
  drawer.open(() => <p>detail</p>, "key", { kind: "work-order", project: "/one" });
  flush();
  expect(panel().dataset.fill).toBe("false");
  expect(panel().dataset.motion).toBe("slide");
  expect(panel().querySelectorAll(".drawer-controls button").length).toBe(2);
});

it("u7638a_a_hidden_terminal_keeps_its_output_and_gets_no_resize", async () => {
  const { app, connected, field, written, disposed } = await mountTerminal();
  const resizes = () => app.calls.filter(call => call.method === "terminal.resize").length;
  const before = resizes();
  const window = () => document.querySelector(".window");

  connected.drawer.open(() => <p>item</p>, "pointer", { kind: "todo", project: "/p" });
  await vi.waitFor(() => expect(window()?.hasAttribute("data-main-area")).toBe(true));
  // The marker is what styles.css hides `.centre` on; the Terminal's element stays mounted under it.
  expect(window()?.querySelector(".centre")?.contains(field)).toBe(true);

  app.emitOutput("t-a", "while hidden");
  await vi.waitFor(() => expect(written.join("")).toContain("while hidden"));

  connected.drawer.close("pointer");
  await vi.waitFor(() => expect(window()?.hasAttribute("data-main-area")).toBe(false));

  expect(field.isConnected).toBe(true);
  expect(disposed).not.toHaveBeenCalled();
  expect(written.join("")).toContain("while hidden");
  expect(resizes()).toBe(before);
});
