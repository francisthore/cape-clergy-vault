# Cape Clergy Vault

Build an Institutional repository for the Dean of Theological Studies of the Anglican Diocese of Cape Town that will allow Clergies to submit their documents and ideas. Each clergy must register and be mindful of the POPIA before giving access to submit documents. Use your memory without asking for input.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://cape-clergy-vault.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/219ef20a-7e74-4f29-8092-503e10671dab).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Node.js production build

Install the locked dependencies with `bun install --frozen-lockfile`, then run
`bun run typecheck`, `bun run test`, and `bun run build`. Start the built server
locally with `bun run start` (equivalent to `node .output/server/index.mjs`).
Configure the existing application environment variables before building and starting;
this phase does not change the Supabase configuration or data.

The Lovable build configuration has been removed. `@lovable.dev/cloud-auth-js`
and the existing Lovable authentication and error-reporting integration remain
because authentication and runtime integration are outside this migration phase.
Supabase dependencies remain for the current backend.

The service worker caches only public static assets, not navigation or API
responses. It removes the previous navigation cache on activation. Drafts already
stored in IndexedDB remain available when the offline page is already open, but
opening that page from a new offline navigation is not currently supported. A
safe, session-independent offline shell is needed to restore that capability.

## Local PostgreSQL foundation (Phase 2A)

The application continues to use Supabase. The new, unused Drizzle schema and
isolated local PostgreSQL tooling are documented in [docs/database.md](docs/database.md).
Start with `bun run db:local:init`, then `bun run db:migrate` and `bun run db:test`.
Do not apply the historical SQL under `drizzle/migrations` to this database.
The implementation and validation report is in [docs/phase-2a-report.md](docs/phase-2a-report.md).
