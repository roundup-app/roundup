import { afterEach, expect, it, vi } from "vitest";
import { pressFeedback } from "./pressFeedback";

let stop: (() => void) | undefined;

afterEach(() => { stop?.(); document.body.replaceChildren(); vi.restoreAllMocks(); });

// jsdom omits the Web Animations API that the press feedback needs before it starts.
Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: () => ({ cancel() {}, then() {} }) });

vi.stubGlobal("DOMMatrix", class { scale() { return this; } });

/** Feedback measures the element it is about to scale, so a measured target is an animated one. */
const animates = (target: Element) => {
  const measured = vi.spyOn(window, "getComputedStyle");
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  const started = measured.mock.calls.some(([each]) => each === target);
  measured.mockRestore();

  return started;
};

it("u6220b_a_press_on_a_project_tab_or_its_controls_starts_no_animation", () => {
  document.body.innerHTML = '<button id="plain">Run</button><div class="project-tab"><button role="tab">api</button><button class="tab-close">x</button></div><div data-flat-tab class="terminal-tab"><button role="tab">t</button></div>';
  stop = pressFeedback(document);

  for (const target of document.querySelectorAll(".project-tab button")) expect(animates(target)).toBe(false);

  expect(animates(document.querySelector("#plain")!)).toBe(true);
  expect(animates(document.querySelector(".terminal-tab button")!)).toBe(true);
});
