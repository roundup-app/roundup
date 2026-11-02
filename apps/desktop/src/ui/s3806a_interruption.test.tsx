import { cleanup, render, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bubbleCalls, mountBubbles, TERMINALS } from "../bubbles/bubblesFixture";
import { resizeDragging, setResizeDragging } from "../resize/dragging";
import { Splitter } from "./Splitter";
import type { Sortable as LibrarySortable } from "@dnd-kit/dom/sortable";
import { Sortable } from "./sortable";
import { For } from "solid-js";
import { openOnRelease } from "./contextMenu";
import { info } from "../testing/nodes";
import { placesStorage, ZONES } from "../bubbles/places";

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  placesStorage("/p").write({ "2": { x: 200, y: 100, w: 300, h: 300, min: false } });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

const pointer = (type: string, target: EventTarget = window, button = 0, x = 440, y = 340) => {
  const event = new PointerEvent(type, { isPrimary: true, pointerId: 1, pointerType: "mouse", button, buttons: button === 2 ? 2 : 1,
    clientX: x, clientY: y, bubbles: true, cancelable: true });

  target.dispatchEvent(event);
};

const interrupt = (trigger: string, target: HTMLElement) => {
  if (trigger === "window-blur" || trigger === "capture-blur") window.dispatchEvent(new Event("blur"));
  else if (trigger === "element-blur") target.dispatchEvent(new FocusEvent("blur"));
  else if (trigger === "focus-transfer") document.querySelector<HTMLElement>(".s3806-focus")!.focus();
  else pointer("pointercancel");
};

const owners = ["move", ...ZONES.map(zone => zone.name), "pull"];

const rows = owners.flatMap(owner => ["window-blur", "element-blur", "focus-transfer", "pointercancel", "capture-blur"].flatMap(trigger =>
  (trigger === "capture-blur" ? (owner === "pull" ? [] : ["before"]) : (owner === "move" ? ["before", "moved"] : ["before", "queued", "moved"])).map(phase => ({ owner, trigger, phase }))));

rows.push(...["window-blur", "element-blur", "focus-transfer", "pointercancel", "selection", "replacement", "unmount", "rejection", "release", "pressed"].map(trigger => ({ owner: "pull-open", trigger, phase: "pending" })));

rows.push(...["menu", "split-rail", "split-shelf", "sort-flat", "sort-tree", "sort-external"].flatMap(owner =>
  ["window-blur", "pointercancel", "element-blur", "focus-transfer"].flatMap(trigger => ["before", "moved"].map(phase => ({ owner, trigger, phase })))));

rows.push(...["split-rail", "split-shelf", "sort-flat", "sort-tree", "sort-external"].map(owner => ({ owner, trigger: "capture-blur", phase: "before" })));

