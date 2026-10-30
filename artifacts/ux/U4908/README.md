U4908 implementation evidence is incomplete. Issue #4708 remains open.

The six Open cases failed for the missing Pad button before implementation and pass for Pad/Todo pointer, Enter and Space afterward. Pad list, Pad rename, Project isolation, Escape and capture-registry observers pass. The full U4708 browser run passed 12 cases but its existing dense capture observer timed out. All six U4708 head Check readings collected before that timeout pass.

`observation.json` records immutable source revisions, available paired-observer readings and remaining observations. The baseline checkout differs only by registering U4908 in the capture registry; product code equals the baseline revision. Available baseline Pad captures include rest, hover, focus, selection, Drawer, add field, failure feedback and 1280×820. The full Todos/main/head comparison is not demonstrated. Images and videos remain uncommitted.

Caller inventory: Pads leaves/add field use the shared sticky-note; Todo OpenRow (Shelf and Rail), pending rows and done summary carry Kind glyphs; Todo EntryRow carries the capture tick. EntryRow forwards its mark. No other Shelf tab calls ShelfRow or EntryRow, and no current caller supplies an absent mark. ShelfRow now omits an absent mark and its grid gap. One shared Token formula sets the row/group origin.

`just ready` completed with only stylesheet lint failing; removing the unnecessary selector made `pnpm lint:styles` pass. Typechecking passes. The broad related-test attempt was stopped because Icon reaches most of the desktop suite; focused regressions were run instead. No Mac observation is claimed; the user reports what they meet on the Mac.
