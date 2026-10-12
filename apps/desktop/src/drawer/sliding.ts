import { createSignal } from "solid-js";

const [drawerSliding, setDrawerSliding] = createSignal(false);

/** U430: true while a Drawer slides, the centre narrowing or widening with it; the Terminal is not refitted until it ends, so a slide sends one `terminal.resize`. */
export { drawerSliding, setDrawerSliding };
