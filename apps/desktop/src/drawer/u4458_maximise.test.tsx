import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
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
    expect(screen.getByRole("button", { name: "Maximise" })).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("body"), { key: "m", code: "KeyM" });
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    drawer.close("key");
  }
});
