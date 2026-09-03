---
name: craft-and-structure
description: >-
  SavignaLearn craft cluster: consistency, names, style, small units, pure
  functions, cyclomatic complexity, avoid null/boolean flags, correct constructs,
  fast independent tests, CQS, refactor often. Use after SavignaLearn code subtasks.
disable-model-invocation: true
---

# Craft and structure

- **Be consistent** with sunset tokens and existing patterns.
- **Meaningful names** over comments; short `LONG-TERM:` seam comments only.
- **Keep methods/classes/files focused** — group related code, do not micro-split under ~100 LoC.
- **Pure functions** for render/viewpoint/tokenize/birkenbihl.
- **Minimize cyclomatic complexity** — extract strategies, not nested flags.
- **Avoid null/boolean flags** — split methods; use `DisplayMode` / tagged `LearningSource`.
- **Use correct constructs** — value objects, ports, strategy for translation modes.
- **Tests fast and independent** — Vitest domain suite, no shared mutable order.
- **CQS:** `renderViewpoint` is a query; persist is a command.
- **Refactor often** / Boy Scout after each gate.
