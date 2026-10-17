import { fireEvent, waitFor } from "@solidjs/testing-library";

/** U521: a row carries no native `title`; its Status label is the first line of the row's Tooltip, opened as a pointer over the row opens it. */
export const rowStatusLabel = async (row: HTMLElement): Promise<string> => {
  const control = row.querySelector<HTMLElement>('[data-part="branch-control"]') ?? row;
  let label = "";

  await waitFor(() => {
    fireEvent.pointerMove(control, { pointerType: "mouse" });
    // A Tooltip another row opened can still be closing: read the one this row's trigger names.
    const tip = document.getElementById(control.getAttribute("aria-describedby") ?? "");

    label = tip?.firstElementChild?.textContent ?? "";

    if (label === "") throw new Error("the row's Tooltip has no Status label");
  });

  return label;
};
