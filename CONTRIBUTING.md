# Contributing

Thanks for helping. A few rules keep the project trustworthy.

## Setup

Follow the Quick start in the README, then run `npm run doctor` until it is all green.

## Before opening a pull request

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

CI runs the same four gates on every push and pull request.

## Ground rules

- **Every number shown to a user must trace to a `facts` row.** New metrics go through `scripts/facts/compute.mjs` and get an entry in `scripts/facts/registry.mjs` (the health-visibility test fails otherwise).
- **No silent failures.** If something falls back or degrades, log why and surface it (see `fallback_reason` in `/api/analyze-decision`).
- **Migrations are append-only.** Add a new numbered file; never edit one that has shipped. State what it changes and why at the top. Anything callable through the API needs explicit `revoke`/`grant` (anon must not get access by default).
- **Never commit secrets.** `.env.local` is git-ignored; `.env.example` holds names only.
- Tests live in `tests/unit/` (`node --test`, TypeScript sources run directly) and `scripts/facts/test-*.mjs`.

## Reporting security issues

Please do not open a public issue for a vulnerability. Contact the maintainer privately through GitHub.
