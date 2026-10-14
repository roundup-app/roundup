import { createSignal } from "solid-js";

const [shelfSliding, setShelfSliding] = createSignal(false);

/** U371: a reserved Shelf slide refits the visible Terminal once, after the centre settles. */
export { shelfSliding, setShelfSliding };
