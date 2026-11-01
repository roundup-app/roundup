// The Extension host's side of the process boundary: loads the owner's module, runs
// `register(on)` and answers the host's runs, speaking JSON lines over stdio.
const { pathToFileURL } = require("node:url");

const readline = require("node:readline");

const isText = (value) => Object(value) instanceof String;

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");

// stdout belongs to the protocol; a module's own output goes to stderr.
console.log = console.info = console.debug = (...parts) => console.error(...parts);

const entries = [];

const calls = new Map();

let nextCall = 1;

function call(path, params) {
  return new Promise((resolve, reject) => {
    const id = nextCall++;
    calls.set(id, { resolve, reject });
    send({ t: "call", id, path, params });
  });
}

const namespace = (ns) =>
  new Proxy({}, { get: (_, name) => (isText(name) ? (params) => call(`${ns}.${name}`, params) : undefined) });

const $ = new Proxy({}, { get: (_, ns) => (isText(ns) ? namespace(ns) : undefined) });

function on(event, matcher, hook) {
  if (matcher instanceof Function) [matcher, hook] = [undefined, matcher];

  if (!(hook instanceof Function)) throw new Error(`on("${event}") needs a hook function`);
  const entry = { event, spec: matcher, hook, catcher: null };

  if (event === "action") {
    if (!matcher || !isText(matcher.name)) throw new Error('on("action") needs { name, label }');
    entries.push(entry);
  }

  const handle = {
    catch(fn) {
      entry.catcher = fn;

      return handle;
    },
  };

  return handle;
}

const cause = (error) => String((error && error.message) || error);

async function run(id, name, args) {
  const chain = entries.filter((entry) => entry.spec.name === name);
  const failures = [];

  const step = async (index, e) => {
    if (index >= chain.length) return undefined;
    const entry = chain[index];

    try {
      return await entry.hook($, e, (changed) => step(index + 1, changed === undefined ? e : changed));
    } catch (error) {
      let failure = error;

      if (entry.catcher) {
        try { return await entry.catcher(error); } catch (again) { failure = again; }
      }

      failures.push(cause(failure));

      return step(index + 1, e);
    }
  };

  const answer = await step(0, { name, args });
  const answered = answer instanceof Object && ("done" in answer || "deny" in answer);
  send({ t: "result", id, answer: answered ? answer : null, failure: failures[0] ?? null });
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let message;

  try { message = JSON.parse(line); } catch { return; }

  if (message.t === "run") {
    run(message.id, message.name, message.args).catch((error) =>
      send({ t: "result", id: message.id, answer: null, failure: cause(error) }));
  } else if (message.t === "callResult") {
    const pending = calls.get(message.id);
    calls.delete(message.id);

    if (!pending) return;

    if (message.error) pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
    else pending.resolve(message.result);
  }
});

(async () => {
  try {
    const module = await import(pathToFileURL(process.argv[process.argv.length - 1]).href);

    if (!(module.register instanceof Function)) throw new Error("the module exports no register function");
    await module.register(on);
    send({ t: "registered", actions: entries.map((entry) => entry.spec) });
  } catch (error) {
    send({ t: "failed", cause: cause(error) });
    process.exit(1);
  }
})();
