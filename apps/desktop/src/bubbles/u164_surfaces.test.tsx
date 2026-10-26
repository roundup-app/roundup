import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { mountBubbles } from "./bubblesFixture";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("z3788c_only_the_current_bubble_owner_refits_after_remount", async () => {
  const observers: { targets: Set<Element>; notify(): void }[] = [];

  vi.stubGlobal("ResizeObserver", class {
    targets = new Set<Element>();
    constructor(private callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
    // Bubble refitting needs only notification, not jsdom's absent layout.
    notify() { if (this.targets.size) this.callback([], this); }
  });

  const first = await mountBubbles("w");
  await waitFor(() => expect(first.emulators.made.has("2")).toBe(true));
  const oldHost = document.querySelector('.bubble[data-bubble="2"] .bubble-body')!;
  const old = observers.find(observer => observer.targets.has(oldHost))!;
  old.notify();
  await new Promise(requestAnimationFrame);
  const previous = first.emulators.made.get("2")!;
  const fits = previous.fits;

  cleanup();
  const second = await mountBubbles("w");
  await waitFor(() => expect(second.emulators.made.has("2")).toBe(true));
  const host = document.querySelector('.bubble[data-bubble="2"] .bubble-body')!;
  const current = observers.find(observer => observer.targets.has(host))!;
  await new Promise(requestAnimationFrame);
  const next = second.emulators.made.get("2")!;
  const before = next.fits;

  old.notify();
  current.notify();
  current.notify();
  // Bubble coalesces observer notifications through refitNextFrame.
  await new Promise(requestAnimationFrame);
  expect([first.emulators.made.get("2"), previous.fits, next.fits]).toEqual([previous, fits, before + 1]);
});
