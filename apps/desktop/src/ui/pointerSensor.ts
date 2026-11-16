import { PointerActivationConstraints, PointerSensor, type Draggable } from "@dnd-kit/dom";

/** A press that moves less than this is a click. */
const PRESS_DRAG_PX = 4;

// DOM 0.5.1 cancels pointercancel/Escape, but omits window blur even while activation is pending.
class InterruptiblePointerSensor extends PointerSensor {
  private stopBlur: (() => void) | undefined;

  protected override handlePointerDown(event: PointerEvent, source: Draggable, options: Parameters<PointerSensor["bind"]>[1]) {
    const previous = this.controller;

    super.handlePointerDown(event, source, options);

    if (!this.controller || this.controller === previous) return;
    const owner = event.view ?? window;
    const cancel = (event: Event) => this.handleCancel(event);

    owner.addEventListener("blur", cancel);
    this.stopBlur = () => owner.removeEventListener("blur", cancel);
  }

  protected override handleStart(source: Draggable, event: PointerEvent) {
    super.handleStart(source, event);

    // A blur during capture can make the superclass attach its final listeners after cancellation.
    if (!this.controller) this.cleanup();
  }

  protected override cleanup() {
    this.stopBlur?.();
    this.stopBlur = undefined;
    super.cleanup();
  }
}

/** What acts on its own press: a press that starts on one never starts a row's drag. */
const CONTROLS = "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [contenteditable]:not([contenteditable=false]), [role=checkbox], [data-no-drag]";

/** The row is the drag surface; a control inside it is not, unless it is the row's handle or its own title button (`data-drag-surface`), which drags as a Project tab does. */
const onControl = (event: PointerEvent, source: Draggable) => {
  const control = event.target instanceof Element ? event.target.closest(CONTROLS) : null;

  return control !== null && control !== source.element && control !== source.handle && !control.matches("[data-drag-surface]");
};

export const pointerSensor = () => ({ ...PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: PRESS_DRAG_PX })], preventActivation: onControl }), plugin: InterruptiblePointerSensor });
