import { createEffect, createResource, createSignal, createMemo, For, on, onCleanup, Show } from "solid-js";
import type { App } from "../app/seam";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";
import { registerKeys } from "../keys/registry";
import { Combobox } from "../ui/Combobox";
import { Tabs } from "../ui/Tabs";
import { Field } from "../ui/Field";
import { Deferred } from "../ui/Deferred";
import { SegmentGroup } from "../ui/SegmentGroup";
import { Switch } from "../ui/Switch";
import { Select } from "../ui/Select";
import * as v from "valibot";
import { draftStorage } from "../state/storage";
import { createSettingsView } from "../state/settingsView";
import { appSettings, saveAppSettings, terminalRanges, terminalType } from "./preferences";
import { SettingsGroup, SettingsShell } from "./SettingsShell";
import { NamingSettings } from "./NamingSettings";
import { ShortcutSettings } from "./ShortcutSetting";

/** One App-wide center view, available even before a Project is open. */
export const AppSettings = (props: { app: App; project: () => string | null; onOpenChange?: (open: boolean) => void; navigation?: () => string }) => {
  const view = createSettingsView();
  const [section, setSection] = createSignal<string>(copy.settingsAgents);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [numericFailure, setNumericFailure] = createSignal<Record<string, string | null>>({});
  const drafts = draftStorage("app-settings");
  drafts.validate("settings", v.object({ text: v.string(), saved: v.optional(v.string()) }));
  const destination = (field: string) => ({ surface: "settings", object: field, recipient: null });
  const current = (field: string) => drafts.list().findLast(draft => draft.destination.surface === "settings" && draft.destination.object === field);

  type Numeric = keyof typeof terminalRanges;

  const field = (name: "fontFamily" | Numeric) => String(current(name)?.value.text ?? appSettings()[name]);

  const edit = (name: "fontFamily" | Numeric, input: HTMLInputElement) => drafts.edit(destination(name), { text: input.value, saved: current(name)?.value.saved ?? String(appSettings()[name]) },
    { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? "none" }, "ordinary");

  const ownSaves = new Map<string, { from: string; to: string }>();

  const conflicted = (name: "fontFamily" | Numeric) => {
    const saved = String(appSettings()[name]);
    const baseline = current(name)?.value.saved;
    const own = ownSaves.get(name);

    return baseline !== undefined && baseline !== saved && !(own?.from === baseline && own.to === saved);
  };

  const commit = async (name: "fontFamily" | Numeric, value: string | number) => {
    const draft = current(name);
    const revision = draft?.revision;

    if (conflicted(name)) {
      return;
    }

    ownSaves.set(name, { from: String(draft?.value.saved ?? appSettings()[name]), to: String(value) });

    if (revision) await drafts.submit(revision);
    const cause = await saveAppSettings({ [name]: value });
    setFailure(cause);

    if (cause !== null) ownSaves.delete(name);

    if (revision) await drafts.settle(revision, cause === null ? "acknowledged" : "failed");
    const newer = current(name);

    if (cause === null && newer?.status === "draft" && newer.revision !== revision && newer.value.saved === draft?.value.saved)
      drafts.edit(destination(name), { ...newer.value, saved: String(value) }, newer.selection, "ordinary", newer.revision);
  };

  // U5242c: what Back closed, until another view opens; Forward reopens it as `⌘,` does.
  const [forward, setForward] = createSignal(false);

  const close = () => { props.onOpenChange?.(false); view.close(); };

  const back = () => { setForward(true); close(); };

  createEffect(on(() => props.navigation?.(), () => setForward(false), { defer: true }));

  const show = () => {
    setForward(false);

    if (view.open()) return;

    view.show(document.activeElement instanceof HTMLElement ? document.activeElement : document.body);
    props.onOpenChange?.(true);
  };

  let disposed = false;
  let stop: (() => void) | undefined;
  let stopProject: (() => void) | undefined;

  void props.app.onAppSettings(show).then(unsubscribe => { if (disposed) unsubscribe(); else stop = unsubscribe; });
  void props.app.onProjectPage(({ path }) => {
    setForward(false);

    if (path !== props.project() || !view.open()) return;
    props.onOpenChange?.(false);
    view.close();
  }).then(unsubscribe => { if (disposed) unsubscribe(); else stopProject = unsubscribe; });
  onCleanup(() => { disposed = true; stop?.(); stopProject?.(); });
  registerKeys({ kind: "app" }, [
    { chords: ["Meta+Comma"], run: show },
    { chords: ["Meta+BracketLeft"], when: () => view.open(), run: event => { event.preventDefault(); back(); } },
    { chords: ["Meta+BracketRight"], when: () => forward() && !view.open(), run: event => { event.preventDefault(); show(); } },
  ]);

  const [offered] = createResource(() => view.open() && props.project(), async path => {
    try {
      return { list: await props.app.forProject(path).rpc("models.list", null), failure: null };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return { list: null, failure: error.message };
    }
  });

  const save = async (patch: Parameters<typeof saveAppSettings>[0]) => setFailure(await saveAppSettings(patch));

  const numericFields = [
    { name: "fontSize", label: copy.fontSize, hint: copy.fontSizeHint },
    { name: "lineHeight", label: copy.lineHeight, hint: "" },
    { name: "letterSpacing", label: copy.letterSpacing, hint: "" },
  ] as const;

  const validNumber = (name: Numeric) => {
    const text = field(name);
    const value = Number(text);
    const range = terminalRanges[name];

    return text.trim() !== "" && Number.isFinite(value) && value >= range.min && value <= range.max ? value : null;
  };

  const [selectedType, setSelectedType] = createSignal<{ fontFamily?: string; fontWeight?: number }>({});

  const chooseType = async (patch: { fontFamily?: string; fontWeight?: number }) => {
    setSelectedType(previous => ({ ...previous, ...patch }));
    const failure = await saveAppSettings(patch);
    setFailure(failure);
    setSelectedType(previous => {
      const remaining = { ...previous };

      if (patch.fontFamily === remaining.fontFamily) delete remaining.fontFamily;

      if (patch.fontWeight === remaining.fontWeight) delete remaining.fontWeight;

      return remaining;
    });
  };

  const preview = createMemo((previous: ReturnType<typeof terminalType> | undefined) => {
    const type = terminalType({ ...appSettings(), ...selectedType() });

    for (const { name } of numericFields) type[name] = validNumber(name) ?? previous?.[name] ?? type[name];

    return type;
  });

  const commitNumber = (name: Numeric, label: string) => {
    const value = validNumber(name);
    const { min, max } = terminalRanges[name];
    setNumericFailure(previous => ({ ...previous, [name]: value === null ? (name === "fontSize" ? copy.fontSizeRefusal(min, max) : copy.numericRefusal(label, min, max)) : null }));

    if (value !== null && (current(name) || value !== appSettings()[name])) void commit(name, value);
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

  // U5242d: the draft value is the one clicked until its save settles; the real App changes only when it commits.
  const [pendingAppearance, setPendingAppearance] = createSignal<{ mode?: ReturnType<typeof appSettings>["mode"]; interfaceScale?: ReturnType<typeof appSettings>["interfaceScale"] }>({});

  const chooseAppearance = async (patch: ReturnType<typeof pendingAppearance>) => {
    setPendingAppearance(previous => ({ ...previous, ...patch }));
    await save(patch);
    setPendingAppearance(previous => {
      const remaining = { ...previous };

      if (patch.mode === remaining.mode) delete remaining.mode;

      if (patch.interfaceScale === remaining.interfaceScale) delete remaining.interfaceScale;

      return remaining;
    });
  };

  const previewMode = () => {
    const mode = pendingAppearance().mode ?? appSettings().mode;

    return mode === "system" ? (globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode;
  };

  const previewScale = () => pendingAppearance().interfaceScale ?? appSettings().interfaceScale;

  return <>
    <Show when={!view.open() && forward()}>
      <button data-button="quiet" class="settings-forward word" type="button" onClick={show}>{copy.settingsForward}</button>
    </Show>
    <Show when={view.open()}>
    <SettingsShell heading={copy.settings} hideHeading onClose={back}>
      <Tabs.Root value={section()} onValueChange={({ value }) => setSection(value)} onFocusChange={({ focusedValue }) => { if (focusedValue !== null) setSection(focusedValue); }} activationMode="automatic" orientation="vertical" class="settings-sections">
        <aside class="settings-navigation">
        <div class="settings-history">
          <button data-button="quiet" class="settings-back word" type="button" onClick={back}>{copy.settingsBack}</button>
          <button data-button="quiet" class="settings-forward-disabled word" type="button" disabled>{copy.settingsForward}</button>
        </div>
        <h2 class="settings-title">{copy.settings}</h2>
        <Tabs.List aria-label={copy.settings}>
          <h3 class="settings-category">{copy.settingsAgents}</h3>
          <Tabs.Trigger value="Agents">{copy.settingsAgents}</Tabs.Trigger>
          <h3 class="settings-category">{copy.settingsTerminal}</h3>
          <Tabs.Trigger value="Terminal">{copy.settingsTerminal}</Tabs.Trigger>
          <h3 class="settings-category">{copy.settingsGeneral}</h3>
          <Tabs.Trigger value="Shortcuts">{copy.settingsShortcuts}</Tabs.Trigger>
          <Tabs.Trigger value="Appearance">{copy.settingsAppearance}</Tabs.Trigger>
        </Tabs.List>
        </aside>
      <div class="settings-content">
      <Tabs.Content value="Agents"><SettingsGroup name={copy.settingsAgents}>
        <Select description={copy.permissionHint} label={copy.permissionMode} value={appSettings().permissionMode} choices={[
          { value: "", label: copy.permissionDefault }, { value: "default", label: copy.permissionNormal },
          { value: "acceptEdits", label: copy.permissionEdits }, { value: "plan", label: copy.permissionPlan }, { value: "auto", label: copy.permissionAuto },
        ]} onValueChange={permissionMode => { if (permissionMode === "" || permissionMode === "default" || permissionMode === "acceptEdits" || permissionMode === "plan" || permissionMode === "auto") save({ permissionMode }); }} />
        <Show when={props.project()}>
          <Field.Root class="settings-field"><Field.Label>{copy.engine}</Field.Label><Combobox.Picker label={copy.engine} value={appSettings().engine} savedLabel={appSettings().engineLabel || copy.engine}
            items={[...defaults, ...(offered()?.list?.engines ?? []).map(item => ({ value: item.id, label: item.label }))]}
            onSelect={chooseEngine} /><Field.HelperText>{copy.engineHint}</Field.HelperText></Field.Root>
          <Field.Root class="settings-field"><Field.Label>{copy.model}</Field.Label><Combobox.Picker label={copy.model} value={appSettings().model} savedLabel={appSettings().modelLabel || copy.model}
            items={[...defaults, ...(offered()?.list?.models ?? []).map(item => ({ value: item.id, label: item.label }))]}
            onSelect={model => save({ model, modelLabel: offered()?.list?.models.find(item => item.id === model)?.label ?? "" })} /><Field.HelperText>{copy.modelHint}</Field.HelperText></Field.Root>
        </Show>
        <NamingSettings app={props.app} />
        <ReservedLine message={offered()?.failure} />
      </SettingsGroup></Tabs.Content>
      <Tabs.Content value="Terminal"><SettingsGroup hideHeading name={copy.settingsTerminal}>
        <Select label={copy.fontFamily} description={copy.fontFamilyHint} value={appSettings().fontFamily}
          choices={[{ value: "", label: copy.fontDefault }, ...[...new Set(["Fira Code", "Menlo", "Monaco", "monospace", appSettings().fontFamily].filter(Boolean))].map(value => ({ value, label: value }))]}
          onValueChange={value => chooseType({ fontFamily: value })} />
        <Show when={current("fontFamily")}>{draft => <Field.Root class="settings-field"><Field.Label>{copy.fontFamily}</Field.Label><Field.Input aria-label={copy.fontFamily} value={String(draft().value.text)} spellcheck={false} autocorrect="off" autocapitalize="off"
          onInput={event => edit("fontFamily", event.currentTarget)}
          onKeyDown={event => { if (event.key === "Enter" && !event.isComposing) void commit("fontFamily", field("fontFamily")); }} /></Field.Root>}</Show>
        <SegmentGroup label={copy.fontWeight} value={String(appSettings().fontWeight)} segments={[300, 400, 500, 600].map(value => ({ value: String(value), label: String(value) }))}
          onValueChange={value => { const weight = Number(value);

 if (weight === 300 || weight === 400 || weight === 500 || weight === 600) void chooseType({ fontWeight: weight }); }} />
        <For each={numericFields}>{({ name, label, hint }) => <Field.Root class="settings-field" invalid={!!numericFailure()[name]}>
          <Field.Label>{label}</Field.Label>
          <Deferred load={() => import("../ui/NumberInput")} label={label}>{module => <module.NumberInput.Root value={field(name)} {...terminalRanges[name]} clampValueOnBlur={false} allowOverflow pattern=".*" onValueChange={({ value, valueAsNumber }) => {
            const range = terminalRanges[name];

            if (value !== field(name) && value.trim() !== "" && Number.isFinite(valueAsNumber) && valueAsNumber >= range.min && valueAsNumber <= range.max)
              drafts.edit(destination(name), { text: value, saved: current(name)?.value.saved ?? String(appSettings()[name]) }, null, "ordinary");
          }}>
            <module.NumberInput.Input aria-label={label} inputMode="decimal" value={field(name)}
              onInput={event => edit(name, event.currentTarget)} onBlur={() => commitNumber(name, label)}
              onKeyDown={event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commitNumber(name, label); } }} />
          </module.NumberInput.Root>}</Deferred>
          <Show when={hint}><Field.HelperText>{hint}</Field.HelperText></Show>
          <ReservedLine message={numericFailure()[name]} />
        </Field.Root>}</For>
        <Deferred load={() => import("./TerminalPreview")} label={copy.terminalPreview}>{module => <module.TerminalPreview type={preview()} />}</Deferred>
      </SettingsGroup></Tabs.Content>
      <Tabs.Content value="Shortcuts"><SettingsGroup name={copy.settingsShortcuts}><ShortcutSettings capture={props.app.capture} onFailure={setFailure} /></SettingsGroup></Tabs.Content>
      <Tabs.Content value="Appearance"><SettingsGroup name={copy.settingsAppearance}>
        <SegmentGroup description={copy.modeHint} label={copy.mode} segments={[{ value: "dark", label: copy.modeDark }, { value: "light", label: copy.modeLight }, { value: "system", label: copy.modeSystem }]} value={appSettings().mode}
          onValueChange={mode => void chooseAppearance({ mode })} />
        <SegmentGroup label={copy.interfaceScale} value={appSettings().interfaceScale} segments={[
          { value: "small", label: copy.interfaceSmall, content: <span class="settings-scale-small">{copy.interfaceSample}</span> },
          { value: "default", label: copy.interfaceDefault, content: <span class="settings-scale-default">{copy.interfaceSample}</span> },
          { value: "large", label: copy.interfaceLarge, content: <span class="settings-scale-large">{copy.interfaceSample}</span> },
        ]} onValueChange={interfaceScale => void chooseAppearance({ interfaceScale })} />
        <section class="settings-appearance-preview" aria-label={copy.appearancePreview}>
          <div class={`settings-mode-preview ${previewMode()}-theme`} data-mode={previewMode()} data-scale={previewScale()}>{copy.appearancePreviewSample}</div>
        </section>
        <Switch checked={appSettings().focusMarkers} onCheckedChange={focusMarkers => save({ focusMarkers })}>{copy.focusMarkers}</Switch>
      </SettingsGroup></Tabs.Content>
      <ReservedLine message={failure()} />
      <ReservedLine message={numericFields.some(({ name }) => conflicted(name)) ? copy.settingsConflict : null}>
        <For each={numericFields.filter(({ name }) => conflicted(name))}>{({ name, label }) => <button data-button="quiet" type="button" onClick={() => { const draft = current(name);

 if (draft) void drafts.discard(draft.revision); }}>{copy.discardSettingsEdit(label)}</button>}</For>
      </ReservedLine>
      <ReservedLine message={drafts.problem() ? copy.draftRetention(copy.settings, copy.settingsTerminal, drafts.problem()!.cause) : null}><button data-button="quiet" type="button" onClick={() => drafts.retry()}>{copy.storageRetry}</button></ReservedLine>
      </div></Tabs.Root>
    </SettingsShell>
    </Show>
  </>;
};
