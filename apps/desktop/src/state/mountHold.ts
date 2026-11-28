import { createSignal } from "solid-js";

const [mountHeld, setMountHeld] = createSignal(false);

/** U8075: true from the click that opens Changes until the frame that starts the fold has painted; the view mounts after it, so the slide starts first. */
export { mountHeld };

export const holdMount = () => {
  setMountHeld(true);
  requestAnimationFrame(() => setTimeout(() => setMountHeld(false)));
};
