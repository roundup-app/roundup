import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { serve } from './runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

async function fixture(t, branch = 'main') {
  const directory = mkdtempSync(join(tmpdir(), 'roundup-boxd-'));
  const provider = join(directory, 'provider.json');

  const initial = { jobs: { 23: { id: 23, status: 'queued' } },
    run: { head_repository: { full_name: 'owner/repo' }, head_branch: branch,
      path: '.github/workflows/build.yml', event: 'workflow_dispatch', run_attempt: 1 },
    machines: [], runners: [], creates: 0, removes: 0 };

  writeFileSync(provider, JSON.stringify(initial));
  const executable = join(directory, 'provider.mjs');
  writeFileSync(executable, `#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
const file=${JSON.stringify(provider)}, root=${JSON.stringify(directory)}, helper=${JSON.stringify(join(HERE, 'memory.py'))};
const state=JSON.parse(readFileSync(file,'utf8')), args=process.argv.slice(2), program=basename(process.argv[1]);
const save=()=>writeFileSync(file,JSON.stringify(state));
const output=value=>process.stdout.write(JSON.stringify(value));
const local=value=>{ const match=value.match(/^([^:]+):(.+)$/); return match ? join(root,'machines',match[1],match[2]) : value; };
if(program==='gh'){
 const path=args[1];
 if(path.includes('/actions/jobs/')) output(state.jobs[path.split('/').at(-1)]);
 else if(path.includes('/actions/runs/')) output(state.run);
 else if(path.endsWith('/registration-token')) output({token:'one-job-registration'});
 else if(path.includes('/actions/runners?')) output({runners:state.runners});
 else if(args.includes('DELETE')) {state.runners=[];save();}
 else throw Error('unexpected GitHub contract '+path);
}else if(args[1]==='list') output(state.machines);
else if(args[1]==='new'){
 state.machines.push({name:args[2],status:'running'});state.creates++;state.newOptions=args;save();mkdirSync(join(root,'machines',args[2],'tmp'),{recursive:true});output({name:args[2]});
}else if(args[1]==='remove'){
 state.machines=state.machines.filter(m=>m.name!==args[2]);state.removes++;save();output({status:'destroyed'});
}else if(args[1]==='cp'){
 const source=local(args[2]),target=local(args[3]);mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
}else if(args[1]==='networks'){
 state.networkAssignment=args;save();output({networks:[args[3]]});
}else if(args[1]==='config'){
 state.settings=[...(state.settings??[]),args];save();output({ok:true});
}else if(args[1]==='exec'){
 const machine=args[2], script=args.at(-1), base=join(root,'machines',machine);
 if(script.includes('agent.py register')){
  const given=JSON.parse(readFileSync(join(base,'tmp/registration.json'),'utf8'));state.runners.push({id:23,name:given.name,labels:[given.label]});save();
 }else if(script.includes('agent.py seed')){
  const result=spawnSync('python3',[helper,'restore',join(base,'tmp/roundup-memory.tar.gz'),join(base,'home/boxd/.roundup-ci')]);process.exitCode=result.status;
 }else if(script.includes('memory.py pack')){
  if(state.failPack)process.exitCode=1;
  else {const result=spawnSync('python3',[helper,'pack',join(base,'home/boxd/.roundup-ci'),join(base,'tmp/roundup-memory.tar.gz')]);process.exitCode=result.status;}
 }else if(script.includes('tar -czf')) writeFileSync(join(base,'tmp/runner-diagnostics.tar.gz'),'private diagnostics');
 else if(!script.includes('agent.py start')) throw Error('unexpected remote command '+script);
}else throw Error('unexpected boxd contract '+args);
`, { mode: 0o700 });

  for (const name of ['gh', 'boxd']) {
    const { symlinkSync } = await import('node:fs');
    symlinkSync(executable, join(directory, name));
  }

  const settings = { repository: 'owner/repo', snapshot: 'prepared', network: 'ci-network', secret: 'test-signing-secret',
    directory: join(directory, 'controller'), port: 0, interval: 25, maxRunners: 1,
    boxd: join(directory, 'boxd'), gh: join(directory, 'gh') };

  let server = serve(settings);
  await once(server, 'listening');
  const base = () => `http://127.0.0.1:${server.address().port}`;
  const health = async () => (await fetch(`${base()}/health`)).json();
  const read = () => JSON.parse(readFileSync(provider, 'utf8'));
  const update = change => { const state = read(); change(state); writeFileSync(provider, JSON.stringify(state)); };

  const send = async (action, id = 23, signature = true) => {
    const body = JSON.stringify({ action, repository: { full_name: 'owner/repo' },
      workflow_job: { id, run_id: 7, labels: ['self-hosted', 'boxd', 'roundup-build-11-7-1'] } });

    return fetch(`${base()}/api/github/webhooks`, { method: 'POST', body,
      headers: { 'content-type': 'application/json', 'x-github-event': 'workflow_job',
        'x-github-delivery': `delivery-${id}-${action}`, 'x-hub-signature-256': signature ?
          `sha256=${createHmac('sha256', settings.secret).update(body).digest('hex')}` : 'sha256=invalid' } });
  };

  t.after(async () => { await server.shutdown(); rmSync(directory, { recursive: true }); });

  return { directory, read, update, send, health, restart: async () => {
    await server.shutdown();
    server = serve(settings); await once(server, 'listening');
  } };
}

