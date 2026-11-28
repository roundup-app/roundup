import { createSignal } from "solid-js";

const [railSliding, setRailSliding] = createSignal(false);

/** U6228g: true while the Rail slides over the centre; the centre keeps its width and the Terminal is not refitted until it ends, so a fold sends one `terminal.resize`. */
export { railSliding, setRailSliding };

const [railAtStart, setRailAtStart] = createSignal(false);

/** U6228g, U8075: true while a Changes fold slides; its column took its final width at the click, so the centre does not change at the slide's end. */
export { railAtStart, setRailAtStart };
