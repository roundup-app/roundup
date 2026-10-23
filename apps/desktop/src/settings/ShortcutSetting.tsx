import { createSignal, Show } from "solid-js";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { CHORDS, LEADER, pressOf, shortcutLabel } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { appSettings, saveAppSettings } from "./preferences";

/** Ark's existing key registry owns recording as a modal layer, ahead of App shortcuts. */
export const ShortcutSetting = (props: { onFailure: (message: string | null) => void }) => {
  const [recording, setRecording] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  let button: HTMLButtonElement | undefined;
  const save = (press: string) => { setFailure(null); props.onFailure(saveAppSettings({ quickAdd: press })); setRecording(false); };

  const take = (event: KeyboardEvent) => {
    if (!event.metaKey && !event.ctrlKey) return setFailure(copy.shortcutModifier);
    const press = pressOf(event);
    const reserved = new Map([["meta+KeyQ", copy.quitApp], ["meta+KeyH", copy.hideApp], ["meta+Space", copy.spotlight], ["meta+Tab", copy.switchApps]]);

    const holder = reserved.get(press)
      ?? CHORDS.find(row => row.what !== copy.captureATodo && row.presses.includes(press))?.what
      ?? LEADER.find(row => row.press.toLowerCase() === press.toLowerCase())?.what;

    if (holder) return setFailure(copy.shortcutRefusal(shortcutLabel(press), holder));

    setFailure(null);
    save(press);
  };

  registerKeys({ kind: "layer", element: () => button, active: recording, modal: true }, [
    { chords: ["Escape"], run: () => { setRecording(false); setFailure(null); } },
    { chords: [...copy.shortcutKeys.keys()].map(code => `[Control]+[Alt]+[Meta]+[Shift]+${code}`), run: take },
  ]);

  return <>
    <div class="settings-shortcut">
      <button ref={button} data-button="quiet" type="button" aria-label={copy.quickAddTodo} onClick={() => { setRecording(true); setFailure(null); }}>
        {recording() ? copy.recordShortcut : `${copy.quickAddTodo} ${shortcutLabel(appSettings().quickAdd)}`}
      </button>
      <Show when={appSettings().quickAdd !== "meta+shift+KeyT"}><button data-button="quiet" type="button" onClick={() => save("meta+shift+KeyT")}>{copy.reset}</button></Show>
    </div>
    <Show when={failure()}>{message => <ErrorLine message={message()} />}</Show>
  </>;
};
