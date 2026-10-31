import { copy } from "./copy";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Deliverable } from "@contracts/deliverable/Deliverable";
import { ask, input, mountAskBar } from "./askFixture";
import { RpcError } from "../app/seam";

afterEach(cleanup);

it("p3557c_failure_lifetime_ask_rows", async () => {
  const waiting = (text: string) => ({ text, placement: { kind: "unclear" as const, question: "Which?", candidates: ["lead", "ops"] }, state: "waiting" as const });
  const { app } = await mountAskBar([ask("a1", 1, [waiting("first"), waiting("second")])]);
  const lines = () => [...document.querySelectorAll(".ask-row")].map(row => row.querySelector(".reserved-line")?.getAttribute("title") ?? null);

  app.handlers["ask.pick"] = () => { throw new Error("pick refused"); };

  await waitFor(() => expect(document.querySelectorAll(".ask-row")).toHaveLength(2));
  fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".ask-row")[0]!.querySelector<HTMLButtonElement>(".ask-choices button")!);
  await waitFor(() => expect(lines()[0]).toContain("pick refused"));
  expect(lines()[1]).toBeNull();

  // Dismissal clears exactly that part's line and nothing else.
  fireEvent.click(within(document.querySelectorAll<HTMLElement>(".ask-row")[0]!).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(lines()).toEqual([null, null]));

  // A later acknowledged pick of the same part clears its failure.
  fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".ask-row")[0]!.querySelector<HTMLButtonElement>(".ask-choices button")!);
  await waitFor(() => expect(lines()[0]).toContain("pick refused"));
  app.handlers["ask.pick"] = () => ask("a1", 1, [{ text: "first", placement: { kind: "routed", workstream: "lead" }, state: "queued" }, waiting("second")]);
  fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".ask-row")[0]!.querySelector<HTMLButtonElement>(".ask-choices button")!);
  await waitFor(() => expect(lines()[0]).toBeNull());
});

const published = (n: number): Deliverable => ({
  id: `publication-${n}`, project: "project-original", maker: { kind: "agent", id: "gone", parent: null }, maker_name: "Review", home: null,
  title: `Title ${n}`, published_at: 1792713600000,
  target: { kind: "pad", name: "pad", incarnation: "inc", revision: n, sha256: `hash-${n}`, length: 10 },
});

it("p3557c_failure_lifetime_ask_bar_deliverables", async () => {
  const { app, connected } = await mountAskBar();
  connected.showView("made");
  let records = [published(1), published(2)];

  app.handlers["deliverable.list"] = () => records;
  app.handlers["deliverable.resolve"] = ({ id }) => id === "publication-1" ? { kind: "unavailable", cause: "missing-revision" } : { kind: "retained", path: "/p", sha256: "h" };
  window.dispatchEvent(new Event("focus"));
  const made = await screen.findByRole("region", { name: "Made" });
  const rows = () => within(made).getAllByRole("listitem");
  const lines = () => rows().map(row => row.querySelector(".reserved-line")?.getAttribute("title") || null);
  const open = (i: number) => fireEvent.click(within(rows()[i]!).getAllByRole("button")[0]!);

  type(input(), "unfinished");
  await waitFor(() => expect(rows()).toHaveLength(2));
  open(0);
  await waitFor(() => expect(lines()[0]).toContain("the saved version is missing"));

  // A successful action on another record leaves the first failure alone.
  open(1);
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(lines()[0]).toContain("the saved version is missing");
  expect(lines()[1]).toBeNull();

  // Dismissal clears it, without touching the typed input.
  fireEvent.click(within(rows()[0]!).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(lines()).toEqual([null, null]));

  // A later acknowledged open of the same record clears its failure.
  open(0);
  await waitFor(() => expect(lines()[0]).not.toBeNull());
  app.handlers["deliverable.resolve"] = () => ({ kind: "retained", path: "/p", sha256: "h" });
  open(0);
  await waitFor(() => expect(lines()[0]).toBeNull());
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));

  // Removing a record does not move its failure to the record that takes its place.
  app.handlers["deliverable.resolve"] = () => ({ kind: "unavailable", cause: "missing-revision" });
  open(0);
  await waitFor(() => expect(lines()[0]).not.toBeNull());
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  records = [published(2)];
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(lines()).toEqual([null]);
  expect(input()!.value).toBe("unfinished");
});

function type(element: HTMLTextAreaElement | HTMLInputElement | null, value: string) {
  fireEvent.input(element!, { target: { value } });
}

it("p3557c_failure_lifetime_ask_bar_send_dismiss_once", async () => {
  const { app } = await mountAskBar();
  app.handlers["ask.send"] = () => { throw new RpcError(-32003, "the Daemon refused the ask"); };

  type(input(), "send me");
  fireEvent.keyDown(input()!, { key: "Enter" });
  const line = () => document.querySelector(".ask-send-status")?.getAttribute("title") ?? null;
  await waitFor(() => expect(line()).toContain("refused"));

  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(line()).toBeNull());
  expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
});

it("u4277c_empty_made_keeps_refresh_and_distinguishes_read_failure", async () => {
  const { app, connected } = await mountAskBar();
  connected.showView("made");
  const made = await screen.findByRole("region", { name: "Made" });
  await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  expect(within(made).queryAllByRole("listitem")).toHaveLength(0);
  expect(within(made).queryAllByRole("button", { name: /^Open / })).toHaveLength(0);
  app.handlers["deliverable.list"] = () => { throw new RpcError(-32003, "Publication list unavailable"); };

  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(within(made).getByRole("alert")).toBeTruthy());
  app.handlers["deliverable.list"] = () => [published(1)];
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(within(made).getAllByRole("listitem")).toHaveLength(1));
  expect(app.calls.filter(call => ["deliverable.resolve", "ask.send", "agent.spawn", "terminal.write"].includes(call.method))).toHaveLength(0);
});
