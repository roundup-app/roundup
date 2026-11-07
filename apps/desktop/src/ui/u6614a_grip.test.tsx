import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { For } from "solid-js";
import { Sortable } from "./sortable";

afterEach(cleanup);

it("u6614a_drag_grip_shows_no_tooltip", async () => {
  render(() => <Sortable.Root ids={["A", "B"]} onOrderChange={() => {}}>
    <For each={["A", "B"]}>{(id, index) => <Sortable.Item id={id} index={index()}>{parts =>
      <div ref={parts.ref}><Sortable.Handle label={`Move ${id}`} ref={parts.handleRef} /></div>}</Sortable.Item>}</For>
  </Sortable.Root>);

  const grip = screen.getByRole("button", { name: "Move A" });
  fireEvent.pointerEnter(grip); fireEvent.mouseEnter(grip); fireEvent.pointerMove(grip);
  await new Promise(resolve => setTimeout(resolve, 700));
  expect(screen.queryByRole("tooltip")).toBeNull();

  grip.focus();
  await new Promise(resolve => setTimeout(resolve, 700));
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(grip.getAttribute("aria-label")).toBe("Move A");
});
