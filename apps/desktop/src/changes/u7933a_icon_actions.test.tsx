import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { copy } from "./copy";
import type { RemoteChip as Chip } from "./remote";
import { RemoteChip } from "./RemoteChip";

afterEach(cleanup);

const chip = (kind: "moved" | "failed"): Chip => kind === "moved" ? { kind } : { kind, cause: "x" };

it("u7933a_no_action_button_shows_text", () => {
  for (const [kind, name] of [["moved", copy.fetch], ["failed", copy.retry]] as const) {
    render(() => <RemoteChip chip={chip(kind)} fetch={() => {}} retry={() => {}} />);

    const button = screen.getByRole("button", { name });

    expect(button.textContent).toBe("");
    expect(button.querySelector("svg.icon")).not.toBeNull();
    cleanup();
  }
});
