import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IconButton } from "../ui/IconButton";
import { door } from "../testing/nodes";
import { mountAskBar as mountQuietAskBar } from "./askFixture";

// jsdom has no layout-shift observer; this test controls the anchor rectangles.
beforeEach(() => vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("u2749a_project_root_kind_owns_its_tooltip", async () => {
  await mountAskBar([], null, [door("a", "working", "busy")]);
  const glyph = screen.getByRole("img", { name: "Working" });
  const owner = glyph.closest("[data-slot=tooltip-trigger]")!;
  expect(owner).not.toBe(screen.getByRole("button", { name: "a Working" }));
  const rect = new DOMRect(100, 100, 16, 16);
  const anchor = vi.spyOn(owner, "getBoundingClientRect").mockReturnValue(rect);
  fireEvent.pointerEnter(owner, { pointerType: "mouse", clientX: 108, clientY: 108 });
  flush();
  expect((await screen.findByRole("tooltip")).textContent).toBe("Working");
  expect(anchor).toHaveBeenCalled();

  render(() => <IconButton aria-label="Another control">+</IconButton>);
  const other = screen.getByRole("button", { name: "Another control" });
  vi.spyOn(other, "getBoundingClientRect").mockReturnValue(new DOMRect(200, 100, 24, 24));
  fireEvent.pointerLeave(owner, { pointerType: "mouse", clientX: 400, clientY: 400 });
  flush();
  fireEvent.pointerEnter(other, { pointerType: "mouse", clientX: 212, clientY: 112 });
  flush();
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("Another control"));
  // ui-sdk keeps a tooltip open while the pointer leaves toward it, so a leave carries where the pointer went: away from both.
  fireEvent.pointerLeave(other, { pointerType: "mouse", clientX: 400, clientY: 400 });
  flush();
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

it("u2749b_focus_opens_without_a_pointer", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(10);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(100);
  await mountAskBar([], null, [door("a", "working", "busy", { name: "A long overview name" })]);

  fireEvent.keyDown(document, { key: "Tab" });
  flush();
  screen.getByRole("button", { name: "A long overview name Working" }).focus();
  expect((await screen.findByRole("tooltip")).textContent).toBe("A long overview name");
  screen.getByRole("button", { name: "outside" }).focus();
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

const mountAskBar = async (...args: Parameters<typeof mountQuietAskBar>) => {
  const mounted = await mountQuietAskBar(...args);
  mounted.connected.showView(null);
  mounted.connected.showView("workstreams");

  if (args[1] == null) await screen.findByRole("region", { name: "Project overview" });

  return mounted;
};
