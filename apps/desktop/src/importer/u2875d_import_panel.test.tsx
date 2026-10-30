import { openProjectPage } from "../testing/menuProbe";
import { openLane } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "@solidjs/testing-library";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { ProjectSettingsView } from "../rail/ProjectSettings";
import { Rail } from "../rail/Rail";
import { RpcError } from "../app/seam";
import { connectFakeProject } from "../terminal/paneHarness";
import { workstream } from "../testing/nodes";
import { createFakeApp } from "../testing/fakeApp";

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

const candidates = [
  { source: "s1", title: "first", cwd: "", last_activity_ms: 2n, revision: "r1" },
  { source: "s2", title: "second", cwd: "sub", last_activity_ms: 1n, revision: "r2" },
];

const mount = async () => {
  const { app, connected } = await connectFakeProject([workstream("ws", { name: "ws" })]);
  app.handlers["project.importDiscover"] = () => ({ candidates, excluded: [] });

  app.handlers["project.importCommit"] = (params) => ({
    outcomes: params.selections.map((entry) => ({ source: entry.source, workstream: `w-${entry.source}`, agent: `a-${entry.source}`, error: null })),
  });

  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /><ProjectSettingsView /></ConnectedProjectContext.Provider>);

  return { app, connected };
};

const calls = (app: Awaited<ReturnType<typeof mount>>["app"], method: string) => app.calls.filter((call) => call.method === method);

const isChecked = (name: RegExp): boolean => {
  const box = screen.getByRole("checkbox", { name });

  return box instanceof HTMLInputElement && box.checked;
};

const open = async () => {
  openProjectPage("import-work");
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy());
};

