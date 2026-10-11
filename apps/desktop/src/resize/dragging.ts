import { createSignal } from "solid-js";

const [railDragging, setRailDragging] = createSignal(false);

/** U389: true while the user holds the Rail's Resize edge; the Terminal is not refitted until it ends, so a drag sends one `terminal.resize` at most. */
export { railDragging, setRailDragging };
