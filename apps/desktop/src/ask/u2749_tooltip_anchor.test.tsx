import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { IconButton } from "../ui/IconButton";
import { door } from "../testing/nodes";
import { mountAskBar } from "./askFixture";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("u2749a_project_root_kind_owns_its_tooltip", async () => {
  await mountAskBar([], null, [door("a", "working", "busy")]);
  const glyph = screen.getByRole("img", { name: "Working" });
  const owner = glyph.closest("[data-part=trigger]")!;
  expect(owner.tagName).toBe("SPAN");
  const rect = new DOMRect(100, 100, 16, 16);
  const anchor = vi.spyOn(owner, "getBoundingClientRect").mockReturnValue(rect);
  fireEvent.pointerMove(glyph.querySelector("path")!, { pointerType: "mouse", clientX: 108, clientY: 108 });
  expect((await screen.findByRole("tooltip")).textContent).toBe("Working");
  expect(anchor).toHaveBeenCalled();

  render(() => <IconButton aria-label="Another control">+</IconButton>);
  const other = screen.getByRole("button", { name: "Another control" });
  vi.spyOn(other, "getBoundingClientRect").mockReturnValue(new DOMRect(200, 100, 24, 24));
  fireEvent.pointerLeave(owner, { pointerType: "mouse" });
  fireEvent.pointerMove(other, { pointerType: "mouse", clientX: 212, clientY: 112 });
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("Another control"));
});
