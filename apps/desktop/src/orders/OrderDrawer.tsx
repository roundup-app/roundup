import * as v from "valibot";
import { RpcError, INTERNAL_CODE } from "../app/seam";
import { IconButton } from "../ui/IconButton";
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

const formSchema = v.object({
  title: v.string(), ask: v.string(), done: v.string(), field: v.picklist(["title", "ask", "done"]),
  baseTitle: v.nullable(v.string()), baseAsk: v.string(), baseDone: v.nullable(v.string()), limits: v.array(v.string()),
});

/** O6: the whole order of one Agent or Door. What it shows follows the Rail, so a changed order reaches it. */
export const OrderDrawer = (props: { id: string; inline?: boolean }) =>
  <Show when={props.id} keyed>{(id) => <OrderContent id={id} inline={props.inline ?? false} />}</Show>;

const OrderContent = (props: { id: string; inline?: boolean }) => {
  const { rail, app, drafts, project } = useConnectedProject();
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

  const destination = () => ({ surface: "orders", object: props.id, recipient: props.id });

  const records = () => drafts.list().filter((draft) => draft.destination.surface === "orders"
    && draft.destination.object === props.id && draft.destination.recipient === props.id);

  const current = () => records().filter((draft) => draft.status === "draft").at(-1) ?? records().at(-1);
  const [selected, selectRevision] = createSignal<string | null>(null);
  const selectedDraft = () => records().find((draft) => draft.revision === selected());
  const [initial, setInitial] = createSignal<v.InferOutput<typeof formSchema> | null>(null);
  const formValue = () => v.safeParse(formSchema, selectedDraft()?.value ?? initial());

  const base = (): WorkOrder | null => {
    const parsed = formValue();

    if (!parsed.success) return null;
    const value = parsed.output;

    const original: WorkOrder = { kind: "work", ask: value.baseAsk, limits: value.limits };

    if (value.baseTitle !== null) original.title = value.baseTitle;

    if (value.baseDone !== null) original.done = value.baseDone;

    return original;
  };

  const conflict = () => {
    const original = base();
    const latest = order();

    return original !== null && (latest?.kind !== "work" || original.title !== latest.title
      || original.ask !== latest.ask || original.done !== latest.done
      || JSON.stringify(original.limits) !== JSON.stringify(latest.limits));
  };

  let form: HTMLFormElement | undefined;
  let disposed = false;
  onCleanup(() => { disposed = true; });

  const begin = () => {
    const draft = current();
    const each = order();

    if (!draft && each?.kind !== "work") return;
    setInitial(each?.kind === "work" ? {
      title: each.title ?? "", ask: each.ask, done: each.done ?? "", field: "title",
      baseTitle: each.title ?? null, baseAsk: each.ask, baseDone: each.done ?? null, limits: [...each.limits],
    } : null);
    selectRevision(draft?.revision ?? null);
    setEditing(true);
  };

  const capture = (field: HTMLTextAreaElement) => {
    const parsed = formValue();

    if (!parsed.success || !form) return;
    const fields = new FormData(form);

    const next = drafts.edit(destination(), { ...parsed.output,
      title: String(fields.get("title") ?? ""), ask: String(fields.get("ask") ?? ""),
      done: String(fields.get("done") ?? ""), field: field.name,
    }, { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection }, "ordinary");

    selectRevision(next.draft.revision);
  };

  const saveBlocked = () => conflict() || (selectedDraft() !== undefined
    && !["draft", "failed"].includes(selectedDraft()!.status));

  const recovery = () => conflict() || drafts.problem() || ["failed", "unknown"].includes(selectedDraft()?.status ?? "");

  /** Capture the revision and original recipient before crossing the RPC boundary. */
  const save = async () => {
    const draft = selectedDraft();
    const parsed = formValue();
    const captured = base();

    if (saveBlocked()) return;

    if (!draft) {
      close();

      return;
    }

    if (!parsed.success || !captured) return;
    const snapshot = drafts.submit(draft.revision);

    if (!snapshot) return;
    const fields = parsed.output;
    const next: WorkOrder = { kind: "work", ask: fields.ask.trim(), limits: captured.limits };

    if (fields.title.trim()) next.title = fields.title.trim();

    if (fields.done.trim()) next.done = fields.done.trim();

    try {
      await app.rpc("agent.setOrder", {
        id: snapshot.draft.destination.object, order: next, captured: { order: captured },
      });
      drafts.settle(draft.revision, "acknowledged");

      if (!disposed && selected() === draft.revision) close();
    } catch (thrown) {
      drafts.settle(draft.revision, thrown instanceof RpcError && thrown.code !== INTERNAL_CODE ? "failed" : "unknown");

      if (!disposed) setFailure(thrown instanceof Error && thrown.message !== "" ? thrown.message : copy.theOrderCouldNotBeSaved);
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

  const editor = () => (
    <form
      class="order-edit"
      ref={form}
      onSubmit={(submit) => {
        submit.preventDefault();
        void save();
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
      <For each={[{ name: "title", label: copy.title }, { name: "ask", label: copy.ask }, { name: "done", label: copy.doneWhen }] as const}>{(item) =>
        <label class="order-field">
          <span class="order-field-label">{item.label}</span>
          <textarea name={item.name} readOnly={selectedDraft()?.status === "unknown"} rows={item.name === "ask" ? 3 : 1} ref={(field) => {
            const parsed = formValue();

            if (parsed.success) field.value = String(parsed.output[item.name]);
            const draft = selectedDraft();

            if (parsed.success && parsed.output.field === item.name) {
              if (draft?.selection) field.setSelectionRange(draft.selection.start, draft.selection.end, draft.selection.direction);
              queueMicrotask(() => { if (field.isConnected) field.focus(); });
            }

            sizeField(field);
          }} onInput={(event) => { resizeField(event.currentTarget); capture(event.currentTarget); }} onSelect={(event) => {
            const draft = selectedDraft();

            if (document.activeElement === event.currentTarget && draft?.status === "draft") capture(event.currentTarget);
          }} />
        </label>
      }</For>
      <Show when={selectedDraft()}>{(draft) => <Show when={draft().status !== "draft"}><p data-state={draft().status}>{copy.draftStatus[draft().status]}</p></Show>}</Show>
      <Show when={failure()}>{(text) => <p class="order-edit-error" role="alert"><KindGlyph kind="error" /><span>{text()}</span></p>}</Show>
      <Show when={!formValue().success}><p class="order-edit-error" role="alert">{copy.orderRestoreFailed}</p></Show>
      <Show when={conflict()}><p class="order-edit-conflict" role="alert">{copy.orderChanged}</p></Show>
      <Show when={drafts.problem()}>{(problem) => <div class="order-edit-retention" role="alert"><p>{copy.draftRetention(project.name, copy.draftSurface(destination().surface), problem().cause)}</p><button data-button="quiet" type="button" onClick={() => drafts.retry()}>{copy.storageRetry}</button></div>}</Show>
      <Show when={recovery()}><div class="order-edit-actions">
        <For each={["title", "ask", "done"]}>{(name) => <button data-button="quiet" type="button" onClick={() => void navigator.clipboard.writeText(String(selectedDraft()?.value[name] ?? "")).catch((error) => setFailure(copy.copyDraftFailure(error instanceof Error ? error.message : String(error))))}>{copy.copyField(name)}</button>}</For>
        <button data-button="quiet" type="button" onClick={() => {
          const draft = selectedDraft();

          if (draft) drafts.discard(draft.revision);
          close();
        }}>{copy.discardRevision}</button>
      </div></Show>
      <div class="order-edit-actions">
        <button data-button="primary" type="submit" aria-disabled={saveBlocked()}>{copy.save}</button>
        <button data-button="quiet" type="button" onClick={close}>{copy.cancel}</button>
      </div>
    </form>
  );

  const shown = (each: WorkOrder) => (
    <>
      <div class="order-head">
        <Markdown class="order-title" body={each.title ?? each.ask} />
        <IconButton ref={editButton} aria-label={copy.editOrder} onClick={begin}>
          <Icon name="edit" />
        </IconButton>
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
              <span>{copy.contextUse(overview().used!, overview().limit!)}</span>
              <meter aria-label={copy.context} aria-valuenow={overview().used} aria-valuemax={overview().limit} min={0} max={overview().limit} value={overview().used} />
              <span>{copy.percent(Math.round(overview().used! / overview().limit! * 100))}</span>
            </div>
          </Show>
          <div class="overview-card">
            <Show when={overview().card?.intent}>{(text) => <section><h3>{copy.cardIntent}</h3><Markdown body={text()} /></section>}</Show>
            <Show when={overview().card?.shape}>{(text) => <section><h3>{copy.cardShape}</h3><Markdown body={text()} /></section>}</Show>
            <Show when={overview().card?.facts?.length}><section><h3>{copy.cardFacts}</h3><ul><For each={overview().card?.facts}>{(fact) => <li><Markdown body={fact} /></li>}</For></ul></section></Show>
            <Show when={overview().card?.outcome}>{(text) => <section><h3>{copy.cardOutcome}</h3><Markdown body={text()} /></section>}</Show>
          </div>
        </header>}
      </Show>
      <Show when={editing()} fallback={<Switch>
        <Match when={order()} keyed>
          {(each) =>
            each.kind === "work" ? (
              <>
                {shown(each)}
                <Show when={props.inline && each.limits.length > 0}><section><h3>{copy.orderLimits}</h3><ul><For each={each.limits}>{(limit) => <li><Markdown body={limit} /></li>}</For></ul></section></Show>

              </>
            ) : (
              <Markdown class="order-ask" body={each.question} />
            )
          }
        </Match>
      </Switch>}>{editor()}</Show>
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
