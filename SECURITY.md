# Security and privacy

## API keys

Never commit `.env` or paste a real `KIMI_API_KEY` into frontend code. The key is read only by the backend. If a key is accidentally committed, revoke it in Moonshot AI immediately and replace it with a new one.

## User data

Uploaded videos, recordings, transcripts, and the SQLite database live under `data/`. They may contain personal information and must not be included in bug reports or public release archives.

## Deployment scope

The current application has no authentication or per-user data isolation. It is intended for local use or a trusted private network. Do not expose the backend directly to the public internet without adding authentication, authorization, upload limits, rate limiting, and production-grade storage.

## Reporting a vulnerability

Until a private security contact is published, avoid opening a public issue that contains credentials, personal recordings, or other sensitive data. Contact the repository owner privately instead.

