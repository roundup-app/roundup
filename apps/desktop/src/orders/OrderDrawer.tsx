import { Match, Show, Switch, createResource, createSignal } from "solid-js";
import type { Order } from "@contracts/agent/Order";
import { Icon } from "../ink/Icon";
import { Markdown } from "../plain/Markdown";
import "./styles.css";
import { useConnectedProject } from "../state/connectedProject";

type SpawnRead = { prompt: string | null; error: string | null };

type Work = Extract<Order, { kind: "work" }>;

/** O16: the fields of one edit; a blank `title` or `done` is sent absent. */
const edited = (order: Work, fields: { title: string; ask: string; done: string }): Order => {
  const next: Work = { kind: "work", ask: fields.ask, limits: order.limits };
  const title = fields.title.trim();
  const done = fields.done.trim();

  if (title !== "") next.title = title;

  if (done !== "") next.done = done;

  return next;
};

/** O16: the title, ask and done condition as fields; Save sends `agent.setOrder`, Escape or Cancel sends nothing. */
const OrderFields = (props: {
  order: Work;
  error: string | null;
  onSave: (fields: { title: string; ask: string; done: string }) => void;
  onCancel: () => void;
}) => {
  const [title, setTitle] = createSignal(props.order.title ?? "");
  const [ask, setAsk] = createSignal(props.order.ask);
  const [done, setDone] = createSignal(props.order.done ?? "");

  return (
    <form
      class="order-fields"
      aria-label="edit order"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave({ title: title(), ask: ask(), done: done() });
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onCancel();
      }}
    >
      <label>
        Title
        <input ref={(field) => queueMicrotask(() => field.focus())} value={title()} onInput={(event) => setTitle(event.currentTarget.value)} />
      </label>
      <label>
        Ask
        <textarea rows={3} value={ask()} onInput={(event) => setAsk(event.currentTarget.value)} />
      </label>
      <label>
        Done when
        <input value={done()} onInput={(event) => setDone(event.currentTarget.value)} />
      </label>
      <Show when={props.error}>{(text) => <p class="order-error" role="alert">{text()}</p>}</Show>
      <div class="order-actions">
        <button data-button="quiet" type="button" onClick={() => props.onCancel()}>Cancel</button>
        <button data-button="primary" type="submit">Save</button>
      </div>
    </form>
  );
};

/** O6: the whole order of one Agent or Door. What it shows follows the Rail, so a changed order reaches it. */
export const OrderDrawer = (props: { id: string }) => {
  const { rail, app } = useConnectedProject();
  const node = () => rail.nodes.find((each) => each.id === props.id);
  const order = () => node()?.work ?? null;
  const [editing, setEditing] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const stop = () => {
    setEditing(false);
    setError(null);
  };

  const save = async (order: Work, fields: { title: string; ask: string; done: string }) => {
    try {
      await app.rpc("agent.setOrder", { id: props.id, order: edited(order, fields) });
      stop();
    } catch (thrown) {
      setError(thrown instanceof Error && thrown.message !== "" ? thrown.message : "the order could not be saved");
    }
  };

  /** O10: read when the Drawer opens, never on the Rail; a failed read keeps its text. */
  const [spawn] = createResource(() => props.id, async (id): Promise<SpawnRead> => {
    try {
      const answer = await app.rpc("agent.spawnPrompt", { id });

      return { prompt: answer.prompt, error: null };
    } catch (thrown) {
      return { prompt: null, error: thrown instanceof Error ? thrown.message : "the prompt could not be read" };
    }
  });

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
                <Show
                  when={editing()}
                  fallback={
                    <>
                      <header class="order-head">
                        <Show
                          when={each.title}
                          fallback={<Markdown class="order-title order-ask" body={each.ask} />}
                        >
                          {(title) => <h2 class="order-title">{title()}</h2>}
                        </Show>
                        <button data-button="icon" type="button" aria-label="Edit order" onClick={() => setEditing(true)}>
                          <Icon name="edit" />
                        </button>
                      </header>
                      <Show when={each.title}>
                        <Markdown class="order-ask" body={each.ask} />
                      </Show>
                      <Show when={each.done}>
                        {(done) => (
                          <p class="order-done" data-done={node()?.status?.kind === "done" ? "true" : "false"}>
                            <Icon name={node()?.status?.kind === "done" ? "check" : "circle"} />
                            <span>{done()}</span>
                          </p>
                        )}
                      </Show>
                    </>
                  }
                >
                  <OrderFields order={each} error={error()} onSave={(fields) => void save(each, fields)} onCancel={stop} />
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
