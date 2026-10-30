import { createRowCollection, rowKey } from "../ui/RowCollection";
import { EmptyState } from "../ink/EmptyState";
import { outcomeOf } from "../app/seam";
import { captureFocus, queueFocus } from "../keys/focus";
import { CopyButton } from "../ui/CopyButton";
import { ExitButton } from "../ui/IconButton";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, type Accessor } from "solid-js";
import * as v from "valibot";
import type { Message } from "@contracts/message/Message";
import type { Reaction } from "@contracts/reaction/Reaction";
import type { Preview } from "@contracts/reaction/Preview";
import type { Condition } from "@contracts/reaction/Condition";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";
import { useConnectedProject } from "../state/connectedProject";
import { Checkbox } from "../ui/Checkbox";
import { Form as Fields } from "../ui/Form";
import { Combobox } from "../ui/Combobox";
import { RadioGroup } from "../ui/RadioGroup";
import { Select } from "../ui/Select";
import { reactionCopy } from "../copy/reactions";
import type { createReactions } from "./state";
import "./styles.css";

export { createReactions } from "./state";

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
  const { rail, project } = useConnectedProject();

  return (id: string) => {
    const node = rail.nodes.find((node) => node.id === id);

    if (!node) return copy.reactionGone();

    return rail.nodes.some(other => other.name === node.name && other.parent !== node.parent)
      ? copy.draftIdentity(node.name, node.parent === null ? project.name : rail.nodes.find(home => home.id === node.parent)?.name ?? copy.unavailableHome)
      : node.name;
  };
};

const evidenceText = (evidence: string): string | null => {
  let value: unknown;

  try { value = JSON.parse(evidence); }
  catch { return copy.reactionUnknownEvidence; }

  const parsed = v.safeParse(v.object({ source: v.picklist(["agents", "pr-checks", "instant"]) }), value);

  return parsed.success ? null : copy.reactionUnknownEvidence;
};

const conditionText = (condition: Condition, nameOf: (id: string) => string): string =>
  condition.kind === "agents" ? copy.reactionAgents(condition.ids.map(nameOf), condition.any === true)
    : condition.kind === "pr-checks" ? copy.reactionPrChecks(condition.repository, condition.number)
      : copy.reactionInstant(condition.at, condition.late);

