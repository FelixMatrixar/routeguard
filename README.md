# RouteGuard

> Static BOLA/IDOR detector for Node.js backends. OWASP API Security #1, caught at write-time.

**Status: In development**

## Supported stacks

| Framework | Status | | ORM | Status |
|---|---|-|---|---|
| Express | 🚧 In progress | | Prisma | 🚧 In progress |
| Fastify | 📋 Planned | | Drizzle | 📋 Planned |
| NestJS | 📋 Planned | | TypeORM | 📋 Planned |
| | | | Raw SQL | 📋 Planned |

## Development

```bash
pnpm install
pnpm build
pnpm test
```

First time setup in Bob: run `/init` to generate full project context.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for design details.
