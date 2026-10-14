Source snapshot: https://github.com/saadshahd/roundup/issues/1525

Saved before observer run 38487020217 could replace the same-date report.
The associated input and its digest are recorded in retro-observation.md.

<!-- retro-report -->

<!-- retro-state {"window": {"start": "2026-10-12T19:48:27Z", "end": "2026-10-13T19:48:27Z", "interval": "[start, end)"}, "numbers": {"merged": 119, "product": 53, "loop": 51, "spec": 15, "closed_unmerged": 9, "fix_attempts": 83, "fix_nopush": 1, "fix_push_unknown": 83, "strikes": 18, "held_by_strikes": 0, "main_failures": 15, "flaky_issues": 4, "needs_user": 3, "needs_user_seconds": 106223.0, "confirmed_model_runs": 612, "model_work_unknown": 2323, "model_runs_per_merged_pr": "n/a"}, "repairs": [], "queue_by_workflow": {"build": {"count": 398, "median_seconds": 3.0, "max_seconds": 33.0, "still_queued": 0}, "care": {"count": 5, "median_seconds": 5.0, "max_seconds": 1509.0, "still_queued": 0}, "critic": {"count": 778, "median_seconds": 3.0, "max_seconds": 31.0, "still_queued": 0}, "fix": {"count": 1482, "median_seconds": 1.0, "max_seconds": 3273.0, "still_queued": 35}, "retro": {"count": 9, "median_seconds": 4.0, "max_seconds": 27.0, "still_queued": 1}, "review": {"count": 778, "median_seconds": 3.0, "max_seconds": 6.0, "still_queued": 0}}} -->

Window: `2026-10-12T19:48:27Z` to `2026-10-13T19:48:27Z` (end excluded).

Previous: n/a

| Metric | Today | Previous |
|---|---:|---:|
| merged | 119 | n/a |
| product | 53 | n/a |
| loop | 51 | n/a |
| spec | 15 | n/a |
| closed_unmerged | 9 | n/a |
| fix_attempts | 83 | n/a |
| fix_nopush | 1 | n/a |
| fix_push_unknown | 83 | n/a |
| strikes | 18 | n/a |
| held_by_strikes | 0 | n/a |
| main_failures | 15 | n/a |
| flaky_issues | 4 | n/a |
| needs_user | 3 | n/a |
| needs_user_seconds | 106223.0 | n/a |
| confirmed_model_runs | 612 | n/a |
| model_work_unknown | 2323 | n/a |
| model_runs_per_merged_pr | n/a | n/a |

Queue by workflow:
```json
{
  "today": {
    "build": {
      "count": 398,
      "median_seconds": 3.0,
      "max_seconds": 33.0,
      "still_queued": 0
    },
    "care": {
      "count": 5,
      "median_seconds": 5.0,
      "max_seconds": 1509.0,
      "still_queued": 0
    },
    "critic": {
      "count": 778,
      "median_seconds": 3.0,
      "max_seconds": 31.0,
      "still_queued": 0
    },
    "fix": {
      "count": 1482,
      "median_seconds": 1.0,
      "max_seconds": 3273.0,
      "still_queued": 35
    },
    "retro": {
      "count": 9,
      "median_seconds": 4.0,
      "max_seconds": 27.0,
      "still_queued": 1
    },
    "review": {
      "count": 778,
      "median_seconds": 3.0,
      "max_seconds": 6.0,
      "still_queued": 0
    }
  },
  "previous": "n/a"
}
```