it("u3814_close_restores_the_previous_center_and_focus", async () => {
  await mount();
  const opener = screen.getByRole("button", { name: /Overview/ });
  opener.focus();

  await open();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("region", { name: "Import Claude Code work" })));
  fireEvent.keyDown(document.activeElement ?? document.body, { code: "Escape", key: "Escape", keyCode: 27 });
  await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it("u2875d_period_change_clears_selection", async () => {
  const { app } = await mount();

  await open();
  fireEvent.click(screen.getByText("first"));
  await screen.findByRole("button", { name: "Import 1" });
  expect(isChecked(/first/)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Last month" }));
  await waitFor(() => expect(calls(app, "project.importDiscover")).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy());
  await waitFor(() => expect(isChecked(/first/)).toBe(false));
  expect(screen.getByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
});

it.each([new RpcError(-32003, "daemon said no"), new Error("daemon said no")])("u2875d_rejected_call_keeps_period_and_selection (%s)", async (failure) => {
  const { app, connected } = await mount();

  app.handlers["project.importCommit"] = () => { throw failure; };

  await open();
  fireEvent.click(screen.getByRole("button", { name: "Last month" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy());
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(screen.getByText("daemon said no")).toBeTruthy());
  expect(connected.drafts.list().find((draft) => draft.destination.surface === "import")?.status).toBe(failure instanceof RpcError ? "failed" : "unknown");
  cleanup();
  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /><ProjectSettingsView /></ConnectedProjectContext.Provider>);
  await open();
  expect(calls(app, "project.importCommit")).toHaveLength(1);
  expect(isChecked(/first/)).toBe(true);
  expect(screen.getByRole("button", { name: "Last month" }).getAttribute("aria-pressed")).toBe("true");
});

it("u2875a_discovery_exclusions_remain_visible_after_partial_failure", async () => {
  const { app } = await mount();
  app.handlers["project.importCommit"] = () => {
    app.handlers["project.importDiscover"] = () => ({ candidates: [candidates[1]!], excluded: [{ source: "s1", cause: "noDirectory", reason: "/p/worktrees/s1.jsonl: no recorded working directory", title: null, last_activity_ms: null }] });

    return { outcomes: [{ source: "s1", workstream: null, agent: null, error: { code: -32003, message: "copy refused", outcome: "failed" } }] };
  };

  await open();
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  fireEvent.click(await screen.findByRole("button", { name: "1 not importable" }));
  await waitFor(() => expect(screen.getByText(/No working folder was recorded/)).toBeTruthy());
  expect(screen.getByText(/The saved conversation changed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(calls(app, "project.importDiscover")).toHaveLength(3));
});

it.each([false, true])("u3815_cancel_keeps_the_exact_current_choices (empty: %s)", async (empty) => {
  const { app, connected } = await mount();

  app.handlers["project.importCommit"] = () => { throw new RpcError(-32003, "daemon said no"); };

  await open();
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(screen.getByText("daemon said no")).toBeTruthy());
  fireEvent.click(screen.getByText("second"));
  await screen.findByRole("button", { name: "Import 2" });

  if (empty) {
    fireEvent.click(screen.getByText("first"));
    await screen.findByRole("button", { name: "Import 1" });
    fireEvent.click(screen.getByText("second"));
    await screen.findByRole("button", { name: "Import" });
  }

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
  cleanup();
  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /><ProjectSettingsView /></ConnectedProjectContext.Provider>);
  await open();
  expect(isChecked(/first/)).toBe(!empty);
  expect(isChecked(/second/)).toBe(!empty);
  expect(calls(app, "project.importCommit")).toHaveLength(1);
});


it.skipIf(!captureDir("U3049a"))("u3049a_u3049b_rendered_conflict_recovery", async () => {
  const lane = await openLane(1512, "dark", "builder-3049");

  try {
    await lane.evaluate(`(() => {
      window.__fake.app.handlers['project.importDiscover'] = () => ({ candidates: Array.from({ length: 10 }, (_, at) => ({ source: 's' + (at + 1), revision: 'preview-' + (at + 1), title: ('長い会話 🪁 ' + (at + 1) + ' ').repeat(12), cwd: 'src', last_activity_ms: 1n })), excluded: [] });
      return true;
    })()`);
    await lane.evaluate("window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: document.querySelector('.project-tab[data-selected=true]').dataset.path, command: 'import-work' } }))");
    await lane.until("document.querySelectorAll('.import-check').length === 10");
    await lane.capture("U3049a", "before");
    await lane.browser("click", ".import-list li:first-child .import-check");
    await lane.until("document.querySelector('.import-confirm')?.textContent === 'Import 1'");
    await lane.evaluate(`(() => {
      localStorage.setItem('roundup:import:/Users/you/harness', JSON.stringify({ open: true, period: 'month', selected: [{ source: 's2', revision: 'preview-2', title: ('長い会話 🪁 2 ').repeat(12) }] }));
      document.querySelectorAll('.import-check')[2].click();
      return true;
    })()`);
    await lane.until("!!document.querySelector('.import-panel [role=status][aria-label=\"Import choices conflict\"]')");
    await lane.capture("U3049a", "conflict");
    expect(await lane.calls("project.importCommit")).toEqual([]);
    await lane.evaluate("[...document.querySelectorAll('.import-recovery button')].find(button => button.textContent === 'Open choices 1').focus()");
    await lane.browser("press", "Enter");
    await lane.until("document.querySelector('.import-confirm')?.disabled && document.querySelector('.import-confirm')?.textContent === 'Import 1'");
    await lane.capture("U3049b", "recovered");
    await lane.evaluate(`(() => {
      const read = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key) { if (key === 'roundup:import:/Users/you/harness') throw new Error('unreadable'); return read.call(this, key); };
      [...document.querySelectorAll('.import-recovery button')].find(button => button.textContent === 'Open choices 1').click();
      return true;
    })()`);
    await lane.until("document.querySelector('.import-panel').textContent.includes('could not be restored')");
    await lane.browser("scrollintoview", ".import-panel [role=alert]");
    await lane.capture("U3049b", "retention-failure");
    expect(await lane.calls("project.importCommit")).toEqual([]);
  } finally {
    await lane.close();
  }
}, 60_000);

it("u3037d_discovery_deadline_and_retry", async () => {
  const { app } = await mount();
  app.handlers["project.importDiscover"] = () => new Promise(() => {});
  vi.useFakeTimers();
  openProjectPage("import-work");
  await vi.advanceTimersByTimeAsync(0);
  expect(within(screen.getByRole("region", { name: "Import Claude Code work" })).getByRole("status")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", false);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Import Claude Code work" })).queryByRole("status")).toBeNull();
  expect(calls(app, "project.importCommit")).toHaveLength(0);
  app.handlers["project.importDiscover"] = () => ({ candidates, excluded: [] });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
});


