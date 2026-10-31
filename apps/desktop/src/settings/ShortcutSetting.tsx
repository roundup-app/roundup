import type { App, CapturePort } from "../app/seam";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { copy } from "./copy";
import { KeyChip } from "../keys/KeyChip";
import { ReservedLine } from "../ink/ReservedLine";
import { CHORDS, LEADER, defaultPress, pressOf, recordable, shortcutLabel } from "../keys/chords";
import { listActions } from "../keys/actions";
import { registerKeys } from "../keys/registry";
import { appSettings, saveAppSettings } from "./preferences";

/** Ark's existing key registry owns recording as a modal layer, ahead of App shortcuts. */
const ROWS = {
  quickAdd: { label: copy.quickAddTodo, hint: copy.quickAddHint },
  quickAddAnywhere: { label: copy.quickAddAnywhere, hint: copy.quickAddAnywhereHint },
} as const;

const fallbackOf = (field: keyof typeof ROWS) => field === "quickAdd" ? "meta+shift+KeyT" : "";

/** U5239d: the only chords a focused Terminal leaves to the App (U2241); every other `⌃`, `⌥` or `⌘` chord is the Terminal's. */
const appScope = () => new Set(["meta+KeyN", "meta+shift+KeyN", "meta+KeyT", "meta+KeyK", "meta+Slash", "meta+Comma", "ctrl+meta+KeyJ", "meta+KeyB", appSettings().quickAdd]);

const RESERVED = () => new Map([["meta+KeyQ", copy.quitApp], ["meta+KeyH", copy.hideApp], ["meta+Space", copy.spotlight], ["meta+Tab", copy.switchApps]]);

/** The action that holds `press` now, a macOS-reserved chord included. */
const holderOf = (press: string, except = ""): string | undefined =>
  RESERVED().get(press)
  ?? CHORDS.find(row => row.name !== except && row.presses.includes(press))?.what
  ?? LEADER.find(row => row.press.toLowerCase() === press.toLowerCase())?.what;

const isModifier = (event: KeyboardEvent) => ["Control", "Alt", "Meta", "Shift", "CapsLock"].includes(event.key) || event.isComposing;

type Mode = { kind: "record"; name: string } | { kind: "find" };

/** U5239a to U5239e: one row per named action with its keys, a key to record for each, a lookup by key and the overrides saved to a file. */
export const ShortcutSettings = (props: { capture?: CapturePort | undefined; app?: App | undefined; onFailure: (message: string | null) => void }) => {
  const [mode, setMode] = createSignal<Mode | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [found, setFound] = createSignal<string | null>(null);

  const rows = createMemo(() => {
    appSettings();

    return listActions();
  });

  const overrides = () => appSettings().shortcuts;
  let active: HTMLElement | undefined;

  const stop = () => { setMode(null); setFailure(null); };

  const record = async (name: string, event: KeyboardEvent) => {
    if (!event.metaKey && !event.ctrlKey) return setFailure(copy.shortcutModifier);

    const press = pressOf(event);
    const label = shortcutLabel(press, event.key);
    const holder = holderOf(press, name);

    if (holder) return setFailure(copy.shortcutRefusal(label, holder));

    if (!appScope().has(press)) return setFailure(copy.shortcutTerminal(label));

    await change(name, press);
  };

  const change = async (name: string, press: string | null) => {
    const { [name]: _gone, ...rest } = overrides();
    const next = press === null || press === defaultPress(name) ? rest : { ...rest, [name]: press };

    setFailure(null);
    props.onFailure(await saveAppSettings({ shortcuts: next }, props.capture));
    setMode(null);
  };

  const look = (event: KeyboardEvent) => {
    const press = pressOf(event);
    const owner = RESERVED().get(press) ?? CHORDS.find(row => row.presses.includes(press))?.what;
    const label = shortcutLabel(press, event.key);

    setFound(owner ? copy.chordIs(label, owner) : copy.chordFree(label));
    setMode(null);
  };

  registerKeys({ kind: "layer", element: () => active, active: () => mode() !== null, modal: true }, [
    { chords: ["Escape"], run: stop },
    { chords: ["[Control]+[Alt]+[Meta]+[Shift]+(.+)"], when: event => !isModifier(event), run: event => {
      const current = mode();

      if (current?.kind === "record") void record(current.name, event);
      else if (current) look(event);
    } },
  ]);

  const recording = (name: string) => {
    const current = mode();

    return current?.kind === "record" && current.name === name;
  };

  const begin = (next: Mode) => (event: MouseEvent & { currentTarget: HTMLElement }) => { active = event.currentTarget; setFound(null); setFailure(null); setMode(next); };

  const save = async () => {
    if (!props.app) return;

    props.onFailure(null);

    try {
      const path = await props.app.chooseSavePath("shortcuts.json");

      if (path !== null) await props.app.forProject("").rpc("shortcuts.export", { path, keys: overrides() });
    } catch (error) {
      props.onFailure(error instanceof Error ? error.message : String(error));
    }
  };

  return <>
    <div class="settings-field">
      <div class="settings-shortcut">
        <button data-button="quiet" type="button" aria-pressed={mode()?.kind === "find"} onClick={begin({ kind: "find" })}>{mode()?.kind === "find" ? copy.recordShortcut : copy.findKey}</button>
        <button data-button="quiet" type="button" disabled={!Object.keys(overrides()).length} onClick={save}>{copy.saveToFile}</button>
      </div>
    </div>
    <ReservedLine message={failure()} status={found()} />
    <For each={rows()}>{row => row.name === "todo.capture"
      ? <><ShortcutSetting field="quickAdd" {...props} /><ShortcutSetting field="quickAddAnywhere" {...props} /></>
      : <ActionShortcut label={row.label} keys={row.keys} recording={recording(row.name)}
          {...(CHORDS.some(chord => chord.name === row.name && recordable(chord)) ? { onRecord: begin({ kind: "record", name: row.name }) } : {})}
          overridden={row.name in overrides()} onReset={() => change(row.name, null)} />}</For>
  </>;
};

