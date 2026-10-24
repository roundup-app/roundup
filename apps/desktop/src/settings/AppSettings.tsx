import { createResource, createSignal, onCleanup, Show } from "solid-js";
import type { App } from "../app/seam";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";
import { registerKeys } from "../keys/registry";
import { Combobox } from "../ui/Combobox";
import { Select } from "../ui/Select";
import * as v from "valibot";
import { draftStorage } from "../state/storage";
import { createSettingsView } from "../state/settingsView";
import { MIN_FONT_SIZE, MAX_FONT_SIZE } from "../terminal/fontSize";
import { appSettings, saveAppSettings } from "./preferences";
import { SettingsGroup, SettingsShell } from "./SettingsShell";
import { ShortcutSetting } from "./ShortcutSetting";

/** One App-wide center view, available even before a Project is open. */
export const AppSettings = (props: { app: App; project: () => string | null; onOpenChange?: (open: boolean) => void }) => {
  const view = createSettingsView();
  const [failure, setFailure] = createSignal<string | null>(null);
  const [sizeFailure, setSizeFailure] = createSignal<string | null>(null);
  const defaultFont = getComputedStyle(document.documentElement).getPropertyValue("--font-terminal").trim();
  const drafts = draftStorage("app-settings");
  drafts.validate("settings", v.object({ text: v.string() }));
  const destination = (field: string) => ({ surface: "settings", object: field, recipient: null });
  const current = (field: string) => drafts.list().findLast(draft => draft.destination.surface === "settings" && draft.destination.object === field);
  const field = (name: "fontFamily" | "fontSize") => String(current(name)?.value.text ?? appSettings()[name]);

  const edit = (name: string, input: HTMLInputElement) => drafts.edit(destination(name), { text: input.value },
    { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? "none" }, "ordinary");

  const commit = (name: "fontFamily" | "fontSize", value: string | number) => {
    const revision = current(name)?.revision;
    const cause = saveAppSettings({ [name]: value });
    setFailure(cause);

    if (cause === null && revision) drafts.discard(revision);
  };

  const show = () => { if (!view.open()) { view.show(document.activeElement instanceof HTMLElement ? document.activeElement : document.body); props.onOpenChange?.(true); } };

  let disposed = false;
  let stop: (() => void) | undefined;
  let stopProject: (() => void) | undefined;

  void props.app.onAppSettings(show).then(unsubscribe => { if (disposed) unsubscribe(); else stop = unsubscribe; });
  void props.app.onProjectPage(({ path }) => {
    if (path !== props.project() || !view.open()) return;
    props.onOpenChange?.(false);
    view.close();
  }).then(unsubscribe => { if (disposed) unsubscribe(); else stopProject = unsubscribe; });
  onCleanup(() => { disposed = true; stop?.(); stopProject?.(); });
  registerKeys({ kind: "app" }, [{ chords: ["Meta+Comma"], run: show }]);

  const [offered] = createResource(() => view.open() && props.project(), async path => {
    try {
      return { list: await props.app.forProject(path).rpc("models.list", null), failure: null };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return { list: null, failure: error.message };
    }
  });

  const save = (patch: Parameters<typeof saveAppSettings>[0]) => setFailure(saveAppSettings(patch));

  const commitSize = () => {
    const size = Number(field("fontSize"));

    if (field("fontSize").trim() === "" || !Number.isFinite(size) || size < MIN_FONT_SIZE || size > MAX_FONT_SIZE) return setSizeFailure(copy.fontSizeRefusal(MIN_FONT_SIZE, MAX_FONT_SIZE));

    setSizeFailure(null);
    commit("fontSize", size);
  };

  const chooseEngine = (engine: string) => {
    const list = offered()?.list;
    const only = list?.engines.length === 1 ? list.engines[0]?.id : undefined;
    const previous = appSettings().engine;
    const same = previous === engine || (previous || only) === (engine || only);

    const patch: Parameters<typeof saveAppSettings>[0] = { engine, engineLabel: list?.engines.find(item => item.id === engine)?.label ?? "" };

    if (!same) { patch.model = ""; patch.modelLabel = ""; }

    save(patch);
  };

  const defaults = [{ value: "", label: copy.modelDefault }];

  return <Show when={view.open()}>
    <SettingsShell heading={copy.settings} onClose={() => { props.onOpenChange?.(false); view.close(); }}>
      <SettingsGroup name={copy.settingsAgents}>
        <Select label={copy.permissionMode} value={appSettings().permissionMode} choices={[
          { value: "", label: copy.permissionDefault }, { value: "default", label: copy.permissionNormal },
          { value: "acceptEdits", label: copy.permissionEdits }, { value: "plan", label: copy.permissionPlan }, { value: "auto", label: copy.permissionAuto },
        ]} onValueChange={permissionMode => { if (permissionMode === "" || permissionMode === "default" || permissionMode === "acceptEdits" || permissionMode === "plan" || permissionMode === "auto") save({ permissionMode }); }} />
        <Show when={props.project()}>
          <label class="settings-field"><span>{copy.engine}</span><Combobox.Picker label={copy.engine} value={appSettings().engine} savedLabel={appSettings().engineLabel || copy.engine}
            items={[...defaults, ...(offered()?.list?.engines ?? []).map(item => ({ value: item.id, label: item.label }))]}
            onSelect={chooseEngine} /></label>
          <label class="settings-field"><span>{copy.model}</span><Combobox.Picker label={copy.model} value={appSettings().model} savedLabel={appSettings().modelLabel || copy.model}
            items={[...defaults, ...(offered()?.list?.models ?? []).map(item => ({ value: item.id, label: item.label }))]}
            onSelect={model => save({ model, modelLabel: offered()?.list?.models.find(item => item.id === model)?.label ?? "" })} /></label>
        </Show>
        <ReservedLine message={offered()?.failure} />
      </SettingsGroup>
      <SettingsGroup name={copy.settingsTerminal}>
        <label class="settings-field settings-font"><span>{copy.fontFamily}</span><input type="text" aria-label={copy.fontFamily} placeholder={defaultFont} value={field("fontFamily")}
          onInput={event => edit("fontFamily", event.currentTarget)} onBlur={() => { commit("fontFamily", field("fontFamily")); }}
          onKeyDown={event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commit("fontFamily", field("fontFamily")); } }} /></label>
        <div class="settings-field"><label><span>{copy.fontSize}</span><input type="text" aria-label={copy.fontSize} inputMode="decimal" value={field("fontSize")}
          onInput={event => edit("fontSize", event.currentTarget)} onBlur={commitSize}
          onKeyDown={event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commitSize(); } }} /></label>
          <ReservedLine message={sizeFailure()} />
        </div>
      </SettingsGroup>
      <SettingsGroup name={copy.settingsShortcuts}><ShortcutSetting onFailure={setFailure} /></SettingsGroup>
      <SettingsGroup name={copy.settingsAppearance}>
        <Select label={copy.mode} choices={[{ value: "dark", label: copy.modeDark }, { value: "light", label: copy.modeLight }, { value: "system", label: copy.modeSystem }]} value={appSettings().mode}
          onValueChange={mode => { if (mode === "dark" || mode === "light" || mode === "system") save({ mode }); }} />
      </SettingsGroup>
      <ReservedLine message={failure()} />
      <ReservedLine message={drafts.problem() ? copy.draftRetention(copy.settings, copy.settingsTerminal, drafts.problem()!.cause) : null}><button data-button="quiet" type="button" onClick={() => drafts.retry()}>{copy.storageRetry}</button></ReservedLine>
    </SettingsShell>
  </Show>;
};
