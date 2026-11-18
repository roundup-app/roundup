---
name: scenario-first
description: Use when planning, building or reproducing a roundup work item - find the scenario that holds its acceptance, or write it first.
---

No scenario, no work. Acceptance lives in `scenarios/*.md` on `main`, never in the item.

## Find it

- The item names scenario ids (`U83`, `L116`, `U2176a`). Each heads a `**<id> <name>.**` clause in `scenarios/`; its then-clauses are the acceptance.
- No id, or an id `main` lacks: the change writes the scenario first, then its tests and code.
- The item orders a change that a scenario on `main` contradicts: edit that scenario and its code in the same change. Never loosen acceptance only to fit the code.

## Write it

- A new id is `<area letter><item id><lowercase letter>` (`U2176a`), taking the first letter no heading in `scenarios/` holds. Never rename an existing id.
- Each id gets a `**<id> <name>.**` heading.
- Every then-clause names the test that will assert it, or is marked policy.
- Every check cites its file and the function, test or heading that holds it on `main`, never a line number. Every cited id, file and pull request exists on `origin/main`.
- A script gets one row per failure, with its exit code.
- The text states the result, never the incident.
- Write each then-clause so anyone applies it the same way (`anchor`).
- A new domain word goes in `GLOSSARY.md`; no public name uses one of its _Avoid_ words (`AGENTS.md` rule 6).

## Size

One change fits one module directory and about 2000 changed lines (rule 3). An API change and all its callers stay one change. A larger item splits; each part names its scenario ids.