const shared = async (owner: string, trigger: string, phase: string) => {
  if (owner === "menu") {
    const open = vi.fn();
    const view = render(() => <button onContextMenu={event => openOnRelease(event, open)}>Menu</button>);
    const target = view.getByRole("button");
    fireEvent.contextMenu(target, { button: 2, buttons: 2, clientX: 400, clientY: 300 });

    if (phase === "moved") pointer("pointermove", target, 2, 402, 300);

    if (trigger === "window-blur") window.dispatchEvent(new Event("blur"));
    else if (trigger === "pointercancel") pointer("pointercancel", document, 2);
    else target.dispatchEvent(new FocusEvent("blur"));
    pointer("pointerup", target, 2, 402, 300);
    expect(open).toHaveBeenCalledTimes(trigger === "window-blur" || trigger === "pointercancel" ? 0 : 1);
    open.mockClear();
    fireEvent.contextMenu(target, { button: 2, buttons: 2, clientX: 400, clientY: 300 });
    pointer("pointerup", target, 2, 402, 300);
    expect(open).toHaveBeenCalledExactlyOnceWith(402, 300);
    fireEvent.contextMenu(target, { button: 2, buttons: 2, clientX: 400, clientY: 300 });
    pointer("pointerup", target, 2, 420, 300);
    expect(open).toHaveBeenCalledTimes(1);

    return;
  }

  const terminals = owner.startsWith("split-") ? await mountBubbles("a") : null;

  if (owner.startsWith("split-")) vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  // jsdom omits WAAPI; the real gesture engines still own activation and cancellation.
  Object.defineProperty(document, "getAnimations", { configurable: true, value: () => [] });
  Object.defineProperty(HTMLElement.prototype, "getAnimations", { configurable: true, value: () => [] });

  // Zag sends use microtasks. dnd-kit schedules pointer movement on rAF, then its Solid renderer completes in the next task.
  const settle = async () => {
    if (owner.startsWith("split-")) await vi.advanceTimersByTimeAsync(0);
    else { await frame(); await frame(); }
  };

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const y = this.getAttribute("data-id") === "B" ? 50 : 0;
    const row = this.hasAttribute("data-id") || this.matches(".sortable-slot, .sortable-overlay");

    return { x: 0, y, left: 0, top: y, right: row ? 200 : 1280, bottom: y + (row ? 50 : 300), width: row ? 200 : 1280, height: row ? 50 : 300, toJSON() {} };
  });
  const commits = vi.fn();
  const preview = vi.fn();
  const dragging = vi.fn();
  const continuing = trigger === "element-blur" || trigger === "focus-transfer";

  if (owner.startsWith("split")) {
    const direction = owner === "split-rail" ? 1 : -1;

    const view = render(() => <div data-layout-root=""><section data-layout-panel="rail" hidden={direction === -1} /><section data-layout-panel="centre" /><section data-layout-panel="shelf" hidden={direction === 1} />
      <Splitter onDragging={active => { dragging(active); setResizeDragging(active); }} side={{ label: "Width", direction, min: 240, fallback: 288, now: () => 288, room: () => 560, preview, commit: commits }} /><button class="s3806-focus">Other</button></div>);

    const target = view.getByRole("separator");
    let captured = false;
    target.setPointerCapture = () => { captured = true;

 if (trigger === "capture-blur") window.dispatchEvent(new Event("blur")); };

    target.hasPointerCapture = () => captured;
    target.releasePointerCapture = () => { captured = false; };

    target.focus();
    await settle();
    const fitted = terminals!.emulators.made.get("1")!;
    const fits = fitted.fits;
    pointer("pointerdown", target, 0, 400, 100);
    expect(resizeDragging()).toBe(true);

    if (phase === "moved") { await settle(); pointer("pointermove", document, 0, 400 + direction * 64, 100); await settle(); expect(preview).toHaveBeenLastCalledWith(352); }

    if (trigger === "capture-blur") await settle();
    else if (trigger === "pointercancel") pointer("pointercancel", document);
    else interrupt(trigger, target);
    await settle();

    if (!continuing) {
      expect(captured).toBe(false);
      expect(target.hasAttribute("data-dragging")).toBe(false);
      expect(dragging).toHaveBeenLastCalledWith(false);
      expect(resizeDragging()).toBe(false);
      // Pane::refitNextFrame schedules its fit after the shared hold falls.
      await vi.advanceTimersByTimeAsync(16);
      expect(fitted.fits).toBeGreaterThan(fits);
      expect(bubbleCalls(terminals!.app, "terminal.write")).toEqual([]);

      if (phase === "moved") expect(preview).toHaveBeenLastCalledWith(288);
    }

    const count = preview.mock.calls.length;
    pointer("pointermove", document, 0, 400 + direction * 96, 100);
    pointer("pointerup", target, 0, 400 + direction * 96, 100);
    await settle();
    expect(commits).toHaveBeenCalledTimes(continuing ? 1 : 0);

    if (!continuing) expect(preview).toHaveBeenCalledTimes(count);
    commits.mockClear();
    target.setPointerCapture = () => { captured = true; };

    pointer("pointerdown", target, 0, 400, 100); await settle();
    pointer("pointermove", document, 0, 400 + direction * 64, 100); await settle();
    pointer("pointerup", target); await settle();
    expect(commits).toHaveBeenCalledTimes(1);
    expect(dragging).toHaveBeenLastCalledWith(false);

    return;
  }

  Object.defineProperty(document.body, "setPointerCapture", { configurable: true, writable: true, value: () => { if (trigger === "capture-blur") window.dispatchEvent(new Event("blur")); } });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.querySelector('[data-id="B"]') });
  const outside = document.createElement("div");
  document.body.append(outside);
  let source!: LibrarySortable;

  const view = render(() => <><Sortable.Root ids={["A", "B"]} onOrderChange={commits} onDrag={dragging}
    tree={owner === "sort-tree" ? { rows: [{ id: "A", parent: null }, { id: "B", parent: null }], indent: 24, inset: () => 0, nests: () => true, onMove: commits, onPreview: preview } : undefined}
    external={owner === "sort-external" ? { target: () => ({ element: outside }), onDropOutside: commits } : undefined}>
    <For each={["A", "B"]}>{(id, index) => <Sortable.Item id={id} index={index()} pressable={owner === "sort-external"}>{parts => { if (id === "A") source = parts.sortable;

 return <div ref={element => { element.dataset.id = id; parts.ref(element); }} data-id={id}><button ref={parts.handleRef}>{id}</button></div>; }}</Sortable.Item>}</For>
    </Sortable.Root><button class="s3806-focus">Other</button></>);

  const target = view.getByRole("button", { name: "A" });
  target.focus(); await settle();
  pointer("pointerdown", target, 0, 10, 10);

  if (phase === "moved") {
    pointer("pointermove", document, 0, 40, 70); await settle();
    pointer("pointermove", document, 0, 50, 80); await settle();
    expect(dragging).toHaveBeenLastCalledWith(true);
    // jsdom has no hit testing; select B through the real manager, leaving sorting and cancellation to dnd-kit.
    void source.manager!.actions.setDropTarget("B"); await settle();
    expect(source.index).toBe(1);
  }

  if (trigger === "capture-blur") {
    pointer("pointermove", document, 0, 40, 70); await settle();
    expect(source.manager!.dragOperation.status.idle).toBe(true);
  }

  // dnd-kit owns document pointer cancellation, while Bubble owns window cancellation.
  if (trigger === "pointercancel") pointer("pointercancel", document);
  else if (trigger !== "capture-blur") interrupt(trigger, target);
  await settle();

  if (!continuing && phase === "moved") {
    expect(dragging).toHaveBeenLastCalledWith(false);
    expect(source.index).toBe(0);
    expect(source.manager!.dragOperation.status.idle).toBe(true);
  }

  pointer("pointermove", document, 0, 50, 80); await settle();

  if (continuing && phase === "before") {
    expect(dragging).toHaveBeenLastCalledWith(true);
    void source.manager!.actions.setDropTarget("B"); await settle();
  }

  pointer("pointerup", target, 0, 50, 80); await settle();

  if (!continuing) expect(commits).not.toHaveBeenCalled();
  else expect(commits).toHaveBeenCalledTimes(1);
  expect(source.manager!.dragOperation.status.idle).toBe(true);
  expect(outside.hasAttribute("data-drop")).toBe(false);

  if (owner === "sort-tree" && (phase === "moved" || continuing)) expect(preview).toHaveBeenLastCalledWith(null);

  if (continuing) { outside.remove();

 return; }

  commits.mockClear();
  document.body.setPointerCapture = () => {};

  pointer("pointerdown", target, 0, 10, 10);
  pointer("pointermove", document, 0, 40, 70); await settle();
    pointer("pointermove", document, 0, 50, 80); await settle();
  expect(dragging).toHaveBeenLastCalledWith(true);
  void source.manager!.actions.setDropTarget("B"); await settle();
  expect(source.index).toBe(1);
  pointer("pointerup", target, 0, 40, 70); await settle();
  expect(dragging).toHaveBeenLastCalledWith(false);

  if (owner === "sort-flat") expect(commits).toHaveBeenCalledExactlyOnceWith(["B", "A"], "A");

  if (owner === "sort-tree") expect(commits).toHaveBeenCalledExactlyOnceWith({ id: "A", parent: "B", index: 0 });

  if (owner === "sort-external") expect(commits).toHaveBeenCalledExactlyOnceWith("A", { element: outside });
  outside.remove();
};

