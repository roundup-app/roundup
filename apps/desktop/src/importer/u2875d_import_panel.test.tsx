import { openLane } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "@solidjs/testing-library";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
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

  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);

  return { app, connected };
};

const calls = (app: Awaited<ReturnType<typeof mount>>["app"], method: string) => app.calls.filter((call) => call.method === method);

const isChecked = (name: RegExp): boolean => {
  const box = screen.getByRole("checkbox", { name });

  return box instanceof HTMLInputElement && box.checked;
};

const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy());
};

it("u2875d_dialog_focus_and_escape_return_to_the_rail", async () => {
  await mount();
  const opener = screen.getByRole("button", { name: "Import Claude Code work" });

  await open();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("dialog")));
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
  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);
  await open();
  expect(calls(app, "project.importCommit")).toHaveLength(1);
  expect(isChecked(/first/)).toBe(true);
  expect(screen.getByRole("button", { name: "Last month" }).getAttribute("aria-pressed")).toBe("true");
});

it("u2875a_discovery_exclusions_remain_visible_after_partial_failure", async () => {
  const { app } = await mount();
  app.handlers["project.importCommit"] = () => {
    app.handlers["project.importDiscover"] = () => ({ candidates: [candidates[1]!], excluded: [{ source: "s1", reason: "/p/worktrees/s1.jsonl: no recorded working directory", title: null, last_activity_ms: null }] });

    return { outcomes: [{ source: "s1", workstream: null, agent: null, error: "copy refused" }] };
  };

  await open();
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  fireEvent.click(await screen.findByRole("button", { name: "1 not importable" }));
  await waitFor(() => expect(screen.getByText("Its folder is no longer there")).toBeTruthy());
  expect(screen.getByText(/copy refused/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
});

it.each([false, true])("u2875d_cancel_consumes_only_the_current_draft (empty: %s)", async (empty) => {
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
  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);
  await open();
  expect(isChecked(/first/)).toBe(true);
  expect(isChecked(/second/)).toBe(false);
  expect(calls(app, "project.importCommit")).toHaveLength(1);
});


it.skipIf(!captureDir("U3049a"))("u3049a_u3049b_rendered_conflict_recovery", async () => {
  const lane = await openLane(1512, "dark", "builder-3049");

  try {
    await lane.evaluate(`(() => {
      window.__fake.app.handlers['project.importDiscover'] = () => ({ candidates: Array.from({ length: 10 }, (_, at) => ({ source: 's' + (at + 1), revision: 'preview-' + (at + 1), title: ('長い会話 🪁 ' + (at + 1) + ' ').repeat(12), cwd: 'src', last_activity_ms: 1n })), excluded: [] });
      return true;
    })()`);
    await lane.browser("click", ".rail-import");
    await lane.until("document.querySelectorAll('.import-check').length === 10");
    await lane.capture("U3049a", "before");
    await lane.browser("click", ".import-list li:first-child .import-check");
    await lane.until("document.querySelector('.import-confirm')?.textContent === 'Import 1'");
    await lane.evaluate(`(() => {
      localStorage.setItem('roundup:import:/Users/you/harness', JSON.stringify({ open: true, period: 'month', selected: [{ source: 's2', revision: 'preview-2', title: ('長い会話 🪁 2 ').repeat(12) }] }));
      document.querySelectorAll('.import-check')[2].click();
      return true;
    })()`);
    await lane.until("!!document.querySelector('.import-recovery [role=status]')");
    await lane.capture("U3049a", "conflict");
    expect(await lane.calls("project.importCommit")).toEqual([]);
    await lane.browser("focus", ".import-recovery button");
    await lane.browser("press", "Enter");
    await lane.until("document.querySelector('.import-confirm')?.disabled && document.querySelector('.import-confirm')?.textContent === 'Import 1'");
    await lane.capture("U3049b", "recovered");
    await lane.evaluate(`(() => {
      const read = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key) { if (key === 'roundup:import:/Users/you/harness') throw new Error('unreadable'); return read.call(this, key); };
      document.querySelector('.import-recovery button').click();
      return true;
    })()`);
    await lane.until("document.querySelector('.import-panel').textContent.includes('could not be restored')");
    await lane.browser("scrollintoview", ".import-panel [role=alert]");
    await lane.capture("U3049b", "retention-failure");
    expect(await lane.calls("project.importCommit")).toEqual([]);
  } finally {
    await lane.close();
  }
}, 120_000);

it("u3037d_discovery_deadline_and_retry", async () => {
  const { app } = await mount();
  app.handlers["project.importDiscover"] = () => new Promise(() => {});
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(within(screen.getByRole("dialog")).getByRole("status")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", false);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(within(screen.getByRole("dialog")).queryByRole("status")).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
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
    render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
    await vi.advanceTimersByTimeAsync(0);
  }

  complete({ candidates, excluded: [] });
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.queryByRole("checkbox", { name: /first/ })).toBeNull();

  if (action !== "dismiss") expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeTruthy();
  expect(calls(app, "project.importCommit")).toHaveLength(0);
});

