# Open Doodles

Pablo Stanley’s [Open Doodles](https://www.opendoodles.com/), bundled under
[CC0](https://www.opendoodles.com/about). No payment or attribution required.

Each file comes from `https://opendoodles.s3-us-west-1.amazonaws.com/<filename>`.
Geometry is unchanged; export metadata and unused IDs were removed, the root
was wrapped in a reusable SVG symbol, and the two fills now use the existing
`--accent` and `--text-muted` Tokens. External SVG use loads only mounted scenes;
Vite’s `?no-inline` keeps their bytes outside the entry and eager JS closure.

| Source SVG | Empty view / next activity |
| --- | --- |
| strolling.svg | First run: enter a workspace |
| running.svg | Todos: begin the next task |
| reading-side.svg | Pads: read and develop notes |
| laying.svg | Inbox: read incoming messages |
| unboxing.svg | Made: discover what was produced |
| plant.svg | Rail: grow a team |
| meditating.svg | Centre and stopped Door: pause before starting |
| sitting-reading.svg | Earlier output: inspect past work |
| loving.svg | Named reactions: respond to an event |
| reading.svg | Ask history: revisit earlier requests |
| clumsy.svg | Draft recovery and note drafts: gather unfinished papers |

Changes and Timeline no longer render empty views on this main revision;
their absent states remain absent. No single-icon fallback remains.
