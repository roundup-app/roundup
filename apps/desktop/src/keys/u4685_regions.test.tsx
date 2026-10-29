import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { showShelfTab } from "../testing/shelfTabs";
import { callsTo } from "../terminal/paneHarness";

afterEach(cleanup);

it("u4685b_focus_changes_never_refit_or_resize_the_terminal", async () => {
  const { daemon, connected, emulators, store } = await mountNavigation(false, 0);
  store.todos[0]!.home = "home";
  connected().rail.select("a0");
  await waitFor(() => expect(emulators.made.get("t-a0")?.host).toBeTruthy());
  const emulator = emulators.made.get("t-a0")!;
  const terminal = document.querySelector<HTMLElement>('.pane [data-terminal]')!;
  showShelfTab("Todos");
  await screen.findByText("Selected work");
  const shelf = document.querySelector<HTMLElement>('.shelf button')!;
  const rail = document.querySelector<HTMLElement>('.rail-row')!;
  const fits = emulator.fits;
  const resizes = callsTo(daemon, "terminal.resize").length;

  for (const target of [terminal, rail, shelf, terminal]) target.focus();

  expect({ fits: emulator.fits - fits, resizes: callsTo(daemon, "terminal.resize").length - resizes }).toEqual({ fits: 0, resizes: 0 });
  fireEvent.click(screen.getByText("Selected work"));
  const drawer = await waitFor(() => {
    const node = document.querySelector<HTMLElement>('.drawer button');
    if (!node) throw new Error("Drawer has not opened");
    return node;
  });
  const drawerFits = emulator.fits;
  const drawerResizes = callsTo(daemon, "terminal.resize").length;
  for (const target of [terminal, rail, drawer, terminal]) target.focus();
  expect({ fits: emulator.fits - drawerFits, resizes: callsTo(daemon, "terminal.resize").length - drawerResizes }).toEqual({ fits: 0, resizes: 0 });
});
