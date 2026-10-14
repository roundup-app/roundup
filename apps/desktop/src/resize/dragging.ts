import { createSignal } from "solid-js";

const [resizeDragging, setResizeDragging] = createSignal(false);

/** U389, U371: true while the user holds either Resize edge; the Terminal is not refitted until it ends, so a drag sends one `terminal.resize` at most. */
export { resizeDragging, setResizeDragging };
