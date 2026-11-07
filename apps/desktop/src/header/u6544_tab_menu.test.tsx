import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openTabs, path, projectTabs, tab } from "./stripFixture";

// jsdom has no layout; Ark excludes zero-size controls from its focus targets.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20);
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1024);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(768);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const keepDraft = (name: string) => localStorage.setItem(`roundup:drafts:${path(name)}`, JSON.stringify({ version: 1, drafts: [
  { revision: "kept", destination: { surface: "header", object: path(name), recipient: null }, value: { name: "Saved", base: name }, selection: null, status: "failed", policy: "ordinary" },
] }));

const open = (name: string) => fireEvent.contextMenu(tab(name), { clientX: 40, clientY: 10 });

it("u6544a_tab_draws_no_pencil_and_keeps_its_close_slot", async () => {
  keepDraft("api");
  await openTabs({ api: [], web: [] }, true);

  const api = tab("api").closest(".project-tab")!;

  expect(api.querySelector(".tab-recover")).toBeNull();
  expect(api.querySelector(".tab-close")).not.toBeNull();
  expect(api.querySelector(".tab-close")!.getAttribute("data-visible")).toBe("false");
  expect(projectTabs().map(each => each.closest(".project-tab")!.querySelector(".tab-close")!.getAttribute("data-visible"))).toContain("true");
});

it("u6544b_close_others_left_right", async () => {
  const { app } = await openTabs({ a: [], b: [], c: [] });
  const labels = () => app.menuLabels();

  open("a");
  expect(labels()).toEqual(expect.arrayContaining(["Close", "Close Others", "Close Right"]));
  expect(labels()).not.toContain("Close Left");
  await app.closeMenu();

  open("c");
  expect(labels()).not.toContain("Close Right");
  expect(labels()).toContain("Close Left");
  await app.closeMenu();

  open("b");
  await app.pickMenu("Close Others");
  await waitFor(() => expect(app.closed.sort()).toEqual([path("a"), path("c")]));
  app.closed.length = 0;
  open("b");
  expect(labels()).not.toContain("Close Others");
  await app.closeMenu();
});

it("u6544b_close_to_the_left_and_right_close_only_that_side", async () => {
  const { app } = await openTabs({ a: [], b: [], c: [] });

  open("b");
  await app.pickMenu("Close Left");
  await waitFor(() => expect(app.closed).toEqual([path("a")]));
  app.closed.length = 0;

  open("b");
  await app.pickMenu("Close Right");
  await waitFor(() => expect(app.closed).toEqual([path("c")]));
});

it("u6544c_recover_drafts_in_menu", async () => {
  keepDraft("api");
  const { app } = await openTabs({ api: [], web: [] }, true);

  open("web");
  expect(app.menuLabels()).not.toContain("Recover unfinished work");
  await app.closeMenu();

  open("api");
  await app.pickMenu("Recover unfinished work");
  await waitFor(() => expect(document.querySelector(".header-recovery")).not.toBeNull());
});