it.each(["timeout", "period", "dismiss", "project"])("u3037d_late_results_cannot_replace_current_state (%s)", async (action) => {
  const { app } = await mount();
  let complete: (result: { candidates: typeof candidates; excluded: [] }) => void = () => {};

  app.handlers["project.importDiscover"] = () => new Promise((resolve) => { complete = resolve; });
  vi.useFakeTimers();
  openProjectPage("import-work");
  await vi.advanceTimersByTimeAsync(0);
  app.handlers["project.importDiscover"] = () => { throw new Error("current failure"); };

  if (action === "timeout") await vi.advanceTimersByTimeAsync(20_000);
  else if (action === "period") {
    fireEvent.click(screen.getByRole("button", { name: "Last day" }));
    await vi.advanceTimersByTimeAsync(0);
  } else if (action === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  else {
    cleanup();
    const other = createFakeApp();
    other.handlers["rail.tree"] = () => [];
    other.handlers["terminal.list"] = () => [];
    other.handlers["project.importDiscover"] = () => { throw new Error("current failure"); };

    const connected = await connectProject(other, { name: "q", path: "/q" }, () => false, () => 0, () => null);
    render(() => <ConnectedProjectContext.Provider value={connected}><Rail /><ProjectSettingsView /></ConnectedProjectContext.Provider>);
    openProjectPage("import-work", "/q");
    await vi.advanceTimersByTimeAsync(0);
  }

  complete({ candidates, excluded: [] });
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.queryByRole("checkbox", { name: /first/ })).toBeNull();

  if (action !== "dismiss") expect(within(screen.getByRole("region", { name: "Import Claude Code work" })).getByRole("alert")).toBeTruthy();
  expect(calls(app, "project.importCommit")).toHaveLength(0);
});

const mixed = () => {
  const excluded: import("@contracts/project/ImportExclusion").ImportExclusion[] = [{ source: "sess-dup", cause: "alreadyImported", reason: "already in this Project", title: "Imported earlier", last_activity_ms: 5n }, { source: "sess-amb", cause: "ambiguousProject", reason: "ambiguous Project membership", title: null, last_activity_ms: 1_700_000_000_000n }];

  return mount().then(({ app }) => {
    app.handlers["project.importDiscover"] = () => ({ candidates, excluded });

    return app;
  });
};

it("u3083b_excluded_rows_absent_until_the_disclosure_opens", async () => {
  await mixed();
  await open();
  const dialog = screen.getByRole("region", { name: "Import Claude Code work" });

  expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(within(dialog).getByRole("button", { name: "2 not importable" }));
  await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(4));
  fireEvent.click(within(dialog).getByRole("button", { name: "2 not importable" }));
  await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(2));
});

it("u3083b_no_line_without_excluded", async () => {
  await mount();
  await open();
  expect(screen.queryByText(/not importable/)).toBeNull();
});


it("u3083c_failed_import_preserves_failed_row", async () => {
  const { app } = await mount();

  app.handlers["project.importCommit"] = () => ({ outcomes: [{ source: "s1", workstream: null, agent: null, error: { code: -32003, message: "copy refused", outcome: "failed" } }] });
  await open();
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  const alert = await screen.findByText(/The saved conversation changed/);

  expect(alert.closest("label")).toBe(screen.getByRole("checkbox", { name: /first/ }).closest("label"));
});


it("u3299d_copy_uses_selected_item_import", async () => {
  const { app } = await mount();
  const duplicate = candidates.map((candidate, index) => ({ ...candidate, title: "Review", cwd: `/Users/test/projects/${index}/source` }));
  app.handlers["project.importDiscover"] = () => ({ candidates: duplicate, excluded: [] });
  const write = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(app, "clipboardWrite").mockImplementation(write);
  openProjectPage("import-work");
  const choices = await screen.findAllByRole("checkbox", { name: /Review/ });
  const rows = choices.map(choice => choice.closest("li")!);
  fireEvent.click(within(rows[1]!).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(write).toHaveBeenCalledOnce());
  expect(JSON.parse(write.mock.calls[0]![0])).toEqual({ ...duplicate[1], error: null, last_activity_ms: "1" });
  expect(calls(app, "project.importCommit")).toHaveLength(0);
});

it("u3299d_named_rows_keep_recorded_targets_import", async () => {
  const { app } = await mount();
  app.handlers["project.importDiscover"] = () => ({ candidates: candidates.map(candidate => ({ ...candidate, title: "Review" })), excluded: [] });
  openProjectPage("import-work");
  const choices = await screen.findAllByRole("checkbox", { name: /Review/ });
  fireEvent.click(choices[1]!);
  const confirm = await screen.findByRole("button", { name: "Import 1" });
  fireEvent.click(confirm);
  await waitFor(() => expect(calls(app, "project.importCommit").map(call => call.params)).toEqual([{ selections: [{ source: "s2", revision: "r2" }] }]));
});

