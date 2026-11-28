import { createSignal } from "solid-js";

const [mountDeferred, setMountDeferred] = createSignal(false);

/** U8075: true from the click that opens Changes until the frame that starts the fold has painted; the view mounts after it, so the slide starts first. */
export { mountDeferred };

export const holdMount = () => {
  setMountDeferred(true);
  requestAnimationFrame(() => setTimeout(() => setMountDeferred(false)));
};
