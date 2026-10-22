import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

/** U3764: whether the centre shows the Project settings view, and the control to give focus back to when it closes (U3766). */
export type SettingsViewState = {
  open: Accessor<boolean>;
  show(opener: HTMLElement): void;
  /** Closes the view; `refocus` false leaves focus where the user put it. */
  close(refocus?: boolean): void;
};

export const createSettingsView = (): SettingsViewState => {
  const [open, setOpen] = createSignal(false);
  let opener: HTMLElement | undefined;

  return {
    open,
    show: (from) => { opener = from; setOpen(true); },
    close: (refocus = true) => {
      setOpen(false);

      if (refocus) opener?.focus();
    },
  };
};
