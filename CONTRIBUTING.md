# Contributing

OpenDev Orchestrator backend is a local-first application. The current milestone is a loopback API foundation. It is not production-ready.

## Setup

1. Use Node.js 22.5.0 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env`. The default `MONGO_URI` points at local MongoDB. Start that server before running the API.
4. Run `npm run doctor`, then `npm test`.

Do not commit `.env` or credentials.

## Checks before a pull request

```bash
npm run format:check
npm run typecheck
npm test
npm run build
```

`npm run format:fix` applies Prettier. The GitHub Actions workflow runs the same checks on Ubuntu and macOS.

## Scope

Keep the Node-Boilerplate `dev` folder layout: routes, controllers, services, middlewares, validation schemas, configs, constants, utils, and types. Product behavior belongs in new modules. Database access uses Mongoose and the local `MONGO_URI`. Do not add SQLite, bcrypt, bcryptjs, or jsonwebtoken.

Do not add agent execution, shell commands, Git mutations, model downloads, or paid cloud AI calls unless a later milestone explicitly accepts that work.

Automated tests must not open a developer's real database or require a production MongoDB server.

## Git

Branch from `development`. Open a pull request into `development` and fill in the pull request template. Leave history intact. Do not commit generated `dist/` output.
