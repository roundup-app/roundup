# Open Doodles

Pablo Stanley’s [Open Doodles](https://www.opendoodles.com/), bundled under
[CC0](https://www.opendoodles.com/about). No payment or attribution required.

Each file comes from `https://opendoodles.s3-us-west-1.amazonaws.com/<filename>`.
Export metadata and unused IDs were removed, the root
was wrapped in a reusable SVG symbol, and the two fills now use the existing
`--accent` and `--grey` Tokens. External SVG use loads only mounted scenes;
Vite’s `?no-inline` keeps their bytes outside the entry and eager JS closure.

SVGO 4.1.0 optimizes paths with integer coordinate precision for the 240×160
rendering size. The external `scene` ID and
symbol are preserved. To reproduce from the token-coloured source SVGs, run
SVGO with `multipass: true`, `floatPrecision: 1` and `preset-default` overrides
`cleanupIds: false, removeHiddenElems: false`, then repeat at `floatPrecision: 0`.
The eleven scenes total 105,681 bytes. No runtime optimizer ships.

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
