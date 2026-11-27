import { waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { calls, file, open, scroller, section, setUpView, there } from "./viewHarness";

setUpView();

type Seen = { options: IntersectionObserverInit | undefined; targets: Element[]; report: (targets: Element[]) => void };

const observers: Seen[] = [];

class Recording implements IntersectionObserver {
  root = null;
  rootMargin = "";
  scrollMargin = "";
  thresholds = [];
  seen: Seen;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    const rect = new DOMRect();

    this.seen = { options, targets: [], report: targets => callback(targets.map(target => ({ target, isIntersecting: true, boundingClientRect: rect, intersectionRect: rect, rootBounds: null, intersectionRatio: 1, time: 0 })), this) };
    observers.push(this.seen);
  }

  observe(target: Element) { this.seen.targets.push(target); }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

const MANY = ["a", "b", "c", "d", "e", "f"].map(name => file(`m/${name}.ts`));

it("u8031a_a_file_inside_the_margin_is_drawn_before_it_scrolls_in", async () => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", Recording);
  const { app } = await open(() => ({ files: MANY }));
  const reading = () => calls(app, "agent.compareFile");

  await waitFor(() => expect(observers.length).toBeGreaterThan(0));
  const seen = there(observers.find(each => each.options?.rootMargin === "4000px 0px"));

  expect(seen.options?.root).toBe(scroller());
  expect(seen.options?.rootMargin).toBe("4000px 0px");
  const before = reading();

  seen.report([there(section("m/d.ts"))]);
  await waitFor(() => expect(reading()).toBeGreaterThan(before));
  const after = reading();

  expect(app.calls.filter(call => call.method === "agent.compareFile").some(call => JSON.stringify(call.params).includes("m/f.ts"))).toBe(false);
  expect(after).toBeLessThan(MANY.length);
});

it("u8031c_a_files_bar_stays_the_same_node_when_its_diff_arrives", async () => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", Recording);
  const { app } = await open(() => ({ files: MANY }));

  await waitFor(() => expect(observers.length).toBeGreaterThan(0));
  const target = there(section("m/e.ts"));
  const bar = target.querySelector("header.diff-header");
  const before = calls(app, "agent.compareFile");

  expect(bar).not.toBeNull();
  expect(target.querySelector('[role="status"]')).toBeNull();
  there(observers.find(each => each.targets.includes(target))).report([target]);
  await waitFor(() => expect(calls(app, "agent.compareFile")).toBeGreaterThan(before));
  await waitFor(() => expect(target.querySelector(".diff-content")).not.toBeNull());

  expect(target.querySelector("header.diff-header")).toBe(bar);
  expect(target.querySelectorAll("header.diff-header")).toHaveLength(1);
});
