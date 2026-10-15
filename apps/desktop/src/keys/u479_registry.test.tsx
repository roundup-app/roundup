import { createRoot } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { registerKeys, type KeyScope } from "./registry";

const disposals: (() => void)[] = [];
afterEach(() => { disposals.splice(0).forEach((dispose) => dispose()); document.body.replaceChildren(); });
const mount = (run: () => void) => createRoot((dispose) => { disposals.push(dispose); run(); });
const element = (parent: HTMLElement = document.body) => {
  const node = document.createElement("div");
  node.tabIndex = 0;
  parent.append(node);
  return node;
};
const press = (target: HTMLElement) => {
  target.focus();
  const event = new KeyboardEvent("keydown", { key: "m", code: "KeyM", metaKey: true, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

it("u479_scope_precedence_ignores_registration_order", () => {
  for (const reverse of [false, true]) {
    const first = element();
    const second = element();
    const panel = element();
    let open = true;
    const actions: string[] = [];
    const scopes: [string, KeyScope][] = [
      ["app", { kind: "app" }],
      ["first", { kind: "region", element: () => first }],
      ["second", { kind: "region", element: () => second }],
      ["layer", { kind: "layer", element: () => panel, active: () => open, modal: true }],
    ];
    mount(() => { for (const [name, scope] of reverse ? scopes.reverse() : scopes) registerKeys(scope, [{ chords: ["Meta+KeyM"], run: () => actions.push(name) }]); });
    expect(press(first).defaultPrevented).toBe(true);
    open = false;
    press(second);
    press(first);
    press(element());
    expect(actions).toEqual(["layer", "second", "first", "app"]);
    disposals.splice(0).forEach((dispose) => dispose());
  }
});
