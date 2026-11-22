import { Show, createSignal, onSettled, untrack } from "solid-js";
import { parseArgsStringToArgv } from "string-argv";
import { copy } from "./copy";
import { SettingsGroup } from "./SettingsShell";
import { markControl } from "./place";
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

type Field = "command" | "folder" | "adopt";

type Refusal = { field: Field; text: string } | null;

type Saved = { argv: string[]; dir: string; adoptDir?: string };

const same = (current: Saved | null, next: Saved) => current !== null && current.dir === next.dir && current.adoptDir === next.adoptDir && current.argv.length === next.argv.length && current.argv.every((word, at) => word === next.argv[at]);

const checked = (folder: string, adopt: string): { dir: string; adoptDir: string } | { refusal: NonNullable<Refusal> } => {
  const typed = folder.trim();
  const dir = typed === "" ? "." : typed;

  if (!inside(dir)) return { refusal: { field: "folder", text: copy.programFolderRefusal } };

  const adoptDir = adopt.trim();

  if (adoptDir !== "" && !inside(adoptDir)) return { refusal: { field: "adopt", text: copy.programAdoptRefusal } };

  return { dir, adoptDir };
};

/** PL2: the settings-link control of each field. */
const CONTROL_IDS = { command: "program", folder: "program-folder", adopt: "program-worktree" } as const;

const ProgramField = (props: { name: Field; label: string; refusal: Refusal; value: string; setValue: (value: string) => void; ref: (element: HTMLTextAreaElement) => void; commit: () => void; keys: (event: KeyboardEvent) => void }) => {
  const failed = () => props.refusal !== null && props.refusal.field === props.name;
  const errorId = () => `program-${props.name}-error`;

  return markControl(untrack(() => CONTROL_IDS[props.name]), () => <Field.Root invalid={failed()}>
    <label class="app-dialog-field">
      <span class="program-label">{props.label}</span>
      <textarea ref={props.ref} class="field-frame program-field" rows={1} spellcheck={false} autocorrect="off" autocapitalize="off" aria-invalid={failed() ? "true" : undefined} aria-describedby={failed() ? errorId() : undefined} aria-label={props.label} value={props.value}
        onInput={event => props.setValue(event.currentTarget.value)} onBlur={() => props.commit()} onKeyDown={event => props.keys(event)} />
    </label>
    <Field.ErrorText id={errorId()}>{props.refusal !== null && failed() ? copy.programRefused(props.refusal.text) : null}</Field.ErrorText>
  </Field.Root>);
};

/** PG6: the Project's `Program` section. Enter or blur with a changed value is one `project.setProgram`; a bad entry is refused in the field and calls nothing. */
export const ProgramSettings = () => {
  const { app } = useConnectedProject();
  const [saved, setSaved] = createSignal<Saved | null>(null);
  const [command, setCommand] = createSignal("");
  const [folder, setFolder] = createSignal("");
  const [adopt, setAdopt] = createSignal("");
  const [refusal, setRefusal] = createSignal<Refusal>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);

  const show = (program: Saved | null) => {
    setSaved(program);
    setCommand(program ? program.argv.map(quoted).join(" ") : "");
    setFolder(program && program.dir !== "." ? program.dir : "");
    setAdopt(program?.adoptDir ?? "");
  };

  onSettled(() => void (async () => {
    const message = await failureOf(async () => { show((await app.rpc("project.get", null)).program); });

    if (message !== null) setFailure(message);
    setLoaded(true);
  })());

  let commandField: HTMLTextAreaElement | undefined;
  let folderField: HTMLTextAreaElement | undefined;
  let adoptField: HTMLTextAreaElement | undefined;
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

    const entry = checked(folderField?.value ?? folder(), adoptField?.value ?? adopt());

    if ("refusal" in entry) return setRefusal(entry.refusal);

    const { dir, adoptDir } = entry;

    setRefusal(null);

    const program: Saved = adoptDir === "" ? { argv, dir } : { argv, dir, adoptDir };

    if (same(saved(), program)) return;

    void run(() => app.rpc("project.setProgram", program), () => setSaved(program));
  };

  const clear = () => run(() => app.rpc("project.clearProgram", null), () => { setRefusal(null); show(null); });

  createMessageToast({ get message() { return failure(); }, dismiss: () => setFailure(null) });

  const keys = (event: KeyboardEvent) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commit(); } };

  return <SettingsGroup name={copy.program}><div class="app-dialog-form">
    <ProgramField name="command" label={copy.programCommand} refusal={refusal()} value={command()} setValue={setCommand} ref={element => { commandField = element; }} commit={commit} keys={keys} />
    <ProgramField name="folder" label={copy.programFolder} refusal={refusal()} value={folder()} setValue={setFolder} ref={element => { folderField = element; }} commit={commit} keys={keys} />
    <ProgramField name="adopt" label={copy.programAdopt} refusal={refusal()} value={adopt()} setValue={setAdopt} ref={element => { adoptField = element; }} commit={commit} keys={keys} />
    <p>{copy.programNote}</p>
    <Show when={saved() !== null}><BusyButton kind="quiet" busyLabel={copy.programClearing} onClick={clear}>{copy.programClear}</BusyButton></Show>
  </div></SettingsGroup>;
};
