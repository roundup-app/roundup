import { waitFor } from "@solidjs/testing-library";
import { copy } from "../copy";

/** U2228a: a row's accessible name is its name, then its Status label; read that label once the row carries one. */
export const rowStatusLabel = async (row: HTMLElement, timeout?: number): Promise<string> => {
  let label = "";

  await waitFor(() => {
    label = (row.getAttribute("aria-label") ?? "").split(copy.comma)[1] ?? "";

    if (label === "") throw new Error("the row's accessible name has no Status label");
  }, timeout === undefined ? undefined : { timeout });

  return label;
};
