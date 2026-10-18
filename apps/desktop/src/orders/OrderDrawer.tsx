import { copy } from "../copy";
import type { Order } from "@contracts/agent/Order";
import { For, Match, Show, Switch, createResource, createSignal, onCleanup } from "solid-js";
import { KindGlyph } from "../ink/KindGlyph";
import { Icon } from "../ink/Icon";
import { Markdown } from "../plain/Markdown";
import "./styles.css";
import { useConnectedProject } from "../state/connectedProject";

type SpawnRead = { id: string; prompt: string | null; error: string | null };

type WorkOrder = Extract<Order, { kind: "work" }>;

/** O6: the whole order of one Agent or Door. What it shows follows the Rail, so a changed order reaches it. */
export const OrderDrawer = (props: { id: string; inline?: boolean }) => {
  const { rail, app } = useConnectedProject();
  const node = () => rail.nodes.find((each) => each.id === props.id);
  const order = () => node()?.work ?? null;
  const finished = () => node()?.status?.kind === "done";
  const [editing, setEditing] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);

  /** O10, U83: read on opening the order or selecting a closed Agent; a failed read keeps its text. */
  const [read] = createResource(() => props.id, async (id): Promise<SpawnRead> => {
    try {
      const answer = await app.rpc("agent.spawnPrompt", { id });

      return { id, prompt: answer.prompt, error: null };
    } catch (thrown) {
      return { id, prompt: null, error: thrown instanceof Error ? thrown.message : copy.thePromptCouldNotBeRead };
    }
  });

  const spawn = () => read()?.id === props.id ? read() : undefined;

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
      setFailure(thrown instanceof Error && thrown.message !== "" ? thrown.message : copy.theOrderCouldNotBeSaved);
    }
  };

  const resizeField = (field: HTMLTextAreaElement) => {
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  };

  const sizeField = (field: HTMLTextAreaElement) => {
    queueMicrotask(() => resizeField(field));

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => resizeField(field));
    observer.observe(field);
    onCleanup(() => observer.disconnect());
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
        <span class="order-field-label">{copy.title}</span>
        <textarea name="title" rows={1} ref={(field) => { sizeField(field); queueMicrotask(() => field.focus()); }} onInput={(event) => resizeField(event.currentTarget)}>{each.title ?? ""}</textarea>
      </label>
      <label class="order-field">
        <span class="order-field-label">{copy.ask}</span>
        <textarea name="ask" rows={3} ref={sizeField} onInput={(event) => resizeField(event.currentTarget)}>{each.ask}</textarea>
      </label>
      <label class="order-field">
        <span class="order-field-label">{copy.doneWhen}</span>
        <textarea name="done" rows={1} ref={sizeField} onInput={(event) => resizeField(event.currentTarget)}>{each.done ?? ""}</textarea>
      </label>
      <Show when={failure()}>{(text) => <p class="order-edit-error" role="alert"><KindGlyph kind="error" /><span>{text()}</span></p>}</Show>
      <div class="order-edit-actions">
        <button data-button="primary" type="submit">{copy.save}</button>
        <button data-button="quiet" type="button" onClick={close}>{copy.cancel}</button>
      </div>
    </form>
  );

  const shown = (each: WorkOrder) => (
    <>
      <div class="order-head">
        <Markdown class="order-title" body={each.title ?? each.ask} />
        <button ref={editButton} data-button="icon" type="button" aria-label={copy.editOrder} title={copy.editOrder} onClick={() => setEditing(true)}>
          <Icon name="edit" />
        </button>
      </div>
      <Show when={each.title}>
        <Markdown class="order-ask" body={each.ask} />
      </Show>
      <Show when={each.done}>
        {(done) => (
          <p class="order-done-line" data-done={finished()}>
            <span class="order-done-mark" role="img" aria-label={finished() ? copy.done : copy.notDone}>
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
      class={props.inline ? "order-overview" : "order-drawer"}
      aria-label={copy.fullOrderOf(node()?.name ?? props.id)}
    >
      <Show when={props.inline ? node()?.overview : undefined}>
        {(overview) => <header class="overview-session">
          <p class="light">{overview().program}</p>
          <Show when={overview().name}>{(name) => <h2>{name()}</h2>}</Show>
          <p class="overview-id">{overview().id}</p>
          <Show when={overview().used !== undefined && overview().limit !== undefined && overview().limit! > 0}>
            <div class="overview-context">
              <span>Context {new Intl.NumberFormat("en", { notation: "compact" }).format(overview().used!)} / {new Intl.NumberFormat("en", { notation: "compact" }).format(overview().limit!)}</span>
              <meter aria-label="Context" aria-valuenow={overview().used} aria-valuemax={overview().limit} min={0} max={overview().limit} value={overview().used} />
              <span>{Math.round(overview().used! / overview().limit! * 100)}%</span>
            </div>
          </Show>
          <div class="overview-card">
            <Show when={overview().card?.intent}>{(text) => <section><h3>Intent</h3><Markdown body={text()} /></section>}</Show>
            <Show when={overview().card?.shape}>{(text) => <section><h3>Shape</h3><Markdown body={text()} /></section>}</Show>
            <Show when={overview().card?.facts?.length}><section><h3>Facts</h3><ul><For each={overview().card?.facts}>{(fact) => <li><Markdown body={fact} /></li>}</For></ul></section></Show>
            <Show when={overview().card?.outcome}>{(text) => <section><h3>Outcome</h3><Markdown body={text()} /></section>}</Show>
          </div>
        </header>}
      </Show>
      <Switch>
        <Match when={order()} keyed>
          {(each) =>
            each.kind === "work" ? (
              <>
                <Show when={editing()} fallback={shown(each)}>
                  {editor(each)}
                </Show>
                <Show when={props.inline && each.limits.length > 0}><section><h3>Limits</h3><ul><For each={each.limits}>{(limit) => <li><Markdown body={limit} /></li>}</For></ul></section></Show>

              </>
            ) : (
              <Markdown class="order-ask" body={each.question} />
            )
          }
        </Match>
      </Switch>
      <Show when={(props.inline || order()?.kind === "work") && (spawn()?.prompt ?? spawn()?.error)}>
        {(text) => (
          <Show when={props.inline} fallback={
            <details class="order-prompt">
              <summary>{copy.prompt}</summary>
              <Show when={spawn()?.error === null} fallback={<p class="order-prompt-error">{text()}</p>}>
                <Markdown class="order-prompt-body" body={text()} />
              </Show>
            </details>
          }>
            <section class="order-prompt">
              <h3>{copy.prompt}</h3>
              <Show when={spawn()?.error === null} fallback={<p class="order-prompt-error">{text()}</p>}>
                <Markdown class="order-prompt-body" body={text()} />
              </Show>
            </section>
          </Show>
        )}
      </Show>
    </section>
  );
};
