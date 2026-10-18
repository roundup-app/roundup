import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { door } from "../testing/nodes";
import { mountAskBar } from "./askFixture";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("u2749a_project_root_kind_owns_its_tooltip", async () => {
  await mountAskBar([], null, [door("a", "working", "busy")]);
  const glyph = screen.getByRole("img", { name: "Working" });
  const owner = glyph.closest("[data-part=trigger]")!;
  expect(owner.tagName).toBe("SPAN");
  const rect = new DOMRect(100, 100, 16, 16);
  vi.spyOn(owner, "getBoundingClientRect").mockReturnValue(rect);
  fireEvent.pointerMove(owner, { pointerType: "mouse", clientX: 108, clientY: 108 });
  expect((await screen.findByRole("tooltip")).textContent).toBe("Working");
});
