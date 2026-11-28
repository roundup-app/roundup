# Extension interface

An Extension is one module exporting `register(on)`, named by one path in its manifest. The host runs action Hooks, and draws a panel for an Extension granted `panel`.

## Manifest

`rup-extension.json` = `{ name, module, permissions, uses?, types? }`. Permissions are declared and enforced by `rupd`. `uses` lists the capabilities the Extension needs, read before it starts: `panel`, `service`, `agents.place`, `agents.settings`, `asks`. `service` is granted on declaration; the others only by the owner's approval, which pins folder, name and capabilities, so a new capability asks again (EP5).

## Shape

- `$` — engine handle for permitted calls: `$.agents`, `$.todos`, `$.pads`, `$.bus`, `$.ui`, `$.store`, `$.clock`.
- `e` — `{ name, args }`, the action request as plain data.
- `next(e)` passes on. `next({...e, changed})` rewrites what later Hooks see. Returning without `next` answers for yourself.
- Results: `{ done: true }` completes the action; `{ deny: "cause" }` refuses it.
- Registration: `on("action", { name, label, args? }, hook)`.
- Hot reload on save: the host starts a new child and publishes its actions only after registration succeeds. A bad save keeps the last good registration. State lives in `$.store`, persisted per Extension.
- A throwing runtime Hook is skipped (fail open), raising one `extension.problem`. `.catch` can answer in its place.
- An Extension ignores unknown events, fields and frames (EP4). The interface only grows: no field, call or event is removed or renamed, and there is no v2 (EP3).

```ts
export function register(on) {
  on("action", { name: "user.check", label: "Check" }, async ($) => {
    await $.todos.create({ title: "Check the result" });
    return { done: true };
  });
}
```

## Where Extensions run

Each Extension is a child process of `rupd` running its `module` with the owner's `node`, started by the Extension host (`crates/rupd`, `src/extensions/`) after the Daemon serves its socket. Extensions are folders in `~/.roundup/extensions/`; a Project folder never loads code. `rupd` enforces `permissions` (`agents`, `todos`, `pads`, `bus`, `ui`, `store`, `clock`) on the child's calls. The interface only grows: `contracts/generated/extension/` holds every frame, and an Extension or host ignores an event, frame or field it does not know. A load failure ends the new child only and raises one `extension.problem` (a Toast). Acceptance: `scenarios/user-actions.md`.

## User actions

`on("action", { name, label, args? }, hook)` declares a named action. It is listed after the built-in ones by `action.list`, shown in the Switcher when it needs no argument, and run with `rup do <name>`. A name never takes a built-in one.

## Hooks

| Concern | Hook | Returns |
|---|---|---|
| User action | `action {name, label, args?}` | `{done}` / `{deny}`; `next(e)` continues the chain |

## Provenance

`rupd` records calls with `actor` (`{kind:"user"|"agent"|"ext", id, parent}`) in the append-only Touch log. An Extension's permitted calls retain its identity and authority.

## Panels

An Extension granted `panel` draws a panel at the centre of its own Mode on the Rail, in roundup's own components; no webview, iframe or HTML. The contract is `crates/contracts/src/extension.rs`; its schema only grows (EP3).

- **Frames.** The Extension sends `show {ask, panel}` and `health {note}` (at most 80 characters, shown on its node). roundup sends `hello {offers, granted, components}` first, then `shown {ask, render}` or `shown {ask, refused: {code, cause}}`, `click {id, render, element, action, args, inputs, by: "user", via: "app"}`, `stop {reason}` and, to an Extension granted `asks`, `ask {id, text, item?, by: "user", via: "app"}`. A frame that needs a capability goes only to an Extension granted it.
- **Components.** `stack`, `heading`, `text`, `row`, `chip`, `button` and `input`. Text is plain and labels are capped. A button's action is `{name, args}`, or `{ask: {item}}`, which opens the Ask bar and sends no click.
- **Clicks.** The App sends `panel.click` on its attested connection (EP1). roundup passes a click once, only for the current render, and reads the action and args from the render it stored (EP9). The SDK acts only on its newest render and a click id it has not seen.
- **Capabilities.** `service` makes rupd supervise the Extension (EP14); `agents.place` puts the Agents it starts under its Mode (EP13); `agents.settings` lets it start Agents with Claude Code settings (EP7); `asks` lets an Ask to its Mode reach it (EP19). `hello.offers` states what roundup offers and `hello.granted` what the owner approved.
- **Attention.** A panel raises no alert, Toast, badge, count or Inbox row, and shows no token, cost or cap numbers (EP10).

roundup proves a click came through roundup's window, not that your hand made it: any program you allowed to control your computer can click hum's buttons for you.

Acceptance: `scenarios/extension-panels.md`.

## Out of scope

Other event sources, a registry and other vendors' adapters (`agentAdapters` stays the seam). GUI automation, Agents editing Extension files, and a replaced rupd or a hand-run Extension are policy, not features.
