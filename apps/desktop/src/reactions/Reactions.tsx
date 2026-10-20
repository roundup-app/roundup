import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, type Accessor } from "solid-js";
import * as v from "valibot";
import type { Reaction } from "@contracts/reaction/Reaction";
import type { Preview } from "@contracts/reaction/Preview";
import type { Condition } from "@contracts/reaction/Condition";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { resolvedWorkstream } from "../rail/layout";
import { useConnectedProject } from "../state/connectedProject";
import { Select } from "../ui/Select";
import "./styles.css";

const destination = { surface: "reactions", object: "create", recipient: null };

const formSchema = v.object({
  operation: v.string(), name: v.string(), target: v.string(), instruction: v.string(), kind: v.string(),
  ids: v.array(v.string()), any: v.boolean(), repository: v.string(), number: v.string(),
  atDate: v.string(), atTime: v.string(), atOffset: v.string(),
  expDate: v.string(), expTime: v.string(), expOffset: v.string(),
  maxFirings: v.string(), rearm: v.boolean(),
});

type Form = v.InferOutput<typeof formSchema>;

const blank = (operation: string): Form => ({
  operation, name: "", target: "", instruction: "", kind: "agents", ids: [], any: false, repository: "", number: "",
  atDate: "", atTime: "", atOffset: copy.reactionUtc, expDate: "", expTime: "", expOffset: copy.reactionUtc, maxFirings: "1", rearm: false,
});

type View = { kind: "list" } | { kind: "create" } | { kind: "detail"; id: string };

const useNames = () => {
  const { rail } = useConnectedProject();

  return (id: string) => rail.nodes.find((node) => node.id === id)?.name ?? copy.reactionGone(id);
};

const conditionText = (condition: Condition, nameOf: (id: string) => string): string =>
  condition.kind === "agents" ? copy.reactionAgents(condition.ids.map(nameOf), condition.any === true)
    : condition.kind === "pr-checks" ? copy.reactionPrChecks(condition.repository, condition.number)
      : copy.reactionInstant(condition.at);