const pendingPull = async (trigger: string) => {
  const mounted = await mountBubbles("other");
  let resolve!: (value: { terminal_id: string }) => void;
  let reject!: (error: Error) => void;
  mounted.app.handlers["terminal.open"] = () => new Promise((yes, no) => { resolve = yes; reject = no; });
  const target = document.querySelector<HTMLElement>(".rail-row")!;
  const other = document.createElement("button");
  other.className = "s3806-focus";
  mounted.container.append(other);
  target.focus();
  pointer("pointerdown", target, 2, 400, 300);
  pointer("pointermove", window, 2);
  await waitFor(() => expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([{ workstream: "other", cols: 100, rows: 30 }]));

  if (trigger === "release") pointer("pointerup", window, 2);
  else if (trigger === "selection" || trigger === "replacement") mounted.connected.rail.select("w");
  else if (trigger === "unmount") cleanup();
  else if (trigger !== "pressed") interrupt(trigger === "rejection" ? "window-blur" : trigger, target);

  if (trigger === "replacement") {
    pointer("pointerdown", target, 2, 400, 300);
    pointer("pointermove", window, 2, 470, 250);
    pointer("pointerup", window, 2);
  }

  const settled = placesStorage("/p").read()["2"];
  mounted.setListed([...TERMINALS, info("9", { owner: "other", title: "opened" })]);

  if (trigger === "rejection") reject(new Error("open outcome unavailable"));
  else resolve({ terminal_id: "9" });
  await waitFor(() => expect(bubbleCalls(mounted.app, "terminal.list").length).toBeGreaterThan(trigger === "rejection" ? 0 : 1));
  await frame();
  await frame();

  const continuing = trigger === "pressed" || trigger === "element-blur";

  if (continuing) expect(placesStorage("/p").read()["9"]).toMatchObject({ x: 136, y: 192, min: false });
  pointer("pointermove", window, 2, continuing ? 500 : 700, continuing ? 160 : 500);
  pointer("pointerup", window, 2);
  await frame();
  expect(bubbleCalls(mounted.app, "terminal.open")).toHaveLength(1);
  expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
  expect(placesStorage("/p").read()["2"]).toEqual(settled);

  if (trigger === "release") expect(placesStorage("/p").read()["9"]).toMatchObject({ x: 136, y: 192, min: false });
  else if (continuing) expect(placesStorage("/p").read()["9"]).toMatchObject({ x: 192, y: 160, min: false });
  else if (trigger === "rejection") expect(document.querySelector('[role="alert"]')).not.toBeNull();
  else expect(placesStorage("/p").read()["9"]?.min).toBe(true);

  if (trigger === "unmount") return;
  mounted.connected.rail.select("w");
  pointer("pointerdown", target, 2, 400, 300);
  pointer("pointermove", window, 2, 460, 360);
  pointer("pointerup", window, 2);
  expect(placesStorage("/p").read()["2"]).toMatchObject({ x: 310, y: 300, min: false });
};

