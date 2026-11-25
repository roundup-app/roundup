# UI: Project settings (U3764–U3766; the center view retired by U7887d)

Acceptance for #3280, from the user's request: "we need to have project settings view that users could open from the overview". Module: `apps/desktop/src/` (`rail/`, a shared settings shell). Ids: U3764–U3766. U3813 (`ui-project-menu.md`, #3511) moves the entry point to the native Project menu; its implementing PR changes the App seam. No new Daemon method, nothing under `contracts/`, no new Token. Replaces the dialog of U3745 as the place the Workstream cap lives; U3745's field, toggle, refusal and call-once clauses stay. Shares the center-only sizing rule of #3278 (U3761).

**U3764 retired.** The center view and its `Project Settings…` entry are gone; the Project page of Settings holds the groups (U7887a, `scenarios/ui-project-settings-page.md`).

**U3765 the Workstreams group holds the cap.** Given the Project page of Settings (U7887a), then the first group is named **Workstreams** and holds `Run at most N Workstreams at once` and `No limit` with U3745's behaviour unchanged: one `project.setWorkstreamCap {cap}` per commit (Enter or blur with a changed value), `null` for `No limit`, a bad entry refused in the field with `✕ <message>`, calling nothing and keeping the old cap, and the field reads `project.get`'s value on open. Tests: the existing `u3745_a_commit_sets_the_cap_once_and_no_limit_sets_null`, `u3745_a_bad_entry_calls_nothing_and_keeps_the_cap` and `u3745_no_limit_shows_when_the_project_has_no_cap` in `apps/desktop/src/rail/u3745_workstream_cap.test.tsx`, retargeted at the page (U7887b).

**U3766 retired.** A page of Settings returns as U3800 holds.

Policy: U3765's cap behavior is unchanged.
