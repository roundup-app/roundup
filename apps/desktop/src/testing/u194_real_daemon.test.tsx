// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { createFakeApp } from "./fakeApp";
import { door } from "./nodes";

afterEach(cleanup);

describe("a3564a a Door's native prompt is attended to in its own Terminal in the App", () => {
  it("a3564a_attention_opens_the_requesting_terminal", async () => {
    const app = createFakeApp();
    const requesting = door("requesting", "needs-you", "native prompt");

    app.opened.project = { name: "project", path: "/project" };
    app.handlers["rail.tree"] = () => [requesting];

    const emulators = fakeEmulators();

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={emulators.factory} />);
    const rail = await screen.findByRole("region", { name: "Rail" });

    // Native attention opens the requesting Terminal only through explicit Open.
    const row = await waitFor(() => {
      const found = rail.querySelector<HTMLElement>(`[data-id="${requesting.id}"]`);

      if (!found) throw new Error("the requesting Door row has not arrived");

      return found;
    });

    fireEvent.click(row.querySelector(".name")!);
    const id = requesting.id;

    await waitFor(() => expect(rail.querySelector(".rail-row[data-selected=true]")?.getAttribute("data-id")).toBe(id));
    fireEvent.keyDown(rail.querySelector(`.rail-row[data-id="${id}"]`)!, { key: "Enter" });
    await waitFor(() => expect(emulators.made.get(requesting.terminal_id!)?.host?.contains(document.activeElement)).toBe(true));
    expect(screen.queryByRole("region", { name: / wants to / })).toBeNull();
  });
});