it.skipIf(!captureDir("U3299a")).each(["names", "retention"] as const)("u5014a_u3299a_u3299b_u3299c_u3299d_rendered_audit_%s", async phase => {
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { startAppServer } = await import("../testing/appServer");
  const baseline = process.env.ROUNDUP_BASELINE_ROOT ? await startAppServer({ root: process.env.ROUNDUP_BASELINE_ROOT }) : null;
  const lane = await openLane(1512, "dark", "builder-3299");
  const headUrl = await lane.evaluate<string>("location.origin");
  const clockDirectory = mkdtempSync(join(tmpdir(), "u3299-clock-"));

  const capture = async (id: string, side: string, step: string) => {
    const dir = captureDir(id);

    if (!dir) return;
    const output = join(dir, side);

    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, `${step}.checks.json`), JSON.stringify(await lane.evaluate("window.__checks()")) + "\n");
    await lane.browser("screenshot", join(output, `${step}.png`));
  };

  try {
    const clockScript = join(clockDirectory, "clock.js");
    writeFileSync(clockScript, "Date.now = () => 1792713600000;\n");
    await lane.browser("close");
    await lane.browser("--init-script", clockScript, "open", "about:blank");
    await lane.browser("set", "viewport", "1512", "950");
    await lane.browser("set", "media", "dark");

    for (const [side, url] of [...(baseline ? [["base", baseline.resolvedUrls.local[0]]] : []), ["head", headUrl]] as const) {
      await lane.browser("open", `${url}/harness.html?seed=tree-40`);
      await lane.until("!!document.querySelector('.todo-project-root')");
      let legacyRevision: string | null = null;

      if (phase === "retention") {
        legacyRevision = await lane.evaluate<string>(`(async () => {
          const { draftStorage } = await import('/src/state/storage.ts');
          const holder = draftStorage('/Users/you/harness');
          const legacy = holder.edit({surface:'orders',object:'tokens',recipient:'tokens'}, {title:'Orchard release',ask:'Exact retained Order /Users/authored/path',done:'Release checked'}, null, 'ordinary');
          if (await legacy.retained) throw new Error('Legacy fixture was not retained');
          return legacy.draft.revision;
        })()`);
        // A fresh App must restore the legacy record before storage starts failing.
        await lane.browser("open", `${url}/harness.html?seed=tree-40`);
        await lane.until("!!document.querySelector('.todo-project-root')");
      }

      await lane.evaluate(`(async () => {
        const app = window.__fake.app;
        const tree = await app.rpc('rail.tree', null);
        await app.rpc('pad.create', {name:'retained-notes',text:'Plain notes'});
        for (const node of tree) { if (node.id === 'migrate' || node.id === 'tokens') node.name = 'Review'; }
        tree.find(node => node.id === 'tokens').work = {kind:'work',title:'Orchard release',ask:'Review the retained work',done:'Release checked',limits:[]};
        app.handlers['rail.tree'] = () => tree;
        const common = { project: 'original-project', actor: {kind:'user',id:'you',parent:null}, home: 'backend', target: 'migrate', instruction: 'Keep /Users/authored/path and original-id verbatim.', condition: {kind:'agents',ids:['tokens'],any:false}, max_firings:2,remaining:1,rearm:false,expires_at:'2026-11-01T09:00:00Z',created_at:'2026-10-22T09:00:00Z',state:'active',firings:[{id:'firing-original',ordinal:1,message:42,matched:true,evidence:'original-evidence',definition:'{}',outcome:'kept'}] };
        const observations = [
          {health:'observing', health_code: 'observing', cause_code: "unknown", gap_code: "unknown", recovery_code: "unknown",cursor:88,gap:null,recovery:null,evidence:'{"source":"agents","cursor":88}'},
          {health:'not-observing', health_code: 'not-observing', cause_code: "unknown", gap_code: "unknown", recovery_code: "unknown",cursor:null,gap:null,recovery:null,evidence:null},
          {health:'unavailable', health_code: 'unavailable', cause_code: "unsupported", gap_code: "agent-read-failed", recovery_code: "check",cursor:88,gap:'the Agent state was not read after Event 88: /Users/private/path',recovery:'observation resumes at the next successful read; nothing matches meanwhile',evidence:null,cause:'unsupported source original-id /Users/private/path'},
          {health:'observing', health_code: 'observing', cause_code: "unknown", gap_code: "history-expired", recovery_code: "reconciled",cursor:99,gap:'the Event history after 88 expired',recovery:'the recorded source gap remains; authoritative current Agent state reconciled observation',evidence:'{"source":"agents"}'},
          {health:'invalidated', health_code: 'invalidated', cause_code: "head-moved", gap_code: "unknown", recovery_code: "unknown",cursor:99,gap:null,recovery:null,evidence:null,pinned_head:'original-commit',cause:'the PR head moved from original-commit to new-commit'},
          {health:'unavailable', health_code: 'unavailable', cause_code: "agent-unavailable", gap_code: "unknown", recovery_code: "replace-agent",cursor:99,gap:null,recovery:'stop this reaction and create one naming the Agents that exist',evidence:null,cause:'removed-original-id no longer names an Agent with a state; no condition matches it'},
          {health:'observing', health_code: 'observing', cause_code: "unknown", gap_code: "unknown", recovery_code: "unknown",cursor:100,gap:'unrecognised-gap /Users/private/path original-id',recovery:'unrecognised-recovery original-id',evidence:'{"source":"unknown","private":"/Users/private/path"}'}
        ];
        window.__auditReactions = observations.map((observation,index) => ({...common,id:'audit-'+index,name:['Watch Review','Waiting to watch','Source unavailable','Recovered observation','Changed PR','Removed Agent','Unknown details'][index], observation, ...(index === 4 ? {state:'invalidated',condition:{kind:'pr-checks',repository:'orchard/app',number:7}} : {}), ...(index === 5 ? {target:'removed-original-id',actor:{kind:'agent',id:'removed-authorizer',parent:null}} : index === 0 ? {actor:{kind:'agent',id:'tokens',parent:null}} : {}) }));
        app.handlers['reaction.list'] = () => window.__auditReactions;
        app.handlers['reaction.get'] = ({id}) => window.__auditReactions.find(r => r.id === id);
        app.handlers['message.get'] = () => ({id:42,from:{kind:'user',id:'you',parent:null},to:'migrate',body:'Exact accepted instruction /Users/authored/path',kind:'note',replyTo:null,status:'kept',reason:'receiver gone',at:0});
        app.handlers['deliverable.list'] = () => [7,9].map(revision => ({id:'published-'+revision,project:'original-project',title:'Orchard report',maker:{kind:'agent',id:'removed-maker',parent:null},maker_name:'Review',home:'backend',published_at:1792713600000,target:{kind:'pad',name:'Authored report',incarnation:'original-incarnation',revision,length:10,sha256:'original-hash-'+revision}}));
        window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
        window.dispatchEvent(new Event('focus'));
        document.querySelector('.todo-project-root').click();
        return true;
      })()`);
      await lane.evaluate(`(async () => {
        const { projectMenu } = await import('/src/testing/menuProbe.ts');
        if (!projectMenu.items.some(item => item.id === 'view:made' && item.enabled)) throw new Error('Native menu action unavailable: view:made');
        window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:projectMenu.path,command:'view:made'}}));
      })()`);
      await lane.until("document.querySelector('[data-part=item-trigger][id$=made]')?.getAttribute('aria-expanded') === 'true' && document.querySelectorAll('.made-row').length === 2");

      if (phase === "names") {
        await capture("U3299d", side!, "publications");
      }

      await lane.browser("find", "role", "button", "click", "--name", "Reactions", "--exact");
      await lane.until("document.querySelector('[data-part=item-trigger][id$=reactions]')?.getAttribute('aria-expanded') === 'true' && document.querySelectorAll('.reaction-row').length === 7");

      if (phase === "names") {
      await capture("U3299a", side!, "overview");

      for (let index = 0; index < 7; index++) {
        await lane.browser("focus", `[data-reaction-opener="audit-${index}"]`);
        await lane.browser("press", "Enter");
        await lane.until("!!document.querySelector('.reaction-detail')");
        expect(await lane.evaluate("document.activeElement.matches('.reaction-back')")).toBe(true);
        await capture("U3299b", side!, `reaction-${index}`);

        if (index === 0) {
          await lane.browser("click", '[data-firing-message="42"]');
          await lane.until("document.querySelector('.reaction-detail').textContent.includes('Exact accepted instruction')");
          await capture("U3299b", side!, "message");
        }

        await lane.browser("click", ".reaction-back");
        await lane.until("!!document.querySelector('.reaction-row')");
      }

      await lane.evaluate(`(() => {
        window.__fake.app.handlers['project.importDiscover'] = () => ({ candidates: Array.from({length:10},(_,n) => ({source:'source-'+n,revision:'revision-'+n,title:n<2?'Review':('Conversation '+n+' 長い名前 ').repeat(8),cwd:'/Users/private/projects/orchard/'+(n<2?'location-'+n:'source-'+n),last_activity_ms:1792713600000n})),excluded:[] });
        return true;
      })()`);
      await lane.evaluate("window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: document.querySelector('.project-tab[data-selected=true]').dataset.path, command: 'import-work' } }))");
      await lane.until("document.querySelectorAll('.import-check').length === 10");
      await capture("U3299d", side!, "imports");
      await lane.browser("click", ".import-check");
      await lane.until("document.querySelector('.import-confirm')?.textContent === 'Import 1'");
      await lane.evaluate(`(() => {
        localStorage.setItem('roundup:import:/Users/you/harness', JSON.stringify({open:true,period:'month',selected:[{source:'missing-original-source',revision:'original-revision',title:''}]}));
        document.querySelectorAll('.import-check')[1].click();
        return true;
      })()`);
      await lane.until("!!document.querySelector('.import-recovery')");
      await capture("U3299d", side!, "import-conflict");
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('.import-panel')");
      }

      if (phase === "retention") {
      await lane.browser("click", '.rail-row[data-id="backend"]');
      await lane.until("document.querySelector('.rail-row[data-id=backend]')?.dataset.selected === 'true' && !document.querySelector('.ask-input')");
      await lane.browser("click", ".todo-project-root");
      await lane.until("!!document.querySelector('.ask-input')");
      await lane.evaluate(`(() => {
        Storage.prototype.setItem = () => { throw new Error('Storage is full'); };
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',metaKey:true,shiftKey:true,bubbles:true}));
        return true;
      })()`);
      await lane.until("!!document.querySelector('.spawn-prompt-field')");
      await lane.browser("fill", ".spawn-prompt-field", "Exact retained task /Users/authored/path");
      await lane.until("!!document.querySelector('.rail-command-notice [role=alert]')");
      await lane.browser("click", '.rail-row[data-id="backend"]');
      await lane.until("!!document.querySelector('.rail-tree .reserved-line[role=status]')");
      await capture("U3299c", side!, "retained-task");
      await lane.browser("focus", ".spawn-prompt-field");
      await lane.until("document.activeElement === document.querySelector('.spawn-prompt-field')");
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('.spawn-prompt-field')");
      await lane.browser("click", ".todo-project-root");
      await lane.until("!!document.querySelector('.ask-input')");
      await lane.browser("fill", ".ask-input", "Exact Ask /Users/authored/path");
      await lane.until("!!document.querySelector('.ask-send-status [role=alert]')");
      await capture("U3299c", side!, "retained-ask");
      await lane.evaluate("(() => { document.dispatchEvent(new KeyboardEvent('keydown',{key:'t',code:'KeyT',metaKey:true,shiftKey:true,bubbles:true})); return true; })()");
      await lane.until("!!document.querySelector('.capture-field')");
      await lane.browser("fill", ".capture-field", "Exact Todo /Users/authored/path");
      await lane.until("!!document.querySelector('.capture [role=alert]')");
      await capture("U3299c", side!, "retained-todo");
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('.capture')");

      if (await lane.evaluate("document.querySelector('.window')?.dataset.shelf !== 'open'")) {
        await lane.browser("press", "Meta+k");
        await lane.browser("press", "b");
      }

      await lane.until("document.querySelector('.window')?.dataset.shelf === 'open'");
      await lane.browser("click", "#shelf-tab-pads");
      await lane.until("!!document.querySelector('.pads-tab')");
      await lane.browser("click", '[aria-label="Add Pad"]');
      await lane.until("!!document.querySelector('.pads-tab .entry-field')");
      await lane.browser("fill", ".pads-tab .entry-field", "Original Pad name");
      await lane.until("!!document.querySelector('.pads-tab [role=alert]')");
      await capture("U3299c", side!, "retained-pad-name");
      await lane.browser("press", "Escape");
      await lane.evaluate(`(() => { for (const group of document.querySelectorAll('.shelf [data-shelf-group][data-state="closed"] [data-part="branch-control"]')) group.click(); return true; })()`);
      await lane.until("!!document.querySelector('.pad-name')");
      await lane.browser("find", "role", "button", "click", "--name", "retained-notes");
      await lane.until("document.activeElement?.matches('.pad-name')");
      await lane.browser("press", "Enter");
      await lane.until("!!document.querySelector('.drawer [contenteditable=true]')");
      await lane.browser("fill", ".drawer [contenteditable=true]", "Exact retained Pad body /Users/authored/path");
      await lane.until("!!document.querySelector('.drawer .pad-body [role=alert]')");
      await capture("U3299c", side!, "retained-pad-body");
      await lane.browser("click", ".drawer .close");
      await lane.until("document.querySelector('.drawer')?.dataset.open === 'false'");
      // U4453b retired Order editing; the same authored revision remains in shared recovery.
      await lane.evaluate(`(() => {
        window.__auditLegacy = ${JSON.stringify(legacyRevision)};
        window.__fake.app.menuChoice = 'recover';
        return true;
      })()`);
      await lane.browser("focus", ".todo-project-root");
      await lane.browser("press", "Shift+F10");
      await lane.until("!!document.querySelector('[aria-label=\"Unfinished work\"] [data-revision=\"' + window.__auditLegacy + '\"]')");
      await capture("U3299c", side!, "retained-order");
      await lane.evaluate("[...document.querySelectorAll('[data-revision=\"' + window.__auditLegacy + '\"] button')].find(button => button.textContent === 'Copy').click()");
      await lane.until("window.__fake.app.clipboardWrites.at(-1)?.includes('Exact retained Order /Users/authored/path')");
      expect(await lane.calls("agent.setOrder")).toEqual([]);
      await lane.browser("click", ".drawer .close");
      await lane.until("document.querySelector('.drawer')?.dataset.open === 'false'");
      await lane.browser("click", ".todo-project-root");
      await lane.until("!!document.querySelector('.ask-input')");
      await lane.browser("click", "#shelf-tab-todos");
      await lane.until("!!document.querySelector('.todos-tab')");
      await lane.evaluate(`(() => {
        const values = {title:'Authored Todo',body:'',done:false,blockers:[],owner:null};
        const owner = {kind:'agent',id:'tokens',parent:null};
        const removed = {kind:'agent',id:'removed-original-owner',parent:null};
        window.__fake.app.handlers['todo.getHistory'] = () => ({unread:null,changes:[{seq:1,actor:owner,changed_at:null,before:values,after:{...values,owner}}, {seq:2,actor:removed,changed_at:null,before:{...values,owner},after:{...values,owner:removed},handed:removed}]});
        window.__fake.app.handlers['todo.readHistory'] = () => null;
        for (const group of document.querySelectorAll('.shelf [data-shelf-group][data-state="closed"] [data-part="branch-control"]')) group.click();
        return true;
      })()`);
      await lane.until("!!document.querySelector('.todo-row-button')");
      await lane.browser("focus", ".todo-row-button");
      await lane.browser("press", "Enter");
      await lane.until("!!document.querySelector('.todo-history-line')");
      await lane.browser("click", ".todo-history-line");
      await lane.until("document.querySelectorAll('.todo-change').length >= 2");
      await capture("U3299a", side!, "history");
      }


      await lane.browser("open", `${url}/harness.html?seed=tabs-8`);
      await lane.until("document.querySelectorAll('.project-tab').length === 8");
      const projectPaths = await lane.evaluate<string[]>("[...document.querySelectorAll('.project-tab')].slice(0, 2).map(tab => tab.dataset.path)");

      for (const projectPath of projectPaths) {
        await lane.browser("focus", `.project-tab[data-path=${JSON.stringify(projectPath)}] .tab-name-button`);
        await lane.browser("press", "F2");
        await lane.until("!!document.querySelector('.tab-rename')");
        await lane.browser("fill", ".tab-rename", "Orchard");
        await lane.browser("press", "Enter");
        await lane.until("!document.querySelector('.tab-rename')");
      }

      await lane.browser("focus", `.project-tab[data-path=${JSON.stringify(projectPaths[0])}] .tab-name-button`);
      await lane.browser("press", "Enter");
      await lane.until("document.querySelector('.project-tab[data-selected=true] [role=tab]')?.getAttribute('aria-busy') === 'false'");

      if (phase === "names") {
      await lane.browser("hover", ".todo-project-root");
      await lane.browser("hover", ".project-tab[data-selected=true] .tab-name");
      await lane.until("!!document.querySelector('[role=tooltip]')");
      await capture("U3299d", side!, "project-tooltip");
      } else {
      await lane.browser("dblclick", ".project-tab[data-selected=true] .tab-name");
      await lane.until("!!document.querySelector('.tab-rename')");
      await lane.evaluate("(() => { Storage.prototype.setItem = () => { throw new Error('Storage is full'); }; return true; })()");
      await lane.browser("fill", ".tab-rename", "Original retained Project name");
      await lane.browser("press", "Escape");
      await lane.until("!!document.querySelector('.tab-recover')");
      await lane.browser("click", ".tab-recover");
      await lane.until("!!document.querySelector('.header-recovery [role=alert]')");
      expect(await lane.evaluate("document.querySelector('.header-recovery').contains(document.activeElement)")).toBe(true);
      await capture("U3299c", side!, "project-recovery");
      }
    }
  } finally {
    await lane.close();
    await baseline?.close();
    rmSync(clockDirectory, { recursive: true, force: true });
  }
}, 60_000);

