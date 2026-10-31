import type { CapturePort } from "../app/seam";
import { createSignal, createUniqueId, Show } from "solid-js";
import { copy } from "./copy";
import { KeyChip } from "../keys/KeyChip";
import { ReservedLine } from "../ink/ReservedLine";
import { CHORDS, LEADER, pressOf, shortcutLabel } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { appSettings, saveAppSettings } from "./preferences";

/** Ark's existing key registry owns recording as a modal layer, ahead of App shortcuts. */
export const ShortcutSetting = (props: { capture?: CapturePort | undefined; onFailure: (message: string | null) => void }) => {
  const [recording, setRecording] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const caption = createUniqueId();
  const value = createUniqueId();
  const hint = createUniqueId();
  let button: HTMLButtonElement | undefined;
  const save = async (press: string, key = "") => { setFailure(null); props.onFailure(await saveAppSettings({ quickAdd: press, quickAddKey: key }, props.capture)); setRecording(false); };

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
      <div class="settings-caption"><span id={caption} class="settings-field-caption">{copy.quickAddTodo}</span></div>
      <div class="settings-shortcut">
      <button ref={button} aria-describedby={hint} aria-pressed={recording()} aria-invalid={!!failure()} data-button="quiet" type="button" aria-labelledby={`${caption} ${value}`} onClick={() => { setRecording(true); setFailure(null); }}>
        <span id={value}><Show when={recording()} fallback={<KeyChip keys={shortcutLabel(appSettings().quickAdd, appSettings().quickAddKey)} />}><span class="settings-recording-mark" aria-hidden="true">{copy.recordingMark}</span> {copy.recordShortcut}</Show></span>
      </button>
      <Show when={appSettings().quickAdd !== "meta+shift+KeyT"}><button data-button="quiet" type="button" onClick={() => save("meta+shift+KeyT")}>{copy.reset}</button></Show>
      </div>
      <span id={hint} class="settings-hint">{copy.quickAddHint}</span>
    </div>
    <ReservedLine message={failure()} />
  </>;
};
