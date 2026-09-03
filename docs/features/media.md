# Media (planned)

Gigolingo `Media` / `Block` / `Line` / shield UX lands behind `MediaCatalogPort`.

Chat excerpts can become media via `toMediaBlock` without rewriting the thread.

Deleting media later must not break chat (inverse of GigolingoConcept’s media foundation coupling).
