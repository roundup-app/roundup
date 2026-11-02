# Extension interface (v0)

An Extension is one module exporting `register(on)`, named by one path in its manifest. The host runs action Hooks only.

## Manifest

`rup-extension.json` = `{ name, module, permissions, types? }`. Permissions are declared and enforced by `rupd`.

## Shape

- `$` — engine handle for permitted calls: `$.agents`, `$.todos`, `$.pads`, `$.bus`, `$.ui`, `$.store`, `$.clock`.
- `e` — `{ name, args }`, the action request as plain data.
- `next(e)` passes on. `next({...e, changed})` rewrites what later Hooks see. Returning without `next` answers for yourself.
- Results: `{ done: true }` completes the action; `{ deny: "cause" }` refuses it.
- Registration: `on("action", { name, label, args? }, hook)`.
- Hot reload on save: the host starts a new child and publishes its actions only after registration succeeds. A bad save keeps the last good registration. State lives in `$.store`, persisted per Extension.
- A throwing runtime Hook is skipped (fail open), raising one `extension.problem`. `.catch` can answer in its place.
- Any event other than `action` throws during registration, with a cause naming the unsupported event. This is a load failure: none of that registration's actions is published. It is distinct from a runtime Hook failure.

```ts
export function register(on) {
  on("action", { name: "user.check", label: "Check" }, async ($) => {
    await $.todos.create({ title: "Check the result" });
    return { done: true };
  });
}
```

## Where Extensions run

Each Extension is a child process of `rupd` running its `module` with the owner's `node`, started by the Extension host (`crates/rupd`, `src/extensions/`) after the Daemon serves its socket. Extensions are folders in `~/.roundup/extensions/`; a Project folder never loads code. `rupd` enforces `permissions` (`agents`, `todos`, `pads`, `bus`, `ui`, `store`, `clock`) on the child's calls. A load failure ends the new child only and raises one `extension.problem` (a Toast). Acceptance: `scenarios/user-actions.md`.

## User actions

`on("action", { name, label, args? }, hook)` declares a named action. It is listed after the built-in ones by `action.list`, shown in the Switcher when it needs no argument, and run with `rup do <name>`. A name never takes a built-in one.

## Hooks

| Concern | Hook | Returns |
|---|---|---|
| User action | `action {name, label, args?}` | `{done}` / `{deny}`; `next(e)` continues the chain |

## Provenance

`rupd` records calls with `actor` (`{kind:"user"|"agent"|"ext", id, parent}`) in the append-only Touch log. An Extension's permitted calls retain its identity and authority.

## Out of scope for v0

Other event sources, custom panels, a registry and other vendors' adapters (`agentAdapters` stays the seam).
