import { captureActions } from "../keys/registry";
import { fireEvent, screen, within } from "@solidjs/testing-library";

/** U373: open or select the named list without closing an already open tab. */
export const showShelfTab = (name: "Todos" | "Pads"): void => {
  if (!screen.queryByRole("tablist", { name: "Work items" })) captureActions(document.activeElement).find(action => action.value === "action:leader:S")?.run();
  const tab = within(screen.getByRole("tablist", { name: "Work items" })).getByRole("tab", { name: new RegExp(`^${name}`) });

  if (tab.getAttribute("aria-expanded") !== "true") fireEvent.click(tab);
};