Model runs by merged PR:
| Merged PR | build | fix | review | critic | Confirmed total | Unknown total |
|---|---:|---:|---:|---:|---:|---:|
| [#1505](https://github.com/saadshahd/roundup/pull/1505) | 0 (+0 unknown) | 0 (+2 unknown) | 1 (+0 unknown) | 0 (+1 unknown) | 1 | 3 |
| [#1495](https://github.com/saadshahd/roundup/pull/1495) | 0 (+0 unknown) | 0 (+2 unknown) | 1 (+0 unknown) | 0 (+1 unknown) | 1 | 3 |
| [#1492](https://github.com/saadshahd/roundup/pull/1492) | 1 (+0 unknown) | 0 (+13 unknown) | 1 (+6 unknown) | 0 (+7 unknown) | 2 | 26 |
| [#1489](https://github.com/saadshahd/roundup/pull/1489) | 1 (+0 unknown) | 0 (+8 unknown) | 1 (+4 unknown) | 0 (+5 unknown) | 2 | 17 |
| [#1486](https://github.com/saadshahd/roundup/pull/1486) | 1 (+0 unknown) | 1 (+11 unknown) | 1 (+6 unknown) | 0 (+7 unknown) | 3 | 24 |
| [#1484](https://github.com/saadshahd/roundup/pull/1484) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 1 (+2 unknown) | 3 | 9 |
| [#1480](https://github.com/saadshahd/roundup/pull/1480) | 1 (+0 unknown) | 0 (+11 unknown) | 1 (+5 unknown) | 0 (+6 unknown) | 2 | 22 |
| [#1478](https://github.com/saadshahd/roundup/pull/1478) | 1 (+0 unknown) | 1 (+7 unknown) | 1 (+4 unknown) | 0 (+5 unknown) | 3 | 16 |
| [#1476](https://github.com/saadshahd/roundup/pull/1476) | 1 (+0 unknown) | 1 (+9 unknown) | 5 (+11 unknown) | 0 (+16 unknown) | 7 | 36 |
| [#1475](https://github.com/saadshahd/roundup/pull/1475) | 1 (+0 unknown) | 3 (+29 unknown) | 13 (+35 unknown) | 12 (+36 unknown) | 29 | 100 |
| [#1474](https://github.com/saadshahd/roundup/pull/1474) | 0 (+0 unknown) | 0 (+2 unknown) | 1 (+0 unknown) | 0 (+1 unknown) | 1 | 3 |
| [#1473](https://github.com/saadshahd/roundup/pull/1473) | 1 (+0 unknown) | 0 (+5 unknown) | 2 (+5 unknown) | 0 (+7 unknown) | 3 | 17 |
| [#1472](https://github.com/saadshahd/roundup/pull/1472) | 1 (+0 unknown) | 1 (+10 unknown) | 1 (+5 unknown) | 0 (+6 unknown) | 3 | 21 |
| [#1471](https://github.com/saadshahd/roundup/pull/1471) | 1 (+0 unknown) | 2 (+20 unknown) | 11 (+29 unknown) | 10 (+30 unknown) | 24 | 79 |
| [#1469](https://github.com/saadshahd/roundup/pull/1469) | 1 (+0 unknown) | 1 (+17 unknown) | 4 (+12 unknown) | 0 (+16 unknown) | 6 | 45 |
| [#1468](https://github.com/saadshahd/roundup/pull/1468) | 1 (+0 unknown) | 1 (+8 unknown) | 2 (+3 unknown) | 0 (+5 unknown) | 4 | 16 |
| [#1466](https://github.com/saadshahd/roundup/pull/1466) | 1 (+0 unknown) | 1 (+8 unknown) | 1 (+3 unknown) | 0 (+4 unknown) | 3 | 15 |
| [#1464](https://github.com/saadshahd/roundup/pull/1464) | 0 (+0 unknown) | 0 (+2 unknown) | 1 (+0 unknown) | 0 (+1 unknown) | 1 | 3 |
| [#1457](https://github.com/saadshahd/roundup/pull/1457) | 1 (+0 unknown) | 0 (+9 unknown) | 1 (+5 unknown) | 1 (+5 unknown) | 3 | 19 |
| [#1456](https://github.com/saadshahd/roundup/pull/1456) | 1 (+0 unknown) | 3 (+13 unknown) | 1 (+8 unknown) | 1 (+8 unknown) | 6 | 29 |
| [#1455](https://github.com/saadshahd/roundup/pull/1455) | 1 (+0 unknown) | 0 (+8 unknown) | 1 (+4 unknown) | 1 (+4 unknown) | 3 | 16 |
| [#1452](https://github.com/saadshahd/roundup/pull/1452) | 1 (+0 unknown) | 1 (+13 unknown) | 1 (+6 unknown) | 0 (+7 unknown) | 3 | 26 |
| [#1451](https://github.com/saadshahd/roundup/pull/1451) | 1 (+0 unknown) | 2 (+24 unknown) | 10 (+27 unknown) | 9 (+28 unknown) | 22 | 79 |
| [#1450](https://github.com/saadshahd/roundup/pull/1450) | 1 (+0 unknown) | 0 (+3 unknown) | 1 (+1 unknown) | 0 (+2 unknown) | 2 | 6 |
| [#1449](https://github.com/saadshahd/roundup/pull/1449) | 1 (+0 unknown) | 2 (+14 unknown) | 4 (+7 unknown) | 0 (+11 unknown) | 7 | 32 |
| [#1448](https://github.com/saadshahd/roundup/pull/1448) | 1 (+0 unknown) | 1 (+5 unknown) | 1 (+2 unknown) | 0 (+3 unknown) | 3 | 10 |
| [#1447](https://github.com/saadshahd/roundup/pull/1447) | 0 (+0 unknown) | 0 (+7 unknown) | 2 (+2 unknown) | 0 (+4 unknown) | 2 | 13 |
| [#1443](https://github.com/saadshahd/roundup/pull/1443) | 2 (+0 unknown) | 4 (+10 unknown) | 2 (+4 unknown) | 2 (+4 unknown) | 10 | 18 |
| [#1442](https://github.com/saadshahd/roundup/pull/1442) | 1 (+0 unknown) | 2 (+15 unknown) | 6 (+18 unknown) | 3 (+21 unknown) | 12 | 54 |
| [#1438](https://github.com/saadshahd/roundup/pull/1438) | 1 (+0 unknown) | 3 (+22 unknown) | 9 (+23 unknown) | 8 (+24 unknown) | 21 | 69 |
| [#1437](https://github.com/saadshahd/roundup/pull/1437) | 1 (+0 unknown) | 1 (+5 unknown) | 2 (+1 unknown) | 0 (+3 unknown) | 4 | 9 |
| [#1436](https://github.com/saadshahd/roundup/pull/1436) | 1 (+0 unknown) | 0 (+13 unknown) | 1 (+6 unknown) | 0 (+7 unknown) | 2 | 26 |
| [#1435](https://github.com/saadshahd/roundup/pull/1435) | 0 (+0 unknown) | 0 (+2 unknown) | 1 (+0 unknown) | 0 (+1 unknown) | 1 | 3 |
| [#1431](https://github.com/saadshahd/roundup/pull/1431) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 0 (+3 unknown) | 2 | 10 |
| [#1429](https://github.com/saadshahd/roundup/pull/1429) | 1 (+0 unknown) | 0 (+7 unknown) | 1 (+3 unknown) | 1 (+3 unknown) | 3 | 13 |
| [#1428](https://github.com/saadshahd/roundup/pull/1428) | 1 (+0 unknown) | 2 (+12 unknown) | 1 (+7 unknown) | 0 (+8 unknown) | 4 | 27 |
| [#1426](https://github.com/saadshahd/roundup/pull/1426) | 1 (+0 unknown) | 2 (+7 unknown) | 1 (+4 unknown) | 0 (+5 unknown) | 4 | 16 |
| [#1425](https://github.com/saadshahd/roundup/pull/1425) | 1 (+0 unknown) | 0 (+6 unknown) | 1 (+3 unknown) | 0 (+4 unknown) | 2 | 13 |
| [#1424](https://github.com/saadshahd/roundup/pull/1424) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 0 (+3 unknown) | 2 | 10 |
| [#1423](https://github.com/saadshahd/roundup/pull/1423) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 0 (+3 unknown) | 2 | 10 |
| [#1421](https://github.com/saadshahd/roundup/pull/1421) | 1 (+0 unknown) | 2 (+10 unknown) | 3 (+6 unknown) | 2 (+7 unknown) | 8 | 23 |
| [#1420](https://github.com/saadshahd/roundup/pull/1420) | 1 (+0 unknown) | 2 (+10 unknown) | 2 (+4 unknown) | 2 (+4 unknown) | 7 | 18 |
| [#1418](https://github.com/saadshahd/roundup/pull/1418) | 1 (+0 unknown) | 1 (+8 unknown) | 2 (+9 unknown) | 0 (+11 unknown) | 4 | 28 |
| [#1415](https://github.com/saadshahd/roundup/pull/1415) | 1 (+0 unknown) | 2 (+24 unknown) | 8 (+20 unknown) | 7 (+21 unknown) | 18 | 65 |
| [#1411](https://github.com/saadshahd/roundup/pull/1411) | 0 (+0 unknown) | 0 (+2 unknown) | 1 (+0 unknown) | 0 (+1 unknown) | 1 | 3 |
| [#1410](https://github.com/saadshahd/roundup/pull/1410) | 0 (+0 unknown) | 0 (+4 unknown) | 2 (+0 unknown) | 0 (+2 unknown) | 2 | 6 |
| [#1407](https://github.com/saadshahd/roundup/pull/1407) | 1 (+0 unknown) | 1 (+17 unknown) | 3 (+8 unknown) | 0 (+11 unknown) | 5 | 36 |
| [#1406](https://github.com/saadshahd/roundup/pull/1406) | 1 (+0 unknown) | 0 (+3 unknown) | 1 (+1 unknown) | 1 (+1 unknown) | 3 | 5 |
| [#1405](https://github.com/saadshahd/roundup/pull/1405) | 1 (+0 unknown) | 4 (+17 unknown) | 2 (+11 unknown) | 1 (+12 unknown) | 8 | 40 |
| [#1403](https://github.com/saadshahd/roundup/pull/1403) | 1 (+0 unknown) | 2 (+11 unknown) | 4 (+12 unknown) | 0 (+16 unknown) | 7 | 39 |
| [#1402](https://github.com/saadshahd/roundup/pull/1402) | 1 (+0 unknown) | 1 (+4 unknown) | 1 (+2 unknown) | 0 (+3 unknown) | 3 | 9 |
| [#1401](https://github.com/saadshahd/roundup/pull/1401) | 1 (+0 unknown) | 0 (+7 unknown) | 2 (+10 unknown) | 2 (+10 unknown) | 5 | 27 |
| [#1400](https://github.com/saadshahd/roundup/pull/1400) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 0 (+3 unknown) | 2 | 10 |
| [#1399](https://github.com/saadshahd/roundup/pull/1399) | 1 (+0 unknown) | 4 (+36 unknown) | 4 (+17 unknown) | 4 (+17 unknown) | 13 | 70 |
| [#1398](https://github.com/saadshahd/roundup/pull/1398) | 1 (+0 unknown) | 2 (+8 unknown) | 1 (+4 unknown) | 0 (+5 unknown) | 4 | 17 |
| [#1397](https://github.com/saadshahd/roundup/pull/1397) | 1 (+0 unknown) | 2 (+8 unknown) | 1 (+5 unknown) | 0 (+6 unknown) | 4 | 19 |
| [#1394](https://github.com/saadshahd/roundup/pull/1394) | 1 (+0 unknown) | 3 (+12 unknown) | 2 (+6 unknown) | 0 (+8 unknown) | 6 | 26 |
| [#1393](https://github.com/saadshahd/roundup/pull/1393) | 1 (+0 unknown) | 0 (+7 unknown) | 1 (+3 unknown) | 0 (+4 unknown) | 2 | 14 |
| [#1391](https://github.com/saadshahd/roundup/pull/1391) | 1 (+0 unknown) | 1 (+9 unknown) | 3 (+7 unknown) | 0 (+10 unknown) | 5 | 26 |
| [#1390](https://github.com/saadshahd/roundup/pull/1390) | 1 (+0 unknown) | 1 (+10 unknown) | 1 (+4 unknown) | 0 (+5 unknown) | 3 | 19 |
| [#1389](https://github.com/saadshahd/roundup/pull/1389) | 1 (+0 unknown) | 0 (+6 unknown) | 1 (+3 unknown) | 0 (+4 unknown) | 2 | 13 |
| [#1387](https://github.com/saadshahd/roundup/pull/1387) | 1 (+0 unknown) | 2 (+9 unknown) | 1 (+5 unknown) | 0 (+6 unknown) | 4 | 20 |
| [#1384](https://github.com/saadshahd/roundup/pull/1384) | 1 (+0 unknown) | 5 (+29 unknown) | 7 (+16 unknown) | 6 (+17 unknown) | 19 | 62 |
| [#1383](https://github.com/saadshahd/roundup/pull/1383) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 0 (+3 unknown) | 2 | 10 |
| [#1382](https://github.com/saadshahd/roundup/pull/1382) | 1 (+0 unknown) | 0 (+5 unknown) | 2 (+1 unknown) | 0 (+3 unknown) | 3 | 9 |
| [#1379](https://github.com/saadshahd/roundup/pull/1379) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 1 (+2 unknown) | 3 | 9 |
| [#1377](https://github.com/saadshahd/roundup/pull/1377) | 1 (+0 unknown) | 3 (+10 unknown) | 2 (+5 unknown) | 0 (+7 unknown) | 6 | 22 |
| [#1375](https://github.com/saadshahd/roundup/pull/1375) | 1 (+0 unknown) | 1 (+7 unknown) | 1 (+3 unknown) | 0 (+4 unknown) | 3 | 14 |
| [#1373](https://github.com/saadshahd/roundup/pull/1373) | 1 (+0 unknown) | 1 (+10 unknown) | 1 (+5 unknown) | 0 (+6 unknown) | 3 | 21 |
| [#1371](https://github.com/saadshahd/roundup/pull/1371) | 1 (+0 unknown) | 0 (+7 unknown) | 1 (+3 unknown) | 0 (+4 unknown) | 2 | 14 |
| [#1367](https://github.com/saadshahd/roundup/pull/1367) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 0 (+3 unknown) | 2 | 10 |
| [#1363](https://github.com/saadshahd/roundup/pull/1363) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 0 (+3 unknown) | 2 | 10 |
| [#1360](https://github.com/saadshahd/roundup/pull/1360) | 1 (+0 unknown) | 2 (+12 unknown) | 1 (+7 unknown) | 1 (+7 unknown) | 5 | 26 |
| [#1359](https://github.com/saadshahd/roundup/pull/1359) | 1 (+0 unknown) | 1 (+8 unknown) | 1 (+4 unknown) | 0 (+5 unknown) | 3 | 17 |
| [#1358](https://github.com/saadshahd/roundup/pull/1358) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 0 (+3 unknown) | 2 | 10 |
| [#1354](https://github.com/saadshahd/roundup/pull/1354) | 1 (+0 unknown) | 0 (+8 unknown) | 1 (+4 unknown) | 0 (+5 unknown) | 2 | 17 |
| [#1352](https://github.com/saadshahd/roundup/pull/1352) | 1 (+0 unknown) | 1 (+7 unknown) | 2 (+2 unknown) | 0 (+4 unknown) | 4 | 13 |
| [#1351](https://github.com/saadshahd/roundup/pull/1351) | 1 (+0 unknown) | 0 (+3 unknown) | 2 (+0 unknown) | 0 (+2 unknown) | 3 | 5 |
| [#1349](https://github.com/saadshahd/roundup/pull/1349) | 1 (+0 unknown) | 2 (+20 unknown) | 6 (+9 unknown) | 5 (+10 unknown) | 14 | 39 |
| [#1348](https://github.com/saadshahd/roundup/pull/1348) | 1 (+0 unknown) | 2 (+9 unknown) | 1 (+4 unknown) | 0 (+5 unknown) | 4 | 18 |
| [#1347](https://github.com/saadshahd/roundup/pull/1347) | 1 (+0 unknown) | 1 (+9 unknown) | 1 (+3 unknown) | 0 (+4 unknown) | 3 | 16 |
| [#1344](https://github.com/saadshahd/roundup/pull/1344) | 1 (+0 unknown) | 1 (+5 unknown) | 1 (+1 unknown) | 0 (+2 unknown) | 3 | 8 |
| [#1342](https://github.com/saadshahd/roundup/pull/1342) | 0 (+0 unknown) | 0 (+2 unknown) | 1 (+0 unknown) | 0 (+1 unknown) | 1 | 3 |
| [#1341](https://github.com/saadshahd/roundup/pull/1341) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 0 (+3 unknown) | 2 | 10 |
| [#1340](https://github.com/saadshahd/roundup/pull/1340) | 1 (+0 unknown) | 0 (+2 unknown) | 1 (+0 unknown) | 0 (+1 unknown) | 2 | 3 |
| [#1339](https://github.com/saadshahd/roundup/pull/1339) | 1 (+0 unknown) | 0 (+5 unknown) | 2 (+1 unknown) | 0 (+3 unknown) | 3 | 9 |
| [#1335](https://github.com/saadshahd/roundup/pull/1335) | 1 (+0 unknown) | 2 (+17 unknown) | 5 (+7 unknown) | 4 (+8 unknown) | 12 | 32 |
| [#1334](https://github.com/saadshahd/roundup/pull/1334) | 1 (+0 unknown) | 0 (+12 unknown) | 2 (+5 unknown) | 0 (+7 unknown) | 3 | 24 |
| [#1333](https://github.com/saadshahd/roundup/pull/1333) | 1 (+0 unknown) | 1 (+7 unknown) | 1 (+3 unknown) | 0 (+4 unknown) | 3 | 14 |
| [#1331](https://github.com/saadshahd/roundup/pull/1331) | 0 (+0 unknown) | 1 (+5 unknown) | 1 (+3 unknown) | 1 (+3 unknown) | 3 | 11 |
| [#1330](https://github.com/saadshahd/roundup/pull/1330) | 1 (+0 unknown) | 1 (+10 unknown) | 2 (+3 unknown) | 0 (+5 unknown) | 4 | 18 |
| [#1329](https://github.com/saadshahd/roundup/pull/1329) | 1 (+0 unknown) | 1 (+7 unknown) | 1 (+4 unknown) | 0 (+5 unknown) | 3 | 16 |
| [#1325](https://github.com/saadshahd/roundup/pull/1325) | 1 (+0 unknown) | 1 (+9 unknown) | 1 (+3 unknown) | 0 (+4 unknown) | 3 | 16 |
| [#1324](https://github.com/saadshahd/roundup/pull/1324) | 1 (+0 unknown) | 1 (+8 unknown) | 1 (+4 unknown) | 0 (+5 unknown) | 3 | 17 |
| [#1323](https://github.com/saadshahd/roundup/pull/1323) | 1 (+0 unknown) | 1 (+15 unknown) | 4 (+3 unknown) | 3 (+4 unknown) | 9 | 22 |
| [#1321](https://github.com/saadshahd/roundup/pull/1321) | 1 (+0 unknown) | 0 (+5 unknown) | 1 (+2 unknown) | 1 (+2 unknown) | 3 | 9 |
| [#1318](https://github.com/saadshahd/roundup/pull/1318) | 1 (+0 unknown) | 0 (+3 unknown) | 2 (+0 unknown) | 0 (+2 unknown) | 3 | 5 |
| [#1316](https://github.com/saadshahd/roundup/pull/1316) | 1 (+0 unknown) | 1 (+9 unknown) | 2 (+4 unknown) | 0 (+6 unknown) | 4 | 19 |
| [#1314](https://github.com/saadshahd/roundup/pull/1314) | 0 (+0 unknown) | 0 (+2 unknown) | 1 (+1 unknown) | 0 (+2 unknown) | 1 | 5 |
| [#1312](https://github.com/saadshahd/roundup/pull/1312) | 1 (+0 unknown) | 0 (+3 unknown) | 3 (+0 unknown) | 2 (+1 unknown) | 6 | 4 |
| [#1311](https://github.com/saadshahd/roundup/pull/1311) | 1 (+0 unknown) | 1 (+1 unknown) | 1 (+0 unknown) | 0 (+1 unknown) | 3 | 2 |
| [#1310](https://github.com/saadshahd/roundup/pull/1310) | 1 (+0 unknown) | 2 (+6 unknown) | 1 (+3 unknown) | 0 (+4 unknown) | 4 | 13 |
| [#1309](https://github.com/saadshahd/roundup/pull/1309) | 1 (+0 unknown) | 0 (+0 unknown) | 1 (+0 unknown) | 0 (+0 unknown) | 2 | 0 |
| [#1307](https://github.com/saadshahd/roundup/pull/1307) | 1 (+0 unknown) | 0 (+0 unknown) | 1 (+0 unknown) | 0 (+0 unknown) | 2 | 0 |
| [#1306](https://github.com/saadshahd/roundup/pull/1306) | 1 (+0 unknown) | 3 (+9 unknown) | 2 (+4 unknown) | 0 (+5 unknown) | 6 | 18 |
| [#1302](https://github.com/saadshahd/roundup/pull/1302) | 1 (+0 unknown) | 1 (+4 unknown) | 2 (+1 unknown) | 0 (+3 unknown) | 4 | 8 |
| [#1301](https://github.com/saadshahd/roundup/pull/1301) | 1 (+0 unknown) | 0 (+0 unknown) | 1 (+0 unknown) | 0 (+0 unknown) | 2 | 0 |
| [#1299](https://github.com/saadshahd/roundup/pull/1299) | 1 (+0 unknown) | 5 (+23 unknown) | 5 (+7 unknown) | 5 (+7 unknown) | 16 | 37 |
| [#1298](https://github.com/saadshahd/roundup/pull/1298) | 1 (+0 unknown) | 0 (+0 unknown) | 2 (+0 unknown) | 0 (+0 unknown) | 3 | 0 |
| [#1297](https://github.com/saadshahd/roundup/pull/1297) | 1 (+0 unknown) | 0 (+0 unknown) | 1 (+0 unknown) | 1 (+0 unknown) | 3 | 0 |
| [#1296](https://github.com/saadshahd/roundup/pull/1296) | 1 (+0 unknown) | 3 (+8 unknown) | 2 (+4 unknown) | 2 (+4 unknown) | 8 | 16 |
| [#1294](https://github.com/saadshahd/roundup/pull/1294) | 1 (+0 unknown) | 1 (+0 unknown) | 1 (+0 unknown) | 0 (+0 unknown) | 3 | 0 |
| [#1280](https://github.com/saadshahd/roundup/pull/1280) | 1 (+0 unknown) | 2 (+0 unknown) | 1 (+0 unknown) | 0 (+0 unknown) | 4 | 0 |
| [#1277](https://github.com/saadshahd/roundup/pull/1277) | 1 (+0 unknown) | 1 (+0 unknown) | 2 (+0 unknown) | 1 (+0 unknown) | 5 | 0 |
| [#1276](https://github.com/saadshahd/roundup/pull/1276) | 1 (+0 unknown) | 2 (+0 unknown) | 1 (+0 unknown) | 0 (+0 unknown) | 4 | 0 |
| [#1267](https://github.com/saadshahd/roundup/pull/1267) | 1 (+0 unknown) | 8 (+30 unknown) | 4 (+12 unknown) | 1 (+15 unknown) | 14 | 57 |
| [#1246](https://github.com/saadshahd/roundup/pull/1246) | 1 (+0 unknown) | 10 (+35 unknown) | 5 (+13 unknown) | 5 (+13 unknown) | 21 | 61 |
| [#1242](https://github.com/saadshahd/roundup/pull/1242) | 1 (+0 unknown) | 4 (+9 unknown) | 1 (+6 unknown) | 1 (+6 unknown) | 7 | 21 |
| [#1234](https://github.com/saadshahd/roundup/pull/1234) | 1 (+0 unknown) | 4 (+7 unknown) | 3 (+0 unknown) | 3 (+0 unknown) | 11 | 7 |

## Retro 2026-10-12T19:48Z to 2026-10-13T19:48Z

**Value delivered.** 119 PRs merged: 53 product, 51 loop and 15 spec. 9 PRs were closed unmerged. Of those, #1453, #1413 and #1283 were closed after using all 3 fix runs (comments [#1453](https://github.com/saadshahd/roundup/pull/1453), [#1413](https://github.com/saadshahd/roundup/pull/1413), [#1283](https://github.com/saadshahd/roundup/pull/1283)). The owner closed #1463, #1461, #1459, #1408, #1372 and #1317 as evidence-only or obsolete PRs.

**Ranked causes.**

1. **Flaky tests are the largest cost.** `main`'s `check` failed 15 times, mostly on loop-only merges:
   - `web` / `check-web` failed in runs 38308071055, 38305404360, 38313209039, 38331899755, 38352522554, 38354698582 and 38358439316.
   - `rust` / `linux` failed in runs 38335427223, 38337723077, 38340562996, 38346951778 and 38330105486.
   - The latest `main` run, 38439184909 (attempt 2), failed `a32_without_handoff_archives_everything` at `crates/rup/tests/a32.rs:731`.
   - Run 38448461575 failed at 18:39–19:04 and now reads as success on re-check.
   - At least 8 PRs reached 3 fix attempts: #1456, #1453, #1413, #1405, #1399, #1394, #1377 and #1283.
   - Confirmed model time was 241,752 s over 142 fix runs. Only 109 build runs have confirmed work, at 365,317 s.
   - Open [#1504](https://github.com/saadshahd/roundup/issues/1504) and [#1516](https://github.com/saadshahd/roundup/issues/1516) already own this outcome, so I propose nothing new.

2. **Build runs ended with no PR: 15 strike comments** (build runs 38316347669, 38327508160, 38337691978, 38340304453, 38340639870, 38340997482, 38343710377, 38343984499, 38345319830, 38345715731, 38348954049, 38362170865, 38362947620, 38363583120, 38368754592). Issues #1357, #1350 and #1414 each took 2–3 strikes.
   - These were observer-only Issues that waited for 24-hour evidence.
   - The owner removed that clause and closed the Issues ([#1357](https://github.com/saadshahd/roundup/issues/1357#issuecomment-6139442435), [#1414](https://github.com/saadshahd/roundup/issues/1414#issuecomment-6140989927)).
   - The last strike was at 08:27, run 38368754592. None followed the owner's closure comments, so no new gap remains.

3. **Queue waits are not a cost.** Median waits were 1–5 s. The exceptions are the `fix` workflow, with 35 runs still queued and a max wait of 3273 s, and `care`, with a max wait of 1509 s. Open [#1290](https://github.com/saadshahd/roundup/issues/1290) and [#1289](https://github.com/saadshahd/roundup/issues/1289) cover queued and no-work runs. Of 1482 `fix` workflow runs, most are skipped triggers that did no model work.

4. **Evidence gaps.**
   - Model work is `unknown` for 2323 of 3151 runs. This count includes skipped triggers, so I do not rank it as a cause.
   - All 83 fix attempts have push status `unknown`, so I cannot say how many fix runs pushed nothing. Open [#1491](https://github.com/saadshahd/roundup/issues/1491) owns this collector.
   - `Retro` input collection and live observation are still open in [#1315](https://github.com/saadshahd/roundup/issues/1315) and [#1308](https://github.com/saadshahd/roundup/issues/1308).

**Owner comments.** The owner's closure comments (for example [#1454](https://github.com/saadshahd/roundup/issues/1454#issuecomment-6148406371), [#1396](https://github.com/saadshahd/roundup/issues/1396#issuecomment-6140990835), [#1479](https://github.com/saadshahd/roundup/issues/1479#issuecomment-6149659277)) each name a PR that fulfils them. I found no direction still missing.

**Needs-user.** #1299, #1295 and #1284 carried the label for up to 82,057 s. #1299 and #1284 were cleared ([#1299](https://github.com/saadshahd/roundup/pull/1299#issuecomment-6135164789), [#1284](https://github.com/saadshahd/roundup/issues/1284#issuecomment-6135147778)). #1295 still shows no removal in the input.

**Repairs.** None. Every evidenced cause matches an open or owner-closed Issue, and I respect those closures. I did not refresh the open/closed loop Issue search in a dedicated step, but my `gh issue list` just before returning showed no newer matching Issue.

Repairs:


Sources: the fixed input artifact holds every contributing PR, run, job and event link, with timestamps.
https://github.com/saadshahd/roundup/actions/runs/38457744271
