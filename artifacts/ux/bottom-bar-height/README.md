# Terminal tab bar matches the + Workstream row

Seed `tabs-8` at 1512x950, light and dark, focus on a Rail row so the hint line shows. `before-*` is origin/main d1210540f, `after-*` is this branch. `*.measure.json` holds the readings.

| | before | after |
|---|---|---|
| tab row height / + Workstream row height | 40 / 40 | 40 / 40 |
| tab bar rule y / Rail footer rule y | 906 / 910 | 910 / 910 |
| rule colour (light, dark) | same | same |
| hint chip left inset | 4 | 8 (the Terminal text's inset) |
| hint chip to rule | 4, inside the band | 4, on the page ground |

Cause: d53acf932 grew the hint row from 16 to 20 px; the bar's ground and rule stayed at a hard-coded 16 px, so the band and rule began 4 px high and the bar read 44 px tall. One token, `--hint-row-height`, now sets the row and both offsets.
