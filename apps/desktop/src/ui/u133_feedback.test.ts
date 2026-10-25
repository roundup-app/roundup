import { afterEach, expect, it } from "vitest";
import { pressFeedback } from "./pressFeedback";

let stop: (() => void) | undefined;

afterEach(() => { stop?.(); document.body.replaceChildren(); });

it.each(["pointercancel", "blur", "dragstart", "pointerup"])("u133_cancellation_clears_feedback_%s", (ending) => {
  document.body.innerHTML = '<button>Run</button>';
  stop = pressFeedback(document);
  const button = document.querySelector("button")!;
  button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  expect(button.dataset.pressed).toBe("true");
  window.dispatchEvent(new Event(ending));
  expect(button.hasAttribute("data-pressed")).toBe(false);
});

it("u133_feedback_preserves_editor_keys_and_disabled_controls", () => {
  document.body.innerHTML = '<input type="text"><button aria-disabled="true">Run</button>';
  stop = pressFeedback(document);

  for (const el of document.body.children) {
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }

  expect(document.querySelector("[data-pressed]")).toBeNull();
});