/** One action's row: its label and keys, and where recordable the button to press a new key and the Reset. */
const ActionShortcut = (props: { label: string; keys: string; recording: boolean; overridden: boolean; onRecord?: ((event: MouseEvent & { currentTarget: HTMLElement }) => void) | undefined; onReset: () => void }) => {
  const caption = createUniqueId();
  const value = createUniqueId();

  return <div class="settings-field">
    <div class="settings-caption"><span id={caption} class="settings-field-caption">{props.label}</span></div>
    <div class="settings-shortcut">
      <Show when={props.onRecord} fallback={<span id={value}>{props.keys ? <KeyChip keys={props.keys} /> : <span>{copy.none}</span>}</span>}>
        <button data-button="quiet" type="button" aria-pressed={props.recording} aria-labelledby={`${caption} ${value}`} onClick={props.onRecord}>
          <span id={value}><Show when={props.recording} fallback={<KeyChip keys={props.keys} />}><span class="settings-recording-mark" aria-hidden="true">{copy.recordingMark}</span> {copy.recordShortcut}</Show></span>
        </button>
      </Show>
      <Show when={props.overridden}><button data-button="quiet" type="button" onClick={props.onReset}>{copy.reset}</button></Show>
    </div>
  </div>;
};

/** One recordable chord: the in-App quick add, or its opt-in Mac-wide twin. */
export const ShortcutSetting = (props: { field: keyof typeof ROWS; capture?: CapturePort | undefined; onFailure: (message: string | null) => void }) => {
  const row = ROWS[props.field];
  const key = () => props.field === "quickAdd" ? "quickAddKey" : "quickAddAnywhereKey";
  const press = () => appSettings()[props.field];
  const [recording, setRecording] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const caption = createUniqueId();
  const value = createUniqueId();
  const hint = createUniqueId();
  let button: HTMLButtonElement | undefined;
  const save = async (press: string, eventKey = "") => { setFailure(null); props.onFailure(await saveAppSettings({ [props.field]: press, [key()]: eventKey }, props.capture)); setRecording(false); };

  const take = (event: KeyboardEvent) => {
    if (!event.metaKey && !event.ctrlKey) return setFailure(copy.shortcutModifier);
    const press = pressOf(event);
    const reserved = new Map([["meta+KeyQ", copy.quitApp], ["meta+KeyH", copy.hideApp], ["meta+Space", copy.spotlight], ["meta+Tab", copy.switchApps]]);

    const holder = reserved.get(press)
      ?? CHORDS.find(row => row.what !== copy.captureATodo && row.presses.includes(press))?.what
      ?? LEADER.find(row => row.press.toLowerCase() === press.toLowerCase())?.what;

    if (holder) return setFailure(copy.shortcutRefusal(shortcutLabel(press, event.key), holder));

    setFailure(null);
    save(press, event.key);
  };

  registerKeys({ kind: "layer", element: () => button, active: recording, modal: true }, [
    { chords: ["Escape"], run: () => { setRecording(false); setFailure(null); } },
    { chords: ["[Control]+[Alt]+[Meta]+[Shift]+(.+)"], when: event => !["Control", "Alt", "Meta", "Shift", "CapsLock"].includes(event.key) && !event.isComposing, run: take },
  ]);

  return <>
    <div class="settings-field">
      <div class="settings-caption"><span id={caption} class="settings-field-caption">{row.label}</span></div>
      <div class="settings-shortcut">
      <button ref={button} aria-describedby={hint} aria-pressed={recording()} aria-invalid={!!failure()} data-button="quiet" type="button" aria-labelledby={`${caption} ${value}`} onClick={() => { setRecording(true); setFailure(null); }}>
        <span id={value}><Show when={recording()} fallback={press() ? <KeyChip keys={shortcutLabel(press(), appSettings()[key()])} /> : <span>{copy.none}</span>}><span class="settings-recording-mark" aria-hidden="true">{copy.recordingMark}</span> {copy.recordShortcut}</Show></span>
      </button>
      <Show when={press() !== fallbackOf(props.field)}><button data-button="quiet" type="button" onClick={() => save(fallbackOf(props.field))}>{copy.reset}</button></Show>
      </div>
      <span id={hint} class="settings-hint">{row.hint}</span>
    </div>
    <ReservedLine message={failure()} />
  </>;
};
