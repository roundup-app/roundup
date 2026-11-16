import { cleanup } from "@solidjs/testing-library";
import { createRoot, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTabs } from "../header/stripFixture";
import { createReducedMotion } from "./reducedMotion";
import type { MediaQuery } from "./reducedMotion";

const REDUCE = "(prefers-reduced-motion: reduce)";

/** A `matchMedia` that reports `matches` for the reduced-motion query only. */
const matchMediaWith = (matches: boolean) => (query: string): MediaQuery => ({
  matches: query === REDUCE && matches,
  addEventListener: () => {},
  removeEventListener: () => {},
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("u5 reduced motion", () => {
  it("u5_the_app_reads_prefers_reduced_motion_from_the_webview", () => {
    createRoot((dispose) => {
      expect([createReducedMotion(matchMediaWith(true))(), createReducedMotion(matchMediaWith(false))()]).toEqual([
        true,
        false,
      ]);
      dispose();
    });
  });

  it("u5_a_change_of_the_preference_is_followed", () => {
    let notify: (change: { matches: boolean }) => void = () => {};

    const listeners = new Set<(change: { matches: boolean }) => void>();

    const query: MediaQuery = {
      matches: false,
      addEventListener: (_type, listener) => { notify = listener; listeners.add(listener); },
      removeEventListener: (_type, listener) => { listeners.delete(listener); },
    };

    // The change arrives from the platform, outside any owner; Solid 2 applies it at the flush.
    const { reduced, dispose } = createRoot((dispose) => ({ reduced: createReducedMotion(() => query), dispose }));
    notify({ matches: true });
    flush();
    expect(reduced()).toBe(true);
    notify({ matches: false });
    flush();
    expect(reduced()).toBe(false);
    dispose();
    expect(listeners.size).toBe(0);
  });

  it("u3010d_app_dialogs_reuse_the_injected_preference_without_another_subscription", async () => {
    const media = vi.fn(matchMediaWith(false));
    vi.stubGlobal("matchMedia", media);

    await openTabs({ one: [] });

    expect(media.mock.calls.filter(([query]) => query === REDUCE)).toHaveLength(0);
  });
});
