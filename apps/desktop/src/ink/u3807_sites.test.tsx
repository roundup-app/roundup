import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createSignal, type JSX } from "solid-js";
import { mountBubbles, TERMINALS } from "../bubbles/bubblesFixture";
import { ChooseProject } from "../app/FirstRun";
import { RpcError } from "../app/seam";
import { Pads } from "../pads/Pads";
import { createReactions, Reactions } from "../reactions/Reactions";
import { Inbox } from "../inbox/Inbox";
import { WorkProgress } from "../orders/WorkProgress";
import { ConnectedProjectContext } from "../state/connectedProject";
import { event } from "../testing/nodes";
import { progressSeed } from "../testing/progressSeed";
import { TodoComments } from "../todos/TodoComments";
import { TodoHistory } from "../todos/TodoHistory";
import { TodoRefs } from "../todos/TodoRefs";
import { mountTodos, todo } from "../todos/testHarness";

afterEach(cleanup);

const FAILURE = "Cannot read work: try again";

const placesOf = (surface: HTMLElement) => new Map([...surface.querySelectorAll(".reserved-line")].map(place => [place, [...place.parentElement!.children]]));

const unchanged = (places: ReturnType<typeof placesOf>, place: Element) => {
  expect(places.has(place)).toBe(true);
  expect([...place.parentElement!.children]).toEqual(places.get(place));
};

type Mounted = Awaited<ReturnType<typeof mountTodos>>;

const ReactionSite = () => {
  const state = createReactions();

  return <section aria-busy={state.read.loading}><Reactions state={state} /></section>;
};

const readers: { site: string; method: "todo.unread" | "todo.comments" | "todo.getHistory" | "todo.refs" | "pad.list" | "reaction.list" | "message.progress"; render: () => JSX.Element; refresh: (mounted: Mounted) => void; role?: "status" }[] = [
  { site: "Inbox", method: "todo.unread", render: () => <Inbox />, refresh: m => m.app.emit(event({ name: "todo.commented", data: { id: 1 } })) },
  { site: "Todo comments", method: "todo.comments", render: () => <TodoComments id={1} />, refresh: m => m.app.emit(event({ name: "todo.commented", data: { id: 1 } })) },
  { site: "Todo history", method: "todo.getHistory", render: () => <TodoHistory id={1} />, refresh: m => m.app.emit(event({ name: "todo.deleted", data: { id: 2 } })) },
  { site: "Todo Pad references", method: "todo.refs", render: () => <TodoRefs id={1} />, refresh: m => m.app.emit(event({ name: "pad.changed", data: { name: "Plan" } })) },
  { site: "Pads", method: "pad.list", render: () => <Pads />, refresh: m => m.app.emit(event({ name: "pad.changed", data: { name: "Plan" } })) },
  { site: "Reactions", method: "reaction.list", render: () => <ReactionSite />, refresh: () => window.dispatchEvent(new Event("focus")), role: "status" },
  { site: "Work progress", method: "message.progress", render: () => <WorkProgress id="a" />, refresh: m => m.app.emit(event({ name: "rail.changed" })) },
];

it.each(readers)("u3807_each_site_shows_its_message_in_the_reserved_line: $site", async (site) => {
  const mounted = await mountTodos([todo(1)]);

  if (site.method === "message.progress") {
    const seed = progressSeed({ project: mounted.connected.project.path, agent: "a" });
    mounted.app.handlers["message.progress"] = () => seed.progress;
    mounted.app.handlers["message.reconcileWork"] = () => seed.plan;
  }

  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><section>{site.render()}</section></ConnectedProjectContext.Provider>);

  if (site.method === "todo.getHistory") await within(view.container).findByRole("button", { name: /change/i });

  if (site.method === "pad.list") await waitFor(() => expect(view.container.querySelector(".empty-state")).not.toBeNull());

  if (site.method === "reaction.list") await waitFor(() => expect(view.container.querySelector("[aria-busy=false]")).not.toBeNull());

  if (site.method === "message.progress") await within(view.container).findByRole("region", { name: "Progress" });

  const original = mounted.app.handlers[site.method];
  const places = placesOf(view.container);
  mounted.app.handlers[site.method] = () => { throw new RpcError(-32003, FAILURE); };

  site.refresh(mounted);
  const alert = await within(view.container).findByRole(site.role ?? "alert");
  const place = alert.closest<HTMLElement>(".reserved-line")!;
  expect(alert.textContent).toContain(FAILURE);
  unchanged(places, place);
  Object.assign(mounted.app.handlers, { [site.method]: original });
  const retry = within(place).queryByRole("button");

  if (retry) fireEvent.click(retry);
  else site.refresh(mounted);
  await waitFor(() => expect(within(view.container).queryByText(FAILURE)).toBeNull());
  unchanged(places, place);
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: first Project", () => {
  const [failure, setFailure] = createSignal<string | null>(null);
  const view = render(() => <section><ChooseProject failure={failure()} onChoose={() => {}} /></section>);
  const places = placesOf(view.container);
  setFailure(FAILURE);
  const place = within(view.container).getByRole("alert").closest(".reserved-line")!;
  unchanged(places, place);
  setFailure(null);
  expect(within(view.container).queryByRole("alert")).toBeNull();
  unchanged(places, place);
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Rail", async () => {
  const mounted = await mountTodos([todo(1)], true, [], true);
  const surface = document.querySelector<HTMLElement>(".rail")!;
  const places = placesOf(surface);
  mounted.app.handlers["rail.createWorkstream"] = () => { throw new RpcError(-32003, FAILURE); };

  await mounted.connected.rail.createWorkstream();
  const place = within(surface).getByRole("alert").closest(".reserved-line")!;
  unchanged(places, place);
  mounted.connected.rail.clearWorkstreamFailure();
  expect(within(surface).queryByRole("alert")).toBeNull();
  unchanged(places, place);
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Terminal name recovery", async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  const mounted = await mountBubbles();
  fireEvent.dblClick(document.querySelector('button.terminal-tab[data-bubble="2"] .terminal-tab-name')!);
  const field = await within(mounted.container).findByRole("textbox", { name: "Terminal name" });
  fireEvent.input(field, { target: { value: "retained name" } });
  mounted.setListed(TERMINALS.map(terminal => terminal.id === "2" ? { ...terminal, title: "external" } : terminal));
  mounted.app.emit(event({ name: "terminal.changed" }));
  await mounted.connected.rail.settled();
  fireEvent.keyDown(field, { key: "Enter" });
  const recovery = await within(document.body).findByRole("dialog", { name: "Unfinished work" });
  const places = placesOf(recovery);
  const notice = within(recovery).getByText(/original name changed/).closest(".reserved-line")!;
  mounted.setListed(TERMINALS.map(terminal => terminal.id === "2" ? { ...terminal, incarnation: "replacement" } : terminal));
  mounted.app.emit(event({ name: "terminal.changed" }));
  await mounted.connected.rail.settled();
  expect(mounted.connected.rail.terminals().find(terminal => terminal.id === "2")?.incarnation).toBe("replacement");
  expect(recovery.isConnected).toBe(true);
  await within(recovery).findByText("Original object unavailable");
  unchanged(places, notice);
});
