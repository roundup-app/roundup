import { expect, it } from "vitest";
import { trackScrollbars } from "./scrollHover";

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

it("u3800g_scroll_hover_marks_new_areas", async () => {
  trackScrollbars(document);
  const area = document.body.appendChild(document.createElement("div"));

  area.style.overflowY = "auto";
  area.style.height = "20px";
  area.append(document.createElement("div"));
  await frame();
  await frame();

  expect(area.parentElement?.querySelector(".scrollbar-slot")).not.toBeNull();
  area.remove();
});

// U7543b: the library's in-host mode wraps a host's children in its own viewport; a node a framework inserts later lands beside it.
it("u7543b_in_host_mode_leaves_later_children_outside_the_viewport", async () => {
  const { OverlayScrollbars } = await import("overlayscrollbars");
  const host = document.body.appendChild(document.createElement("div"));

  host.append(document.createElement("p"));

  const bars = OverlayScrollbars(host, {});
  const viewport = host.querySelector("[data-overlayscrollbars-viewport]");
  const later = host.appendChild(document.createElement("section"));

  expect(viewport).not.toBeNull();
  expect(viewport?.contains(later)).toBe(false);
  bars.destroy();
  host.remove();
});
