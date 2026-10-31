import type { CapturePort } from "../app/seam";
import { createSignal, createUniqueId, Show } from "solid-js";
import { copy } from "./copy";
import { KeyChip } from "../keys/KeyChip";
import { ReservedLine } from "../ink/ReservedLine";
import { CHORDS, LEADER, pressOf, shortcutLabel } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { appSettings, saveAppSettings } from "./preferences";

/** Ark's existing key registry owns recording as a modal layer, ahead of App shortcuts. */
const ROWS = {
  quickAdd: { label: copy.quickAddTodo, hint: copy.quickAddHint },
  quickAddAnywhere: { label: copy.quickAddAnywhere, hint: copy.quickAddAnywhereHint },
} as const;

const fallbackOf = (field: keyof typeof ROWS) => field === "quickAdd" ? "meta+shift+KeyT" : "";

export const ShortcutSettings = (props: { capture?: CapturePort | undefined; onFailure: (message: string | null) => void }) => <>
  <ShortcutSetting field="quickAdd" {...props} />
  <ShortcutSetting field="quickAddAnywhere" {...props} />
</>;

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
      <div class="settings-caption"><span id={caption} class="settings-field-caption">{row.label}</span><span id={hint} class="settings-hint">{row.hint}</span></div>
      <div class="settings-shortcut">
      <button ref={button} aria-describedby={hint} aria-pressed={recording()} aria-invalid={!!failure()} data-button="quiet" type="button" aria-labelledby={`${caption} ${value}`} onClick={() => { setRecording(true); setFailure(null); }}>
        <span id={value}><Show when={recording()} fallback={press() ? <KeyChip keys={shortcutLabel(press(), appSettings()[key()])} /> : <span>{copy.none}</span>}><span class="settings-recording-mark" aria-hidden="true">{copy.recordingMark}</span> {copy.recordShortcut}</Show></span>
      </button>
      <Show when={press() !== fallbackOf(props.field)}><button data-button="quiet" type="button" onClick={() => save(fallbackOf(props.field))}>{copy.reset}</button></Show>
      </div>
    </div>
    <ReservedLine message={failure()} />
  </>;
};
