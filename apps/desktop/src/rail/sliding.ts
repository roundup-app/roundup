import { createSignal } from "solid-js";

const [railSliding, setRailSliding] = createSignal(false);

/** U6228g: true while the Rail slides over the centre; the centre keeps its width and the Terminal is not refitted until it ends, so a fold sends one `terminal.resize`. */
export { railSliding, setRailSliding };

const [foldPending, setFoldPending] = createSignal(false);

/** U7610b: true from the task that opens Changes until its fold has started; the centre is about to move. */
export { foldPending, setFoldPending };
