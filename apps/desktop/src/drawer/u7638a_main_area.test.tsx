import { flush, useContext } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createDrawer } from "./drawer";
import { DrawerHost, DrawerMaximisedContext } from "./DrawerHost";

afterEach(() => { cleanup(); localStorage.clear(); });

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

it("u7638a_esc_brings_the_terminal_back_with_focus", () => {
  const drawer = createDrawer();
  render(() => <><button aria-label="row">row</button><DrawerHost drawer={drawer} reducedMotion={() => false} /></>);
  const row = screen.getByLabelText("row");
  row.focus();
  drawer.open(() => <p>item</p>, "key", { kind: "pad", project: "/one" });
  flush();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  flush();
  expect(panel().dataset.open).toBe("false");
  expect(document.activeElement).toBe(row);
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
