import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { ErrorLine } from "../ink/ErrorLine";
import { KindGlyph } from "../ink/KindGlyph";
import { Icon } from "../ink/Icon";
import { useConnectedProject } from "../state/connectedProject";
import { scribeIds } from "../pads/scribe";
import { usePadList } from "./pads/padList";
import { createRailDrag } from "./drag";
import { GroupHead } from "../ink/GroupHead";
import { adjacentId } from "./keys";
import { RailMenu } from "./menu/RailMenu";
import { createRailMenu } from "./menu/model";
import { isWorkstream, layoutRail, liveAgentsBelow, resolvedWorkstream } from "./layout";
import type { NodeRow } from "./layout";
import { RailRowView } from "./RailRow";
import { SpawnPromptField } from "./SpawnPromptField";
import type { SpawnParams } from "@contracts/agent/SpawnParams";
import { createChoices } from "../models/choices";
import { ModelPair } from "../models/ModelPair";
import "./styles.css";

const toggled = <T,>(set: ReadonlySet<T>, member: T): ReadonlySet<T> =>
  new Set(set.has(member) ? [...set].filter((each) => each !== member) : [...set, member]);

export const Rail = () => {
  const connected = useConnectedProject();
  const { app, project, rail, now, reducedMotion, daemonExit } = connected;

  const collapsed = rail.collapsed;
  const [unfolded, setUnfolded] = createSignal<ReadonlySet<string | null>>(new Set());
  const [failure, setFailure] = createSignal<string | null>(null);
  const menu = createRailMenu(app, rail, setFailure, connected.events);
  const [wanted, setWanted] = createSignal<string | null>(null);
  /** Gates `⌘N` in the chord handler and the add-agent click below, so an open field is never dropped mid-type (U33). */
  const [composing, setComposing] = createSignal(false);

  const [dragged, setDragged] = createSignal<string | null>(null);

  /** U378: the add's optional `model…` disclosure; left alone it passes nothing. */
  const choices = createChoices(app);
  const [modelOpen, setModelOpen] = createSignal(false);
  const [picked, setPicked] = createSignal<{ model: string | null; effort: string | null }>({ model: null, effort: null });

  /** U172: the Rail's one group is its Workstreams and what hangs under them; collapsing it hides those rows, never a loose top-level row, and keeps the head and its count. */
  const closed = () => collapsed().has("rail:workstreams");
  const workstreams = createMemo(() => rail.nodes.filter(isWorkstream).length);

  /** U190: a Scribe shows on the Rail only when the user can answer it. */
  const padList = usePadList();

  const visible = createMemo(() => {
    const scribes = scribeIds(padList.pads());

    return rail.nodes.filter((node) => !scribes.has(node.id) || node.status?.kind === "error" || node.status?.kind === "needs-you");
  });

  const rows = createMemo(() => {
    const all = layoutRail(visible(), { collapsed: collapsed(), unfolded: unfolded(), now: now(), dragged: dragged() });

    if (!closed()) return all;

    const heads = new Set(rail.nodes.filter(isWorkstream).map((node) => node.id));
    const underHead = (id: string | null): boolean => id !== null && (heads.has(id) || underHead(rail.nodes.find((node) => node.id === id)?.parent ?? null));

    return all.filter((row) => !underHead(row.kind === "node" ? row.node.id : row.parent));
  });

  /** U38: the empty line waits for the first `rail.tree` (always answered before the Rail mounts) and yields to a fetch failure, which the centre shows instead. */

  const nodeRows = createMemo(() => rows().filter((row): row is NodeRow => row.kind === "node"));
  const nodeIds = createMemo(() => nodeRows().map((row) => row.node.id));
  const layoutKey = createMemo(() => nodeRows().map((row) => `${row.key}@${row.depth}`).join());
  const keys = createMemo(() => rows().map((row) => row.key));
  const byKey = createMemo(() => new Map(rows().map((row) => [row.key, row])));

  const attempt = async <T,>(call: () => Promise<T>): Promise<void> => {
    try {
      await call();
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      setFailure(error.message);
    }
  };

  const [container, setContainer] = createSignal<HTMLElement>();
  const [field, setField] = createSignal<HTMLInputElement>();

  const rowElement = (id: string) => container()?.querySelector<HTMLElement>(`[data-id="${id}"]`);

  const focusRow = (id: string) => rowElement(id)?.focus();

  const tabbableId = createMemo(() => {
    const selected = rail.selected();
    const ids = nodeIds();

    return ids.find((id) => id === selected) ?? ids[0] ?? null;
  });

  const moveFocus = (current: string, direction: 1 | -1) => focusRow(adjacentId(nodeIds(), current, direction));

  /** U358: `⌘⌫` in the Rail takes the row menu's `remove` for the selected row; the selection then moves to the next row, else the previous, and focus stays in the Rail. A repeat acts on nothing. */
  const removeSelected = (repeat: boolean) => {
    const id = rail.selected();
    const node = rail.nodes.find((candidate) => candidate.id === id);
    const row = id === null ? undefined : rowElement(id);

    if (repeat || !node || !row) return;

    const ids = nodeIds();
    const next = ids[ids.indexOf(node.id) + 1] ?? ids[ids.indexOf(node.id) - 1];
    const box = row.getBoundingClientRect();

    menu.requestRemove(node, rail.exitOf(node), box.left, box.bottom, () => {
      if (next === undefined || rail.selected() !== node.id) return;

      rail.select(next);
      focusRow(next);
    });
  };

  const onRailKeyDown = (press: KeyboardEvent) => {
    const focusedId = press.target instanceof HTMLElement ? press.target.dataset.id : undefined;

    if (focusedId === undefined) return;

    if (press.key === "ContextMenu" || (press.key === "F10" && press.shiftKey)) {
      press.preventDefault();
      const row = rowElement(focusedId);
      const node = rail.nodes.find((candidate) => candidate.id === focusedId);

      if (row && node) {
        const box = row.getBoundingClientRect();
        menu.open(node, rail.exitOf(node), box.left, box.bottom);
      }

      return;
    }

    if (press.key === "Backspace" && press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey) {
      press.preventDefault();
      removeSelected(press.repeat);

      return;
    }

    if (press.key === "ArrowDown" || press.key === "ArrowUp") {
      press.preventDefault();
      moveFocus(focusedId, press.key === "ArrowDown" ? 1 : -1);
    } else if (press.key === "Enter") {
      press.preventDefault();
      rail.select(focusedId);
    }
  };

  const drag = createRailDrag({
    container,
    nodes: () => rail.nodes,
    rows: nodeRows,
    layoutKey,
    onDragging: setDragged,
    enabled: () => daemonExit() === null,
    onDrop: (id, { parent, index }) => void attempt(() => app.rpc("rail.move", { id, parent, index })),
  });

  const [pending, setPending] = createSignal(false);

  /** Runs one of the add actions; a second click while the Daemon is still answering would add a second row. */
  const guarded = <T,>(call: () => Promise<T>): void => {
    setPending(true);
    void attempt(call).finally(() => setPending(false));
  };

  const parent = (): string | null => {
    const selected = rail.nodes.find((node) => node.id === rail.selected());

    return selected?.kind === "workstream" ? selected.id : null;
  };

  /** U191: the Workstream whose group holds the icon add: the selected Workstream, else the one above the selected row. */
  const resolved = createMemo(() => resolvedWorkstream(rail.nodes, rail.selected()));

  /** The key of the last row of the resolved Workstream's group (`null` when it is collapsed or none resolves): the inside line follows it. */
  const addsAfter = createMemo(() => {
    const id = resolved();
    const all = rows();
    const start = all.findIndex((row) => row.kind === "node" && row.node.id === id);
    const head = all[start];

    if (head?.kind !== "node" || head.collapsed !== null) return null;

    const end = all.findIndex((row, index) => index > start && row.depth <= head.depth);

    return { key: all[(end === -1 ? all.length : end) - 1]!.key, depth: head.depth + 1, workstream: head.node.id };
  });

  const spawnAgentWith = (prompt: string | null, under: string | null = parent()) =>
    guarded(async () => {
      const { model, effort } = picked();
      const params: SpawnParams = { cwd: project.path, prompt, parent: under };

      if (model !== null) params.model = model;

      if (effort !== null) params.effort = effort;

      const spawned = await app.rpc("agent.spawn", params);

      setPicked({ model: null, effort: null });
      setModelOpen(false);
      setWanted(spawned.id);
      setComposing(false);
    });

  const spawnAgent = () => spawnAgentWith(null);

  /** U164: the running Terminals an Agent started. */
  const runningRuns = (id: string) => rail.terminals().filter((terminal) => terminal.owner === id && terminal.running && rail.terminalExit(terminal.id) === null).length;

  const canSpawn = () => !pending() && !rail.workstreamCreating() && !rail.doorPending(rail.selected() ?? "") && daemonExit() === null;

  onMount(() => {
    const clear = () => {
      setFailure(null);
      rail.clearWorkstreamFailure();
      rail.clearStorageFailure();
    };

    const chord = (press: KeyboardEvent) => {
      if (!press.metaKey || press.ctrlKey || press.altKey) return;

      const key = press.key.toLowerCase();

      if (press.shiftKey) {
        if (key !== "n") return;

        press.preventDefault();

        if (press.repeat) return;

        if (canSpawn()) setComposing(true);

        return;
      }

      const spawn = { n: spawnAgent }[key];

      if (!spawn) return;

      press.preventDefault();

      if (press.repeat) return;

      if (key === "n" && composing()) return;

      if (canSpawn()) spawn();
    };

    document.addEventListener("click", clear, true);
    document.addEventListener("keydown", chord);
    onCleanup(() => {
      document.removeEventListener("click", clear, true);
      document.removeEventListener("keydown", chord);
    });
  });

  /** Restoring must not scroll before the window has placed focus (U100). */
  createEffect(
    on(rail.selected, (id) => {
      if (id === null || rail.restored()) return;

      queueMicrotask(() => rowElement(id)?.scrollIntoView({ block: "nearest" }));
    }),
  );

  createEffect(() => {
    const id = wanted();

    if (id !== null && rail.nodes.some((node) => node.id === id)) {
      rail.select(id);
      setWanted(null);
    }
  });

  return (
    <>
    <div class="rail-scroll">
    <div
      class="rail-tree"
      ref={setContainer}
      style={{
        "--room": `${drag.state()?.room ?? 0}px`,
        "--lift": `${drag.state()?.lift ?? 0}px`,
        "--shift-ms": reducedMotion() ? "0ms" : "120ms",
      }}
    >
      <Show when={composing()}>
        <SpawnPromptField
          ref={setField}
          onSubmit={(prompt) => {
            if (canSpawn()) spawnAgentWith(prompt);
          }}
          onCancel={() => setComposing(false)}
        />
      </Show>
      <Show when={workstreams() > 0}>
        <GroupHead group="rail:workstreams" label="workstreams" shown={workstreams()} total={workstreams()} />
      </Show>
      <div
        role="tree"
        aria-label="Rail"
        aria-disabled={daemonExit() !== null ? true : undefined}
        onKeyDown={onRailKeyDown}
      >
        <For each={keys()}>
          {(key) => (
            <Show when={byKey().get(key)}>
              {(row) => {
                const node = createMemo(() => {
                  const current = row();

                  return current.kind === "node" ? current : undefined;
                });

                const fold = createMemo(() => {
                  const current = row();

                  return current.kind === "fold" ? current : undefined;
                });

                return (
                  <>
                    <Show when={node()}>
                      {(view) => (
                        <RailRowView
                          row={view()}
                          exit={rail.exitOf(view().node)}
                          agentsLive={isWorkstream(view().node) ? liveAgentsBelow(rail.nodes, view().node.id) : 0}
                          selected={rail.selected() === view().node.id}
                          tabbable={tabbableId() === view().node.id}
                          now={now}
                          onSelect={() => rail.select(view().node.id)}
                          onToggle={() => rail.toggleCollapsed(view().node.id)}
                          onRename={(name) =>
                            void attempt(() => app.rpc("rail.rename", { id: view().node.id, name }))
                          }
                          onStartDoor={() => { rail.select(view().node.id); void rail.startDoor(view().node.id); }}
                          runs={runningRuns(view().node.id)}
                          doorPending={rail.doorPending(view().node.id)}
                          doorFailure={rail.doorFailure(view().node.id)}
                          dragging={dragged() !== null}
                          lifted={drag.state()?.lifted.has(view().node.id) ?? false}
                          shift={drag.state()?.shifts.get(view().node.id) ?? 0}
                          onPointerDown={(press) => drag.start(view().node.id, press)}
                          onOpenMenu={(press) => menu.open(view().node, rail.exitOf(view().node), press.clientX, press.clientY)}
                        />
                      )}
                    </Show>
                    <Show when={fold()}>
                      {(view) => (
                        <div class="rail-fold" role="none" style={{ "--indent": `calc(${view().depth} * var(--rail-step) + var(--rail-inset))` }}>
                          <For each={view().trail}>
                            {(runs, at) => <Show when={runs}><span class="rail-pass" aria-hidden="true" style={{ "--level": at() }} /></Show>}
                          </For>
                          <Show when={view().depth > 0}>
                            <span class="rail-branch" aria-hidden="true" data-last="true" style={{ "--level": view().depth - 1 }} />
                          </Show>
                          <button data-button="quiet"
                            class="word"
                            role="treeitem"
                            aria-level={view().depth + 1}
                            onClick={() => setUnfolded((open) => toggled(open, view().parent))}
                          >
                            <KindGlyph kind="done" decorative /> {view().count} done
                          </button>
                        </div>
                      )}
                    </Show>
                    <Show when={addsAfter()?.key === key ? addsAfter() : undefined}>
                      {(adds) => (
                        <div class="rail-adds" role="none" style={{ "--indent": `calc(${adds().depth} * var(--rail-step) + var(--rail-inset))` }}>
                          <button data-button="icon"
                            class="word"
                            role="treeitem"
                            aria-label="Add Agent"
                            title="Add Agent ⌘N"
                            aria-level={adds().depth + 1}
                            aria-disabled={canSpawn() ? undefined : true}
                            onClick={() => {
                              if (!canSpawn()) return;

                              if (composing()) field()?.focus();
                              else spawnAgentWith(null, adds().workstream);
                            }}
                          >
                            <Icon name="plus" />
                          </button>
                          <button data-button="quiet"
                            class="word model-disclosure"
                            type="button"
                            aria-expanded={modelOpen()}
                            onClick={() => {
                              setModelOpen(!modelOpen());
                              void choices.load();
                            }}
                          >
                            Model…
                          </button>
                          <Show when={modelOpen() && choices.list()}>
                            {(list) => (
                              <div class="model-panel">
                                <ModelPair
                                  subject="new agent"
                                  models={list().models}
                                  efforts={list().efforts}
                                  model={picked().model}
                                  effort={picked().effort}
                                  onModel={(model) => setPicked({ ...picked(), model })}
                                  onEffort={(effort) => setPicked({ ...picked(), effort })}
                                />
                              </div>
                            )}
                          </Show>
                        </div>
                      )}
                    </Show>
                  </>
                );
              }}
            </Show>
          )}
        </For>
      </div>
      <Show when={drag.state()}>
        {(dragging) => (
          <div
            class="drop-line"
            aria-hidden="true"
            style={{ top: `${dragging().top}px`, "--depth": dragging().drop.depth }}
          />
        )}
      </Show>
    </div>
    </div>
      <Show when={failure() ?? rail.workstreamFailure() ?? rail.doorFailure(rail.selected() ?? "") ?? rail.storageFailure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={modelOpen() ? choices.failure() : null}>{(message) => <ErrorLine message={message()} />}</Show>
      <RailMenu menu={menu} />
      <div class="rail-actions">
        <button data-button="add"
          aria-label="Add Workstream"
          class="word"
          aria-disabled={canSpawn() ? undefined : true}
          onClick={() => {
            if (canSpawn()) guarded(() => rail.createWorkstream());
          }}
        >
          <Icon name="plus" /> Workstream
        </button>
      </div>
    </>
  );
};
