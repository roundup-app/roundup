import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountSwitcher, switcherKey as press } from "../switcher/switcherFixture";

afterEach(cleanup);

const screenTarget = (): HTMLElement => document.querySelector<HTMLElement>(".pane-screen [tabindex]")!;

const mountFocused = async () => {
  const mounted = await mountSwitcher("ann");

  await waitFor(() => expect(document.querySelector(".pane-screen [tabindex]")).not.toBeNull());
  screenTarget().focus();

  return mounted;
};

it("u3706_pane_keys_follow_the_registry", async () => {
  await mountFocused();

  expect(press("c", { metaKey: true }, screenTarget()).defaultPrevented).toBe(true);
  expect(press("Enter", { metaKey: true }, screenTarget()).defaultPrevented).toBe(false);
});

it("u3706_typing_reaches_xterm", async () => {
  await mountFocused();

  const chords: [string, KeyboardEventInit][] = [
    ["r", { ctrlKey: true }], ["f", { altKey: true }], ["j", { metaKey: true }], ["x", { metaKey: true }],
    ["=", { ctrlKey: true }], ["c", { ctrlKey: true }], ["c", { metaKey: true, altKey: true }],
  ];

  for (const [key, init] of chords) expect(press(key, init, screenTarget()).defaultPrevented, `${key} ${JSON.stringify(init)}`).toBe(false);
});

it("u3706_disposal_leaves_no_stale_binding", async () => {
  await mountFocused();
  cleanup();

  expect(press("c", { metaKey: true }, document.body).defaultPrevented).toBe(false);
  expect(press("=", { metaKey: true }, document.body).defaultPrevented).toBe(false);
});

it("z3788a_find_steps_through_matches_and_returns_focus", async () => {
  const { emulators } = await mountFocused();
  const emulator = [...emulators.made.values()].find(candidate => candidate.host !== null)!;
  const target = screenTarget();

  expect(press("f", { metaKey: true }, target).defaultPrevented).toBe(true);

  const input = await waitFor(() => {
    const found = document.querySelector<HTMLInputElement>('input[aria-label="Find in Terminal"]');

    expect(found).not.toBeNull();

    return found!;
  });

  expect(document.activeElement).toBe(input);
  fireEvent.input(input, { target: { value: "needle" } });
  press("Enter", {}, input);
  press("Enter", { shiftKey: true }, input);
  expect(emulator.finds).toEqual([["needle", false], ["needle", false], ["needle", true]]);

  emulator.matches = false;
  press("Enter", {}, input);
  expect(await screen.findByRole("status")).toBeTruthy();

  press("Escape", {}, input);
  expect(document.querySelector('input[aria-label="Find in Terminal"]')).toBeNull();
  expect(document.activeElement).toBe(screenTarget());
  expect(emulator.written).toEqual([]);
});
