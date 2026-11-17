@AGENTS.md

# Claude Code specifics

- Start by reading `docs/system-design.md` (architecture + API) and `docs/plan.md` (what is done / what is next).
- Use plan mode for anything touching auth, the database schema, or `lookup.js`.
- After editing front-end files, verify in a browser at 390px wide; screenshots are the proof for UI work.
- Prefer `Edit` on existing files over new files; this codebase is intentionally small (≈1k lines).
- Before finishing a task, run `npm test` and report the result honestly (including anything you could not test, e.g. a real card scan).
- Language: code and comments in English; UI strings in Egyptian-friendly Modern Standard Arabic, short and imperative.
