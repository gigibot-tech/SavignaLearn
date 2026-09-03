---
name: design-classics
description: >-
  SavignaLearn classics cluster: KISS, premature optimization, composition over
  inheritance, IOSP. Use after SavignaLearn design or adapter work.
disable-model-invocation: true
---

# Design classics

- **KISS:** MVP ships empty sockets for Gigolingo, not a second Gigolingo.
- **Beware premature optimization:** no WebGPU Gemma on the send path; on-prem HTTP first.
- **Favour composition over inheritance:** Strategies for lines vs Birkenbihl; compose ports.
- **IOSP:** Integration (engine I/O) in adapters/application; Operations (split/assemble/render) in domain.
- Prefer polymorphism / strategy over flag arguments on `send()`.
- DI via factories (`createTranslationEngine`, `createChatCompletion`, `createAuthPort`).
