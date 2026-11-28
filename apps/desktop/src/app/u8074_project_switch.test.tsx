import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { WORKTREE } from "../changes/harness";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";

const SLIDING = ["key", "click", "fade", "true"];

beforeEach(() => {
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });

  window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
});

afterEach(async () => {
  cleanup();
  await new Promise(resolve => setTimeout(resolve));
  localStorage.clear();

  Reflect.deleteProperty(Element.prototype, "getAnimations");
});

const started = async () => {
  const app = createFakeApp();

  app.add("/b", "beta");
  app.add("/a", "alpha");

  for (const path of ["/a", "/b"]) {
    const daemon = app.of(path);

    daemon.handlers["rail.tree"] = () => [agent(`${path}-1`, "working", "x", { name: `scout-${path.slice(1)}`, worktree: WORKTREE })];
    daemon.handlers["agent.worktreeState"] = () => ({ ahead: 0, behind: 0, dirty: true });
    daemon.handlers["agent.changedFiles"] = () => ({ files: [{ path: "src/a.ts", status: "modified", line: 1, counts: null, blob: null }] });
    daemon.handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: WORKTREE.path, checkout: WORKTREE.path, branch: WORKTREE.branch, base: "main", files: [{ path: "src/a.ts", status: "modified", line: 1, counts: null, blob: null }] }] });
  }

  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} initialShelfOpen />);
  await screen.findByText("scout-a");
};


const railFolded = () => document.querySelector(".rail")?.getAttribute("data-collapsed") === "true";

const benchOpen = () => document.querySelector(".shelf")?.getAttribute("data-open") === "true";

const changesOpen = () => screen.queryByRole("button", { name: "Close changes" }) !== null;

const visit = async (name: RegExp) => { fireEvent.click(screen.getByRole("tab", { name })); await new Promise(resolve => setTimeout(resolve, 20)); };

const openChanges = async () => {
  fireEvent.click(required((await screen.findAllByRole("button", { name: "1 changed file", hidden: true }))[0]));
  await screen.findByRole("button", { name: "Close changes" });
  await waitFor(() => expect(railFolded()).toBe(true));
};

const required = <T,>(value: T | undefined): T => {
  if (value === undefined) throw new Error("expected an element");

  return value;
};

/** Every slide attribute value the document took, read from each record's `oldValue` and its current value. */
const watchSlides = () => {
  const seen: string[] = [];

  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : document.body;
      const now = target.getAttribute(record.attributeName ?? "");

      for (const value of [record.oldValue, now]) if (value !== null && SLIDING.includes(value)) seen.push(`${record.attributeName}=${value} on ${target.className}`);
    }
  });

  observer.observe(document.body, { attributes: true, attributeFilter: ["data-slide", "data-animated"], attributeOldValue: true, subtree: true });

  return { seen, stop: () => observer.disconnect() };
};

it("u8074a_returning_to_a_project_with_changes_open_slides_nothing", async () => {
  await started();
  await openChanges();
  await waitFor(() => expect(benchOpen()).toBe(false));
  await new Promise(resolve => setTimeout(resolve, 20));

  const watch = watchSlides();

  await visit(/^beta/);
  await visit(/^alpha/);
  await waitFor(() => expect(changesOpen()).toBe(true));

  expect(watch.seen).toEqual([]);
  expect(railFolded()).toBe(true);
  expect(benchOpen()).toBe(false);
  watch.stop();
});

it("u8074a_leaving_a_project_with_changes_open_writes_nothing_and_slides_nothing", async () => {
  await started();
  await openChanges();
  await new Promise(resolve => setTimeout(resolve, 20));

  const writes = vi.spyOn(Storage.prototype, "setItem");
  const watch = watchSlides();

  await visit(/^beta/);

  expect(changesOpen()).toBe(false);
  expect(railFolded()).toBe(false);
  expect(benchOpen()).toBe(true);
  expect(watch.seen).toEqual([]);
  expect(writes.mock.calls.filter(([key]) => key === "roundup:viewer")).toEqual([]);
  watch.stop();
  writes.mockRestore();
});
