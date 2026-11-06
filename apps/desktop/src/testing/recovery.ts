import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import type { MenuItem } from "../app/seam";
import { menuProbe, openProjectPage, projectMenu } from "./menuProbe";

const PREFIX = "Unfinished work (";

/** U3289c: right-clicks the Rail background; the recovery item's label, or null while nothing qualifies. The menu is left open. */
const askRail = async (): Promise<MenuItem | null> => {
  if (!document.querySelector(".rail-scroll")) {
    await waitFor(() => { if (projectMenu.path === null) throw new Error("Project menu is connecting"); });
    openProjectPage("view:workstreams", projectMenu.path);
  }

  const before = menuProbe.count;

  await screen.findByLabelText("Rail", { selector: '[role="tree"]' });
  fireEvent.contextMenu(document.querySelector(".rail-scroll")!, { clientX: 10, clientY: 10 });

  return menuProbe.count === before ? null : menuProbe.shown?.find((item) => item.label.startsWith(PREFIX)) ?? null;
};

/** The recovery item's label in the Rail menu, or null; the menu closes unchosen. */
export const recoveryLabel = async (): Promise<string | null> => {
  const item = await askRail();

  menuProbe.answer?.(null);

  return item?.label ?? null;
};

/** Chooses "Recover unfinished work" in the Rail menu, which opens the panel. */
export const openRecovery = async (): Promise<void> => {
  let item = await askRail();

  // The work may still be settling; ask again until the item is there.
  for (let tries = 0; !item && tries < 50; tries++) {
    menuProbe.answer?.(null);
    await new Promise((done) => setTimeout(done, 40));
    item = await askRail();
  }

  if (!item) throw new Error("no recovery item in the Rail menu");

  menuProbe.answer?.(item.id);
  await new Promise((done) => setTimeout(done, 0));
};
