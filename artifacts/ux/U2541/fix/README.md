# U2541 critic fixes

Head code: d53acf932, merged with origin/main 0efd006bf.

Fresh headless agent-browser profile, sessions builder-39096362385 and
builder-39096362385-b; 1512×950. Light/dark captures cover agents-10 and tree-40
with hints, Help and the leader. tree-40 selects token-rotation and leaves
the populated work-items panel open.

Measured in all four Help screens: chord gap 4 px, sequence gap 16 px,
row gap 4 px. The Hint row adds 4 px below its 16 px chips. Help and Hint
both call ⌘K “Wait for one more key”; the shelf chord uses ⏎.

delta.json compares the six tree-40 readings with the committed main baseline:
no passing Check regresses. D2/D5 pass everywhere. The existing tree-40
Todo tick D6/D7 and resulting D10 failures remain in hints/leader screens.
agents-10 and Help pass every Check.

failure.png shows the injected Workstream error beside the hints on tree-40.
pad.png and drawer.png show focus in an owned Pad's Make yours button and the
Drawer's Close button: each shows ⌘K and ⌘/. These supplement the existing
bound-chord behavior observer. No native macOS rendering is claimed.
