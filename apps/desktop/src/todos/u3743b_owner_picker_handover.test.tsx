import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { OwnerPicker } from "./OwnerPicker";

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** The target a Todo's picker is open for; each press of `o` makes a new one. */
const target = (id: number) => ({ id, anchor: document.body.appendChild(document.createElement("button")) });

const stateOf = (id: number) => screen.getByRole("menu", { name: `Owners for #${id}`, hidden: true }).getAttribute("data-state");

it.each(["gone", "again"])("u3743b_a_target_that_ends_during_the_exit_gets_no_naming_and_the_next_one_opens: %s", async ending => {
  const [current, setCurrent] = createSignal<ReturnType<typeof target> | null>(target(1));
  const named: number[] = [];

  render(() => <OwnerPicker target={current} offers={() => [{ id: "unassigned", name: "Unassigned", actor: null }]} label={id => `Owners for #${id}`}
    choose={() => {}} newWorkstream={id => named.push(id)} close={() => setCurrent(null)} />);
  const offer = await screen.findByText("New Workstream…");

  // The exit completes on an animation frame, so holding frames holds the exit as one that never completes does.
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  fireEvent.click(offer);
  await waitFor(() => expect(stateOf(1)).toBe("closed"));

  if (ending === "gone") { setCurrent(null); setCurrent(target(2)); } else setCurrent(target(1));
  await waitFor(() => expect(stateOf(ending === "gone" ? 2 : 1)).toBe("open"));
  await vi.advanceTimersByTimeAsync(100);
  expect(named).toEqual([]);
});
