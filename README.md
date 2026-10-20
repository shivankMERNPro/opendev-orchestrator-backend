# opendev-orchestrator-backend

Local-first backend for OpenDev Orchestrator. It serves a loopback health check, connects to a local MongoDB database, and talks to a local Ollama daemon for model discovery and downloads. It does not run chat or agents, mutate Git repositories, or execute shell commands for product work.

This application is not production-ready.

## Prerequisites

- Node.js 22.5.0 or newer. This repository was developed on Node.js 22.20.0.
- npm, which ships with Node.js.
- Git, for the doctor check and for contributing.
- A local MongoDB server listening on `127.0.0.1:27017`.
- Ollama, if you want model discovery or downloads. The API starts when the daemon is stopped. The default daemon address is `http://127.0.0.1:11434`.

Check the daemon with a short read-only request:

```bash
curl --max-time 2 http://127.0.0.1:11434/api/version
```

A connection failure means the Ollama daemon is unavailable. Installed models can still be read from the local Ollama files under `~/.ollama/models`. Runtime status still reports the daemon as unavailable. These routes do not install Ollama, delete models, or change model files except by starting a download through the local daemon.

## Configuration

Copy the example environment file. The process loads it with `dotenv` and does not override variables that are already set:

```bash
cp .env.example .env
```

| Variable                      | Required | Default                                          | Purpose                                                                                            |
| ----------------------------- | -------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                    | No       | `development`                                    | `development`, `test`, or `production`                                                             |
| `HOST`                        | No       | `127.0.0.1`                                      | Bind address. Must be loopback                                                                     |
| `PORT`                        | No       | `3001`                                           | TCP port. `0` asks the OS for an ephemeral port                                                    |
| `MONGO_URI`                   | No       | `mongodb://127.0.0.1:27017/opendev-orchestrator` | Local MongoDB connection string                                                                    |
| `CORS_ORIGINS`                | No       | `http://127.0.0.1:5173`                          | Loopback browser origins allowed to call                                                           |
| `OLLAMA_BASE_URL`             | No       | `http://127.0.0.1:11434`                         | Local Ollama API. Must be an `http` or `https` loopback origin with no path, query, or credentials |
| `OLLAMA_MAX_CONCURRENT_PULLS` | No       | `1`                                              | Active downloads at once. Only `1` or `2`                                                          |
| `OLLAMA_REQUEST_TIMEOUT_MS`   | No       | `4000`                                           | Timeout for status, installed, and runtime calls                                                   |
| `OLLAMA_PULL_TIMEOUT_MS`      | No       | `1800000`                                        | Maximum time one download may stay open                                                            |

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

Unknown routes use the same envelope with `404` and `Resource not found`. The server binds to the configured loopback address and rejects requests whose `Host` header is not loopback. Responses omit environment variables, the Ollama address, and stack traces.

## Models

Installed models and models loaded in memory are different. Installed models are files Ollama already has. Runtime models are the ones currently loaded in memory.

| Method   | Path                         | Purpose                                          |
| -------- | ---------------------------- | ------------------------------------------------ |
| `GET`    | `/api/v1/models/status`      | `available`, `unavailable`, or `invalid`         |
| `GET`    | `/api/v1/models`             | Installed models, from the daemon or local files |
| `GET`    | `/api/v1/models/runtime`     | Models loaded in memory                          |
| `GET`    | `/api/v1/models/catalog`     | Curated identifiers, not a live catalog          |
| `GET`    | `/api/v1/models/variants`    | Parameter-size tags such as 7B, 8B, and 9B       |
| `GET`    | `/api/v1/models/capacity`    | Free disk space against a known model size       |
| `POST`   | `/api/v1/models/pull`        | Start a download and return a job id             |
| `GET`    | `/api/v1/models/pull/:jobId` | Progress for a known job                         |
| `DELETE` | `/api/v1/models/pull/:jobId` | Stop an active download                          |

`GET /api/v1/models/status` returns HTTP 200 even when Ollama is down, so the client can tell a stopped daemon from a stopped API:

```json
{
  "success": true,
  "code": 200,
  "message": "Ollama is unavailable.",
  "data": { "status": "unavailable" }
}
```

`invalid` means the daemon answered with a body this API could not use. The runtime route returns HTTP 503 with `Ollama is unavailable.` or HTTP 502 with `Ollama returned an unexpected response.` When the daemon is down, `GET /api/v1/models` returns HTTP 200 with `data.source` `local-manifest` and `data.daemon` `unavailable`. That list is built from manifest files whose model blob is present. Incomplete `*-partial` blobs are skipped. `family`, `quantization`, and `format` stay `null` in that mode. An empty `models` array is a real empty list, not an error. A daemon that is up uses `data.source` `ollama` and `data.daemon` `available`. An unexpected daemon body is still HTTP 502.

