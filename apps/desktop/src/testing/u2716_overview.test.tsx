import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openTabs, path } from "../header/stripFixture";
import { agent, door, event, terminal } from "./nodes";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u2716a_click_opens_the_project_overview", async () => {
  await openTabs({ p: [agent("worker", "working", "busy")] });
  const row = document.querySelector<HTMLElement>('.rail-row[data-id="worker"]')!;
  fireEvent.click(row);
  const band = screen.getByRole("button", { name: /Overview.*Project root/ });
  await waitFor(() => expect(band.getAttribute("aria-pressed")).toBe("false"));
  fireEvent.click(band);
  await waitFor(() => expect(band.getAttribute("aria-pressed")).toBe("true"));
  expect(document.querySelector(".centre .changes")).not.toBeNull();
});

it("u2716a_attention_name_follows_tree_and_status", async () => {
  const nodes = [door("home", "working", "busy"), agent("worker", "working", "busy"), terminal("shell")];
  const { app } = await openTabs({ p: nodes });
  const daemon = app.of(path("p"));
  const band = screen.getByRole("button", { name: /Overview.*Project root/ });
  fireEvent.click(document.querySelector<HTMLElement>('.rail-row[data-id="worker"]')!);
  await waitFor(() => expect(band.getAttribute("aria-pressed")).toBe("false"));
  expect(screen.getByRole("button", { name: /Overview.*Project root$/ })).toBe(band);
  fireEvent.click(band);
  await waitFor(() => expect(document.querySelector(".changes")).not.toBeNull());
  expect(document.querySelectorAll(".changes .change-row")).toHaveLength(0);

  daemon.handlers["rail.tree"] = () => [door("home", "error", "failed"), agent("worker", "needs-you", "permission"), terminal("shell")];
  daemon.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(document.querySelectorAll(".changes .change-row")).toHaveLength(2));
  fireEvent.click(document.querySelector<HTMLElement>('.rail-row[data-id="worker"]')!);
  await screen.findByRole("button", { name: /Overview.*Project root.*\b2\b/ });
  fireEvent.click(band);
  await waitFor(() => expect(document.querySelectorAll(".changes .change-row")).toHaveLength(2));

  daemon.emit(event({ name: "agent.status", data: { id: "worker", attempt: "1", status_revision: "2", status: { kind: "working", label: "busy", since: 40, finished: "0" } } }));
  await waitFor(() => expect(document.querySelectorAll(".changes .change-row")).toHaveLength(1));
  fireEvent.click(document.querySelector<HTMLElement>('.rail-row[data-id="worker"]')!);
  await screen.findByRole("button", { name: /Overview.*Project root.*\b1\b/ });
});
