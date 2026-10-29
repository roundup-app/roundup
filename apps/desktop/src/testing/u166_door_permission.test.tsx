// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "./requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { createFakeApp } from "./fakeApp";
import { door } from "./nodes";

afterEach(cleanup);

// Native exchange/authorization and transcript receipt remain in
// b50_note_inbox's a3564a_ and b50_a_note_is_delivered_when_the_transcript_records_it.
it("u166_selecting_a_requesting_door_keeps_the_other_workstream_idle_after_reopen", async () => {
  const app = createFakeApp();
  const requesting = door("requesting", "needs-you", "native permission");
  const other = door("other", "idle", "ready");

  app.opened.project = { name: "project", path: "/project" };
  app.handlers["rail.tree"] = () => [other, requesting];

  const mount = () => render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

  mount();
  const rail = await screen.findByRole("region", { name: "Rail" });

  const row = await waitFor(() => {
    const found = rail.querySelector<HTMLElement>(`.rail-row[data-id="${requesting.id}"]`);

    if (!found) throw new Error("the requesting Door row has not arrived");

    return found;
  });

  fireEvent.click(row.querySelector(".name")!);
  await waitFor(() => expect(rail.querySelector(".rail-row[data-selected=true]")?.getAttribute("data-id")).toBe(requesting.id));
  expect(row.getAttribute("data-kind")).toBe("needs-you");
  expect(rail.querySelector(`.rail-row[data-id="${other.id}"]`)?.getAttribute("data-kind")).toBe("idle");
  expect(screen.queryByRole("region", { name: / wants to / })).toBeNull();

  cleanup();
  mount();
  const reopened = await screen.findByRole("region", { name: "Rail" });

  await waitFor(() => expect(reopened.querySelector(`.rail-row[data-id="${requesting.id}"]`)?.getAttribute("data-kind")).toBe("needs-you"));
  expect(reopened.querySelector(`.rail-row[data-id="${other.id}"]`)?.getAttribute("data-kind")).toBe("idle");
  expect(screen.queryByRole("region", { name: / wants to / })).toBeNull();
  expect(app.calls.filter(({ method }) => ["message.send", "agent.prompt", "terminal.write", "rail.startDoor"].includes(method))).toEqual([]);
});
