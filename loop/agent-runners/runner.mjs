/** L121: signed job events drive one-job boxd runners; only this controller holds provider credentials. */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { Webhooks, createNodeMiddleware } from '@octokit/webhooks';

const execute = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));

const WORKFLOWS = { build: 'build', fix: 'fix', smoke: 'qa' };

const EVENTS = new Set(['workflow_run', 'workflow_dispatch', 'schedule', 'issues']);

const LABEL = /^roundup-(build|fix|smoke)-([1-9][0-9]*)-([1-9][0-9]*)-([1-9][0-9]*)$/;

class RemoteFailure extends Error {}

async function command(program, args, timeout = 60_000) {
  try {
    return (await execute(program, args, { timeout, maxBuffer: 4 * 1024 * 1024 })).stdout;
  } catch (error) {
    if (!error.code && !error.signal) throw error;
    // execFile's default message contains its arguments, which can contain provider responses.
    throw new RemoteFailure(`${program} ${error.signal ? 'outcome unknown after timeout/signal' : `exited ${error.code}`}`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(`${path}.next`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${path}.next`, path);
}

/** The HTTP interface persists authenticated events before acknowledging; recovery uses the same job records. */
export function serve(settings) {
  const { repository, ref = 'main', snapshot, secret, directory, maxRunners = 3, port = 8000 } = settings;
  const boxd = settings.boxd ?? 'boxd';
  const gh = settings.gh ?? 'gh';
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(join(directory, 'jobs.sqlite'));
  database.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const lookup = database.prepare('SELECT value FROM jobs WHERE id = ?');
  const persist = database.prepare('INSERT INTO jobs (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value');

  const jobs = new Map(database.prepare("SELECT value FROM jobs WHERE json_extract(value, '$.state') NOT IN ('done', 'rejected')").all().map(row => {
    const job = JSON.parse(row.value);

    return [job.id, job];
  }));

  const save = job => persist.run(job.id, JSON.stringify(job));

  const api = async (path, ...args) => {
    const result = await command(gh, ['api', `repos/${repository}/${path}`, ...args]);

    return result.trim() ? JSON.parse(result) : null;
  };

  const machines = async () => JSON.parse(await command(boxd, ['machine', 'list', '--json']));

  const remote = (machine, script, timeout = 120) => command(boxd,
    ['machine', 'exec', machine, '--timeout', String(timeout), '--', script], (timeout + 10) * 1000);

  const copy = (source, target) => command(boxd, ['machine', 'cp', source, target], 120_000);
  const record = (job, message) => console.log(JSON.stringify({ job: job.id, machine: job.machine, message, at: Date.now() }));

  const webhooks = new Webhooks({ secret });
  webhooks.on('workflow_job', ({ payload }) => {
    if (payload.repository?.full_name !== repository) return;
    const incoming = payload.workflow_job;

    if (!incoming || !Number.isSafeInteger(incoming.id) || !Array.isArray(incoming.labels)) return;
    const label = incoming.labels.find(value => LABEL.test(value));

    if (!label || !incoming.labels.includes('boxd') || !incoming.labels.includes('self-hosted')) return;
    const [, kind, scope, run, attempt] = label.match(LABEL);

    if (Number(run) !== incoming.run_id) return;
    let job = jobs.get(incoming.id);

    if (!job && lookup.get(incoming.id)) return; // Terminal records reject old redeliveries without growing the active set.

    if (!job && payload.action === 'queued') {
      job = { id: incoming.id, run: incoming.run_id, attempt: Number(attempt), kind, scope,
        label, machine: `roundup-ci-${incoming.id}`, state: 'queued', received: Date.now() };
      jobs.set(job.id, job);
    }

    if (!job) return;

    if (payload.action === 'in_progress') job.started = Date.now();

    if (payload.action === 'completed') job.completed = Date.now();
    save(job);
    queueMicrotask(schedule);
  });
  webhooks.onError(error => {
    const failure = error.event ?? error;

    if (failure.status >= 400 && failure.status < 500) {
      console.warn(`webhook rejected: HTTP ${failure.status}`);

      return;
    }

    // A handler's unexpected failure must terminate the controller so systemd can restart and reconcile.
    console.error(error);
    process.exitCode = 1;
    server.close();
    clearInterval(timer);
  });

  async function admit(job) {
    const run = await api(`actions/runs/${job.run}`);

    if (run.head_repository?.full_name !== repository || run.head_branch !== ref ||
        run.path !== `.github/workflows/${WORKFLOWS[job.kind]}.yml` ||
        run.run_attempt !== job.attempt || !EVENTS.has(run.event)) {
      job.state = 'rejected';
      save(job);
      jobs.delete(job.id);
      record(job, 'untrusted workflow/ref/event/attempt; no machine provisioned');

      return false;
    }

    job.role = ['build', 'fix'].includes(job.kind) ? 'builder' : job.kind;
    job.history = `${job.kind === 'build' ? 'issue' : 'pr'}-${job.scope}`;

    if (job.kind === 'fix') {
      const pr = await api(`pulls/${job.scope}`);
      const issue = (pr.body ?? '').match(/^(?:Refs|Closes|Fixes) #([1-9][0-9]*)\b/m);

      if (issue) job.history = `issue-${issue[1]}`;
    }

    save(job);

    return true;
  }

  async function provision(job) {
    const path = join(directory, 'work', String(job.id));
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const retained = join(directory, 'history', job.role, job.history);
    const project = join(directory, 'projects', job.role);
    const latest = join(retained, 'latest');

    if (!existsSync(join(path, 'seed.tar.gz'))) {
      await command('python3', [join(HERE, 'memory.py'), 'seed',
        existsSync(latest) ? join(retained, readFileSync(latest, 'utf8')) : '-', project, path]);
    }

    if (!(await machines()).some(machine => machine.name === job.machine)) {
      job.state = 'provisioning';
      save(job); // A timed-out create may have succeeded: recovery looks up this deterministic name.
      await command(boxd, ['machine', 'new', job.machine, '--from-snapshot', snapshot, '--isolated',
        '--delete-after', '10800', '--json'], 90_000);
    }

    // Snapshot restores currently ignore create-time network and zero idle-timeout overrides. Apply them explicitly.
    await command(boxd, ['machine', 'networks', job.machine, settings.network, '--json']);

    for (const key of ['auto-suspend.timeout', 'auto-hibernate.timeout']) {
      await command(boxd, ['machine', 'config', 'set', key, '0', '--vm', job.machine, '--json']);
    }

    job.ready ??= Date.now();
    save(job);
    const runners = await api('actions/runners?per_page=100');

    if (!runners.runners.some(runner => runner.name === job.machine)) {
      const registration = await api('actions/runners/registration-token', '--method', 'POST');
      const config = join(path, 'registration.json');
      writeJson(config, { token: registration.token, repository, label: job.label, name: job.machine });
      await copy(config, `${job.machine}:/tmp/registration.json`);
      await remote(job.machine, 'python3 /opt/roundup-ci/agent.py register /tmp/registration.json');
      unlinkSync(config);
      job.registered = Date.now();
      save(job);
    }

    if (!job.seeded) {
      await copy(join(path, 'seed.tar.gz'), `${job.machine}:/tmp/roundup-memory.tar.gz`);
      await remote(job.machine, `python3 /opt/roundup-ci/agent.py seed /tmp/roundup-memory.tar.gz ${job.id}`);
      job.seeded = true;
      save(job);
    }

    await remote(job.machine, 'python3 /opt/roundup-ci/agent.py start');
    job.state = 'online';
    delete job.error;
    save(job);
    record(job, `runner online ${job.registered - job.received} ms after webhook receipt`);
  }

  async function retain(job) {
    const path = join(directory, 'work', String(job.id));
    await remote(job.machine, 'python3 /opt/roundup-ci/memory.py pack /home/boxd/.roundup-ci /tmp/roundup-memory.tar.gz');
    await copy(`${job.machine}:/tmp/roundup-memory.tar.gz`, join(path, 'retained.tar.gz'));

    const result = JSON.parse(await command('python3', [join(HERE, 'memory.py'), 'publish',
      join(path, 'retained.tar.gz'), join(path, 'baseline'), join(directory, 'projects', job.role),
      join(directory, 'history', job.role, job.history), String(job.id)]));

    job.checkpoint = Date.now();
    save(job);

    if (result.conflicts.length) record(job, `concurrent memory revisions preserved: ${result.conflicts.join(', ')}`);
  }

  async function finish(job) {
    const present = (await machines()).some(machine => machine.name === job.machine);

    if (present) {
      if (job.seeded && !job.retained) {
        await retain(job);
        const diagnostics = join(directory, 'diagnostics', String(job.id));
        mkdirSync(diagnostics, { recursive: true, mode: 0o700 });
        await remote(job.machine, 'tar -czf /tmp/runner-diagnostics.tar.gz -C /opt/actions-runner _diag');
        await copy(`${job.machine}:/tmp/runner-diagnostics.tar.gz`, join(diagnostics, 'runner.tar.gz'));
        job.retained = Date.now();
        save(job);
      }

      await command(boxd, ['machine', 'remove', job.machine, '--confirm', '--json']);
    } else if (job.seeded && !job.retained) {
      // Absolute lifetime is a compute backstop, not a promise that an unavailable machine's final writes were saved.
      record(job, 'machine unavailable; only its last checkpoint is retained');
    }

    const runners = await api('actions/runners?per_page=100');

    for (const runner of runners.runners) {
      if (runner.name === job.machine) await api(`actions/runners/${runner.id}`, '--method', 'DELETE');
    }

    job.state = 'done';
    delete job.error;
    job.finished = Date.now();
    save(job);
    jobs.delete(job.id);
    record(job, 'memory retained; runner and machine removed');
  }

  let ticking = false;

  async function tick() {
    if (ticking) return;
    ticking = true;

    try {
      for (const job of jobs.values()) {
        if (['done', 'rejected'].includes(job.state) || (job.retryAt ?? 0) > Date.now()) continue;

        try {
          const actual = await api(`actions/jobs/${job.id}`);

          if (actual.started_at) job.started ??= Date.parse(actual.started_at);

          if (actual.status === 'completed' || job.completed) {
            await finish(job);
            continue;
          }

          if (actual.status === 'in_progress') {
            job.started ??= Date.parse(actual.started_at);
            save(job);
          }

          if (job.state === 'online') {
            if (actual.status === 'queued' && Date.now() - job.ready > 60_000) {
              await remote(job.machine, 'python3 /opt/roundup-ci/agent.py start');
            }

            if (Date.now() - (job.checkpoint ?? job.ready) > 300_000) await retain(job);
            continue;
          }

          if (job.state === 'queued') {
            if (!await admit(job)) continue;
            const active = [...jobs.values()].filter(other => ['provisioning', 'online'].includes(other.state)).length;

            if (active >= maxRunners) continue;
          }

          await provision(job);
        } catch (error) {
          if (!(error instanceof RemoteFailure)) throw error;
          job.error = error.message;
          job.retryAt = Date.now() + 30_000;
          save(job);
          record(job, `${error.message}; preserving machine/state for retry`);
        }
      }
    } finally {
      ticking = false;
    }
  }

  const middleware = createNodeMiddleware(webhooks);

  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      const counts = Object.fromEntries(database.prepare("SELECT json_extract(value, '$.state') AS state, count(*) AS total FROM jobs GROUP BY state").all().map(row => [row.state, row.total]));
      const errors = database.prepare("SELECT count(*) AS total FROM jobs WHERE json_extract(value, '$.error') IS NOT NULL").get().total;
      response.writeHead(errors ? 503 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ready: errors === 0, jobs: counts, errors }));

      return;
    }

    middleware(request, response);
  });

  function fatal(error) {
    console.error(error);
    clearInterval(timer);
    server.close();
    process.exitCode = 1;
  }

  let active = Promise.resolve();

  function schedule() {
    if (!ticking) active = tick().catch(fatal);
  }

  const timer = setInterval(schedule, settings.interval ?? 15_000);
  server.on('close', () => clearInterval(timer));
  server.shutdown = async () => {
    clearInterval(timer);
    await new Promise(resolve => server.close(resolve));
    await active;
    database.close();
  };

  server.listen(port, '0.0.0.0');

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const settings = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  serve(settings);
}
