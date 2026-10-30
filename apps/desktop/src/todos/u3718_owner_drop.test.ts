import { createRoot } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { Actor } from "@contracts/Actor";
import { createSortedList } from "./sortedList";
import { mountTodos, todo } from "./testHarness";
import { cleanup } from "@solidjs/testing-library";
import { todoDropTargets } from "./todoDropTargets";

afterEach(cleanup);

const by: Actor = { kind: "agent", id: "a", parent: null };

const mount = (assign: (id: number, owner: Actor | null) => Promise<string | null>) => {
  const reorder = vi.fn(async () => null);

  return createRoot(() => {
    const sorted = createSortedList({
      ids: () => [1],
      all: () => [todo(1)],
      call: reorder,
      reload: async () => {},
      reducedMotion: () => true,
      owner: { target: () => null, assign },
    });

    const shown = vi.fn();
    // SAFETY: the row reads only `ref` and `handleRef` of the Sortable parts, which the test leaves empty.
    const parts = { ref: () => {}, handleRef: () => {} } as never;

    sorted.row(1, parts).fail(shown);

    // SAFETY: an owner target is what `onDropOutside` receives; the union also admits a Rail target, which carries no `owner`.
    const target = (owner: Actor | null) => ({ element: document.createElement("div"), attribute: "data-drop-target", owner }) as never;

    return { drop: (owner: Actor | null) => sorted.external!.onDropOutside("1", target(owner)), shown, reorder };
  });
};

it("u3718_a_drop_on_another_group_assigns_once", async () => {
  const assign = vi.fn(async () => null);
  const { drop, reorder } = mount(assign);

  drop(by);
  await Promise.resolve();

  expect(assign.mock.calls).toEqual([[1, by]]);
  expect(reorder).not.toHaveBeenCalled();
});

it("u3718_a_refused_assign_keeps_the_row_and_shows_its_cause", async () => {
  const { drop, shown } = mount(async () => "no such agent");

  drop(null);
  await vi.waitFor(() => expect(shown).toHaveBeenCalledWith("no such agent"));
});

// Hit-test inputs stand in for browser coordinates; assertions concern target routing only.
it.each(["own-group", "outside"])("u3718_no_owner_assignment_target_for_%s", async place => {
  const { connected, todos } = await mountTodos([todo(1)]);
  const group = document.querySelector<HTMLElement>('[data-shelf-group="unassigned"]')!;
  vi.spyOn(group, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));
  const targets = todoDropTargets(connected, todos);

  expect(targets.owner(1, place === "own-group" ? 50 : 200, 50)).toBeNull();
});
