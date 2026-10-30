// T4902 retires T29 duration setup; existing non-duration proofs below remain.
import { createNow, DisplayClockContext } from "../state/clock";
import { createSignal, onMount, Show } from "solid-js";
import { expect, vi } from "vitest";
import { within, render, fireEvent, waitFor } from "@solidjs/testing-library";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Todo } from "@contracts/todo/Todo";
import { Layout } from "../app/Layout";
import { DrawerHost } from "../drawer/DrawerHost";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { event, USER } from "../testing/nodes";
import { showEverything, withScopeRow } from "../testing/showEverything";
import { todoHandlers } from "../testing/stores";
import type { TodoStore } from "../testing/stores";
import { Todos } from "./Todos";
import { useTodoList } from "./todoList";
// Resolve the lazy editor fixture before the first Drawer opens, as padsFixture does.
import "../pads/PadRichEditor";
import type { TodosState } from "./state";
import { Rail } from "../rail/Rail";

// U4698d's browser observer exercises Milkdown itself; these fixtures keep real draft/RPC settlement
// and substitute only the shared editor handle, as the Pad failure-lifetime fixtures do.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("../pads/PadRichEditor", async (original) => {
  const actual = await original<typeof import("../pads/PadRichEditor")>();

  return { default: (props: import("solid-js").ComponentProps<typeof import("../pads/PadRichEditor").default>) => {
  if (props.label === undefined) return <actual.default {...props} />;
  let field: HTMLTextAreaElement | undefined;
  const [text, setText] = createSignal(props.text);
  let base = props.text;
  onMount(() => {
    if (!props.initialFocus) return;
    props.onReady({
      getText: () => field!.value,
      setText: value => { base = value; setText(value); },
      focus: () => field!.focus(),
      unchanged: () => field!.value === base,
      snapshot: () => ({ source: base, text: field!.value, document: "{}", trailingCaret: false }),
      restoreDocument: () => true,
      selection: () => ({ start: field!.selectionStart, end: field!.selectionEnd, direction: field!.selectionDirection }),
      restoreSelection: selection => field!.setSelectionRange(selection.start, selection.end, selection.direction),
      scrollToHeading: () => {},
    });
  });

  return <Show when={!!props.initialFocus} fallback={<p tabIndex={0}>{props.text}</p>}><textarea ref={field} aria-label={props.label} spellcheck={false} autocorrect="off" autocapitalize="off" value={text()}
    onInput={event => { setText(event.currentTarget.value); props.onChange(); props.onText(text()); }}
    onSelect={() => props.onSelection?.()} onBlur={event => props.onBlur(event.relatedTarget)} /></Show>;
} }; });

export const todo = (id: number, over: Partial<Todo> = {}): Todo => ({
  id,
  title: `todo ${id}`,
  body: "",
  done: false,
  blockers: [],
  blocked: false,
  created_at: 0,
  updated_at: 0,
  creator: USER,
  home: null,
  owner: null,
  refs: [],
  priority: null,
  ...over,
});

export const todoEvent = (name: "todo.created" | "todo.updated", data: Todo): DaemonEvent => event({ name, data });

/** The Shelf's Todos and the Drawer host over a fake Daemon whose `todo.list` answers `store.todos`. */
export const mountTodos = async (initial: Todo[], reducedMotion = true, rail: RailNode[] = [], renderRail = false, path = `/test-todos/${crypto.randomUUID()}`, clock: () => number = () => 0) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => withScopeRow(rail);
  const store: TodoStore = { todos: initial };
  Object.assign(app.handlers, todoHandlers(store, () => {}));

  const [reduced, setReduced] = createSignal(reducedMotion);
  const connected = await connectProject(app, { name: "p", path }, reduced, () => 0);

  await showEverything(connected);


  let todos!: TodosState;

  const Shelf = () => {
    todos = useTodoList();

    return <Todos />;
  };

  const { unmount } = render(() => {
    const now = createNow(clock, () => false);

    return <DisplayClockContext.Provider value={now.subscribe}>
    <ConnectedProjectContext.Provider value={connected}>
      <Layout
        header="roundup"
        rail={renderRail ? <Rail /> : null}
        centre={null}
        shelf={<Shelf />}
        overlay={<DrawerHost drawer={connected.drawer} reducedMotion={reduced} />}
      />
    </ConnectedProjectContext.Provider>
  </DisplayClockContext.Provider>;
  });

  if (initial.length > 0) await waitFor(() => expect(document.querySelector(".shelf-groups [data-part=branch-control], .shelf-done-line")).not.toBeNull());
  const disclosure = document.querySelector<HTMLElement>('[data-shelf-group="unassigned"] [data-part="branch-control"]');

  if (disclosure) fireEvent.click(disclosure);

  return { app, store, connected, todos, unmount, setReduced };
};

export const todoCallsTo = (app: ReturnType<typeof createFakeApp>, method: string) =>
  app.calls.filter((call) => call.method === method);

export const todoRowOf = (id: number): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-id="${id}"]`);

  if (!found) throw new Error(`no row for #${id}`);

  return found;
};

export const assertKind = (button: HTMLElement, kind: "idle" | "blocked" | "done") => {
  const row = button.closest<HTMLElement>(".shelf-row") ?? button;
  const mark = within(row).getByRole("img", { name: { idle: "Idle", blocked: "Blocked", done: "Done" }[kind] });

  expect(within(row).getAllByRole("img")).toEqual([mark]);
  expect(mark.querySelectorAll("svg")).toHaveLength(1);
  expect(mark.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(mark.textContent).toBe("");
};
