# opendev-orchestrator-backend

Local-first backend foundation for OpenDev Orchestrator. This milestone serves a loopback health check and connects to a local MongoDB database. It does not run agents, call models, mutate Git repositories, or execute shell commands for product work.

This application is not production-ready.

## Prerequisites

- Node.js 22.5.0 or newer. This repository was developed on Node.js 22.20.0.
- npm, which ships with Node.js.
- Git, for the doctor check and for contributing.
- A local MongoDB server listening on `127.0.0.1:27017`.
- Ollama is optional. The API starts when the Ollama daemon is stopped.

## Configuration

Copy the example environment file. The process loads it with `dotenv` and does not override variables that are already set:

```bash
cp .env.example .env
```

| Variable       | Required | Default                                          | Purpose                                         |
| -------------- | -------- | ------------------------------------------------ | ----------------------------------------------- |
| `NODE_ENV`     | No       | `development`                                    | `development`, `test`, or `production`          |
| `HOST`         | No       | `127.0.0.1`                                      | Bind address. Must be loopback                  |
| `PORT`         | No       | `3001`                                           | TCP port. `0` asks the OS for an ephemeral port |
| `MONGO_URI`    | No       | `mongodb://127.0.0.1:27017/opendev-orchestrator` | Local MongoDB connection string                 |
| `CORS_ORIGINS` | No       | `http://127.0.0.1:5173`                          | Loopback browser origins allowed to call        |

A blank `MONGO_URI` uses the default local database. A set value must be a `mongodb://` URL whose host is loopback (`127.0.0.0/8`, `localhost`, or `::1`) and whose path names a database. `mongodb+srv://` and remote hosts are rejected. `CORS_ORIGINS` must be a comma-separated list of `http` or `https` loopback origins. `*` and public hosts are rejected. Startup fails before MongoDB is contacted when configuration is invalid or the database cannot be reached.

Error text does not include the connection string, usernames, or passwords. Tests do not load `.env` and do not open the configured database.

Allowed bind addresses are the IPv4 loopback range `127.0.0.0/8`, `::1`, and `localhost`. Any other `HOST`, including `0.0.0.0`, stops startup before MongoDB is contacted.

## Commands

```bash
npm install
npm run doctor
npm run dev
npm test
npm run typecheck
npm run format:check
npm run build
npm start
```

`npm run dev` reloads `src/server.ts`. `npm start` runs the compiled `dist/server.js` from `npm run build`. `npm run format:fix` rewrites formatting locally.

Start MongoDB locally before `npm run dev` or `npm start`. The process connects and pings the database before it accepts requests.

## HTTP

`GET /api/v1/health` returns `200` and this envelope when the database is connected:

```json
{
  "success": true,
  "code": 200,
  "message": "Success",
  "data": {
    "status": "ok",
    "apiVersion": "v1",
    "schemaVersion": 0,
    "database": "connected",
    "networkedIntegrations": []
  }
}
```

`schemaVersion` stays `0` because this milestone does not create application collections. `apiVersion` and `schemaVersion` are included so a local client can confirm the health contract. If MongoDB disconnects after startup, the same route returns HTTP `503` with `success: false`, `data.status: "unavailable"`, and `data.database: "disconnected"`. The body never includes `MONGO_URI` or credentials.

Unknown routes use the same envelope with `404` and `Resource not found`. The server binds to the configured loopback address and rejects requests whose `Host` header is not loopback. Responses omit environment variables and stack traces.

## Database

- Access goes through Mongoose.
- The default database is the local database `opendev-orchestrator`.
- The server connects with `directConnection` so the driver stays on the configured host.
- A `ping` confirms the connection before the HTTP server listens.
- No domain collections, schemas, or application documents are created.
- The doctor command validates `MONGO_URI` and does not connect.

## Doctor

`npm run doctor` is read-only. It checks:

- Node.js is 22.5.0 or newer.
- `git --version` succeeds.
- Configuration is valid for a loopback startup, including the local MongoDB URL.

It does not install packages, download models, call Ollama, start MongoDB, or modify the checkout. The command exits `1` when Node, Git, or configuration fails.

## Security restrictions

- The default bind address is `127.0.0.1`. Non-loopback binds are refused before MongoDB is contacted.
- `MONGO_URI` must point at a loopback MongoDB host.
- Browser CORS allows only the configured loopback origins. The default is `http://127.0.0.1:5173`. A public origin is rejected before MongoDB is contacted, and `*` is not accepted.
- There is no authentication. Any program on this machine can call the port. Do not publish it.
- `trust proxy` is disabled. `Host` must be a loopback name.
- Helmet sets baseline response headers.
- JSON bodies are limited to 100 KB.
- This milestone has no project, task, agent, shell, or Git mutation routes.

## Tests and CI

```bash
npm test
```

The suite covers configuration of `MONGO_URI`, the health envelope, database status without credentials, and non-loopback rejection before a connection attempt. Those tests use a stubbed connection. They do not require a running or production database.

GitHub Actions runs formatting, typecheck, tests, a production build, and the doctor command on Ubuntu and macOS with Node.js 22. A separate Ubuntu job starts the compiled server against a local MongoDB service and checks `GET /api/v1/health`. That workflow has not been executed from this machine.

## Current limitations

- No accounts, sessions, or request authentication.
- No projects, tasks, runs, agents, workflows, model execution, Git automation, or shell execution.
- No application collections or document models.
- `networkedIntegrations` is always empty.
- Loopback HTTP is not TLS.
- One local operator is the assumed user. This is not a multi-user or hosted deployment.
