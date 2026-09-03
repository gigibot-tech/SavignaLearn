---
name: architecture-principles
description: >-
  SavignaLearn architecture Clean Code cluster: high cohesion, low coupling,
  SoC, interface-based design, reusability, testability, modularity,
  interoperability. Use after SavignaLearn subtasks or architecture reviews.
disable-model-invocation: true
---

# Architecture principles

After a SavignaLearn subtask:

- **High cohesion / organize by actor:** chat thread ≠ learning items ≠ media.
- **Low coupling / LoD:** bubbles do not know SM-2, playlists, Firebase internals.
- **SoC / keep framework distant:** domain has no React/Supabase imports.
- **Interface-based / ISP:** use ports in `ports/ports.ts`; do not widen to god interfaces.
- **Reusability / interoperability:** `LearningItem` matches Gigolingo `Word` fields; mappers at boundary.
- **Testability:** fake ports in unit tests; no network in `domain/`.
- **Modularity / ease of replace:** adapters swappable (echo ↔ Gemma ↔ fourSome) without UI edits.
- **Independent components:** parallel work on translation vs chat UI without merge wars.
