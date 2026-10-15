import { createRoot } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { registerKeys, type KeyScope } from "./registry";

const disposals: (() => void)[] = [];

afterEach(() => { disposals.splice(0).forEach((dispose) => dispose()); document.body.replaceChildren(); });

const mount = (run: () => void) => createRoot((dispose) => { disposals.push(dispose); run();

 return dispose; });

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

it("u479_nested_scope_uses_the_innermost_active_owner", () => {
  const outer = element();
  const inner = element(outer);
  const outerPanel = element();
  const innerPanel = element();
  let layers = true;
  const actions: string[] = [];
  mount(() => {
    for (const [name, node] of [["inner", inner], ["outer", outer]] as const)
      registerKeys({ kind: "region", element: () => node }, [{ chords: ["Meta+KeyM"], run: () => actions.push(name) }]);

    const outerScope: KeyScope = { kind: "layer", element: () => outerPanel, active: () => layers, modal: true };
    const innerScope: KeyScope = { kind: "layer", element: () => innerPanel, active: () => layers, modal: true, parent: outerScope };

    registerKeys(innerScope, [{ chords: ["Meta+KeyM"], run: () => actions.push("inner-layer") }]);
    registerKeys(outerScope, [{ chords: ["Meta+KeyM"], run: () => actions.push("outer-layer") }]);
  });
  press(inner);
  layers = false;
  press(inner);
  expect(actions).toEqual(["inner-layer", "inner"]);
});

it("u479_modal_blocks_unbound_shortcuts_and_region_misses_reach_app", () => {
  const region = element();
  const panel = element();
  let open = true;
  const actions: string[] = [];
  mount(() => {
    registerKeys({ kind: "app" }, [{ chords: ["Meta+KeyM"], run: () => actions.push("app") }]);
    registerKeys({ kind: "region", element: () => region }, [{ chords: ["Meta+KeyN"], run: () => actions.push("region") }]);
    registerKeys({ kind: "layer", element: () => panel, active: () => open, modal: true }, []);
    const child = element(panel);
    registerKeys({ kind: "layer", element: () => child, active: () => open, modal: false }, []);
  });
  expect(press(region).defaultPrevented).toBe(false);
  expect(actions).toEqual([]);
  open = false;
  press(region);
  expect(actions).toEqual(["app"]);
});

it("u479_handled_events_act_once_and_unhandled_events_keep_defaults", () => {
  const target = element();
  let count = 0;
  mount(() => registerKeys({ kind: "app" }, [
    { chords: ["Meta+KeyM"], run: () => count++ },
    { chords: ["Meta+KeyM"], run: () => count++ },
  ]));
  const legacy = () => count++;

  window.addEventListener("keydown", legacy, true);
  expect(press(target).defaultPrevented).toBe(true);
  window.removeEventListener("keydown", legacy, true);
  expect(count).toBe(1);
  const native = new KeyboardEvent("keydown", { key: "x", code: "KeyX", bubbles: true, cancelable: true });
  target.dispatchEvent(native);
  expect(native.defaultPrevented).toBe(false);

  const unspecified = new Event("keydown", { bubbles: true, cancelable: true });

  target.dispatchEvent(unspecified);
  expect(unspecified.defaultPrevented).toBe(false);
  expect(count).toBe(1);
});

it("u479_disposal_and_project_switch_remove_stale_actions", () => {
  const target = element();
  const panel = element();
  const actions: string[] = [];
  const project = mount(() => registerKeys({ kind: "app" }, [{ chords: ["Meta+KeyM"], run: () => actions.push("old") }]));
  const region = mount(() => registerKeys({ kind: "region", element: () => target }, [{ chords: ["Meta+KeyM"], run: () => actions.push("region") }]));
  const layer = mount(() => registerKeys({ kind: "layer", element: () => panel, active: () => true, modal: true }, [{ chords: ["Meta+KeyM"], run: () => actions.push("layer") }]));
  press(target);
  layer();
  press(target);
  region();
  press(target);
  project();
  expect(press(target).defaultPrevented).toBe(false);
  mount(() => registerKeys({ kind: "app" }, [{ chords: ["Meta+KeyM"], run: () => actions.push("new") }]));
  press(target);
  expect(actions).toEqual(["layer", "region", "old", "new"]);
});

it("u479_remount_has_one_dispatch", () => {
  const target = element();
  let count = 0;
  const attach = () => mount(() => registerKeys({ kind: "app" }, [{ chords: ["Meta+KeyM"], run: () => count++ }]));
  attach();
  disposals.splice(0).forEach((dispose) => dispose());
  attach();
  press(target);
  expect(count).toBe(1);
});
