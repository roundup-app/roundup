import { createMemo, createSignal, For, Show } from "solid-js";
import type { Adoptable } from "@contracts/agent/Adoptable";
import { failureOf } from "../app/failureOf";
import { useConnectedProject } from "../state/connectedProject";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { DialogFailure } from "../ink/MountedLine";
import { copy } from "./copy";

/** G10: the user's pick of a worktree to start an Agent in. Discovery changes nothing; choosing a row sends `agent.adopt` with the branch the row showed. */
export const AdoptWorktree = (props: { onClose: () => void; onAdopted: (id: string) => void }) => {
  const { app, rail } = useConnectedProject();
  const [rows, setRows] = createSignal<readonly Adoptable[] | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  // The dialog owns focus: focus moving inside it must not dismiss the picker.
  let content: HTMLElement | undefined;

  void failureOf(async () => { setRows(await app.rpc("agent.adoptable", null)); }).then(failed => { if (failed !== null) { setFailure(failed); setRows([]); } });

  const choose = async (row: Adoptable) => {
    const branch = row.branch;

    if (busy() || row.refusal !== null || branch === null) return;
    setBusy(true);
    setFailure(null);
    let id: string | undefined;
    const failed = await failureOf(async () => { id = (await app.rpc("agent.adopt", { path: row.path, branch, parent: null })).id; });

    setBusy(false);

    if (failed !== null || id === undefined) {
      setFailure(failed ?? copy.adoptFailed);

      return;
    }

    await rail.refresh();
    rail.select(id);
    props.onAdopted(id);
  };

  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal<string | null>(null);
  const pickable = createMemo(() => (rows() ?? []).filter(row => row.refusal === null && row.branch !== null));
  const refused = createMemo(() => (rows() ?? []).filter(row => row.refusal !== null));
  const byPath = createMemo(() => new Map(pickable().map(row => [row.path, row])));
  const nameOf = (row: Adoptable) => row.branch ?? copy.adoptDetached;
  const items = createMemo(() => pickable().filter(row => `${nameOf(row)} ${row.path}`.toLowerCase().includes(query().trim().toLowerCase())).map(row => ({ value: row.path, label: nameOf(row) })));
  const facts = (row: Adoptable | undefined) => row === undefined ? "" : [row.dirty ? copy.adoptDirty : null, row.ahead > 0 ? copy.adoptAhead(row.ahead) : null].filter(Boolean).join(" · ");

  return <Dialog.Root open onOpenChange={({ open }) => { if (!open) props.onClose(); }}>
    <Dialog.Content class="app-dialog-form" ref={element => { content = element; }}>
      <Dialog.Title>{copy.adoptTitle}</Dialog.Title>
      <Dialog.Description>{copy.adoptHint}</Dialog.Description>
      <Show when={rows()} fallback={<p>{copy.adoptLoading}</p>}>{list =>
        <Show when={list().length > 0} fallback={<p>{copy.adoptNone}</p>}>
          <Combobox.Root items={items()} inputValue={query()} onInput={setQuery} highlightedValue={highlight()} onHighlightChange={setHighlight}
            autoFocus={false} onDismiss={props.onClose} focusScope={() => content}
            onSelect={path => {
              const row = byPath().get(path);

              if (row) void choose(row);
            }}
            label={copy.adoptFilterLabel} placeholder={copy.adoptFilterPlaceholder} empty={copy.noMatch}
            row={item => <span class="adopt-row"><span>{item.label}</span><span>{item.value}</span><Show when={facts(byPath().get(item.value))}><span>{facts(byPath().get(item.value))}</span></Show></span>} />
          <Show when={refused().length > 0}>
            <ul class="adopt-refused" aria-label={copy.adoptRefusedLabel}>
              <For each={refused()}>{row => <li><span>{copy.adoptRefusedRow(nameOf(row), row.path)}</span><span>{copy.adoptRefusal(row.refusal ?? "")}</span></li>}</For>
            </ul>
          </Show>
        </Show>}
      </Show>
      <DialogFailure message={failure()} dismiss={() => setFailure(null)} />
      <div class="app-dialog-actions"><Dialog.CloseTrigger type="button" data-button="quiet">{copy.close}</Dialog.CloseTrigger></div>
    </Dialog.Content>
  </Dialog.Root>;
};
