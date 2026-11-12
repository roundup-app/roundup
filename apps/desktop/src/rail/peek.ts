import { createEffect, createSignal, on, type Accessor } from "solid-js";
import { CHORDS } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { createEdgePeek, OPEN_LAYER } from "../ui/edgePeek";

const STRIP = ".rail-strip";

const HANDLE = ".rail-handle";

/** U6228: while the Rail is a strip, a pointer resting on the strip or at the window's leading edge slides the full Rail out over the centre; leaving or Escape slides it back. Using the peeked Rail changes nothing: only an explicit expand opens it. */
export const createRailPeek = (collapsed: Accessor<boolean>, region: () => Element | null) => {
  const [open, setOpen] = createSignal(false);
  const peeking = () => collapsed() && open();
  const unpeek = () => setOpen(false);
  const peek = () => { if (collapsed()) setOpen(true); };

  createEdgePeek({ edge: "leading", region, sensor: () => document.querySelector(STRIP), handle: HANDLE, state: { peeking, peek, unpeek } });

  // Escape closes a peek from anywhere, the Terminal included, unless a Drawer, dialog or menu owns the key.
  registerKeys({ kind: "app" }, [{ action: CHORDS["rail.close-peek"], searchable: false,
    when: press => !press.defaultPrevented && press.key === "Escape" && peeking() && document.querySelector(OPEN_LAYER) === null,
    capture: () => ({ available: peeking, invoke: unpeek }) }]);

  createEffect(on(collapsed, (now) => { if (!now) unpeek(); }));

  return peeking;
};
