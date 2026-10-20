# Security

OpenDev Orchestrator backend is a local development tool. This milestone is not production-ready and has no authentication.

## Supported use

Run the server on loopback for one operator. The default bind is `127.0.0.1`. The process refuses other bind addresses before it contacts MongoDB. `MONGO_URI` must use a loopback host. `OLLAMA_BASE_URL` must be a loopback origin, and model routes will not fetch a URL supplied by the client. Parameter tags and manifest sizes, when requested, use only `https://ollama.com` and `https://registry.ollama.ai`. Local model discovery reads Ollama manifest files and checks that the model blob exists. It does not read keys or history. Browser CORS is limited to configured loopback origins. Do not commit `.env` or put credentials, connection strings, or raw Ollama errors in logs or responses.

## Current limitations

- Any local process can call the API. Do not forward the port or bind a public address.
- Traffic is plain HTTP on loopback. There is no TLS.
- A `Host` header check blocks obvious non-loopback names. It is not a complete browser security model.
- Error responses hide stack traces and connection strings.
- Dependencies are not a guarantee against supply-chain risk. Review lockfile changes.

## Reporting a vulnerability

Open a private security advisory on this GitHub repository, or email the maintainer if advisories are unavailable. Do not include live secrets, database files, or access tokens in the report. Describe the impact and a way to reproduce it against a local checkout.

Please give the maintainer time to reproduce the issue before discussing it publicly.
