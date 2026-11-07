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
