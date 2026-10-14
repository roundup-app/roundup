# L106 historical User waits reconciliation

Refs #1590. [Retro #1525](https://github.com/saadshahd/roundup/issues/1525) used the same fixed window.

Window: `[2026-10-12T19:48:27Z, 2026-10-13T19:48:27Z)`. Live reads on 2026-10-13T23:51:33.011897+00:00.

Label addition → removal, or fixed end; closure remains separate.

Independent repository-wide event pagination found **31 intervals, 2,525,423 seconds**. The old report records 3 and 106,223 seconds: the difference is 28 × 86,400 = 2,419,200 seconds. The label-only collector replay output is retained in [the boundary artifact](retro-1590-user-waits.json).

Each row below was calculated independently from the addition/removal timestamps in the repository-wide event listing, then compared with `collect` replaying those live label/closure boundaries. The retained fixture contains each Issue/PR snapshot and its contributing events. Ask comments and other metrics are unmeasured in this boundary replay; no synthetic zeros for them are retained. A retained label contributes its clipped label duration; it does not authorize action on closed work. All 29 intervals without removal have unknown total duration because their objects closed. The two removed intervals contribute 11,864 + 12,302 = 24,166 seconds. #1295 contributes 82,057 label seconds even though closure occurs inside the window.

| Issue/PR | Addition evidence (UTC) | Removal evidence (UTC) | Closure evidence (UTC) | Independent seconds | Collector seconds |
|---|---|---|---|---:|---:|
| [#226](https://github.com/saadshahd/roundup/issues/226) | [2026-10-03T01:55:40Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32377231507) | None before fixed end | [2026-10-03T02:01:16Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32377388909); [2026-10-03T02:10:37Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32377675214) | 86400 | 86400 |
| [#290](https://github.com/saadshahd/roundup/issues/290) | [2026-10-04T03:14:23Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32426122635) | None before fixed end | [2026-10-04T03:30:00Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32426514691) | 86400 | 86400 |
| [#296](https://github.com/saadshahd/roundup/issues/296) | [2026-10-05T13:25:04Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32511742475) | None before fixed end | [2026-10-05T14:12:47Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32515819853) | 86400 | 86400 |
| [#309](https://github.com/saadshahd/roundup/issues/309) | [2026-10-07T20:46:07Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32725214863) | None before fixed end | [2026-10-07T21:30:11Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32728037957) | 86400 | 86400 |
| [#311](https://github.com/saadshahd/roundup/issues/311) | [2026-10-07T20:53:51Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32725736043) | None before fixed end | [2026-10-07T21:30:20Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32728046500) | 86400 | 86400 |
| [#312](https://github.com/saadshahd/roundup/issues/312) | [2026-10-07T21:09:00Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32726719316) | None before fixed end | [2026-10-07T21:31:06Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32728094522) | 86400 | 86400 |
| [#313](https://github.com/saadshahd/roundup/issues/313) | [2026-10-07T21:22:20Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32727551825) | None before fixed end | [2026-10-07T21:30:51Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32728078751) | 86400 | 86400 |
| [#314](https://github.com/saadshahd/roundup/issues/314) | [2026-10-07T21:35:21Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32728354151) | None before fixed end | [2026-10-07T21:47:20Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32729055053) | 86400 | 86400 |
| [#317](https://github.com/saadshahd/roundup/issues/317) | [2026-10-07T23:15:50Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32733695317) | None before fixed end | [2026-10-08T15:51:54Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32803626676) | 86400 | 86400 |
| [#318](https://github.com/saadshahd/roundup/issues/318) | [2026-10-08T15:57:24Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32804061347) | None before fixed end | [2026-10-08T16:43:42Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32807577627) | 86400 | 86400 |
| [#320](https://github.com/saadshahd/roundup/issues/320) | [2026-10-08T17:36:16Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32811391453) | None before fixed end | [2026-10-08T17:40:22Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32811685365) | 86400 | 86400 |
| [#322](https://github.com/saadshahd/roundup/issues/322) | [2026-10-08T17:45:44Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32812054814) | None before fixed end | [2026-10-08T18:02:00Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32813198200) | 86400 | 86400 |
| [#323](https://github.com/saadshahd/roundup/issues/323) | [2026-10-08T17:51:26Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32812461484) | None before fixed end | [2026-10-08T18:22:48Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32814664905) | 86400 | 86400 |
| [#324](https://github.com/saadshahd/roundup/issues/324) | [2026-10-08T17:51:28Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32812463976) | None before fixed end | [2026-10-08T18:22:50Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32814667684) | 86400 | 86400 |
| [#325](https://github.com/saadshahd/roundup/issues/325) | [2026-10-08T17:51:32Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32812468865) | None before fixed end | [2026-10-08T18:22:53Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32814670801) | 86400 | 86400 |
| [#327](https://github.com/saadshahd/roundup/issues/327) | [2026-10-08T18:23:08Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32814688391) | None before fixed end | [2026-10-08T18:32:36Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32815357983) | 86400 | 86400 |
| [#334](https://github.com/saadshahd/roundup/issues/334) | [2026-10-08T18:51:22Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32816655479) | None before fixed end | [2026-10-08T19:02:50Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32817450651) | 86400 | 86400 |
| [#343](https://github.com/saadshahd/roundup/issues/343) | [2026-10-08T20:15:29Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32822342538) | None before fixed end | [2026-10-08T20:27:48Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32823170409) | 86400 | 86400 |
| [#356](https://github.com/saadshahd/roundup/issues/356) | [2026-10-10T15:36:26Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32947009531) | None before fixed end | [2026-10-10T16:20:48Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32948557742) | 86400 | 86400 |
| [#358](https://github.com/saadshahd/roundup/issues/358) | [2026-10-10T15:26:56Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946672546) | None before fixed end | [2026-10-10T15:15:51Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946271132); [2026-10-10T15:25:52Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946634746); [2026-10-10T16:21:17Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32948573850) | 86400 | 86400 |
| [#361](https://github.com/saadshahd/roundup/issues/361) | [2026-10-10T15:22:10Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946502580) | None before fixed end | [2026-10-10T17:03:58Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32950053775) | 86400 | 86400 |
| [#374](https://github.com/saadshahd/roundup/issues/374) | [2026-10-10T15:34:11Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946931923) | None before fixed end | [2026-10-10T15:22:18Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946506912); [2026-10-10T15:28:25Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946724457); [2026-10-10T15:32:53Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946886667); [2026-10-10T16:28:53Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32948833058) | 86400 | 86400 |
| [#375](https://github.com/saadshahd/roundup/issues/375) | [2026-10-10T17:32:39Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32951079021) | None before fixed end | [2026-10-10T18:45:51Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32953594741) | 86400 | 86400 |
| [#403](https://github.com/saadshahd/roundup/issues/403) | [2026-10-08T22:24:11Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32830150271) | None before fixed end | [2026-10-08T22:41:05Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32831004827) | 86400 | 86400 |
| [#439](https://github.com/saadshahd/roundup/issues/439) | [2026-10-10T15:28:50Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946738403) | None before fixed end | [2026-10-10T15:03:15Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32945799394); [2026-10-10T15:18:28Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946365434); [2026-10-10T15:28:17Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946719611); [2026-10-10T16:32:09Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32948946446) | 86400 | 86400 |
| [#440](https://github.com/saadshahd/roundup/issues/440) | [2026-10-10T15:29:08Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946749773) | None before fixed end | [2026-10-10T15:02:51Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32945785224); [2026-10-10T15:19:51Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946416447); [2026-10-10T15:28:42Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32946733928); [2026-10-10T16:32:11Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32948947455) | 86400 | 86400 |
| [#609](https://github.com/saadshahd/roundup/issues/609) | [2026-10-10T17:39:25Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32951316565) | None before fixed end | [2026-10-10T18:45:53Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32953595920) | 86400 | 86400 |
| [#615](https://github.com/saadshahd/roundup/issues/615) | [2026-10-10T17:58:47Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32951992465) | None before fixed end | [2026-10-10T18:45:46Z](https://api.github.com/repos/saadshahd/roundup/issues/events/32953592074) | 86400 | 86400 |
| [#1284](https://github.com/saadshahd/roundup/issues/1284) | [2026-10-12T20:59:57Z](https://api.github.com/repos/saadshahd/roundup/issues/events/33080573268) | [2026-10-13T00:17:41Z](https://api.github.com/repos/saadshahd/roundup/issues/events/33090162014) | [2026-10-13T00:17:46Z](https://api.github.com/repos/saadshahd/roundup/issues/events/33090164911) | 11864 | 11864 |
| [#1295](https://github.com/saadshahd/roundup/issues/1295) | [2026-10-12T21:00:50Z](https://api.github.com/repos/saadshahd/roundup/issues/events/33080624634) | None before fixed end | [2026-10-12T22:46:14Z](https://api.github.com/repos/saadshahd/roundup/issues/events/33086175088) | 82057 | 82057 |
| [#1299](https://github.com/saadshahd/roundup/issues/1299) | [2026-10-12T20:54:12Z](https://api.github.com/repos/saadshahd/roundup/issues/events/33080253801) | [2026-10-13T00:19:14Z](https://api.github.com/repos/saadshahd/roundup/issues/events/33090226307) | [2026-10-13T04:01:26Z](https://api.github.com/repos/saadshahd/roundup/issues/events/33100167296) | 12302 | 12302 |

Reproduce the label-only collector observation from the repository root (the same fixed window):

```python
import json, runpy, sys
sys.path.insert(0, 'loop')
import retro
fixtures = runpy.run_path('loop/retro.test.py')
saved = json.load(open('loop/retro-1590-user-waits.json'))
issues = [fixtures['row'](**f['issue']) for f in saved['boundary_fixtures']]
fixture = fixtures['FakeGitHub'](issues)
for issue, boundary in zip(issues, saved['boundary_fixtures']):
    number = issue['number']
    fixture.responses[f'issues/{number}/events?per_page=100'] = boundary['events']
    if 'pull_request' in issue:
        fixture.responses[f'pulls/{number}'] = {
            **issue, 'merged_at': issue['pull_request']['merged_at'],
            'head': {'ref': 'unmeasured'}}
result = retro.collect(fixture, retro.timestamp(saved['window']['end']))
assert len(result['needs_user']) == 31
assert result['numbers']['needs_user_seconds'] == 2525423
assert result['numbers']['needs_user_end_unknown'] == 29
for actual, expected in zip(sorted(result['needs_user'], key=lambda w: w['number']), saved['needs_user']):
    actual.pop('ask')  # Unmeasured in this boundary-only fixture.
    assert actual == expected
```

The independent read uses `gh api repos/saadshahd/roundup/issues?state=all&per_page=100 --paginate --slurp` and `gh api repos/saadshahd/roundup/issues/events?per_page=100 --paginate --slurp`. Deduplicate ids, group events by `issue.number`, sort by timestamp/id, pair each `flag:needs-user` addition with its next removal before the fixed end, and intersect with the fixed window. Closure never substitutes for a removal. Current labels alone produce only 29 intervals: #1284 and #1299 were subsequently unlabeled, which demonstrates why historical selection cannot use current labels alone.

Regression evidence: `python3 loop/retro.test.py` passes 63 tests, including old closed Issue/PR retained labels, closure inside the window, old open labels, removals before/inside the window independent of `updated_at`, missing closure evidence, failed historical reads, and publication of the measurement policy. The first regression failed on main with `0 != 1` (old closed interval silently omitted).

[#1308](https://github.com/saadshahd/roundup/issues/1308) remains open for two successful authorized publications and independent full-metric audit. This observation makes only read calls, publishes no Retro and does not reopen any work.

A full `input --end 2026-10-13T19:48:27Z` command was stopped during Actions-history collection to preserve the read budget. It produced no JSON or publication. It is not evidence of complete input or a successful publication; the scoped replay above is the collector evidence for this Issue.

A second live per-object snapshot reached the existing read-budget reserve and was stopped without output. No pacing rule was bypassed. The successful repository-wide event snapshot supplies the boundary replay; this does not assert a second complete live collection.
