import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import type { MenuItem } from "../app/seam";
import { menuProbe, openProjectPage, projectMenu } from "./menuProbe";

const PREFIX = "Recover ";

/** U3289c: right-clicks the Overview row; the recovery item's label, or null while nothing qualifies. The menu is left open. */
const askOverview = async (): Promise<MenuItem | null> => {
  if (!document.querySelector("[data-todo-root]")) {
    await waitFor(() => { if (projectMenu.path === null) throw new Error("Project menu is connecting"); });
    openProjectPage("view:workstreams", projectMenu.path);
  }

  const before = menuProbe.count;

  fireEvent.contextMenu(await screen.findByRole("button", { name: /^Overview/ }), { clientX: 10, clientY: 10 });

  return menuProbe.count === before ? null : menuProbe.shown?.find((item) => item.label.startsWith(PREFIX)) ?? null;
};

/** The recovery item's label in the Overview menu, or null; the menu closes unchosen. */
export const recoveryLabel = async (): Promise<string | null> => {
  const item = await askOverview();

  menuProbe.answer?.(null);

  return item?.label ?? null;
};

/** Chooses "Recover unfinished work" in the Overview menu, which opens the panel. */
export const openRecovery = async (): Promise<void> => {
  let item = await askOverview();

  // The work may still be settling; ask again until the item is there.
  for (let tries = 0; !item && tries < 50; tries++) {
    menuProbe.answer?.(null);
    await new Promise((done) => setTimeout(done, 40));
    item = await askOverview();
  }

  if (!item) throw new Error("no recovery item in the Overview menu");

  menuProbe.answer?.(item.id);
  await new Promise((done) => setTimeout(done, 0));
};
