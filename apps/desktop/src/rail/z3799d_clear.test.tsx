import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

it("z3799d_dismissing_clear_returns_focus_without_a_call", async () => {
  const { app } = await mountRail([door("w", "idle", "idle", { name: "ws" })]);

  const open = async () => {
    fireEvent.contextMenu(rowOf("ws"), { clientX: 10, clientY: 10 });
    await app.pickMenu("Clear…");

    return screen.findByRole<HTMLTextAreaElement>("textbox", { name: /Why clear/ });
  };

  const reason = await open();
  fireEvent.input(reason, { target: { value: " exact e\u0301 😀 " } });
  await waitFor(() => expect(document.activeElement).toBe(reason));
  fireEvent.keyDown(reason, { key: "Escape", code: "Escape", keyCode: 27 });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(rowOf("ws")));
  expect(railCallsTo(app, "workstream.clear")).toEqual([]);
  expect((await open()).value).toBe(" exact e\u0301 😀 ");
  // Zag 1.45.0 defers whenNode in dismissable-layer, then trackInteractOutside, by one frame each.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  fireEvent.pointerDown(document.body);
  fireEvent.pointerUp(document.body);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(railCallsTo(app, "workstream.clear")).toEqual([]);
  expect((await open()).value).toBe(" exact e\u0301 😀 ");
});
