import type { Order } from "@contracts/agent/Order";
import { Match, Show, Switch, createResource, createSignal } from "solid-js";
import { Icon } from "../ink/Icon";
import { Markdown } from "../plain/Markdown";
import "./styles.css";
import { useConnectedProject } from "../state/connectedProject";

type SpawnRead = { prompt: string | null; error: string | null };

type WorkOrder = Extract<Order, { kind: "work" }>;

/** O6: the whole order of one Agent or Door. What it shows follows the Rail, so a changed order reaches it. */
export const OrderDrawer = (props: { id: string }) => {
  const { rail, app } = useConnectedProject();
  const node = () => rail.nodes.find((each) => each.id === props.id);
  const order = () => node()?.work ?? null;
  const finished = () => node()?.status?.kind === "done";
  const [editing, setEditing] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);

  /** O10: read when the Drawer opens, never on the Rail; a failed read keeps its text. */
  const [spawn] = createResource(() => props.id, async (id): Promise<SpawnRead> => {
    try {
      const answer = await app.rpc("agent.spawnPrompt", { id });

      return { prompt: answer.prompt, error: null };
    } catch (thrown) {
      return { prompt: null, error: thrown instanceof Error ? thrown.message : "the prompt could not be read" };
    }
  });

  let editButton: HTMLButtonElement | undefined;

  const close = () => {
    setEditing(false);
    setFailure(null);
    queueMicrotask(() => editButton?.focus());
  };

  /** O16: the edited title, ask and done replace the order's; the limits go back as they were. */
  const save = async (current: WorkOrder, form: HTMLFormElement) => {
    const fields = new FormData(form);
    const text = (name: string): string => String(fields.get(name) ?? "").trim();

    const next: WorkOrder = { kind: "work", ask: text("ask"), limits: current.limits };

    if (text("title") !== "") next.title = text("title");

    if (text("done") !== "") next.done = text("done");

    try {
      await app.rpc("agent.setOrder", { id: props.id, order: next });

      close();
    } catch (thrown) {
      setFailure(thrown instanceof Error && thrown.message !== "" ? thrown.message : "the order could not be saved");
    }
  };

  const editor = (each: WorkOrder) => (
    <form
      class="order-edit"
      onSubmit={(submit) => {
        submit.preventDefault();
        void save(each, submit.currentTarget);
      }}
      onKeyDown={(key) => {
        const single = key.target instanceof HTMLTextAreaElement && key.target.name !== "ask";

        if (key.key === "Enter" && single && !key.shiftKey) {
          key.preventDefault();
          key.currentTarget.requestSubmit();
        }

        if (key.key === "Escape") {
          key.preventDefault();
          key.stopPropagation();
          close();
        }
      }}
    >
      <label class="order-field">
        <span class="order-field-label">Title</span>
        <textarea name="title" rows={1} ref={(field) => queueMicrotask(() => field.focus())}>{each.title ?? ""}</textarea>
      </label>
      <label class="order-field">
        <span class="order-field-label">Ask</span>
        <textarea name="ask" rows={3}>{each.ask}</textarea>
      </label>
      <label class="order-field">
        <span class="order-field-label">Done when</span>
        <textarea name="done" rows={1}>{each.done ?? ""}</textarea>
      </label>
      <Show when={failure()}>{(text) => <p class="order-edit-error" role="alert">{text()}</p>}</Show>
      <div class="order-edit-actions">
        <button data-button="primary" type="submit">Save</button>
        <button data-button="quiet" type="button" onClick={close}>Cancel</button>
      </div>
    </form>
  );

  const shown = (each: WorkOrder) => (
    <>
      <div class="order-head">
        <Markdown class="order-title" body={each.title ?? each.ask} />
        <button ref={editButton} data-button="icon" type="button" aria-label="Edit order" title="Edit order" onClick={() => setEditing(true)}>
          <Icon name="edit" />
        </button>
      </div>
      <Show when={each.title}>
        <Markdown class="order-ask" body={each.ask} />
      </Show>
      <Show when={each.done}>
        {(done) => (
          <p class="order-done-line" data-done={finished()}>
            <span class="order-done-mark" role="img" aria-label={finished() ? "done" : "not done"}>
              <Icon name={finished() ? "check" : "circle"} />
            </span>
            <span class="order-done">{done()}</span>
          </p>
        )}
      </Show>
    </>
  );

  return (
    <section
      class="order-drawer"
      aria-label={`full order of ${node()?.name ?? props.id}`}
    >
      <Switch>
        <Match when={order()} keyed>
          {(each) =>
            each.kind === "work" ? (
              <>
                <Show when={editing()} fallback={shown(each)}>
                  {editor(each)}
                </Show>
                <Show when={spawn()?.prompt ?? spawn()?.error}>
                  {(text) => (
                    <details class="order-prompt">
                      <summary>Prompt</summary>
                      <Show
                        when={spawn()?.error === null}
                        fallback={<p class="order-prompt-error">{text()}</p>}
                      >
                        <Markdown class="order-prompt-body" body={text()} />
                      </Show>
                    </details>
                  )}
                </Show>
              </>
            ) : (
              <Markdown class="order-ask" body={each.question} />
            )
          }
        </Match>
      </Switch>
    </section>
  );
};