async function until(observe, predicate) {
  const deadline = Date.now() + 8000;
  let last;

  do {
    last = await observe();

    if (predicate(last)) return last;
    await delay(20); // Poll the public readiness result, not a guessed startup duration.
  } while (Date.now() < deadline);

  assert.fail(`observer timed out: ${JSON.stringify(last)}`);
}

test('L121 an invalid webhook signature cannot provision a machine', async t => {
  const f = await fixture(t);
  const response = await f.send('queued', 23, false);
  assert.ok(response.status >= 400);
  assert.deepEqual((await f.health()).jobs, {});
  assert.equal(f.read().creates, 0);
});

test('L121 a signed event from an untrusted ref cannot provision a machine', async t => {
  const f = await fixture(t, 'attacker-branch');
  await f.send('queued');
  await until(f.health, health => health.jobs.rejected === 1);
  assert.equal(f.read().creates, 0);
});

test('L121 redelivery and restart reuse the same job machine', async t => {
  const f = await fixture(t);
  await f.send('queued');
  await until(f.health, health => health.jobs.online === 1);
  await f.restart();
  await f.send('queued');
  await until(f.health, health => health.jobs.online === 1);
  assert.equal(f.read().creates, 1);
});

test('L121 provisioning isolates the machine on the controller network', async t => {
  const f = await fixture(t);
  await f.send('queued');
  await until(f.health, health => health.jobs.online === 1);
  const args = f.read().newOptions;
  assert.ok(args.includes('--isolated'));
  assert.deepEqual(f.read().networkAssignment, ['machine', 'networks', 'roundup-ci-23', 'ci-network', '--json']);
});

test('L121 provisioning bounds leaked compute with a wall-clock deletion deadline', async t => {
  const f = await fixture(t);
  await f.send('queued');
  await until(f.health, health => health.jobs.online === 1);
  const args = f.read().newOptions;
  assert.equal(args[args.indexOf('--delete-after') + 1], '10800');
});

test('L121 the next fresh job restores history and project memory without logins', async t => {
  const f = await fixture(t);
  await f.send('queued');
  await until(f.health, health => health.jobs.online === 1);
  const state = join(f.directory, 'machines/roundup-ci-23/home/boxd/.roundup-ci');

  for (const [name, content] of Object.entries({ 'claude/projects/roundup/session.jsonl': 'earlier conversation',
    'project-memory/claude/MEMORY.md': 'use pnpm', 'codex/auth.json': 'never retain me' })) {
    mkdirSync(dirname(join(state, name)), { recursive: true }); writeFileSync(join(state, name), content);
  }

  f.update(provider => { provider.jobs[23].status = 'completed'; provider.jobs[24] = { id: 24, status: 'queued' }; });
  await f.send('completed');
  await until(f.health, health => health.jobs.done === 1);
  await f.send('queued', 24);
  await until(f.health, health => health.jobs.online === 1);
  const restored = join(f.directory, 'machines/roundup-ci-24/home/boxd/.roundup-ci');
  assert.equal(readFileSync(join(restored, 'claude/projects/roundup/session.jsonl'), 'utf8'), 'earlier conversation');
  assert.equal(readFileSync(join(restored, 'project-memory/claude/MEMORY.md'), 'utf8'), 'use pnpm');
  assert.equal(existsSync(join(restored, 'codex/auth.json')), false);
  assert.equal(f.read().removes, 1);
});

test('L121 a memory-save failure retains the machine instead of deleting its history', async t => {
  const f = await fixture(t);
  await f.send('queued');
  await until(f.health, health => health.jobs.online === 1);
  f.update(provider => { provider.jobs[23].status = 'completed'; provider.failPack = true; });
  await f.send('completed');
  await until(f.health, health => health.errors === 1);
  assert.equal(f.read().removes, 0);
  assert.equal(f.read().machines[0].name, 'roundup-ci-23');
});
