---
name: request-grok-image
description: Requests an image from Grok Bot (UI mock, diagram, test asset) and waits for the PNG to appear in the worktree. Use when an agent needs a generated image during implementation. Do not use for product catalog images or runtime features.
---

# Request Grok image

Harness tooling. The image is delivered as a **file on disk** at the `output_path` of the request. Do not use `orca orchestration send` or terminal send to deliver or receive it.

## Steps

1. From inside your worktree, run the script with a short description (optionally `--output <absolute path under the worktree>`):

   ```bash
   out="$(scripts/request-grok-image.sh "Login screen mock, white background, one email field and a blue button")"
   ```

   It prints one JSON line `{"request_id","output_path"}` and exits non-zero if env is missing, the POST fails or the ack is not ok. Report that failure; do not retry blindly.

2. Poll the file every ~5-10 s, up to ~3 min:

   ```bash
   path="$(jq -r .output_path <<<"$out")"
   for _ in $(seq 36); do [ -s "$path" ] && break; sleep 5; done
   [ -s "$path" ] && echo "ready: $path" || echo "timeout, no image"
   ```

3. If the file exists with size > 0, use it. Otherwise report the failure including the `request_id`.

`.grok-inbox/` is gitignored. Do not commit generated images unless explicitly asked.

## Contract

Request: `POST $GROK_BOT_IMAGE_WEBHOOK_URL`, `Content-Type: application/json`, `Authorization: Bearer $GROK_BOT_IMAGE_WEBHOOK_SECRET`:

```json
{ "request_id": "<uuid>", "output_path": "/abs/worktree/.grok-inbox/<uuid>.png", "prompt": "<template>\n\n<description>", "format": "png" }
```

Ack (2xx): `{ "ok": true, "request_id": "<uuid>", "accepted": true }`. Errors: 4xx/5xx or `{ "ok": false, "error": "..." }`. The PNG arrives later, written by Grok Bot at `output_path`.

## Config

`GROK_BOT_IMAGE_WEBHOOK_URL` and `GROK_BOT_IMAGE_WEBHOOK_SECRET`, from the environment or from `~/.config/yoyos/grok-image.env` (template: `scripts/grok-image.env.example`; `GROK_IMAGE_ENV_FILE` overrides the path). Never print or commit the secret.
