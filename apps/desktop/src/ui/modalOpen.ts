import { createSignal } from "solid-js";

const [count, setCount] = createSignal(0);

/** U3767: a modal Dialog is mounted; what floats under it closes instead of drawing over it. */
export const modalOpen = () => count() > 0;

/** Called by a modal Dialog's content as it mounts; the returned function ends the claim. */
export const claimModal = () => {
  setCount((now) => now + 1);

  return () => setCount((now) => now - 1);
};