/** NR9: the Project overview's named reactions: a list, a create form that previews, and a detail with stop and run. */
export const Reactions = (props: { state: ReturnType<typeof createReactions> }) => {
  const { app, drafts, daemonExit, hideView } = useConnectedProject();
  const [view, setView] = createSignal<View>({ kind: "list" });
  const [actionFailure, setActionFailure] = createSignal<Record<string, string | null>>({});
  const [pending, setPending] = createSignal(false);
  const [made, setMade] = createSignal<Reaction | null>(null);
  let opener = "";

  drafts.validate("reactions", formSchema);
  drafts.registerRecovery("reactions", (draft, facts) => {
    const target = v.safeParse(v.string(), draft.value.target);

    return facts.daemonExit() !== null || facts.rail.failure() ? "unverified" : !target.success || target.output === "" || facts.rail.nodes.some((node) => node.id === target.output) ? "available" : "unavailable";
  });

  const { read, refetch } = props.state;
  const nameOf = useNames();

  const listName = (reaction: Reaction) => read().list.some(other => other.id !== reaction.id && other.name === reaction.name && other.home !== reaction.home)
    ? copy.draftIdentity(reaction.name, reaction.home ? nameOf(reaction.home) : copy.reactionNoHome)
    : reaction.name;

  const back = () => {
    setView({ kind: "list" });
    queueFocus(() => document.querySelector<HTMLElement>(`[data-reaction-opener="${opener}"]`)?.focus());
  };

  const open = (next: View) => {
    opener = next.kind === "detail" ? next.id : next.kind;
    setView(next);
    queueFocus(() => document.querySelector<HTMLButtonElement>(".reaction-back")?.focus());
  };

  const heads = new Map<string, HTMLElement>();

  const content = createRowCollection(() => read().list.filter(reaction => {
    const head = heads.get(reaction.id);

    return head && !head.closest("[hidden], [inert], [disabled], [aria-disabled=true]");
  }).map(reaction => ({ value: reaction.id, label: listName(reaction) })), {
    onActivate: id => open({ kind: "detail", id }),
  });

  const selected = () => {
    const current = view();

    return current.kind === "detail" ? current.id : null;
  };

  const [inspection, { refetch: inspect, mutate: inspectValue }] = createResource(selected, async (id): Promise<{ id: string; value: Reaction | null; failure: string | null }> => {
    try {
      return { id, value: await app.rpc("reaction.get", { id }), failure: null };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return { id, value: null, failure: error.message };
    }
  });

  const detail = createMemo(() => {
    const current = view();

    if (current.kind !== "detail") return undefined;

    return (inspection()?.value?.id === current.id ? inspection()?.value : undefined) ?? (made()?.id === current.id ? made()! : undefined) ?? read().list.find((reaction) => reaction.id === current.id);
  });

  const act = async (reaction: Reaction, method: "reaction.stop" | "reaction.run") => {
    if (pending()) return;
    setPending(true);

    try {
      setMade(method === "reaction.stop" ? await app.rpc(method, { id: reaction.id }) : await app.rpc(method, { id: reaction.id, operation: crypto.randomUUID() }));
      setActionFailure(value => ({ ...value, [reaction.id]: null }));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setActionFailure(value => ({ ...value, [reaction.id]: error.message }));
    }

    if (daemonExit() === null) {
      await refetch();
      await inspect();
    }

    setPending(false);
  };

  return <section class="reactions" aria-label={copy.reactions}>
    <Show when={view().kind === "create"}>
      <ReactionForm onDone={(created, reveal) => {
        setMade(created);

        if (reveal) {
          setView({ kind: "detail", id: created.id });
          queueFocus(() => document.querySelector<HTMLButtonElement>(".reaction-back")?.focus());
        }
      }} onCancel={back} />
    </Show>
    <Show when={view().kind === "detail"}>
      <Show when={detail()} fallback={<ReservedLine message={copy.reactionMissing}><ExitButton onClick={back} /></ReservedLine>}>
        {(reaction) => <div class="reaction-detail" role="region" aria-label={copy.reactionDetail(reaction().name)}>
          <div class="reaction-head"><h3 class="reaction-title">{reaction().name}</h3><button type="button" data-button="quiet" class="reaction-back" aria-label={copy.closeView(reaction().name)} onClick={back}>{copy.closeView(reaction().name)}</button></div>
          <ReservedLine overlay message={(inspection()?.id === selected() ? inspection()?.failure : null) ?? actionFailure()[reaction().id]}>
            <button type="button" data-button="quiet" onClick={() => {
              if (inspection()?.id === selected() && inspection()?.failure) inspectValue(value => value ? { ...value, failure: null } : value);
              else setActionFailure(value => ({ ...value, [reaction().id]: null }));
            }}>{copy.clear}</button>
          </ReservedLine>
          <Facts reaction={reaction()} />
          <div class="reaction-actions">
            <button type="button" data-button="quiet" onClick={() => { void inspect(); }}>{copy.refresh}</button>
            <button type="button" data-button="quiet" disabled={pending() || reaction().state !== "active"} onClick={() => void act(reaction(), "reaction.stop")}>{copy.reactionStop}</button>
            <button type="button" data-button="quiet" disabled={pending() || reaction().state !== "active" || reaction().remaining < 1} onClick={() => void act(reaction(), "reaction.run")}>{copy.reactionRun}</button>
          </div>
        </div>}
      </Show>
    </Show>
    <Show when={view().kind === "list"}>
      <div class="reaction-head">
        <h2 class="overview-heading">{copy.reactions}</h2>
        <div class="reaction-actions"><button type="button" data-button="quiet" data-reaction-opener="create" onClick={() => open({ kind: "create" })}>{copy.reactionCreate}</button><button type="button" data-button="quiet" onClick={() => { hideView("reactions"); queueFocus(() => document.querySelector<HTMLElement>(".ask-input")?.focus()); }}>{copy.closeView(copy.reactions)}</button></div>
      </div>
      <ReservedLine overlay message={read().failure}>
        <button type="button" data-button="quiet" onClick={() => void refetch()}>{copy.retry}</button>
        <button type="button" data-button="quiet" onClick={props.state.dismiss}>{copy.clear}</button>
      </ReservedLine>
      <Show when={read().list.length > 0} fallback={<Show when={!read.loading && read().failure === null}><EmptyState art="loving" {...{ title: copy.reactionsEmpty }} line={reactionCopy.emptyHelp} /></Show>}>
        <ul class="reaction-list" on:click={{ capture: true, handleEvent: content.click }} on:keydown={{ capture: true, handleEvent: rowKey }}>
          <For each={read().list.map(reaction => reaction.id)}>{(id) => {
            const reaction = () => read().list.find(reaction => reaction.id === id)!;

            return <li>
            <button type="button" data-button="quiet" class="reaction-row overview-entry" data-row-selected={content.selection.isSelected(id)} ref={element => {
              heads.set(id, element); content.register(element, id);
              onCleanup(() => { if (heads.get(id) === element) heads.delete(id); });
            }} data-reaction-opener={id} onClick={() => open({ kind: "detail", id })}>
              <span class="reaction-name">{listName(reaction())}</span>
              <span class="reaction-state" data-state={reaction().state}>{reaction().state === "active" && reaction().observation.evidence && evidenceText(reaction().observation.evidence!) ? copy.reactionUnknownState : copy.reactionState(reaction().state, reaction().observation.health_code)}</span>
            </button>
          </li>;
          }}</For>
        </ul>
      </Show>
    </Show>
  </section>;
};

