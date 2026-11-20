import { createSignal, For, Show } from "solid-js";
import type { Adoptable } from "@contracts/agent/Adoptable";
import { failureOf } from "../app/failureOf";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { DialogFailure } from "../ink/MountedLine";
import { copy } from "./copy";

/** G10: the user's pick of a worktree to start an Agent in. Discovery changes nothing; choosing a row sends `agent.adopt` with the branch the row showed. */
export const AdoptWorktree = (props: { onClose: () => void; onAdopted: (id: string) => void }) => {
  const { app, rail } = useConnectedProject();
  const [rows, setRows] = createSignal<readonly Adoptable[] | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  void failureOf(async () => { setRows(await app.rpc("agent.adoptable", null)); }).then(failed => { if (failed !== null) { setFailure(failed); setRows([]); } });

  const choose = async (row: Adoptable) => {
    const branch = row.branch;

    if (busy() || row.refusal !== null || branch === null) return;
    setBusy(true);
    setFailure(null);
    let id: string | undefined;
    const failed = await failureOf(async () => { id = (await app.rpc("agent.adopt", { path: row.path, branch })).id; });

    setBusy(false);

    if (failed !== null || id === undefined) {
      setFailure(failed ?? copy.adoptFailed);

      return;
    }

    await rail.refresh();
    rail.select(id);
    props.onAdopted(id);
  };

  const facts = (row: Adoptable) => [row.dirty ? copy.adoptDirty : null, row.ahead > 0 ? copy.adoptAhead(row.ahead) : null, row.refusal === null ? null : copy.adoptRefusal(row.refusal)].filter(Boolean).join(" · ");

  return <Dialog.Root open onOpenChange={({ open }) => { if (!open) props.onClose(); }}>
    <Dialog.Content class="app-dialog-form">
      <Dialog.Title>{copy.adoptTitle}</Dialog.Title>
      <Dialog.Description>{copy.adoptHint}</Dialog.Description>
      <Show when={rows()} fallback={<p>{copy.adoptLoading}</p>}>{list =>
        <Show when={list().length > 0} fallback={<p>{copy.adoptNone}</p>}>
          <ul class="adopt-list">
            <For each={list()}>{row => <li><button type="button" data-button="quiet" class="adopt-row" disabled={busy() || row.refusal !== null} onClick={() => void choose(row)}>
              <span>{row.branch ?? copy.adoptDetached}</span><span>{row.path}</span><span>{facts(row)}</span>
            </button></li>}</For>
          </ul>
        </Show>}
      </Show>
      <DialogFailure message={failure()} dismiss={() => setFailure(null)} />
      <div class="app-dialog-actions"><Dialog.CloseTrigger type="button" data-button="quiet">{copy.close}</Dialog.CloseTrigger></div>
    </Dialog.Content>
  </Dialog.Root>;
};
