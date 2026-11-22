import { createEffect, onCleanup, Show, untrack } from "solid-js";
import { Deferred } from "../ui/Deferred";
import { copy } from "./copy";
import { useConnectedProject } from "../state/connectedProject";

/** U3813/U3814: the native `Import Claude Code Work…` command opens its center page. */
export const ProjectSettingsView = () => {
  const { app, project, settingsView, importing, rail } = useConnectedProject();
  onCleanup(app.onProjectPage(({ path, command }) => {
    if (path !== project.path || command !== "import-work") return;
    const selected = rail.selected();
    settingsView.show(document.activeElement instanceof HTMLElement ? document.activeElement : document.body, command, () => rail.select(selected));

    if (command === "import-work" && !importing.open()) importing.show();
  }));
  createEffect(() => importing.open(), open => {
    const shown = untrack(settingsView.open);

    if (open && !shown) settingsView.show(document.body, "import-work");

    if (!open && shown && untrack(settingsView.page) === "import-work") settingsView.close(false);
  });

  const close = () => { importing.cancel(); settingsView.close(); };

  const closeImport = () => { if (!importing.pending()) close(); };

  return <>
    <Show when={settingsView.open() && settingsView.page() === "import-work" && importing.open()}><Deferred load={() => import("../importer/ImportPanel")} label={copy.importTitle} onClose={closeImport}>{module => <module.ImportPanel onClose={closeImport} />}</Deferred></Show>
  </>;
};
