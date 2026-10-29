import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = () => resolve(process.cwd(), "../..", "artifacts/ux");

/** L105: the directory a capture test writes `<id>`'s PNGs and checks to, or null when this run does not name `<id>`. Creates nothing. */
export function captureDir(id: string): string | null {
  const named = (process.env.ROUNDUP_CAPTURES ?? "").split(",").map((part) => part.trim());

  if (!named.includes(id)) return null;

  if (id.startsWith("J")) return /^J[0-9]+[a-z]?$/.test(id) ? join(root(), "journey", id) : null;

  return join(root(), id);
}

/** U453: committed observer readings remain readable when capture writes are disabled. */
export function readCapture(id: string, name: string): string {
  return readFileSync(join(root(), id, name), "utf8");
}

// Named observers, including ids passed through capture helpers. Vitest owns discovery
// and scheduling; this table only names the existing observer files.
export const observers = {
  "src/app/u3560_browser.test.ts": ["U3560c", "U3560e"],
  "src/app/u3787f_browser.test.ts": ["U3787f"],
  "src/app/u3791c_rendered.test.ts": ["U3791c"],
  "src/app/z3742h_browser.test.ts": ["Z3742h"],
  "src/ask/dv5_rendered.test.ts": ["DV5", "DV6", "U3021c"],
  "src/ask/u505_ask_rows.test.tsx": ["U504", "U505"],
  "src/ask/u3787c_browser.test.ts": ["U3787c"],
  "src/bubbles/u2224_rendered.test.ts": ["U2224"],
  "src/bubbles/u2236_browser.test.ts": ["U2892", "U4459"],
  "src/bubbles/u2742_browser.test.ts": ["U4011"],
  "src/bubbles/u3756_focus.test.ts": ["U3756a", "U3756b", "U3756c", "U3756d"],
  "src/bubbles/u4274_navigation.test.tsx": ["U4453c"],
  "src/bubbles/u4390_browser.test.ts": ["U4390"],
  "src/bubbles/u4424_browser.test.ts": ["U4424a", "U4424b"],
  "src/bubbles/u469_bar.test.ts": ["U469"],
  "src/bubbles/u511a_browser.test.ts": ["U3021c", "U3787c"],
  "src/changes/u2539b_rendered.test.ts": ["U2539b"],
  "src/changes/u2540_rendered.test.ts": ["P3557c", "U2540", "U2773a", "U2773e"],
  "src/drawer/u3010b_rendered.test.ts": ["U3010b"],
  "src/drawer/u4458_browser.test.ts": ["U4458"],
  "src/header/u449_rendered.test.ts": ["U449", "U451"],
  "src/header/u475_browser.test.ts": ["P3557c", "U2539b"],
  "src/header/u497_rendered.test.ts": ["U497"],
  "src/importer/u2875d_import_panel.test.tsx": ["U3049a", "U3049b", "U3299a", "U3299b", "U3299c", "U3299d"],
  "src/importer/u3787c_browser.test.ts": ["U3787c"],
  "src/inbox/u3770_browser.test.ts": ["P3557c", "U3770a", "U3770b", "U3770e"],
  "src/inbox/u3787c_browser.test.ts": ["U3787c"],
  "src/ink/u4464_capture.test.ts": ["U4464"],
  "src/keys/u3714_browser.test.ts": ["U3713", "U3714", "U3715", "U3716"],
  "src/keys/u4685_browser.test.ts": ["U4685a", "U4685b"],
  "src/keys/u4692_attention.test.tsx": ["U4692", "U4692a"],
  "src/keys/u4690_browser.test.ts": ["U4690", "U4690a", "U4690b", "U4690c", "U4690d", "U4690e"],
  "src/orders/u3078i_rendered.test.ts": ["P3557c", "U3078i", "U3791b", "U4453b"],
  "src/pads/u4698b_browser.test.ts": ["U4698b"],
  "src/pads/p2544a_browser.test.ts": ["U3021c"],
  "src/pads/u3732_real_daemon_agent_owner.test.tsx": ["U4457"],
  "src/rail/menu/u3787a_browser.test.ts": ["U3787a"],
  "src/rail/menu/u4461_rendered.test.ts": ["U4461", "U4601"],
  "src/rail/u3787c_browser.test.ts": ["U3787c"],
  "src/rail/u426_rendered.test.ts": ["U350"],
  "src/rail/u4547a_browser.test.ts": ["U4547a"],
  "src/rail/u4547bc_browser.test.ts": ["U4547b", "U4547c"],
  "src/rail/u4547d_browser.test.ts": ["U4547d"],
  "src/rail/u4644_capture.test.ts": ["U4644"],
  "src/rail/u522_browser.test.ts": ["U522"],
  "src/reactions/nr9_rendered.test.ts": ["NR9", "P3557c", "U3787c", "U3791b", "U4276a", "U4276b", "U4276c"],
  "src/settings/u3799_app_settings.test.tsx": ["U3813", "U3814", "U3815"],
  "src/settings/u3799_rendered.test.ts": ["U3799", "U3805", "U4277c"],
  "src/settings/u4687_capture.test.ts": ["U4687a"],
  "src/settings/u4688_rendered.test.ts": ["U4688a", "U4688b"],
  "src/settings/u4277_rendered.test.ts": ["U4277a", "U4277b", "U4277c"],
  "src/shelf/u371_reserved_modes.test.ts": ["U2892"],
  "src/shelf/u3787c_browser.test.ts": ["U3787c"],
  "src/shelf/u3789_browser.test.ts": ["U3789a", "U3789b", "U3789c", "U3789d", "U3800a", "U4275a", "U4275b", "U4275c", "U4335a"],
  "src/shelf/u4463_browser.test.ts": ["U4463"],
  "src/state/u3787f_storage_browser.test.ts": ["U3787f"],
  "src/state/u4086_storage_browser.test.ts": ["U4086a", "U4086b", "U4086c", "U4086d"],
  "src/switcher/u2572_browser.test.ts": ["P3557c", "U2572d", "U4681"],
  "src/switcher/u3787c_browser.test.ts": ["U3787c", "U4682"],
  "src/terminal/s3806c_scale.test.ts": ["U4590"],
  "src/terminal/u102_emulator.test.ts": ["Z3788a"],
  "src/terminal/u3517_browser.test.ts": ["U3517b", "U3517c", "U3517f", "U4456a", "U4456b", "U4456c", "U4456d", "U4590", "U4592", "U4649", "U4679"],
  "src/terminal/u3517_type.test.ts": ["U4590"],
  "src/terminal/u3530_browser.test.ts": ["U3530a"],
  "src/terminal/u3707_browser.test.ts": ["U3707"],
  "src/terminal/u4315_header.test.tsx": ["U4355"],
  "src/terminal/u4453a_terminal_only.test.tsx": ["U4453a", "U4453b"],
  "src/terminal/u4590_preparation.test.tsx": ["U4590"],
  "src/terminal/u467_browser.test.ts": ["U467", "U468"],
  "src/terminal/u514_browser.test.ts": ["U3529", "U3529a", "U3529b", "U3529c", "U3529d"],
  "src/terminal/u59_real_daemon.test.ts": ["U4590"],
  "src/testing/u2875d_rendered.test.ts": ["U2875d"],
  "src/testing/u3787d_capture.test.ts": ["U3787d"],
  "src/testing/u463_real_daemon.test.ts": ["A4899a", "U2773g", "U2875d", "U3037d", "U4590", "U463"],
  "src/toasts/p3557c_capture.test.ts": ["P3557c"],
  "src/todos/u3010c_rendered.test.ts": ["U3010c"],
  "src/todos/u3720_real_daemon_owner.test.tsx": ["U3308", "U3311", "T4902"],
  "src/todos/u3741_rendered.test.ts": ["U3741"],
  "src/todos/u3760_rendered.test.ts": ["P3557c", "U3760"],
  "src/todos/u3774_rendered.test.ts": ["U3774"],
  "src/todos/u3776_rendered.test.ts": ["U3776"],
  "src/todos/u3787a_browser.test.ts": ["U3787a", "U3787g", "U3787h"],
  "src/todos/u461_rendered.test.ts": ["U3021c", "U3728", "U461", "U461a", "U461b", "U462"],
  "src/todos/u490a_browser.test.ts": ["U3010c", "U490a"],
  "src/ui/u3010c_copy_rendered.test.ts": ["U3010c"],
  "src/ui/u3295_capture.test.ts": ["U3295a", "U3295b"],
  "src/ui/u3310_browser.test.ts": ["U3310"],
  "src/ui/u3512_rendered.test.ts": ["U3512d"],
  "src/ui/u474_browser.test.ts": ["U477"],
  "src/ui/u484_browser.test.ts": ["U3800a", "U3800b", "U3800c"],
} satisfies Record<string, readonly string[]>;

/** U4590: fail closed before App setup when any requested capture has no observer. */
export function captureTests(selection: string | undefined) {
  if (selection === undefined) return undefined;

  const files = new Set<string>();

  const ids = selection.split(",").map(part => part.trim());

  // Shared observers gate on a lead id or write each member's directory. Activate
  // the complete group so an individually requested member cannot silently skip.
  const groups = [
    ["U3295a", "U3295b"],
    ["U3299a", "U3299b", "U3299c", "U3299d"],
    ["U4277a", "U4277b", "U4277c"],
    ["U3813", "U3814", "U3815"],
    ["U4453a", "U4453b"],
    ["U3529", "U3529a", "U3529b", "U3529c", "U3529d"],
    ["U3049a", "U3049b"],
  ];

  for (const group of groups) {
    if (group.some(id => ids.includes(id))) ids.push(...group.filter(id => !ids.includes(id)));
  }

  for (const id of ids) {
    const found = Object.entries(observers).filter(([, ids]) => ids.includes(id));

    if (found.length === 0) throw new Error(`Unsupported capture id: ${id || "(empty)"}`);

    for (const [file] of found) files.add(file);
  }

  return { ids: [...new Set(ids)], files: [...files] };
}
