import { createSignal, For } from "solid-js";
import { render } from "solid-js/web";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { DrawerHost } from "../drawer/DrawerHost";
import { Tabs } from "../ui";
import { Strip } from "./Strip";
import type { StripTab } from "./tab";
import "../tokens.css";
import "../styles.css";

const app = createFakeApp();

app.handlers['project.get'] = () => ({ worktrees: { on: false, check: null }, mcp: { on: true }, models: { roles: [{ role: 'door', model: null, effort: null }] } });

app.handlers['models.list'] = () => ({ models: [{ id: 'opus', label: 'Authored 雪 Model' }], efforts: [{ id: 'high', label: 'High' }] });

const connected = await connectProject(app, { path: '/fixture', name: 'Fixture' }, () => true, () => 0);

const Fixture = () => {
  const [tabs, setTabs] = createSignal<StripTab[]>(Array.from({ length: 8 }, (_, at) => ({
    path: `/project ${at} 雪`, name: `Project number ${at}`, busy: false, exitText: null,
    needsYou: at === 1 ? 1 : 0, error: at === 7 ? 1 : 0, running: ['Authored Agent'],
  })));

  const [active, setActive] = createSignal(tabs()[0]!.path);
  const [marks, setMarks] = createSignal(0);
  const reverse = new URLSearchParams(location.search).has('reverse');

  const Top = () => <>
    <div style={{ height: 'calc(var(--space-6) * 2)', width: 'calc(var(--space-6) * 10)' }}>
      <Strip tabs={tabs()} active={active()} onSelect={setActive}
        onMark={(path) => { setActive(path); setMarks(marks() + 1); }}
        onRename={(path, name) => setTabs(tabs().map(tab => tab.path === path ? { ...tab, name } : tab))}
        onClose={(path) => { const next = tabs().filter(tab => tab.path !== path); setTabs(next);

 if (active() === path) setActive(next[0]!.path); }}
        onChoose={() => {}} />
    </div>
  </>;

  const Draw = () => <div><DrawerHost drawer={connected.drawer} reducedMotion={() => true} /></div>;

  return <ConnectedProjectContext.Provider value={connected}>
    <Tabs.Root value={active()} onValueChange={({ value }) => setActive(value)} activationMode="manual"
      ids={{ trigger: value => `tab-${encodeURIComponent(value)}`, content: value => `panel-${encodeURIComponent(value)}` }}>
      <button data-button="quiet" id="origin" onClick={() => connected.drawer.open(() => <>
        <p>Unchanged Drawer content</p><input aria-label="Drawer input" /><textarea aria-label="Drawer text" />
        <div contentEditable tabIndex={0}>Editable content</div>
      </>)}>Open Drawer</button>
      <input aria-label="Outside field" />
      <div class="xterm" tabIndex={0}>Terminal</div>
      {reverse ? <><Draw /><Top /></> : <><Top /><Draw /></>}
      <For each={tabs()}>{tab => <Tabs.Content value={tab.path}>Real content: {tab.name}</Tabs.Content>}</For>
      <output data-marks>{marks()}</output>
    </Tabs.Root>
  </ConnectedProjectContext.Provider>;
};

render(() => <Fixture />, document.getElementById('root')!);