/** NR9: the Project overview's named reactions: a list, a create form that previews, and a detail with stop and run. */
export const Reactions = () => {
  const { app, drafts, daemonExit } = useConnectedProject();
  const [view, setView] = createSignal<View>({ kind: "list" });
  const [actionFailure, setActionFailure] = createSignal<string | null>(null);
  const [made, setMade] = createSignal<Reaction | null>(null);
  let opener = "";

  drafts.validate("reactions", formSchema);
  drafts.registerRecovery("reactions", (draft, facts) => {
    const target = v.safeParse(v.string(), draft.value.target);

    return facts.daemonExit() !== null || facts.rail.failure() ? "unverified" : !target.success || target.output === "" || facts.rail.nodes.some((node) => node.id === target.output) ? "available" : "unavailable";
  });

  const [read, { refetch }] = createResource(async (_key, { value }): Promise<{ list: Reaction[]; failure: string | null }> => {
    try {
      return { list: await app.rpc("reaction.list", null), failure: null };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return { list: value?.list ?? [], failure: error.message };
    }
  }, { initialValue: { list: [], failure: null } });

  const refresh = () => { if (daemonExit() === null) void refetch(); };

  window.addEventListener("focus", refresh);
  onCleanup(() => window.removeEventListener("focus", refresh));

  const back = () => {
    setView({ kind: "list" });
    queueMicrotask(() => document.querySelector<HTMLElement>(`[data-reaction-opener="${opener}"]`)?.focus());
  };

  const open = (next: View) => {
    opener = next.kind === "detail" ? next.id : next.kind;
    setActionFailure(null);
    setView(next);
  };

  const detail = createMemo(() => {
    const current = view();

    if (current.kind !== "detail") return undefined;

    return read().list.find((reaction) => reaction.id === current.id) ?? (made()?.id === current.id ? made()! : undefined);
  });

  const act = async (reaction: Reaction, method: "reaction.stop" | "reaction.run") => {
    setActionFailure(null);

    try {
      setMade(method === "reaction.stop" ? await app.rpc(method, { id: reaction.id }) : await app.rpc(method, { id: reaction.id, operation: crypto.randomUUID() }));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setActionFailure(error.message);
    }

    refresh();
  };

  return <section class="reactions" aria-label={copy.reactions}>
    <Show when={view().kind === "create"}>
      <ReactionForm onDone={(created) => { setMade(created); refresh(); setView({ kind: "detail", id: created.id }); }} onCancel={back} />
    </Show>
    <Show when={view().kind === "detail"}>
      <Show when={detail()} fallback={<><ErrorLine message={copy.reactionMissing} /><button type="button" data-button="quiet" onClick={back}>{copy.reactionBack}</button></>}>
        {(reaction) => <div class="reaction-detail" role="region" aria-label={copy.reactionDetail(reaction().name)}>
          <button type="button" data-button="quiet" onClick={back}>{copy.reactionBack}</button>
          <h3 class="reaction-title">{reaction().name}</h3>
          <Show when={actionFailure()}>{(message) => <ErrorLine message={message()} />}</Show>
          <Facts reaction={reaction()} />
          <div class="reaction-actions">
            <button type="button" data-button="quiet" disabled={reaction().state !== "active"} onClick={() => void act(reaction(), "reaction.stop")}>{copy.reactionStop}</button>
            <button type="button" data-button="quiet" disabled={reaction().state !== "active" || reaction().remaining < 1} onClick={() => void act(reaction(), "reaction.run")}>{copy.reactionRun}</button>
          </div>
        </div>}
      </Show>
    </Show>
    <Show when={view().kind === "list"}>
      <div class="reaction-head">
        <h2 class="overview-heading">{copy.reactions}</h2>
        <button type="button" data-button="quiet" data-reaction-opener="create" onClick={() => open({ kind: "create" })}>{copy.reactionCreate}</button>
      </div>
      <Show when={read().failure}>{(message) => <p class="reaction-empty" role="status">{message()}</p>}</Show>
      <Show when={read().list.length > 0} fallback={<p class="reaction-empty">{copy.reactionsEmpty}</p>}>
        <ul class="reaction-list">
          <For each={read().list}>{(reaction) => <li>
            <button type="button" data-button="quiet" class="reaction-row" data-reaction-opener={reaction.id} onClick={() => open({ kind: "detail", id: reaction.id })}>
              <span class="reaction-name">{reaction.name}</span>
              <span class="reaction-state" data-state={reaction.state}>{copy.reactionState(reaction.state, reaction.observation.health)}</span>
            </button>
          </li>}</For>
        </ul>
      </Show>
    </Show>
  </section>;
};

const Facts = (props: { reaction: Reaction }) => {
  const nameOf = useNames();
  const { rail } = useConnectedProject();
  const r = () => props.reaction;
  const home = () => r().home ?? resolvedWorkstream(rail.nodes, r().target);

  return <dl class="reaction-facts">
    <dt>{copy.reactionAuthority}</dt><dd>{copy.reactionActor(r().actor.kind, r().actor.id)}</dd>
    <dt>{copy.reactionHome}</dt><dd>{home() ? nameOf(home()!) : copy.reactionNoHome}</dd>
    <dt>{copy.reactionTarget}</dt><dd>{nameOf(r().target)} <code>{r().target}</code></dd>
    <dt>{copy.reactionInstruction}</dt><dd class="reaction-instruction">{r().instruction}</dd>
    <dt>{copy.reactionCondition}</dt><dd>{conditionText(r().condition, nameOf)}</dd>
    <dt>{copy.reactionBound}</dt><dd>{copy.reactionRemaining(r().remaining, r().max_firings, r().rearm)}</dd>
    <dt>{copy.reactionExpires}</dt><dd>{r().expires_at}</dd>
    <dt>{copy.reactionObservation}</dt>
    <dd>
      <span>{r().observation.health}</span>
      <Show when={r().observation.gap}>{(gap) => <p role="alert">{copy.reactionGap(gap())}</p>}</Show>
      <Show when={r().observation.cause}>{(cause) => <p role="alert">{cause()}</p>}</Show>
      <Show when={r().observation.recovery}>{(recovery) => <p>{copy.reactionRecovery(recovery())}</p>}</Show>
      <Show when={r().observation.evidence}>{(evidence) => <p>{evidence()}</p>}</Show>
    </dd>
    <dt>{copy.reactionFirings}</dt>
    <dd><Show when={r().firings.length > 0} fallback={copy.reactionNoFirings}>
      <ol class="reaction-firings"><For each={r().firings}>{(firing) => <li data-outcome={firing.outcome}>{copy.reactionFiring(firing.ordinal, firing.message, firing.outcome, firing.matched)}</li>}</For></ol>
    </Show></dd>
  </dl>;
};

