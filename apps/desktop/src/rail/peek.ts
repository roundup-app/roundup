import { makeEventListener } from "@solid-primitives/event-listener";
import { debounce } from "@solid-primitives/scheduled";
import { createEffect, createSignal, on, type Accessor } from "solid-js";
import { createEdgePeek, OPEN_LAYER, PEEK_DWELL } from "../ui/edgePeek";

const STRIP = ".rail-strip";

/** U6228: while the Rail is a strip, a pointer resting on the strip or at the window's leading edge slides the full Rail out over the centre; leaving or Escape slides it back. Using the peeked Rail changes nothing: only an explicit expand opens it. */
export const createRailPeek = (collapsed: Accessor<boolean>, region: () => Element | null) => {
  const [open, setOpen] = createSignal(false);
  const peeking = () => collapsed() && open();
  const unpeek = () => setOpen(false);
  const peek = () => { if (collapsed()) setOpen(true); };

  const dwell = debounce(peek, PEEK_DWELL);

  createEdgePeek({ edge: "leading", region, state: { peeking, peek, unpeek } });

  // The strip is not at the window's edge in the module's sense, so a rest on it dwells here too.
  makeEventListener(document, "pointermove", (event) => {
    // By position, not target: a tooltip over a mark takes the pointer's target without the pointer leaving the strip.
    const box = document.querySelector(STRIP)?.getBoundingClientRect();
    const onStrip = box !== undefined && event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom;

    if (!peeking() && onStrip && event.pointerType === "mouse" && event.buttons === 0 && document.querySelector(OPEN_LAYER) === null) dwell();
    else dwell.clear();
  });

  // Escape closes a peek from anywhere, the Terminal included, unless a Drawer, dialog or menu owns the key.
  makeEventListener(document, "keydown", (event) => {
    if (event.key === "Escape" && peeking() && document.querySelector(OPEN_LAYER) === null) unpeek();
  }, { capture: true });

  createEffect(on(collapsed, (now) => { if (!now) unpeek(); }));

  return peeking;
};
