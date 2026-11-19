import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import type { Pad } from "@contracts/pad/Pad";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AGENT, openShelf, padOf } from "./padsFixture";
import { foldMotion } from "../ui/fold";
import type { FoldEngine } from "../ui/fold";

const DAY = 86_400_000;

const NOW = 20 * DAY;

const pad = (name: string, changes: Partial<Pad> = {}): Pad => ({ ...padOf(name, AGENT), updated_at: NOW - DAY, ...changes });

const engine = { animateLayout: vi.fn<FoldEngine["animateLayout"]>(), animate: vi.fn<FoldEngine["animate"]>() };

let stop = () => {};

beforeEach(() => {
  engine.animateLayout.mockReset().mockImplementation((_scope, update) => update().then(() => ({ finished: new Promise<void>(() => {}) })));
  engine.animate.mockReset();
  stop = foldMotion(document, () => false, engine);
});

afterEach(() => { stop(); cleanup(); });

it("u7643a_a_fold_keeps_the_rows_that_stay_as_the_same_nodes", async () => {
  await openShelf([pad("stays"), pad("old", { updated_at: NOW - 8 * DAY })], false, false, "/p", { now: NOW, read: { "fixture-old": "1" } });
  const kept = document.querySelector('[data-pad="stays"]');
  const control = document.querySelector<HTMLElement>('.pad-fold[data-fold="idle"]');
  expect(kept).not.toBeNull();

  if (!control) throw new Error("no idle fold");

  fireEvent.click(control, { detail: 1 });
  await waitFor(() => expect(document.querySelector('[data-pad="old"]')).not.toBeNull());
  expect(engine.animateLayout).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-pad="stays"]')).toBe(kept);
  await waitFor(() => expect(engine.animate).toHaveBeenCalledWith(expect.any(Element), { opacity: [0, 1] }, expect.anything()));

  fireEvent.click(control, { detail: 1 });
  await waitFor(() => expect(engine.animate).toHaveBeenCalledWith(expect.any(Element), { opacity: [1, 0] }, expect.anything()));
  expect(document.querySelector('[data-pad="stays"]')).toBe(kept);
});
