# Your roundup config

You are an agent changing the owner's roundup. This folder holds plain files that change how roundup looks and what acts on a matter. Edit only the files named here. A change applies when the file is saved, with no restart. A file roundup refuses is not applied at all: the previous state stays and roundup shows a `config.problem` that names the file, the key and the cause. Read that cause, fix the file, save again.

## Files you may change

### look.json: how roundup looks
One JSON object. Keys: `mode` ("dark", "light" or "system"), `interfaceScale` ("small", "default" or "large"), `fontFamily` (a Terminal font name), `fontSize` (a number from 9 to 21), `colors` (an object of hex colours for `accent`, `ground`, `sunken`, `text`, `grey`, `hover`, `selected`, `hairline`). Any other key refuses the file. Deleting the file returns the defaults.

    { "mode": "dark", "fontSize": 14, "colors": { "accent": "#ff6a00" } }

### keys.json: key chords
One JSON object of `"<action name>": "<press>"`. A press is modifiers in the order ctrl, alt, meta, shift, then a key code, with ctrl or meta present. A name no action holds, a press that does not parse or one a focused Terminal needs refuses the file.

    { "todo.add": "meta+shift+KeyT" }

### extensions/: your own actions
A single file `extensions/<name>.js` that exports `register(on)` adds named actions. It may use `todos`, `pads` and `store` only. An action that needs more has a folder with a `rup-extension.json` manifest declaring `permissions`.

### door.md: how the Door speaks
Plain text added to the Door's instructions after roundup's own. It shapes how the Door words, orders and summarises what it hands the owner. It never replaces roundup's instructions or removes a tool. A change applies from the Door's next turn.

    Keep every summary under five lines. Put the question first.

## Out of reach

Both kinds are refused whole, in every file and in every Extension call:

- **The attention rules.** Which matter sits in the centre, who may ask the owner (Messages, Routes, Held, Takeover), alert settings (`alertLevel`, a Project's alerts), and the shelf following the Rail's selection. roundup owns these.
- **A second surface or an interruption.** A panel beside the centre, a machine sidebar or Rail level, a dispatch or PR panel, a bell, an OS notification, a Toast or a badge outside the alerts the owner turned on. Only those alerts interrupt.

A side-by-side diff of two Agents' results is one matter in the centre and needs no file.