const Facts = (props: { reaction: Reaction }) => {
  const nameOf = useNames();
  const { app, rail } = useConnectedProject();
  const [copyFailures, setCopyFailures] = createSignal<Record<string, string | null>>({});
  const r = () => props.reaction;
  const [messageId, setMessageId] = createSignal<number | null>(null);

  const copyOwner = () => messageId() === null ? `reaction:${r().id}` : `message:${messageId()}`;
  const failCopy = (owner: string, message: string | null) => setCopyFailures(value => ({ ...value, [owner]: message }));

  const [message, { refetch, mutate }] = createResource(messageId, async (id): Promise<{ id: number; value: Message | null; failure: string | null }> => {
    try {
      return { id, value: await app.rpc("message.get", { id }), failure: null };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return { id, value: null, failure: error.message };
    }
  });

  let returnId: number | null = null;

  const closeMessage = () => {
    setMessageId(null);
    queueFocus(() => document.querySelector<HTMLButtonElement>(`[data-firing-message="${returnId}"]`)?.focus());
  };

  const home = () => r().home;

  const observation = () => r().state !== "active" ? copy.reactionState(r().state, r().observation.health_code)
    : (r().observation.evidence && evidenceText(r().observation.evidence!)) || copy.reactionHealth(r().observation.health_code);

  const authority = () => copy.reactionActor(r().actor.kind, rail.nodes.some(node => node.id === r().actor.id) ? nameOf(r().actor.id) : null);

  return <Show when={messageId() !== null} fallback={<dl class="reaction-facts">
    <dt>{copy.reactionAuthority}</dt><dd>{authority()}</dd>
    <dt>{copy.reactionHome}</dt><dd>{home() ? nameOf(home()!) : copy.reactionNoHome}</dd>
    <dt>{copy.reactionTarget}</dt><dd>{nameOf(r().target)}</dd>
    <dt>{copy.reactionInstruction}</dt><dd class="reaction-instruction">{r().instruction}</dd>
    <dt>{copy.reactionCondition}</dt><dd>{conditionText(r().condition, nameOf)}</dd>
    <dt>{copy.reactionBound}</dt><dd>{copy.reactionRemaining(r().remaining, r().max_firings, r().rearm)}</dd>
    <dt>{copy.reactionExpires}</dt><dd><time datetime={r().expires_at}>{copy.reactionWhen(r().expires_at)}</time></dd>
    <dt>{copy.reactionObservation}</dt>
    <dd>
      <span>{observation()}</span>
      <ReservedLine message={copy.reactionFeedback(r().observation)} />
    </dd>
    <dt>{copy.reactionDetails}</dt><dd><CopyButton app={app} text={JSON.stringify({
        name: r().name, authority: authority(),
        target: nameOf(r().target), home: home() ? nameOf(home()!) : copy.reactionNoHome,
        condition: conditionText(r().condition, nameOf), observation: observation(), reaction: r(),
      }, null, 2)} onSuccess={() => failCopy(copyOwner(), null)} onFailure={error => failCopy(copyOwner(), copy.copyDraftFailure(error instanceof Error ? error.message : String(error)))}>{copy.copy}</CopyButton><ReservedLine message={copyFailures()[copyOwner()]}><button type="button" data-button="quiet" onClick={() => failCopy(copyOwner(), null)}>{copy.clear}</button></ReservedLine></dd>
    <dt>{copy.reactionFirings}</dt>
    <dd><Show when={r().firings.length > 0} fallback={copy.reactionNoFirings}>
      <ol class="reaction-firings"><For each={r().firings}>{(firing) => <li data-outcome={firing.outcome}><button type="button" data-button="quiet" data-firing-message={firing.message} onClick={() => { returnId = firing.message; setMessageId(firing.message); }}>{copy.reactionFiring(firing.ordinal, firing.message, firing.outcome, firing.matched)}</button></li>}</For></ol>
    </Show></dd>
  </dl>}>
    <section aria-label={copy.reactionMessage(messageId()!)}>
      <ExitButton ref={element => queueFocus(() => element.focus())} onClick={closeMessage} />
      <ReservedLine message={message()?.id === messageId() ? message()?.failure : null}><button type="button" data-button="quiet" onClick={() => void refetch()}>{copy.retry}</button><button type="button" data-button="quiet" onClick={() => mutate(value => value ? { ...value, failure: null } : value)}>{copy.clear}</button></ReservedLine>
      <Show when={!message.loading && message()?.id === messageId() && message()?.value}>{value => <dl class="reaction-facts">
        <dt>{copy.reactionTarget}</dt><dd>{nameOf(value().to)}</dd>
        <dt>{copy.reactionMessage(messageId()!)}</dt><dd class="reaction-instruction">{value().body}</dd>
        <dt>{copy.reactionMessageState}</dt><dd data-state={value().status}>{copy.reactionDelivery(value().status)}{value().reason ? ` · ${copy.reactionReason(value().reason!)}` : ""}</dd>
        <dt>{copy.reactionDetails}</dt><dd><CopyButton app={app} text={JSON.stringify({ target: nameOf(value().to), message: value() }, null, 2)} onSuccess={() => failCopy(copyOwner(), null)} onFailure={error => failCopy(copyOwner(), copy.copyDraftFailure(error instanceof Error ? error.message : String(error)))}>{copy.copy}</CopyButton><ReservedLine message={copyFailures()[copyOwner()]}><button type="button" data-button="quiet" onClick={() => failCopy(copyOwner(), null)}>{copy.clear}</button></ReservedLine></dd>
      </dl>}</Show>
    </section>
  </Show>;
};

