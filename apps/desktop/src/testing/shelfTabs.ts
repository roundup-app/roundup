import { fireEvent, screen, within } from "@solidjs/testing-library";

/** U373: the Shelf shows one list at a time; this opens the named tab as a click does. */
export const showShelfTab = (name: "Todos" | "Pads"): void => {
  fireEvent.click(within(screen.getByRole("tablist", { name: "Shelf" })).getByRole("tab", { name: new RegExp(`^${name}`) }));
};
