import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

// U4896 is a rendered policy observer: geometry is evidence for the critic, never a layout assertion.
it.skipIf(!captureDir("U4896"))("u4896_capture_sections_and_keyboard_actions", async () => {
  const root = resolve("../..");
  const base = mkdtempSync(join(tmpdir(), "u4896-base-"));
  const baseRevision = execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim();
  execFileSync("tar", ["-x", "-C", base], { input: execFileSync("git", ["-C", root, "archive", baseRevision, "apps/desktop", "contracts/generated", "tsconfig.json"], { maxBuffer: 64 * 1024 * 1024 }) });
  symlinkSync(join(root, "node_modules"), join(base, "node_modules"));
  symlinkSync(join(root, "apps/desktop/node_modules"), join(base, "apps/desktop/node_modules"));

  try {
    const captures=process.env.ROUNDUP_CAPTURES;
    delete process.env.ROUNDUP_CAPTURES;
    const servers=await Promise.all([appServer({root:join(base,"apps/desktop")}),appServer()]);
    process.env.ROUNDUP_CAPTURES=captures;
    await Promise.all(["base", "head"].map(async (phase,index) => {
      const revision = phase === "base" ? baseRevision : execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const server=servers[index]!;
      const origin = server.resolvedUrls.local[0]!;
      const profile = mkdtempSync(join(tmpdir(), "u4896-profile-"));
      const session = `u4896-${phase}-${process.pid}`;
      const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })).stdout;

      const read = async (expression: string) => {
        const reply = JSON.parse(await browser("eval", expression));

        if (!reply.success) throw new Error(reply.error);

        return reply.data.result;
      };

      const wait = (expression: string) => browser("wait", "--fn", expression);
      const dir = join(captureDir("U4896")!, phase);
      mkdirSync(dir, { recursive: true });

      const snap = async (name: string) => {
        await browser("screenshot", join(dir, `${name}.png`));

        const audit = await read(`(() => {
          const box = el => { const b = el.getBoundingClientRect(); return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height,centre:b.left+b.width/2}; };
          const visible = el => el.getClientRects().length > 0;
          const rows = [...document.querySelectorAll('.rail-row,.rail-fold,.rail-leaf')].filter(visible);
          const heads = [...document.querySelectorAll('.rail .section-head,.rail .overview-heading')].filter(visible);
          return { revision:${JSON.stringify(revision)}, capture:${JSON.stringify(name)}, checks:window.__checks(),
            tokens: Object.fromEntries(['--space-1','--space-2','--space-3','--space-4','--space-5','--space-6','--rail-inset','--rail-step','--tree-origin','--rail-edge','--rail-slot','--rail-section-gap'].map(t => [t,getComputedStyle(document.querySelector('.rail-tree')).getPropertyValue(t)])),
            sources: {inset:'rail/styles.css: .rail-tree --rail-edge / --rail-inset',slot:'rail/styles.css: --rail-slot, section indicator and sortable-handle',gap:'rail/styles.css: .rail-section + .rail-section',depth:'ui/Tree.css: --tree-step; Rail.tsx drag probe'},
            heads:heads.map(el => ({name:el.textContent,box:box(el),icon:el.querySelector('svg') ? box(el.querySelector('svg')) : null,chevron:el.querySelector('[data-part=branch-indicator] svg') ? box(el.querySelector('[data-part=branch-indicator] svg')):null})),
            rows:rows.map(el => ({id:el.dataset.id,kind:el.className,section:el.closest('.rail-section')?.getAttribute('aria-label'),box:box(el),mark:el.querySelector('.row-state,.glyph,.kind-mark') ? box(el.querySelector('.row-state,.glyph,.kind-mark')):null,grip:el.querySelector('.sortable-handle svg') ? box(el.querySelector('.sortable-handle svg')):null,connectors:[...el.querySelectorAll('.tree-pass,.tree-stem,.tree-branch')].map(box),selected:el.dataset.selected,hover:el.matches(':hover'),focus:el.matches(':focus-within'),actions:[...el.querySelectorAll('.row-icons,.row-controls')].map(a=>({opacity:getComputedStyle(a).opacity,buttons:[...a.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'))}))})),
            focus:document.activeElement?.getAttribute('aria-label'), selected:[...document.querySelectorAll('.rail-row[data-selected=true]')].map(el=>el.dataset.id),calls:window.__fake.app.calls,questions:window.__fake.app.questions,alerts:[...document.querySelectorAll('[role=alert]')].map(el=>el.textContent),
            clauses:{1:'critic: compare row marks and connector paint with each head icon',2:'critic: compare rendered grip and chevron centres',3:'critic: compare section gaps with adjacent row gaps and paired heights',4:'compare baseline Checks; failure and keyboard evidence',5:'critic: action opacity, hover/focus/selection and keyboard calls in state captures'} };
        })()`);

        writeFileSync(join(dir, `${name}.audit.json`), JSON.stringify(audit, null, 2));
        writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(audit.checks, null, 2));
      };

      const emit = `window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'})`;

      const load = async (width: number) => {
        await browser("open", new URL('/harness.html?seed=tree-40&view=workstreams', origin).href);
        await wait("!!window.__fake && !!document.querySelector('.rail-row')");
        await read(`document.querySelector('.window').style.setProperty('--rail-width','${width}px')`);
      };

      try {
        await browser("--profile", profile, "--executable-path", "/opt/google/chrome/chrome", "--args", "--no-sandbox", "open", origin);
        await browser("set", "viewport", "1512", "950");

        for (const theme of ["dark", "light"]) for (const width of [252, 480]) {
          const prefix = `${theme}-${width}`;
          await browser("set", "media", "color-scheme", theme);
          await load(width);
          await read(`(async () => {
            const app=window.__fake.app;
            const nodes=await app.rpc('rail.tree',{});
            const plain=nodes.find(n=>n.kind==='workstream');
            const mode=await app.rpc('rail.createWorkstream',{name:'Review changes with a very long name that must truncate',parent:null});
            await app.rpc('workstream.setOpeningPrompt',{id:mode.id,prompt:'Review changes'});
            const agents=nodes.filter(n=>n.kind==='agent');
            for (const [index,agent] of agents.slice(0,3).entries()) await app.rpc('rail.move',{id:agent.id,parent:index<2?plain.id:mode.id,index});
            await app.rpc('rail.createWorkstream',{name:'Empty workstream',parent:null});
            const all=await app.rpc('rail.tree',{});
            const ids=new Set([plain.id,mode.id,...agents.slice(0,5).map(n=>n.id)]);
            const done=all.find(n=>n.kind==='agent'&&n.status?.kind==='done'); if(done) ids.add(done.id);
            const fixture=all.filter(n=>ids.has(n.id)||n.name==='Empty workstream').map(n=>({...n,parent:ids.has(n.parent)?n.parent:null}));
            app.handlers['rail.tree']=()=>fixture;
            window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
            return true;
          })()`);
          await wait("document.querySelectorAll('.rail-tree .section-head').length===3");
          await browser("mouse", "move", "1400", "900");
          await snap(`${prefix}-mixed`);
          const saved = await read("window.__fake.app.rpc('rail.tree',{})");

          for (const kind of ["workstreams", "modes", "agents", "empty"]) {
            await read(`(() => { const saved=${JSON.stringify(saved)}; const kind=${JSON.stringify(kind)}; const roots=saved.filter(n=>n.parent===null && (kind==='agents'?n.kind==='agent':kind==='modes'?!!n.opening_prompt?.trim():kind==='workstreams'?n.kind==='workstream'&&!n.opening_prompt?.trim():false)); window.__fake.app.handlers['rail.tree']=()=>roots.slice(0,1); ${emit}; })()`);
            await wait(`document.querySelectorAll('.rail-tree .section-head').length===${kind === "empty" ? 0 : 1}`);
            await snap(`${prefix}-single-${kind}`);
          }

          await read(`window.__fake.app.handlers['rail.tree']=()=>${JSON.stringify(saved)}; ${emit}`);
          await wait("document.querySelectorAll('.rail-tree .section-head').length===3");
          await browser("focus", ".rail-tree .section-head");
          await browser("press", "ArrowLeft");
          await wait("document.activeElement.getAttribute('aria-expanded')==='false'");
          await snap(`${prefix}-collapsed`);
          await browser("press", "ArrowRight");
          await wait("document.activeElement.getAttribute('aria-expanded')==='true'");
          await snap(`${prefix}-reopened`);

          for (const kind of ["workstream", "agent"]) {
            const selector = kind === "workstream" ? '.rail-row:has(.rail-chevron)' : '.rail-row:not(:has(.rail-chevron))';
            const id = await read(`document.querySelector(${JSON.stringify(selector)}).dataset.id`);
            const row = `.rail-row[data-id="${id}"]`;

            for (const selected of [false, true]) {
              if (selected) {
                const point=await read(`(() => {const b=document.querySelector(${JSON.stringify(row+' .name')}).getBoundingClientRect();return {x:b.left+2,y:b.top+b.height/2};})()`);
                await browser("mouse","move",String(point.x),String(point.y));
                await browser("mouse","down");
                await browser("mouse","up");
                await wait(`document.querySelector(${JSON.stringify(row)}).dataset.selected==='true'`);
              }

              await browser("focus", ".rail-tree .section-head");
              await browser("mouse", "move", "1400", "900");
              await snap(`${prefix}-${kind}-${selected}-rest`);
              await browser("hover", `${row} .row-state`);
              await snap(`${prefix}-${kind}-${selected}-hover`);
              await browser("mouse", "move", "1400", "900");
              await browser("focus", row);
              await snap(`${prefix}-${kind}-${selected}-focus`);

              if (selected && theme === "dark" && width === 252) {
                if (kind === "workstream") {
                  await browser("press", "Meta+Shift+n");
                  await wait("!!document.querySelector('.spawn-prompt-field')");
                  await browser("focus", row);
                }

                const buttons=await read(`document.querySelector(${JSON.stringify(row)}).querySelectorAll('button').length`);
                const walk=[];

                for (let index=0; index<buttons; index++) {
                  await browser("press", "Tab");
                  await wait(`document.activeElement !== document.querySelector(${JSON.stringify(row)})`);
                  const action=await read(`({label:document.activeElement.getAttribute('aria-label'),row:document.activeElement.closest('.rail-row')?.dataset.id,selected:[...document.querySelectorAll('.rail-row[data-selected=true]')].map(el=>el.dataset.id)})`);

                  if (action.row!==id) break;

                  if (action.label==='Open folder'||action.label==='Open in editor') {
                    const before=await read("window.__fake.app.openedTargets.length+window.__fake.app.editorOpened.length");
                    await browser("press", index%2 ? "Space" : "Enter");
                    await wait(`window.__fake.app.openedTargets.length+window.__fake.app.editorOpened.length>${before}`);
                    expect(await read(`document.querySelector(${JSON.stringify(row)}).dataset.selected`)).toBe("true");
                  }

                  if (action.label === 'Add Agent') {
                    await browser("press", "Space");
                    await wait("document.activeElement.matches('.spawn-prompt-field')");
                    expect(await read(`document.querySelector(${JSON.stringify(row)}).dataset.selected`)).toBe("true");
                    await browser("focus", `${row} .rail-add`);
                  }

                  walk.push(action);
                }

                if (kind === "workstream") {
                  await browser("focus", ".spawn-prompt-field");
                  await browser("press", "Escape");
                  await wait("!document.querySelector('.spawn-prompt-field')");
                } else {
                  await browser("focus", `${row} .row-icons [aria-label="Stop"]`);
                  await browser("press", "Enter");
                  await wait("window.__fake.app.questions.length>0 && typeof window.__fake.app.answerQuestion==='function'");
                  await read("window.__fake.app.answerQuestion(true)");
                  await wait("window.__fake.app.calls.some(call=>call.method==='agent.stop')");
                  expect(await read(`document.querySelector(${JSON.stringify(row)}).dataset.selected`)).toBe("true");
                }

                writeFileSync(join(dir,`${prefix}-${kind}-keyboard.json`),JSON.stringify(walk,null,2));
              }

              await browser("focus", ".rail-tree .section-head");
              await snap(`${prefix}-${kind}-${selected}-leave`);
            }
          }

          await load(width);
          await read("window.__fake.app.openFailure=new Error('Folder unavailable; try again')");
          const folder = '.rail-row .row-icons [aria-label="Open folder"]';
          await browser("focus", folder);
          await browser("press", "Enter");
          await wait("document.body.textContent.includes('Folder unavailable; try again')");
          await snap(`${prefix}-dense-failure`);
          const openedBefore=await read("window.__fake.app.openedTargets.length");
          await read("window.__fake.app.openFailure=null");
          await browser("focus", folder);
          await browser("press", "Enter");
          await wait(`window.__fake.app.openedTargets.length>${openedBefore}`);
          expect(await read("window.__fake.app.openedTargets.length")).toBe(openedBefore+1);
          await snap(`${prefix}-recovered`);
        }
      } finally {
        try { await browser("close"); } finally { await server.close(); rmSync(profile, { recursive:true, force:true }); }
      }
    }));
  } finally { rmSync(base, { recursive:true, force:true }); }
}, 300_000);