const mixed = () => {
  const excluded = [{ source: "sess-dup", reason: "already in this Project", title: "Imported earlier", last_activity_ms: 5n }, { source: "sess-amb", reason: "ambiguous Project membership", title: null, last_activity_ms: 1_700_000_000_000n }];

  return mount().then(({ app }) => {
    app.handlers["project.importDiscover"] = () => ({ candidates, excluded });

    return app;
  });
};

it("u3083b_excluded_rows_absent_until_the_disclosure_opens", async () => {
  await mixed();
  await open();
  const dialog = screen.getByRole("dialog");

  expect(within(screen.getByRole("list", { name: "Conversations" })).getAllByRole("listitem")).toHaveLength(2);
  expect(within(dialog).queryByText("Already imported")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "2 not importable" }));
  await within(dialog).findByText("Already imported");
  fireEvent.click(within(dialog).getByRole("button", { name: "2 not importable" }));
  await waitFor(() => expect(within(dialog).queryByText("Already imported")).toBeNull());
});

it("u3083b_no_line_without_excluded", async () => {
  await mount();
  await open();
  expect(screen.queryByText(/not importable/)).toBeNull();
});


it("u3083c_row_is_checkbox_title_and_second_line", async () => {
  await mount();
  await open();
  const box = screen.getByRole("checkbox", { name: /second/ });

  expect(box.getAttribute("type")).toBe("checkbox");
  fireEvent.click(screen.getByText("second"));
  await waitFor(() => expect(isChecked(/second/)).toBe(true));
  fireEvent.click(box);
  await waitFor(() => expect(isChecked(/second/)).toBe(false));
  fireEvent.click(box);
  await waitFor(() => expect(isChecked(/second/)).toBe(true));
});

it("u3083c_failed_import_error_names_cause_and_fix", async () => {
  const { app } = await mount();

  app.handlers["project.importCommit"] = () => ({ outcomes: [{ source: "s1", workstream: null, agent: null, error: "copy refused" }] });
  await open();
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  const alert = await screen.findByText(/copy refused/);

  expect(alert.closest("label")).toBe(screen.getByRole("checkbox", { name: /first/ }).closest("label"));
  expect(alert.textContent).toContain("Choose it again, or Refresh.");
});


it("u3299d_copy_uses_selected_item_import", async () => {
  const { app } = await mount();
  const duplicate = candidates.map((candidate, index) => ({ ...candidate, title: "Review", cwd: `/Users/test/projects/${index}/source` }));
  app.handlers["project.importDiscover"] = () => ({ candidates: duplicate, excluded: [] });
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  const choices = await screen.findAllByRole("checkbox", { name: /Review/ });
  const rows = choices.map(choice => choice.closest("li")!);
  fireEvent.click(within(rows[1]!).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(write).toHaveBeenCalledOnce());
  expect(JSON.parse(write.mock.calls[0]![0])).toEqual({ ...duplicate[1], last_activity_ms: "1" });
  expect(calls(app, "project.importCommit")).toHaveLength(0);
});

it("u3299d_named_rows_keep_recorded_targets_import", async () => {
  const { app } = await mount();
  app.handlers["project.importDiscover"] = () => ({ candidates: candidates.map(candidate => ({ ...candidate, title: "Review" })), excluded: [] });
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  const choices = await screen.findAllByRole("checkbox", { name: /Review/ });
  fireEvent.click(choices[1]!);
  const confirm = await screen.findByRole("button", { name: "Import 1" });
  fireEvent.click(confirm);
  await waitFor(() => expect(calls(app, "project.importCommit").map(call => call.params)).toEqual([{ selections: [{ source: "s2", revision: "r2" }] }]));
});

