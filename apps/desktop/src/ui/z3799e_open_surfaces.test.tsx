import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { Menu } from "./Menu";
import { surfaceOpen } from "./openSurfaces";

afterEach(cleanup);

it("z3799e_an_open_menu_or_switcher_blocks_the_terminal_gesture", async () => {
  const [open, setOpen] = createSignal(false);

  render(() => <Menu.Root open={open()} onOpenChange={(details) => setOpen(details.open)}>
    <Menu.Trigger>More</Menu.Trigger>
    <Menu.Positioner><Menu.Content><Menu.Item value="a">A</Menu.Item></Menu.Content></Menu.Positioner>
  </Menu.Root>);
  expect(surfaceOpen()).toBe(false);
  setOpen(true);
  await waitFor(() => expect(surfaceOpen()).toBe(true));
  setOpen(false);
  await waitFor(() => expect(surfaceOpen()).toBe(false));
});