Installed model fields are `name`, `identifier`, `sizeBytes`, `family`, `families`, `parameterSize`, `quantization`, `format`, and `modifiedAt`. Missing optional details are `null`. Runtime models add `vramBytes` and `expiresAt`.

The catalog is eight known Ollama library names baked into the server. `data.source` is `curated` and `data.complete` is `false`. It does not include sizes, capabilities, or download estimates. `GET /api/v1/models/catalog?q=nomic` filters that list. A query that looks like a URL is rejected. The client never supplies a fetch URL.

`GET /api/v1/models/variants?model=qwen2.5-coder` asks `https://ollama.com/library/{name}/tags` for tags that look like `7b`, `8b`, or `9b`. Quantization tags are omitted. If that request fails, the same shape is taken from local manifests. If neither source has tags, `data.source` is `unavailable` and `variants` is empty. `installed` is true when that tag is already on disk.

`GET /api/v1/models/capacity?model=qwen2.5-coder:7b` measures free space on the disk that holds `~/.ollama/models` and reports free memory. `data.fit` is `already-installed`, `not-enough`, `enough`, or `unknown`. Model size comes from the local manifest or, when that file is absent, from `https://registry.ollama.ai`. Those two hosts are fixed in the server. A missing size leaves `fit` as `unknown` and does not invent a number. Free memory is informational. Enough disk space does not mean the model will run. Responses do not include filesystem paths.

Start a download with a model identifier. An optional `tag` is combined as `name:tag`.

```json
{ "model": "llama3.2", "tag": "latest" }
```

The response is HTTP 202 with a generated job id. The request returns immediately. Progress is read from later `GET` calls. Ollama's pull stream supplies bytes and, when both a completed count and a total are present, a percentage. If the total is missing, `progressPercent` stays `null`. This API does not invent a percentage.

A second pull for the same active identifier returns HTTP 409 and the existing job. A model that is already on disk returns HTTP 409 with `data.fit` `already-installed` and does not start a job. A known model size larger than free disk space returns HTTP 409 with `data.fit` `not-enough` and does not start a job. An unknown size is still accepted. A pull past the concurrency limit returns HTTP 429. Identifiers that contain a URL, `..`, or other unexpected characters return HTTP 400 without echoing the value.

Job states are `queued`, `downloading`, `verifying`, `completed`, `failed`, and `cancelled`. `DELETE` on an active job aborts that pull request and returns HTTP 200 with `state` `cancelled`. Aborting the request is how this API asks Ollama to stop. Files already written stay on disk. `DELETE` on a finished job returns HTTP 409. `DELETE` on an unknown id returns HTTP 404.

A failed download can be retried with a new `POST`. That creates a new job. It does not resume the old job id.

Jobs live in process memory. At most 20 finished jobs are kept. Active jobs are not dropped to make room. Restarting the backend drops the job records. The server aborts its own pull request during shutdown, but this app does not claim that Ollama stops or continues the download after that, because that behavior was not verified. Downloads use disk space and bandwidth on the machine running Ollama.

`networkedIntegrations` stays empty. Local Ollama is not reported there.

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
- `OLLAMA_BASE_URL` must be a loopback origin. Public hosts, LAN addresses, credentials, and paths are rejected before MongoDB is contacted. The browser cannot choose the upstream URL.
- Model routes do not run shell commands, delete model files, or send project data to a remote model service.
- This milestone has no project, task, agent, chat, shell, or Git mutation routes.

## Tests and CI

```bash
npm test
```

The suite covers configuration of `MONGO_URI` and `OLLAMA_BASE_URL`, the health envelope, database status without credentials, non-loopback rejection, and the model routes. Model tests use a stubbed Ollama client and a stubbed connection. They do not require a running Ollama daemon, a model download, or a production database.

GitHub Actions runs formatting, typecheck, tests, a production build, and the doctor command on Ubuntu and macOS with Node.js 22. A separate Ubuntu job starts the compiled server against a local MongoDB service and checks `GET /api/v1/health`. That workflow has not been executed from this machine.

## Current limitations

- No accounts, sessions, or request authentication.
- No projects, tasks, runs, agents, workflows, chat, model execution, Git automation, or shell execution.
- No model deletion and no manual changes to Ollama's model store.
- Download jobs are not saved in MongoDB and do not survive a backend restart.
- Cancellation is not offered, because it was not verified with the installed daemon.
- The model catalog is curated and incomplete.
- No application collections or document models.
- `networkedIntegrations` is always empty.
- Loopback HTTP is not TLS.
- One local operator is the assumed user. This is not a multi-user or hosted deployment.
