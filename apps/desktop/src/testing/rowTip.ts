import { waitFor } from "@solidjs/testing-library";
import { copy } from "./copy";

/** U2228a: a row's accessible name is its name, then its Status label; read that label once the row carries one. */
export const rowStatusLabel = async (row: HTMLElement): Promise<string> => {
  let label = "";

  await waitFor(() => {
    label = (row.getAttribute("aria-label") ?? "").split(copy.comma)[1] ?? "";

    if (label === "") throw new Error("the row's accessible name has no Status label");
  });

  return label;
};

/** What a row shows: a Tooltip's content sits inside its cell, hidden, so it is no part of what the row reads. */
export const shownText = (node: Node): string =>
  node instanceof Element && node.matches("[data-slot=tooltip-content]") ? ""
    : node.nodeType === Node.TEXT_NODE ? node.textContent ?? ""
      : [...node.childNodes].map(shownText).join("");
