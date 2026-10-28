import { createShelfFrame } from "../shelf/frame";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createDrawer } from "./drawer";
import { DrawerHost } from "./DrawerHost";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u4458_maximise_button_and_m_toggle_a_pad_and_a_todo_drawer", () => {
  const drawer = createDrawer();
  render(() => <DrawerHost drawer={drawer} reducedMotion={() => true} />);

  for (const kind of ["pad", "todo"]) {
    drawer.open(() => <input aria-label="body" />, "key", { kind, project: "/one" });
    fireEvent.click(screen.getByRole("button", { name: "Maximise" }));
    const restore = screen.getByRole("button", { name: "Restore" });
    restore.focus();
    fireEvent.keyDown(restore, { key: "m", code: "KeyM" });
    expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("false");
    const types = fireEvent.keyDown(screen.getByLabelText("body"), { key: "m", code: "KeyM" });
    expect([screen.getByLabelText("Drawer").dataset.maximised, types]).toEqual(["false", true]);
    drawer.close("key");
  }
});

it("u4458_every_drawer_kind_gets_the_control", () => {
  const drawer = createDrawer();
  render(() => <DrawerHost drawer={drawer} reducedMotion={() => true} />);

  for (const kind of ["work-order", "future-kind"]) {
    drawer.open(() => <p>detail</p>, "key", { kind, project: "/one" });
    fireEvent.click(screen.getByRole("button", { name: "Maximise" }));
    expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("true");
    drawer.close("key");
  }
});

it("u4458_the_state_is_kept_per_kind_and_project", async () => {
  const drawer = createDrawer();
  const mount = () => render(() => <DrawerHost drawer={drawer} reducedMotion={() => true} />);
  const first = mount();
  drawer.open(() => <p>first Pad</p>, "key", { kind: "pad", project: "/one" });
  fireEvent.click(screen.getByRole("button", { name: "Maximise" }));
  drawer.close("key");
  drawer.open(() => <p>Todo</p>, "key", { kind: "todo", project: "/one" });
  expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("false");
  drawer.open(() => <p>other Project</p>, "key", { kind: "pad", project: "/two" });
  expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("false");
  drawer.open(() => <p>another Pad</p>, "key", { kind: "pad", project: "/one" });
  expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("true");
  // A new host restores from the same stored frame, rather than its previous in-memory state.
  await waitFor(() => expect(localStorage.getItem("roundup:shelf:/one:pad")).not.toBeNull());
  first.unmount();
  mount();
  expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("true");
});

it("u4458_drawer_maximise_keeps_the_shelf_state", () => {
  const drawer = createDrawer();
  let shelf!: ReturnType<typeof createShelfFrame>;
  render(() => {
    shelf = createShelfFrame(() => "/one", () => true, () => {});

    return <DrawerHost drawer={drawer} reducedMotion={() => true} />;
  });
  shelf.toggleMaximise("key");
  drawer.open(() => <p>Pad</p>, "key", { kind: "pad", project: "/one" });
  fireEvent.click(screen.getByRole("button", { name: "Maximise" }));
  drawer.close("key");
  expect(shelf.maximised()).toBe(true);
});
