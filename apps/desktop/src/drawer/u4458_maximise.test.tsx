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
    expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("false");
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
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  drawer.close("key");
  drawer.open(() => <p>Todo</p>, "key", { kind: "todo", project: "/one" });
  expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("true");
  drawer.open(() => <p>other Project</p>, "key", { kind: "pad", project: "/two" });
  expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("true");
  drawer.open(() => <p>another Pad</p>, "key", { kind: "pad", project: "/one" });
  expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("false");
  drawer.open(() => <p>work order</p>, "key", { kind: "work-order", project: "/one" });
  expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("false");
  // A new host restores from the same stored frame, rather than its previous in-memory state.
  await waitFor(() => expect(localStorage.getItem("roundup:shelf:/one:pad")).not.toBeNull());
  first.unmount();
  mount();
  expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("false");
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
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  drawer.close("key");
  expect(shelf.maximised()).toBe(true);
});

it("u4698a_one_control_and_m_keep_the_item_and_draft", () => {
  const drawer = createDrawer();
  render(() => <DrawerHost drawer={drawer} reducedMotion={() => true} />);

  for (const kind of ["todo", "pad"]) {
    for (const press of [false, true]) {
      let reads = 0;
      drawer.open(() => {
        reads += 1;

        return <input aria-label="draft" />;
      }, "key", { kind, project: "/one" });
      // SAFETY: the draft field rendered above is an <input>.
      const field = screen.getByLabelText("draft") as HTMLInputElement;
      fireEvent.input(field, { target: { value: "unsent" } });
      const dialogs = document.querySelectorAll("[role=dialog]").length;
      const states: string[] = [screen.getByLabelText("Drawer").dataset.maximised ?? ""];

      for (const _ of [0, 1]) {
        const control = screen.getByRole("button", { name: /^(Maximise|Restore)$/ });

        if (press) { control.focus(); fireEvent.keyDown(control, { key: "m", code: "KeyM" }); } else fireEvent.click(control);
        states.push(screen.getByLabelText("Drawer").dataset.maximised ?? "");
        expect(screen.getByLabelText("draft")).toBe(field);
        expect(field.value).toBe("unsent");
      }

      expect(states).toEqual(["true", "false", "true"]);
      expect(fireEvent.keyDown(field, { key: "m", code: "KeyM" })).toBe(true);
      expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("true");
      expect(document.querySelectorAll("[role=dialog]").length).toBe(dialogs);
      expect(reads).toBe(1);
      drawer.close("key");
      localStorage.clear();
    }
  }
});

it("u4698a_choice_survives_reopen_and_is_scoped", () => {
  const drawer = createDrawer();
  localStorage.setItem("roundup:shelf:/one:pad", JSON.stringify({ maximised: false }));
  localStorage.setItem("roundup:shelf:/one:todo", JSON.stringify({ maximised: true }));
  render(() => <DrawerHost drawer={drawer} reducedMotion={() => true} />);

  const maximisedOf = (kind: string, project: string) => {
    drawer.open(() => <p>{kind}</p>, "key", { kind, project });
    const value = screen.getByLabelText("Drawer").dataset.maximised;
    drawer.close("key");

    return value;
  };

  expect(maximisedOf("pad", "/one")).toBe("false");
  expect(maximisedOf("todo", "/one")).toBe("true");
  expect(maximisedOf("pad", "/two")).toBe("true");
  expect(maximisedOf("todo", "/two")).toBe("true");
  expect(maximisedOf("work-order", "/one")).toBe("false");
});

it("u4698a_filled_drawer_preserves_other_surfaces", () => {
  const drawer = createDrawer();
  let shelf!: ReturnType<typeof createShelfFrame>;
  render(() => {
    shelf = createShelfFrame(() => "/one", () => true, () => {});

    return <DrawerHost drawer={drawer} reducedMotion={() => true} />;
  });
  shelf.toggleMaximise("key");

  for (const kind of ["todo", "pad"]) {
    drawer.open(() => <p>{kind}</p>, "key", { kind, project: "/one" });
    expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("true");
    expect(shelf.maximised()).toBe(true);
    drawer.close("key");
    expect(shelf.maximised()).toBe(true);
  }
});