type Resolved = { preview: Preview | null; error: string | null };

const createPreview = (date: Accessor<string>, time: Accessor<string>, offset: Accessor<string>) => {
  const { app } = useConnectedProject();
  const key = createMemo(() => date() && time() && offset() ? { date: date(), time: time(), offset: offset() } : null);

  return createResource(key, async (params): Promise<Resolved> => {
    try {
      return { preview: await app.rpc("reaction.preview", params), error: null };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return { preview: null, error: error.message };
    }
  })[0];
};

const ReactionForm = (props: { onDone: (made: Reaction) => void; onCancel: () => void }) => {
  const { app, rail, drafts } = useConnectedProject();
  const records = () => drafts.list().filter((draft) => draft.destination.surface === destination.surface && draft.destination.object === destination.object);

  const current = () => {
    const last = records().at(-1);

    return last?.status === "draft" || last?.status === "failed" ? last : undefined;
  };

  const fresh = blank(crypto.randomUUID());

  const form = (): Form => {
    const parsed = v.safeParse(formSchema, current()?.value);

    return parsed.success ? parsed.output : fresh;
  };

  const set = (patch: Partial<Form>) => { drafts.edit(destination, { ...form(), ...patch }, null, "ordinary"); };

  createEffect(() => { onCleanup(drafts.editor(destination)); });

  const [failure, setFailure] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const agents = () => rail.nodes.filter((node) => node.kind === "agent");
  const nameOf = useNames();
  const instant = createPreview(() => form().atDate, () => form().atTime, () => form().atOffset);
  const expiry = createPreview(() => form().expDate, () => form().expTime, () => form().expOffset);

  const resolvedAt = (read: typeof instant): string | null => {
    const resolved = read();

    return resolved?.preview?.at ?? null;
  };

  const condition = (): Condition | null => {
    const f = form();

    if (f.kind === "agents") return f.ids.length > 0 ? { kind: "agents", ids: f.ids, any: f.any } : null;

    if (f.kind === "pr-checks") return f.repository && /^\d+$/.test(f.number) ? { kind: "pr-checks", repository: f.repository, number: Number(f.number) } : null;

    const at = resolvedAt(instant);

    return at ? { kind: "instant", at, late: "once-before-expiry" } : null;
  };

  const ready = () => {
    const f = form();

    return f.name.trim() !== "" && f.target !== "" && f.instruction.trim() !== "" && condition() !== null && resolvedAt(expiry) !== null && !busy();
  };

  const home = () => resolvedWorkstream(rail.nodes, form().target);

  const submit = async () => {
    const draft = current();
    const cond = condition();
    const until = resolvedAt(expiry);
    const f = form();

    if (!draft || !cond || !until || !drafts.submit(draft.revision)) return;

    setFailure(null);
    setBusy(true);

    try {
      const made = await app.rpc("reaction.create", {
        operation: f.operation, name: f.name, target: f.target, instruction: f.instruction, condition: cond,
        max_firings: Number(f.maxFirings) || 1, rearm: f.rearm, expires_at: until,
      });

      drafts.settle(draft.revision, "acknowledged");
      props.onDone(made);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      drafts.settle(draft.revision, "failed");
      setFailure(copy.reactionNotCreated(error.message));
    } finally {
      setBusy(false);
    }
  };

  const text = (label: string, key: keyof Form, options: { area?: boolean; placeholder?: string } = {}) => <label class="reaction-field">
    <span>{label}</span>
    {options.area
      ? <textarea rows={3} value={String(form()[key])} onInput={(event) => set({ [key]: event.currentTarget.value })} />
      : <input type="text" value={String(form()[key])} placeholder={options.placeholder} onInput={(event) => set({ [key]: event.currentTarget.value })} />}
  </label>;

  const when = (label: string, date: "atDate" | "expDate", time: "atTime" | "expTime", offset: "atOffset" | "expOffset", read: typeof instant) => {
    const dateField = text(copy.reactionDate, date, { placeholder: copy.reactionDatePlaceholder });
    const timeField = text(copy.reactionTime, time, { placeholder: copy.reactionTimePlaceholder });
    const offsetField = text(copy.reactionOffset, offset, { placeholder: copy.reactionOffsetPlaceholder });

    return <fieldset class="reaction-when">
    <legend>{label}</legend>
    {dateField}
    {timeField}
    {offsetField}
    <Show when={read()}>{(r) => {
      const value = r();

      return value.preview ? <p class="reaction-resolved">{copy.reactionResolved(value.preview)}</p> : <ErrorLine message={value.error ?? ""} />;
    }}</Show>
  </fieldset>;
  };

  const nameField = text(copy.reactionName, "name");
  const instructionField = text(copy.reactionInstruction, "instruction", { area: true });
  const repositoryField = text(copy.reactionRepository, "repository", { placeholder: copy.reactionRepositoryPlaceholder });
  const numberField = text(copy.reactionPr, "number");
  const maxField = text(copy.reactionMax, "maxFirings");
  const atFields = when(copy.reactionAt, "atDate", "atTime", "atOffset", instant);
  const expiryFields = when(copy.reactionExpires, "expDate", "expTime", "expOffset", expiry);

  return <form class="reaction-form" aria-label={copy.reactionCreate} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <h3 class="reaction-title">{copy.reactionCreate}</h3>
    {nameField}
    <Select label={copy.reactionTarget} value={form().target}
      choices={[{ value: "", label: copy.reactionPickTarget }, ...agents().map((node) => ({ value: node.id, label: node.name }))]}
      onValueChange={(target) => set({ target })} />
    {instructionField}
    <Select label={copy.reactionCondition} value={form().kind}
      choices={[{ value: "agents", label: copy.reactionKindAgents }, { value: "pr-checks", label: copy.reactionKindPr }, { value: "instant", label: copy.reactionKindInstant }]}
      onValueChange={(kind) => set({ kind })} />
    <Show when={form().kind === "agents"}>
      <fieldset class="reaction-agents"><legend>{copy.reactionWatched}</legend>
        <For each={agents()}>{(node) => <label><input type="checkbox" checked={form().ids.includes(node.id)}
          onChange={(event) => set({ ids: event.currentTarget.checked ? [...form().ids, node.id] : form().ids.filter((id) => id !== node.id) })} />{node.name}</label>}</For>
        <label><input type="checkbox" checked={form().any} onChange={(event) => set({ any: event.currentTarget.checked })} />{copy.reactionAny}</label>
      </fieldset>
    </Show>
    <Show when={form().kind === "pr-checks"}>{repositoryField}{numberField}</Show>
    <Show when={form().kind === "instant"}>{atFields}</Show>
    {expiryFields}
    {maxField}
    <label class="reaction-check"><input type="checkbox" checked={form().rearm} onChange={(event) => set({ rearm: event.currentTarget.checked })} />{copy.reactionRearm}</label>
    <section class="reaction-preview" aria-label={copy.reactionPreview}>
      <h4>{copy.reactionPreview}</h4>
      <p>{copy.reactionPreviewActor}</p>
      <p>{copy.reactionLabelled(copy.reactionHome, home() ? nameOf(home()!) : copy.reactionNoHome)}</p>
      <p>{copy.reactionLabelled(copy.reactionTarget, form().target ? nameOf(form().target) : copy.reactionPickTarget)}</p>
      <p class="reaction-instruction">{form().instruction}</p>
      <p>{condition() ? conditionText(condition()!, nameOf) : copy.reactionIncomplete}</p>
      <p>{copy.reactionRemaining(Number(form().maxFirings) || 1, Number(form().maxFirings) || 1, form().rearm)}</p>
      <p>{copy.reactionLabelled(copy.reactionExpires, resolvedAt(expiry) ?? copy.reactionIncomplete)}</p>
    </section>
    <Show when={failure()}>{(message) => <ErrorLine message={message()} />}</Show>
    <div class="reaction-actions">
      <button type="submit" data-button="quiet" disabled={!ready()}>{copy.reactionSave}</button>
      <button type="button" data-button="quiet" onClick={props.onCancel}>{copy.reactionBack}</button>
    </div>
  </form>;
};