it.each(rows)("s3806a_interruption_settles_the_gesture $owner $trigger $phase", async ({ owner, trigger, phase }) => {
  if (owner === "menu" || owner.startsWith("split-") || owner.startsWith("sort-")) return shared(owner, trigger, phase);

  if (owner === "pull-open") return pendingPull(trigger);
  const mounted = await mountBubbles("w");
  await waitFor(() => expect(document.querySelector('.bubble[data-bubble="2"]')).not.toBeNull());

  const target = owner === "pull" ? document.querySelector<HTMLElement>(".rail-row")!
    : document.querySelector<HTMLElement>(owner === "move" ? '.bubble[data-bubble="2"] .bubble-header' : `.bubble-zone[data-zone="${owner}"][data-zone-of="2"]`)!;

  const other = document.createElement("button");
  other.className = "s3806-focus";
  mounted.container.append(other);
  const from = placesStorage("/p").read()["2"]!;
  const button = owner === "pull" ? 2 : 0;

  // Platform capture is the seam for synchronously delivering blur before capture returns.
  if (trigger === "capture-blur" && owner !== "pull") Object.defineProperty(target, "setPointerCapture", { configurable: true, value: () => interrupt(trigger, target) });

  if (trigger === "focus-transfer") target.focus();
  pointer("pointerdown", target, button, 400, 300);

  if (phase !== "before") {
    pointer("pointermove", window, button);

    if (owner !== "move") pointer("pointermove", window, button, 450, 350);
  }

  if (phase === "moved") await frame();

  const beforeBlur = placesStorage("/p").read()["2"]!;

  if (trigger !== "capture-blur" || owner === "pull") interrupt(trigger, target);

  // S3806a permits incidental element blur while the gesture retains ownership.
  if (trigger === "element-blur") {
    pointer("pointermove", window, button, 650, 500);
    pointer("pointerup", window, button);
    await frame();
    const after = placesStorage("/p").read()["2"]!;
    expect([after.x, after.y, after.w, after.h]).not.toEqual([beforeBlur.x, beforeBlur.y, beforeBlur.w, beforeBlur.h]);

    return;
  }

  const settled = owner === "pull" ? placesStorage("/p").read()["2"]! : { ...from, min: placesStorage("/p").read()["2"]!.min };

  // Pull keeps its completed position, including a last queued position, as U421 Escape does.
  if (owner === "pull" && phase !== "before") expect(settled).toMatchObject({ x: 300, y: 300 });
  expect(placesStorage("/p").read()["2"]).toEqual(settled);
  const writes = vi.spyOn(Storage.prototype, "setItem");
  pointer("pointermove", window, button, 650, 500);
  pointer("pointerup", window, button);
  await frame();
  expect(placesStorage("/p").read()["2"]).toEqual(settled);
  expect(writes.mock.calls.filter(([key]) => key === "roundup:bubble-places:/p")).toEqual([]);

  if (trigger === "capture-blur") Reflect.deleteProperty(target, "setPointerCapture");

  // Focus leaving the panel keeps U2307's minimisation policy; reopen before the fresh press.
  if (owner !== "pull" && settled.min) document.querySelector<HTMLButtonElement>('.terminal-tab[data-bubble="2"]')!.click();
  pointer("pointerdown", target, button, 400, 300);
  pointer("pointermove", window, button, 460, 360);
  pointer("pointerup", window, button);
  await frame();
  const after = placesStorage("/p").read()["2"]!;

  expect([after.x, after.y, after.w, after.h]).not.toEqual([settled.x, settled.y, settled.w, settled.h]);
  expect(mounted.connected.project.path).toBe("/p");
  expect(mounted.connected.rail.selected()).toBe("w");
  expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
  expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([]);
  expect(mounted.app.calls.filter(call => /agent\.(prompt|spawn)|message\.send/.test(call.method))).toEqual([]);
});

it.each([".rail-row", ".resource-strip"])("s3806a_pull_survives_terminal_blur_from_a_press_on_%s", async (selector) => {
  const mounted = await mountBubbles("a");
  const terminal = document.createElement("textarea");
  mounted.container.querySelector(".pane-screen")!.append(terminal);
  terminal.focus();
  const target = document.querySelector<HTMLElement>(selector)!;
  expect(target).not.toBeNull();
  pointer("pointerdown", target, 2, 140, 600);
  terminal.blur();
  pointer("pointermove", window, 2, 720, 460);
  pointer("pointerup", window, 2, 720, 460);
  await frame();
  expect(placesStorage("/p").read()["2"]).toMatchObject({ min: false });
  expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
});
