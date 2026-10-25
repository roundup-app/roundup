// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { EventData } from "@contracts/EventData";
import { USER } from "../testing/nodes";
import { padHandlers } from "../testing/stores";
import { openPad, openShelf, padOf } from "./padsFixture";

afterEach(cleanup);

it("u3789a_rename_refetch_retains_exact_pending_text_and_original_target_without_submitting_on_restore", async () => {
  const original = padOf("Notes", USER, "original");
  const { app, state, connected } = await openShelf([original]);
  const announce = (data: EventData) => app.emit({ actor: USER, ...data });
  Object.assign(app.handlers, padHandlers(state, announce));
  const field = await openPad("Notes");
  fireEvent.input(field, { target: { value: "unfinished\n 日本語 🌱" } });
  const pendingText = field.value;
  const draft = connected.drafts.list().at(-1);
  expect(draft).toBeDefined();

  const renamed = await app.rpc("pad.rename", { name: original.name, newName: "Plan", expectedIncarnation: original.incarnation });
  await screen.findAllByRole("alert");
  expect(field.value).toBe(pendingText);
  expect(renamed).toEqual({ ...original, name: "Plan" });
  expect(connected.drafts.list().at(-1)).toEqual(draft);
  expect(app.calls.filter(call => call.method === "pad.write")).toEqual([]);
  cleanup();

  const restored = await openShelf([renamed, { ...original, incarnation: "replacement", text: "replacement" }], false, true);
  await openPad("Notes");
  expect(restored.connected.drafts.list().at(-1)).toEqual(draft);
  expect(restored.app.calls.filter(call => call.method === "pad.write" || call.method === "pad.rename")).toEqual([]);
});
