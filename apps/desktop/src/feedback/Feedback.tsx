import { createSignal, Show } from "solid-js";
import type { Sent } from "@contracts/feedback/Sent";
import type { FeedbackReport } from "../app/seam";
import { ReservedLine } from "../ink/ReservedLine";
import { queueFocus } from "../keys/focus";
import { CHORDS } from "../keys/chords";
import { modalOpen, registerKeys } from "../keys/registry";
import { appSettings } from "../settings/preferences";
import { useConnectedProject } from "../state/connectedProject";
import type { ToastQueue } from "../toasts/queue";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { copy } from "./copy";
import { factsText } from "./facts";
import "./styles.css";

type Report = { id: string; capture: FeedbackReport | null; cause: string | null };

/** FB1 to FB5: `⇧⌘F` takes the shot, then opens the form; Send closes it and posts in the background, and a Toast links the comment or names the folder of the kept report. */
export const Feedback = (props: { notify: ToastQueue["notify"] }) => {
  const { app, rail, project } = useConnectedProject();
  const [report, setReport] = createSignal<Report | null>(null);
  const [capturing, setCapturing] = createSignal(false);
  const [text, setText] = createSignal("");
  const [shot, setShot] = createSignal<string | null>(null);
  let form: HTMLFormElement | undefined;

  const facts = () => {
    const node = rail.nodes.find(each => each.id === rail.selected());

    return factsText(report()?.capture ?? null, project.path, node ? { kind: node.kind, name: node.name, state: node.status?.kind ?? null } : null);
  };

  const done = (id: string, sent: Sent) => {
    const base = { key: `feedback:${id}`, item: `feedback:${id}`, project: project.path, selected: false };

    if (sent.state === "posted") {
      props.notify({ ...base, kind: "done", name: copy.title, line: copy.posted, open: async () => {
        try {
          await app.openTarget({ kind: "url", url: sent.url });

          return null;
        } catch (error) {
          return String(error instanceof Error ? error.message : error);
        }
      } });

      return;
    }

    props.notify({ ...base, kind: "error", name: sent.cause, line: copy.keptRetry(sent.dir), open: async () => {
      try {
        done(id, await app.rpc("feedback.retry", { id, target: appSettings().feedbackIssue }));

        return null;
      } catch (error) {
        return String(error instanceof Error ? error.message : error);
      }
    } });
  };

  const refused = (id: string, cause: string) => props.notify({ key: `feedback:${id}`, item: `feedback:${id}`, project: project.path, selected: false, kind: "error", name: cause, line: copy.notSent, open: () => null });

  const begin = async () => {
    setCapturing(true);

    let capture: FeedbackReport | null = null;
    let cause: string | null = null;

    try {
      if (app.feedbackCapture) capture = await app.feedbackCapture();
      else cause = copy.noCapture;
    } catch (error) {
      cause = error instanceof Error ? error.message : String(error);
    }

    setCapturing(false);
    cause ??= capture?.shot_error ?? (capture?.shot ? null : copy.noCapture);
    setText("");
    setShot(capture?.shot ?? null);
    setReport({ id: crypto.randomUUID(), capture, cause });
  };

  registerKeys({ kind: "app" }, [{ action: CHORDS.find(row => row.name === "feedback.open")!, searchable: false, capture: () => ({ available: () => report() === null && !capturing() && !modalOpen(), invoke: () => void begin() }) }]);

  const send = () => {
    const current = report();

    if (!current) return;

    const params: Parameters<typeof app.rpc<"feedback.send">>[1] = { id: current.id, text: text(), facts: facts(), target: appSettings().feedbackIssue };
    const picture = shot();
    const node = rail.selected();

    if (picture) params.shot = picture;

    if (node) params.selected = node;

    setReport(null);
    void app.rpc("feedback.send", params).then(sent => done(current.id, sent), error => refused(current.id, error instanceof Error ? error.message : String(error)));
  };

  return <Dialog.Root open={report() !== null} initialFocusEl={() => form?.querySelector("textarea") ?? null} onOpenChange={({ open }) => { if (!open) setReport(null); }}>
    <Dialog.Positioner><Dialog.Content class="app-dialog-form feedback-form">
      <form ref={element => { form = element; queueFocus(() => { if (element.isConnected) element.querySelector("textarea")?.focus({ preventScroll: true }); }); }} onSubmit={event => { event.preventDefault(); send(); }}>
        <Dialog.Title>{copy.title}</Dialog.Title>
        <Field.Root>
          <Field.Label>{copy.line}</Field.Label>
          <Field.Textarea rows={4} value={text()} onInput={event => setText(event.currentTarget.value)} />
        </Field.Root>
        <Show when={shot()} fallback={<Show when={report()?.cause}>{cause => <p class="feedback-noshot">{copy.noShot(cause())}</p>}</Show>}>
          {data => <div class="feedback-shot">
            <img src={`data:image/png;base64,${data()}`} alt={copy.shotAlt} />
            <button type="button" data-button="quiet" onClick={() => setShot(null)}>{copy.removeShot}</button>
          </div>}
        </Show>
        <section aria-label={copy.facts}><pre class="feedback-facts">{facts()}</pre></section>
        <div class="app-dialog-actions">
          <ReservedLine message={null} />
          <Dialog.CloseTrigger type="button" data-button="quiet">{copy.close}</Dialog.CloseTrigger>
          <button type="submit" data-button="primary">{copy.send}</button>
        </div>
      </form>
    </Dialog.Content></Dialog.Positioner>
  </Dialog.Root>;
};
