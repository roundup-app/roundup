import type { AppSeam } from "./seam";

/** U6044a: the root wears the colour of the Fork the App runs on; the live data folder answers `null`, and the root keeps the live Tokens. */
export const applyForkColour = async (app: Pick<AppSeam, "forkColour">, root: HTMLElement): Promise<void> => {
  const colour = await app.forkColour().catch(() => null);

  if (colour) root.dataset.forkColour = colour;
  else delete root.dataset.forkColour;
};
