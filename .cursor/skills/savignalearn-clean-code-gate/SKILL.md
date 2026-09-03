---
name: savignalearn-clean-code-gate
description: >-
  After every SavignaLearn component or feature subtask, run Clean Code checks
  including Gigolingo seam integrity. Use when implementing SavignaLearn chat,
  adapters, domain, UI, or refactoring; triggers on subtask complete, PR, feature.
---

# SavignaLearn Clean Code Gate

Run **after each subtask** before starting the next. Fix findings first.

## Checklist

1. **Gigolingo seam intact?** Can vocab / media / tap / card gen attach via a new adapter or feature folder without editing this file? Chat must not import `features/media`.
2. **File grouping:** Prefer cohesive modules (~100+ LoC). Avoid micro-files unless a true boundary (screen, migration, skill).
3. **Boy Scout:** Leave the touched area cleaner than found.
4. **Root cause:** Fix the cause, not a symptom patch.
5. **Smells:** No rigidity, fragility, immobility, needless complexity/repetition, opacity.
6. Apply clustered principle skills (read if needed):
   - `architecture-principles` — cohesion, coupling, SoC, interfaces, reuse, testability, modularity, interoperability
   - `design-classics` — KISS, premature optimization, FCoI, IOSP
   - `craft-and-structure` — names, style, small units, pure functions, complexity, nulls/flags, framework distance, constructs, tests, organize-by-actor, CQS, refactor often

## Output

Brief pass/fail list. Block next subtask on fail.