it("u3817_closing_a_page_keeps_a_pending_import", async () => {
  const { app, connected } = await mount();
  let settle: (value: { outcomes: { source: string; workstream: string; agent: string; error: null }[] }) => void = () => {};

  app.handlers["project.importCommit"] = () => new Promise((resolve) => { settle = resolve; });

  await open();
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(calls(app, "project.importCommit")).toHaveLength(1));

  openProjectPage("project-settings");
  fireEvent.click(await screen.findByRole("button", { name: /Close/ }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /Close/ })).toBeNull());

  expect(connected.importing.open()).toBe(true);
  expect(connected.importing.pending()).toBe(true);
  expect(calls(app, "project.importCommit")).toHaveLength(1);

  settle({ outcomes: [{ source: "s1", workstream: "w-s1", agent: "a-s1", error: null }] });
  await waitFor(() => expect(connected.importing.pending()).toBe(false));
  expect(calls(app, "project.importCommit")).toHaveLength(1);
});

it("u3791b_copy_depends_on_codes_not_messages_import_exclusions", async () => {
  const { app } = await mount();
  let cause: import("@contracts/project/ImportExclusionCause").ImportExclusionCause = "missingDirectory";
  let diagnostic = "/private/source: missing directory original details";
  app.handlers["project.importDiscover"] = () => ({ candidates, excluded: [{ source: "s3", cause, reason: diagnostic, title: "Excluded work", last_activity_ms: null }] });
  await open();

  const exclusions = async () => {
    fireEvent.click(screen.getByRole("button", { name: "1 not importable" }));
    const row = (await screen.findByText("Excluded work")).closest("li")!;
    const text = row.textContent;
    fireEvent.click(within(row).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(JSON.parse(app.clipboardWrites.at(-1)!).reason).toBe(diagnostic));

    return text;
  };

  const before = await exclusions();
  diagnostic = "Refresh choose retry: a completely different diagnostic";
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByRole("checkbox", { name: /first/ });
  expect(await exclusions()).toBe(before);
  cause = "duplicateSource";
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByRole("checkbox", { name: /first/ });
  expect(await exclusions()).not.toBe(before);
  cause = "unknown";
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByRole("checkbox", { name: /first/ });
  expect(await exclusions()).toMatch(/Refresh/);

});

