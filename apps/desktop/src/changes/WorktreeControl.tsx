import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import type { Accessor } from "solid-js";
import type { ChangedFiles } from "@contracts/agent/ChangedFiles";
import type { Worktree } from "@contracts/agent/Worktree";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { Icon } from "../ink/Icon";
import { failureOf } from "../todos/failureOf";
import { useConnectedProject } from "../state/connectedProject";
import { Popover } from "../ui/Popover";
import { ChangedTree } from "./ChangedTree";
import "./styles.css";

type Read = { failure: null; changed: ChangedFiles } | { failure: string } | null;

/** U2539b: the panel of one Agent's Worktree. It reads again on every open and closes when the selection moves, because it is keyed on the Agent. */
const Panel = (props: { id: string; worktree: Worktree }) => {
  const { app, worktrees } = useConnectedProject();
  const state = () => worktrees.read(props.id);

  const facts = () => {
    const read = state();

    return read?.failure === null ? read.state : null;
  };

  const [open, setOpen] = createSignal(false);
  const [read, setRead] = createSignal<Read>(null);
  const [control, setControl] = createSignal<HTMLButtonElement>();

  createEffect(on(open, (now) => {
    if (!now) return;

    let current = true;

    setRead(null);

    let loaded: Read = null;

    void failureOf(async () => {
      const [, changed] = await Promise.all([worktrees.refresh(props.id), app.rpc("agent.changedFiles", { id: props.id })]);

      loaded = { failure: null, changed };
    }).then((failure) => {
      if (current) setRead(failure === null ? loaded : { failure });
    });

    onCleanup(() => { current = false; });
  }));

  const close = () => {
    setOpen(false);
    control()?.focus();
  };

  return (
    <Popover.Root open={open()} closeOnEscape onOpenChange={({ open: next }) => { if (next) setOpen(true); else close(); }} positioning={{ placement: "top-end", strategy: "fixed" }}>
      <Popover.Trigger asChild={(trigger) => (
        <button {...trigger()} ref={setControl} type="button" data-button="quiet" class="worktree-control" aria-label={props.worktree.branch} onClick={() => (open() ? close() : setOpen(true))}>
          <Icon name="branch" />
          <span class="worktree-branch">{props.worktree.branch}</span>
        </button>
      )} />
      <Popover.Positioner>
        <Popover.Content class="worktree-panel" aria-label={copy.worktree} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
          <dl class="worktree-facts">
            <dt>{copy.branch}</dt>
            <dd title={props.worktree.branch}>{props.worktree.branch}</dd>
            <dt>{copy.base}</dt>
            <dd title={props.worktree.base}>{props.worktree.base}</dd>
            <Show when={facts()}>
              {(state) => (
                <>
                  <dt>{copy.worktreeState}</dt>
                  <dd>{copy.worktreeStateText(state().ahead, state().behind, state().dirty)}</dd>
                  <dt>{copy.worktreeCi}</dt>
                  <dd><Show when={state().ci} fallback={copy.worktreeCiUnavailable}>{(ci) => copy.worktreeCiText(ci().state, ci().stale)}</Show></dd>
                  <dt>{copy.worktreePr}</dt>
                  <dd><Show when={state().pr} fallback={copy.worktreePrUnavailable}>{(pr) => copy.worktreePrText(pr().number, pr().stale)}</Show></dd>
                </>
              )}
            </Show>
          </dl>
          <Show when={state()?.failure ?? read()?.failure}>{(failure) => <ErrorLine message={failure()} />}</Show>
          <Show when={read()}>
            {(done) => {
              const value = done();

              if (value.failure !== null) return null;

              if (value.changed.files.length === 0) return <p class="worktree-none">{copy.noChanges}</p>;

              return <ChangedTree root={props.worktree.path} files={value.changed.files} />;
            }}
          </Show>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
  );
};

/** U2539b: the bottom bar's one control for the selected Agent's Worktree; none for an Agent without one. */
export const WorktreeControl = () => {
  const { rail } = useConnectedProject();

  const selected: Accessor<{ id: string; worktree: Worktree } | null> = createMemo(
    () => {
      const node = rail.nodes.find((candidate) => candidate.id === rail.selected());

      return node && node.worktree ? { id: node.id, worktree: node.worktree } : null;
    },
    null,
    { equals: (a, b) => a?.id === b?.id && a?.worktree.branch === b?.worktree.branch && a?.worktree.path === b?.worktree.path && a?.worktree.base === b?.worktree.base },
  );

  return <Show when={selected()} keyed>{(each) => <Panel id={each.id} worktree={each.worktree} />}</Show>;
};
