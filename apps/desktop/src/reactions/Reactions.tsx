import { createRowCollection, rowKey } from "../ui/RowCollection";
import { queueFocus } from "../keys/focus";
import { CopyButton } from "../ui/CopyButton";
import { ExitButton } from "../ui/IconButton";
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import * as v from "valibot";
import type { Message } from "@contracts/message/Message";
import type { Reaction } from "@contracts/reaction/Reaction";
import type { Condition } from "@contracts/reaction/Condition";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";
import { useConnectedProject } from "../state/connectedProject";
import type { createReactions } from "./state";
import "./styles.css";

export { createReactions } from "./state";

type View = { kind: "list" } | { kind: "detail"; id: string };

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

/** NR9: saved Reactions with exact-identity inspection, Stop and Run. */
export const Reactions = (props: { state: ReturnType<typeof createReactions> }) => {
  const { app, daemonExit } = useConnectedProject();
  const [view, setView] = createSignal<View>({ kind: "list" });
  const [actionFailure, setActionFailure] = createSignal<Record<string, string | null>>({});
  const [pending, setPending] = createSignal(false);
  const [made, setMade] = createSignal<Reaction | null>(null);
  let opener = "";

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
    opener = next.kind === "detail" ? next.id : "";
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
      <ReservedLine overlay message={read().failure}>
        <button type="button" data-button="quiet" onClick={() => void refetch()}>{copy.retry}</button>
        <button type="button" data-button="quiet" onClick={props.state.dismiss}>{copy.clear}</button>
      </ReservedLine>
      <Show when={read().list.length > 0} fallback={<Show when={!read.loading && read().failure === null}><p class="overview-quiet">{copy.reactionsEmpty}</p></Show>}>
        <ul class="reaction-list" on:click={{ capture: true, handleEvent: content.click }} on:keydown={{ capture: true, handleEvent: rowKey }}>
          <For each={read().list.map(reaction => reaction.id)}>{(id) => {
            const reaction = () => read().list.find(reaction => reaction.id === id)!;

            return <li class="reaction-list-item" data-overview-item={id}>
            <button type="button" data-button="quiet" class="reaction-row overview-entry" data-row-selected={content.selection.isSelected(id)} ref={element => {
              heads.set(id, element); content.register(element, id);
              onCleanup(() => { if (heads.get(id) === element) heads.delete(id); });
            }} data-reaction-opener={id} onClick={() => open({ kind: "detail", id })}>
              <span class="reaction-summary"><span class="reaction-name">{listName(reaction())}</span>
              <span class="reaction-state" data-state={reaction().state}>{reaction().state === "active" && reaction().observation.evidence && evidenceText(reaction().observation.evidence!) ? copy.reactionUnknownState : copy.reactionState(reaction().state, reaction().observation.health_code)}</span></span>
              <span class="reaction-reason">{copy.reactionActor(reaction().actor.kind, reaction().actor.kind === "agent" ? nameOf(reaction().actor.id) : null)}</span>
              <span class="reaction-reason">{reaction().reason ?? copy.reactionNoReason}</span>
              <span class="reaction-instruction">{reaction().instruction}</span>
              <span class="reaction-reason">{conditionText(reaction().condition, nameOf)} · {copy.reactionTarget}: {nameOf(reaction().target)}</span>
              <span class="reaction-reason">{copy.reactionRemaining(reaction().remaining, reaction().max_firings, reaction().rearm)}</span>
            </button>
            <Show when={reaction().state === "active"}><div class="reaction-actions">
              <button type="button" data-button="quiet" disabled={pending()} onClick={() => void act(reaction(), "reaction.stop")}>{copy.reactionStop}</button>
              <Show when={reaction().remaining > 0}><button type="button" data-button="quiet" disabled={pending()} onClick={() => void act(reaction(), "reaction.run")}>{copy.reactionRun}</button></Show>
            </div></Show>
            <ReservedLine class="reaction-list-failure" message={actionFailure()[id]}><button type="button" data-button="quiet" onClick={() => setActionFailure(value => ({ ...value, [id]: null }))}>{copy.clear}</button></ReservedLine>
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
    <dt>{copy.reactionMakerReason}</dt><dd>{r().reason ?? copy.reactionNoReason}</dd>
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