it("u3791b_copy_depends_on_codes_not_messages_import_refusals", async () => {
  const { app, connected } = await mount();
  await open();
  let code = -32003;
  let message = "Refresh choose retry: original diagnostic";
  app.handlers["project.importCommit"] = () => ({ outcomes: [{ source: "s1", workstream: null, agent: null, error: { code, message, outcome: [-32003, -32001].includes(code) ? "failed" : "unknown" } }] });
  fireEvent.click(screen.getByText("first"));

  const submit = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
    await waitFor(() => expect(connected.importing.failed().get("s1")).toMatchObject({ code, message }));
    await waitFor(() => expect(connected.importing.pending()).toBe(false));
    expect(screen.getByRole("button", { name: "Import 1" })).toHaveProperty("disabled", ![-32003, -32001].includes(code));
    const row = screen.getByText("first").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(JSON.parse(app.clipboardWrites.at(-1)!).error.message).toBe(message));

    return screen.getByRole("alert").textContent;
  };

  const refusal = await submit();
  message = "other details without recovery words";
  expect(await submit()).toBe(refusal);
  code = -32001;
  expect(await submit()).not.toBe(refusal);
  code = -32603;
  const uncertain = await submit();
  expect(uncertain).not.toBe(refusal);
  code = -99999;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Import 1" })).toHaveProperty("disabled", false));
  expect(await submit()).toBe(uncertain);
});