type Resolved = { preview: Preview | null; error: string | null };

const createPreview = (date: Accessor<string>, time: Accessor<string>, offset: Accessor<string>) => {
  const { app } = useConnectedProject();
  const key = createMemo(() => date() && time() && offset() ? { date: date(), time: time(), offset: offset() } : null);

  const [read] = createResource(key, async (params): Promise<Resolved> => {
    try {
      return { preview: await app.rpc("reaction.preview", params), error: null };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return { preview: null, error: error.message };
    }
  });

  return createMemo(() => key() === null || read.loading ? undefined : read());
};

const ReactionForm = (props: { onDone: (made: Reaction, reveal: boolean) => void; onCancel: () => void }) => {
  const { app, rail, drafts, project } = useConnectedProject();
  const records = () => drafts.list().filter((draft) => draft.destination.surface === destination.surface && draft.destination.object === destination.object);

  const current = () => records().at(-1);
  const unresolved = () => records().find(draft => draft.status === "pending" || draft.status === "unknown");

  const fresh = blank(crypto.randomUUID());

  const form = (): Form => {
    const parsed = v.safeParse(formSchema, current()?.value);

    return parsed.success ? parsed.output : fresh;
  };

  const set = (patch: Partial<Form>) => {
    const last = current();
    // A submitted or refused payload owns its operation id; a changed payload needs a new one.
    const operation = last && last.status !== "draft" ? crypto.randomUUID() : form().operation;

    drafts.edit(destination, { ...form(), ...patch, operation }, null, "ordinary");
  };

  createEffect(() => { onCleanup(drafts.editor(destination)); });

  const [failure, setFailure] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  let disposed = false;

  onCleanup(() => { disposed = true; });
  const agents = () => rail.nodes.filter((node) => node.kind === "agent" || (node.kind === "workstream" && node.status !== null));
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

    return Number.isSafeInteger(Number(f.maxFirings)) && Number(f.maxFirings) > 0 && f.name.trim() !== "" && f.target !== "" && f.instruction.trim() !== "" && condition() !== null && resolvedAt(expiry) !== null && !busy() && !unresolved();
  };

  const home = () => rail.nodes.find(node => node.id === form().target)?.parent ?? null;

  const submit = async () => {
    const draft = current();
    const cond = condition();
    const until = resolvedAt(expiry);
    const f = form();

    if (!draft || !cond || !until || unresolved() || !(await drafts.submit(draft.revision))) return;

    await send(draft.revision, f, cond, until);
  };

  const send = async (revision: string, f: Form, cond: Condition, until: string, focus = captureFocus()) => {
    setFailure(null);
    setBusy(true);

    try {
      const made = await app.rpc("reaction.create", {
        operation: f.operation, name: f.name, reason: reactionCopy.createReason, target: f.target, instruction: f.instruction, condition: cond,
        max_firings: Number(f.maxFirings), rearm: f.rearm, expires_at: until,
      });

      drafts.settle(revision, "acknowledged");

      if (!focus(() => props.onDone(made, !disposed && !current()))) props.onDone(made, false);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const refused = outcomeOf(error) === "failed";
      drafts.settle(revision, refused ? "failed" : "unknown");
      setFailure(refused ? copy.reactionNotCreated(error.message) : copy.reactionCreationUnknown(error.message));
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async () => {
    const draft = unresolved();

    if (!draft || draft.status !== "unknown" || busy()) return;

    const focus = captureFocus();
    const f = v.parse(formSchema, draft.value);
    setBusy(true);
    setFailure(null);

    try {
      const until = await app.rpc("reaction.preview", { date: f.expDate, time: f.expTime, offset: f.expOffset });

      const cond: Condition = f.kind === "agents" ? { kind: "agents", ids: f.ids, any: f.any }
        : f.kind === "pr-checks" ? { kind: "pr-checks", repository: f.repository, number: Number(f.number) }
          : { kind: "instant", at: (await app.rpc("reaction.preview", { date: f.atDate, time: f.atTime, offset: f.atOffset })).at, late: "once-before-expiry" };

      await send(draft.revision, f, cond, until.at, focus);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailure(copy.reactionCreationUnknown(error.message));
    } finally {
      setBusy(false);
    }
  };

  const text = (label: string, key: keyof Form, options: { area?: boolean; placeholder?: string } = {}) => <Fields.Text label={label} value={String(form()[key])} {...options} onInput={value => set({ [key]: value })} />;

  const zones = reactionCopy.zones;

  const when = (label: string, date: "atDate" | "expDate", time: "atTime" | "expTime", offset: "atOffset" | "expOffset", read: typeof instant) => <div class="reaction-when" role="group" aria-label={label}>
    <span class="reaction-label">{label}</span>
    <div class="reaction-time-fields">
      <Fields.Date label={copy.reactionDate} value={form()[date]} placeholder={copy.reactionDatePlaceholder} onChange={value => set({ [date]: value })} />
      {text(copy.reactionTime, time, { placeholder: copy.reactionTimePlaceholder })}
      <Select label={reactionCopy.zone} value={form()[offset]} choices={zones.some(zone => zone.value === form()[offset]) ? zones : [...zones, { value: form()[offset], label: reactionCopy.offset(form()[offset]) }]} onValueChange={value => set({ [offset]: value })} />
    </div>
    <ReservedLine overlay message={read()?.error} status={read()?.preview ? copy.reactionResolved(read()!.preview!) : null} />
  </div>;

  const nameField = text(copy.reactionName, "name");
  const instructionField = text(copy.reactionInstruction, "instruction", { area: true });
  const repositoryField = text(copy.reactionRepository, "repository", { placeholder: copy.reactionRepositoryPlaceholder });
  const numberField = <Fields.Number label={copy.reactionPr} value={form().number} onChange={number => set({ number })} />;
  const maxField = <Fields.Number label={copy.reactionMax} value={form().maxFirings} onChange={maxFirings => set({ maxFirings })} />;
  const atFields = when(copy.reactionAt, "atDate", "atTime", "atOffset", instant);
  const expiryFields = when(copy.reactionExpires, "expDate", "expTime", "expOffset", expiry);

  return <form class="reaction-form" aria-label={copy.reactionCreate} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div class="reaction-head"><h3 class="reaction-title">{copy.reactionCreate}</h3><button type="button" data-button="quiet" class="reaction-back" onClick={props.onCancel}>{copy.closeView(copy.reactionCreate)}</button></div>
    <Fields.Group label={reactionCopy.instructionGroup}>{nameField}
    <div class="reaction-field reaction-target"><span class="reaction-label">{copy.reactionTarget}</span>
    <Combobox.Picker label={copy.reactionTarget} value={form().target} savedLabel={copy.reactionPickTarget}
      items={[...agents().map((node) => ({ value: node.id, label: nameOf(node.id) })), ...(form().target && !agents().some(node => node.id === form().target) ? [{ value: form().target, label: nameOf(form().target) }] : [])]}
      onSelect={(target) => set({ target })} /></div>
    {instructionField}</Fields.Group>
    <Fields.Group label={reactionCopy.conditionGroup}>
    <Select label={copy.reactionCondition} value={form().kind}
      choices={[{ value: "agents", label: copy.reactionKindAgents }, { value: "pr-checks", label: copy.reactionKindPr }, { value: "instant", label: copy.reactionKindInstant }]}
      onValueChange={(kind) => { if (kind === "agents") set({ kind }); else set({ kind, maxFirings: "1", rearm: false }); }} />
    <Show when={form().kind === "agents"}>
      <Fields.Checks label={copy.reactionWatched} values={form().ids} items={agents().map(node => ({ value: node.id, label: nameOf(node.id) }))} onChange={ids => set({ ids })} />
      <RadioGroup label={reactionCopy.sendWhen} value={form().any ? "any" : "all"} choices={[{ value: "all", label: reactionCopy.all }, { value: "any", label: reactionCopy.any }]} onValueChange={value => set({ any: value === "any" })} />
    </Show>
    <Show when={form().kind === "pr-checks"}>{repositoryField}{numberField}</Show>
    <Show when={form().kind === "instant"}>{atFields}</Show>
    </Fields.Group>
    <Fields.Group label={reactionCopy.limitsGroup}>{expiryFields}
    <Show when={form().kind === "agents"}>{maxField}
    <Checkbox checked={form().rearm} onCheckedChange={(rearm) => set({ rearm })}>{copy.reactionRearm}</Checkbox></Show></Fields.Group>
    <section class="reaction-preview" aria-label={copy.reactionPreview}>
      <h4 class="reaction-legend">{copy.reactionPreview}</h4>
      <dl class="reaction-facts">
        <dt>{copy.reactionAuthority}</dt><dd>{copy.reactionPreviewActor}</dd>
        <dt>{copy.reactionHome}</dt><dd>{home() ? nameOf(home()!) : copy.reactionNoHome}</dd>
        <dt>{copy.reactionTarget}</dt><dd>{form().target ? nameOf(form().target) : copy.reactionPickTarget}</dd>
        <dt>{copy.reactionInstruction}</dt><dd class="reaction-instruction">{form().instruction}</dd>
        <dt>{copy.reactionCondition}</dt><dd>{condition() ? conditionText(condition()!, nameOf) : copy.reactionIncomplete}</dd>
        <dt>{copy.reactionBound}</dt><dd>{copy.reactionRemaining(Number(form().maxFirings) || 1, Number(form().maxFirings) || 1, form().rearm)}</dd>
        <dt>{copy.reactionExpires}</dt><dd>{resolvedAt(expiry) ?? copy.reactionIncomplete}</dd>
      </dl>
    </section>
    <ReservedLine message={drafts.problem() ? copy.draftRetention(project.name, copy.draftSurface("reactions"), drafts.problem()!.cause) : unresolved()?.status === "unknown" ? failure() ?? copy.reactionCreationUnknown("") : failure()}>
      <Show when={drafts.problem()}><button type="button" data-button="quiet" onClick={() => drafts.retry()}>{copy.storageRetry}</button></Show>
      <Show when={failure() && !drafts.problem() && !unresolved()}><button type="button" data-button="quiet" onClick={() => setFailure(null)}>{copy.clear}</button></Show>
      <Show when={unresolved()?.status === "unknown"}><button type="button" data-button="quiet" disabled={busy()} onClick={() => void reconcile()}>{copy.reactionCheckCreation}</button></Show>
    </ReservedLine>
    <div class="reaction-actions">
      <button type="submit" data-button="quiet" disabled={!ready()}>{copy.reactionSave}</button>
    </div>
  </form>;
};
