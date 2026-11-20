import { Show, createSignal, onSettled } from "solid-js";
import { parseArgsStringToArgv } from "string-argv";
import { copy } from "./copy";
import { SettingsGroup } from "../settings/SettingsShell";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../app/failureOf";
import { BusyButton } from "../ui/BusyButton";
import { Field } from "../ui/Field";
import { createMessageToast } from "../ink/messageToast";

/** whether a quote in `text` is never closed, as a shell reads one. */
const unclosed = (text: string): boolean => {
  let quote: string | null = null;

  for (let at = 0; at < text.length; at++) {
    const char = text.charAt(at);

    if (quote === null && char === "\\") at++;
    else if (quote === null && (char === "'" || char === '"')) quote = char;
    else if (quote === char) quote = null;
  }

  return quote !== null;
};

/** whether `dir` is a relative path that stays inside the Project folder. */
const inside = (dir: string): boolean => {
  if (dir.startsWith("/") || /^[A-Za-z]:/.test(dir)) return false;

  let depth = 0;

  for (const part of dir.split(/[\\/]/)) {
    if (part === "..") depth--;
    else if (part !== "" && part !== ".") depth++;

    if (depth < 0) return false;
  }

  return true;
};

const quoted = (word: string) => word === "" || /[\s'"\\]/.test(word) ? `"${word.replace(/(["\\])/g, "\\$1")}"` : word;

type Refusal = { field: "command" | "folder"; text: string } | null;

const ProgramField = (props: { name: "command" | "folder"; label: string; refusal: Refusal; value: string; setValue: (value: string) => void; ref: (element: HTMLTextAreaElement) => void; commit: () => void; keys: (event: KeyboardEvent) => void }) => {
  const failed = () => props.refusal !== null && props.refusal.field === props.name;
  const errorId = () => `program-${props.name}-error`;

  return <Field.Root invalid={failed()}>
    <label class="app-dialog-field">
      <span class="program-label">{props.label}</span>
      <textarea ref={props.ref} class="field-frame program-field" rows={1} spellcheck={false} autocorrect="off" autocapitalize="off" aria-invalid={failed() ? "true" : undefined} aria-describedby={failed() ? errorId() : undefined} aria-label={props.label} value={props.value}
        onInput={event => props.setValue(event.currentTarget.value)} onBlur={() => props.commit()} onKeyDown={event => props.keys(event)} />
    </label>
    <Field.ErrorText id={errorId()}>{props.refusal !== null && failed() ? copy.programRefused(props.refusal.text) : null}</Field.ErrorText>
  </Field.Root>;
};

/** PG6: the Project's `Program` section. Enter or blur with a changed value is one `project.setProgram`; a bad entry is refused in the field and calls nothing. */
export const ProgramSettings = () => {
  const { app } = useConnectedProject();
  const [saved, setSaved] = createSignal<{ argv: string[]; dir: string } | null>(null);
  const [command, setCommand] = createSignal("");
  const [folder, setFolder] = createSignal("");
  const [refusal, setRefusal] = createSignal<{ field: "command" | "folder"; text: string } | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);

  const show = (program: { argv: string[]; dir: string } | null) => {
    setSaved(program);
    setCommand(program ? program.argv.map(quoted).join(" ") : "");
    setFolder(program && program.dir !== "." ? program.dir : "");
  };

  onSettled(() => void (async () => {
    const message = await failureOf(async () => { show((await app.rpc("project.get", null)).program); });

    if (message !== null) setFailure(message);
    setLoaded(true);
  })());

  let commandField: HTMLTextAreaElement | undefined;
  let folderField: HTMLTextAreaElement | undefined;
  let saving = false;

  const run = async (call: () => Promise<null>, after: () => void) => {
    if (saving) return;

    saving = true;
    setFailure(null);
    const message = await failureOf(call);

    saving = false;

    if (message !== null) return setFailure(message);

    after();
  };

  const commit = () => {
    if (!loaded()) return;

    // A setter is batched, so the field itself holds the text a key or blur just left.
    const text = commandField?.value ?? command();
    const argv = unclosed(text) ? [] : parseArgsStringToArgv(text);

    if (argv.length === 0) return setRefusal({ field: "command", text: copy.programCommandRefusal });

    const typed = (folderField?.value ?? folder()).trim();
    const dir = typed === "" ? "." : typed;

    if (!inside(dir)) return setRefusal({ field: "folder", text: copy.programFolderRefusal });

    setRefusal(null);

    const current = saved();

    if (current && current.dir === dir && current.argv.length === argv.length && current.argv.every((word, at) => word === argv[at])) return;

    void run(() => app.rpc("project.setProgram", { argv, dir }), () => setSaved({ argv, dir }));
  };

  const clear = () => run(() => app.rpc("project.clearProgram", null), () => { setRefusal(null); show(null); });

  createMessageToast({ get message() { return failure(); }, dismiss: () => setFailure(null) });

  const keys = (event: KeyboardEvent) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commit(); } };

  return <SettingsGroup name={copy.program}><div class="app-dialog-form">
    <ProgramField name="command" label={copy.programCommand} refusal={refusal()} value={command()} setValue={setCommand} ref={element => { commandField = element; }} commit={commit} keys={keys} />
    <ProgramField name="folder" label={copy.programFolder} refusal={refusal()} value={folder()} setValue={setFolder} ref={element => { folderField = element; }} commit={commit} keys={keys} />
    <p>{copy.programNote}</p>
    <Show when={saved() !== null}><BusyButton kind="quiet" busyLabel={copy.programClearing} onClick={clear}>{copy.programClear}</BusyButton></Show>
  </div></SettingsGroup>;
};