it.skipIf(!captureDir("U3299a"))("u3299a_u3299b_u3299c_u3299d_rendered_audit", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { startAppServer } = await import("../testing/appServer");
  const baseline = process.env.ROUNDUP_BASELINE_ROOT ? await startAppServer({ root: process.env.ROUNDUP_BASELINE_ROOT }) : null;
  const lane = await openLane(1512, "dark", "builder-3299");
  const headUrl = await lane.evaluate<string>("location.origin");

  const capture = async (id: string, side: string, step: string) => {
    const dir = captureDir(id);

    if (!dir) return;
    const output = join(dir, side);

    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, `${step}.checks.json`), JSON.stringify(await lane.evaluate("window.__checks()")) + "\n");
    await lane.browser("screenshot", join(output, `${step}.png`));
  };

  try {
    for (const [side, url] of [...(baseline ? [["base", baseline.resolvedUrls.local[0]]] : []), ["head", headUrl]] as const) {
      await lane.browser("open", `${url}/harness.html?seed=tree-40`);
      await lane.until("!!document.querySelector('.todo-project-root')");
      await lane.evaluate(`(async () => {
        const app = window.__fake.app;
        const tree = await app.rpc('rail.tree', null);
        for (const node of tree) { if (node.id === 'migrate' || node.id === 'tokens') node.name = 'Review'; }
        tree.find(node => node.id === 'payments').work = {kind:'work',title:'Orchard release',ask:'Review the retained work',done:'Release checked',limits:[]};
        app.handlers['rail.tree'] = () => tree;
        const common = { project: 'original-project', actor: {kind:'user',id:'you',parent:null}, home: 'backend', target: 'migrate', instruction: 'Keep /Users/authored/path and original-id verbatim.', condition: {kind:'agents',ids:['tokens'],any:false}, max_firings:2,remaining:1,rearm:false,expires_at:'2026-11-01T09:00:00Z',created_at:'2026-10-22T09:00:00Z',state:'active',firings:[{id:'firing-original',ordinal:1,message:42,matched:true,evidence:'original-evidence',definition:'{}',outcome:'held'}] };
        const observations = [
          {health:'observing',cursor:88,gap:null,recovery:null,evidence:'{"source":"agents","cursor":88}'},
          {health:'not-observing',cursor:null,gap:null,recovery:null,evidence:null},
          {health:'unavailable',cursor:88,gap:'the Agent state was not read after Event 88: /Users/private/path',recovery:'observation resumes at the next successful read; nothing matches meanwhile',evidence:null,cause:'unsupported source original-id /Users/private/path'},
          {health:'observing',cursor:99,gap:'the Event history after 88 expired',recovery:'the recorded source gap remains; authoritative current Agent state reconciled observation',evidence:'{"source":"agents"}'},
          {health:'invalidated',cursor:99,gap:null,recovery:null,evidence:null,pinned_head:'original-commit',cause:'the PR head moved from original-commit to new-commit'},
          {health:'unavailable',cursor:99,gap:null,recovery:'stop this reaction and create one naming the Agents that exist',evidence:null,cause:'removed-original-id no longer names an Agent with a state; no condition matches it'},
          {health:'observing',cursor:100,gap:'unrecognised-gap /Users/private/path original-id',recovery:'unrecognised-recovery original-id',evidence:'{"source":"unknown","private":"/Users/private/path"}'}
        ];
        window.__auditReactions = observations.map((observation,index) => ({...common,id:'audit-'+index,name:['Watch Review','Waiting to watch','Source unavailable','Recovered observation','Changed PR','Removed Agent','Unknown details'][index], observation, ...(index === 4 ? {state:'invalidated',condition:{kind:'pr-checks',repository:'orchard/app',number:7}} : {}), ...(index === 5 ? {target:'removed-original-id',actor:{kind:'agent',id:'removed-authorizer',parent:null}} : index === 0 ? {actor:{kind:'agent',id:'tokens',parent:null}} : {}) }));
        app.handlers['reaction.list'] = () => window.__auditReactions;
        app.handlers['reaction.get'] = ({id}) => window.__auditReactions.find(r => r.id === id);
        app.handlers['message.get'] = () => ({id:42,from:{kind:'user',id:'you',parent:null},to:'migrate',body:'Exact accepted instruction /Users/authored/path',kind:'note',replyTo:null,status:'held',reason:'receiver gone',passedFrom:null,at:0});
        app.handlers['deliverable.list'] = () => [7,9].map(revision => ({id:'published-'+revision,project:'original-project',title:'Orchard report',maker:{kind:'agent',id:'removed-maker',parent:null},maker_name:'Review',home:'backend',published_at:1792713600000,target:{kind:'pad',name:'Authored report',incarnation:'original-incarnation',revision,length:10,sha256:'original-hash-'+revision}}));
        window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
        window.dispatchEvent(new Event('focus'));
        document.querySelector('.todo-project-root').click();
        return true;
      })()`);
      await lane.evaluate("window.dispatchEvent(new Event('focus'))");
      await lane.until("document.querySelectorAll('.reaction-row').length === 7 && document.querySelectorAll('.made-row').length === 2");
      await capture("U3299a", side!, "overview");
      await capture("U3299d", side!, "publications");

      for (let index = 0; index < 7; index++) {
        await lane.browser("focus", `[data-reaction-opener="audit-${index}"]`);
        await lane.browser("press", "Enter");
        await lane.until("!!document.querySelector('.reaction-detail')");
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
      await lane.browser("click", ".rail-import");
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
      await lane.evaluate(`(() => {
        Storage.prototype.setItem = () => { throw new Error('Storage is full'); };
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',metaKey:true,shiftKey:true,bubbles:true}));
        return true;
      })()`);
      await lane.until("!!document.querySelector('.spawn-prompt-field')");
      await lane.browser("fill", ".spawn-prompt-field", "Exact retained task /Users/authored/path");
      await lane.until("!!document.querySelector('.rail-retention [role=alert]')");
      await lane.browser("click", '.rail [data-id="backend"] [data-part="branch-control"]');
      await lane.until("!!document.querySelector('.rail-task-target')");
      await capture("U3299c", side!, "retained-task");
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
      await lane.browser("click", "#shelf-tab-pads");
      await lane.until("!!document.querySelector('.pads-tab')");
      await lane.browser("click", '[aria-label="Add Pad"]');
      await lane.until("!!document.querySelector('.pads-tab .entry-field')");
      await lane.browser("fill", ".pads-tab .entry-field", "Original Pad name");
      await lane.until("!!document.querySelector('.pad-retention-shelf')");
      await capture("U3299c", side!, "retained-pad-name");
      await lane.browser("press", "Escape");
      await lane.evaluate(`(() => { for (const group of document.querySelectorAll('.shelf [data-shelf-group][data-state="closed"] [data-part="branch-control"]')) group.click(); return true; })()`);
      await lane.until("!!document.querySelector('.pad-name')");
      await lane.browser("click", ".pad-name");
      await lane.until("!!document.querySelector('.drawer [contenteditable=true]')");
      await lane.browser("fill", ".drawer [contenteditable=true]", "Exact retained Pad body /Users/authored/path");
      await lane.until("!!document.querySelector('.drawer .pad-retention')");
      await capture("U3299c", side!, "retained-pad-body");
      await lane.browser("click", ".drawer .close");
      await lane.until("document.querySelector('.drawer')?.dataset.open === 'false'");
      await lane.browser("click", '.rail [data-id="payments"] [data-part="branch-control"]');
      await lane.until("!!document.querySelector('.order-line, [aria-label=\"Edit order\"]')");
      await lane.evaluate(`(() => { const edit = document.querySelector('[aria-label="Edit order"]'); if (edit) edit.click(); else document.querySelector('.order-line').click(); return true; })()`);
      await lane.until("!!document.querySelector('.order-edit, [aria-label=\"Edit order\"]')");
      await lane.evaluate(`(() => { if (!document.querySelector('.order-edit')) document.querySelector('[aria-label="Edit order"]').click(); return true; })()`);
      await lane.until("!!document.querySelector('.order-edit textarea[name=ask]')");
      await lane.browser("fill", ".order-edit textarea[name=ask]", "Exact retained Order /Users/authored/path");
      await lane.until("!!document.querySelector('.order-edit-retention')");
      await capture("U3299c", side!, "retained-order");
      await lane.browser("press", "Escape");
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
      await lane.browser("click", ".todo-row-button");
      await lane.until("!!document.querySelector('.todo-history-line')");
      await lane.browser("click", ".todo-history-line");
      await lane.until("document.querySelectorAll('.todo-change').length >= 2");
      await capture("U3299a", side!, "history");


      await lane.browser("open", `${url}/harness.html?seed=tabs-8`);
      await lane.until("document.querySelectorAll('.project-tab').length === 8");
      await lane.browser("hover", ".project-tab .tab-name");
      await lane.browser("focus", ".project-tab .tab-name-button");
      await lane.until("!!document.querySelector('[role=tooltip]')");
      await capture("U3299d", side!, "project-tooltip");
      await lane.browser("dblclick", ".project-tab .tab-name");
      await lane.until("!!document.querySelector('.tab-rename')");
      await lane.evaluate("(() => { Storage.prototype.setItem = () => { throw new Error('Storage is full'); }; return true; })()");
      await lane.browser("fill", ".tab-rename", "Original retained Project name");
      await lane.browser("press", "Escape");
      await lane.until("!!document.querySelector('.tab-recover')");
      await lane.browser("click", ".tab-recover");
      await lane.until("!!document.querySelector('.header-recovery [role=alert]')");
      await capture("U3299c", side!, "project-recovery");
    }
  } finally {
    await lane.close();
    await baseline?.close();
  }
}, 180_000);
