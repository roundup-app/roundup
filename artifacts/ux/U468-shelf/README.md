# U468 Shelf refusal repair

Observer: isolated headless agent-browser, fresh profiles, decisions seed; fake Daemon. Both schemes and both contrast settings at 700×800, 1280×800 and 1440×800. The 700 px case reproduces the critic’s diagnostic; supported windows start at 1280 px.

Before captures restore only the rejected max-width declaration over the corrected App; after captures use the committed stylesheet. No other UI rule differs.

24 after states keep the refusal wider than 250 px and every answer control inside the card. Check delta across all 24 pairs: 324 passing Checks preserved, 36 pre-existing failures, zero new failures. Question input D6/D7 and derived D10 remain pre-existing failures. More contrast was verified with matchMedia, with forced colors disabled.

| Width | Scheme | Contrast | Agent | Card width | Refusal before → after | Height before → after |
| --- | --- | --- | --- | --- | --- | --- |
| 1280 | dark | more | 1 | 640 | 304 → 624 | 106 → 62 |
| 1280 | dark | more | 2 | 640 | 304 → 624 | 106 → 62 |
| 1280 | dark | normal | 1 | 640 | 304 → 624 | 106 → 62 |
| 1280 | dark | normal | 2 | 640 | 304 → 624 | 106 → 62 |
| 1280 | light | more | 1 | 640 | 304 → 624 | 106 → 62 |
| 1280 | light | more | 2 | 640 | 304 → 624 | 106 → 62 |
| 1280 | light | normal | 1 | 640 | 304 → 624 | 106 → 62 |
| 1280 | light | normal | 2 | 640 | 304 → 624 | 106 → 62 |
| 1440 | dark | more | 1 | 800 | 464 → 784 | 76 → 46 |
| 1440 | dark | more | 2 | 800 | 464 → 784 | 76 → 46 |
| 1440 | dark | normal | 1 | 800 | 464 → 784 | 76 → 46 |
| 1440 | dark | normal | 2 | 800 | 464 → 784 | 76 → 46 |
| 1440 | light | more | 1 | 800 | 464 → 784 | 76 → 46 |
| 1440 | light | more | 2 | 800 | 464 → 784 | 76 → 46 |
| 1440 | light | normal | 1 | 800 | 464 → 784 | 76 → 46 |
| 1440 | light | normal | 2 | 800 | 464 → 784 | 76 → 46 |
| 700 | dark | more | 1 | 340 | 4 → 324 | 3106 → 92 |
| 700 | dark | more | 2 | 340 | 4 → 324 | 3106 → 92 |
| 700 | dark | normal | 1 | 340 | 4 → 324 | 3106 → 92 |
| 700 | dark | normal | 2 | 340 | 4 → 324 | 3106 → 92 |
| 700 | light | more | 1 | 340 | 4 → 324 | 3106 → 92 |
| 700 | light | more | 2 | 340 | 4 → 324 | 3106 → 92 |
| 700 | light | normal | 1 | 340 | 4 → 324 | 3106 → 92 |
| 700 | light | normal | 2 | 340 | 4 → 324 | 3106 → 92 |

Committed before/after screenshots cover both refused request types at the supported 1280 px width in light/normal contrast. The table records all 48 measured captures; U453 retires committed screenshots below 1280 px, so narrow diagnostic captures remain outside the repository.
