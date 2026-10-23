---
name: request-grok-image
description: Requests an image from Grok Bot (UI mock, diagram, test asset) and waits for the PNG to appear in the worktree. Use when an agent needs a generated image during implementation. Do not use for product catalog images or runtime features.
---

# Request Grok image

Harness tooling. The image is delivered as a **file on disk** at the `output_path` of the request. Do not use `orca orchestration send` or terminal send to deliver or receive it.

## Steps

1. From inside your worktree, run this single block (each tool call may start a fresh shell, so keep it in one call). It requests the image, stops if the request is rejected, polls every 5 s for ~2 min (inside the default 120 s Bash timeout; for longer waits, raise the tool timeout or run it in the background) and prints the `request_id` on timeout:

   ```bash
   out="$(scripts/request-grok-image.sh "Login screen mock, white background, one email field and a blue button")" || exit 1
   id="$(jq -r .request_id <<<"$out")"; path="$(jq -r .output_path <<<"$out")"
   for _ in $(seq 23); do [ -s "$path" ] && break; sleep 5; done
   [ -s "$path" ] && echo "ready: $path" || { echo "timeout: request_id=$id path=$path" >&2; exit 1; }
   ```

   Optional: `--output <absolute path under the worktree ending in .png>` before the description. The script prints one JSON line `{"request_id","output_path"}` and exits non-zero if env is missing, the POST fails or the ack is not ok; report that failure, do not retry blindly.

2. If the file is ready (size > 0), use it. On timeout, report the failure including the `request_id`.

`.grok-inbox/` is gitignored. Do not commit generated images unless explicitly asked.

## Contract

Request: `POST $GROK_BOT_IMAGE_WEBHOOK_URL`, `Content-Type: application/json`, `Authorization: Bearer $GROK_BOT_IMAGE_WEBHOOK_SECRET`:

```json
{ "request_id": "<uuid>", "output_path": "/abs/worktree/.grok-inbox/<uuid>.png", "prompt": "<template>\n\n<description>", "format": "png" }
```

Ack (2xx): `{ "ok": true, "request_id": "<uuid>", "accepted": true }`. Errors: 4xx/5xx or `{ "ok": false, "error": "..." }`. The PNG arrives later, written by Grok Bot at `output_path`. Grok Bot should write atomically (temp file + rename) so size > 0 means complete.

## Config

`GROK_BOT_IMAGE_WEBHOOK_URL` and `GROK_BOT_IMAGE_WEBHOOK_SECRET`, from the environment (wins) or from `~/.config/yoyos/grok-image.env` (template: `scripts/grok-image.env.example`; `GROK_IMAGE_ENV_FILE` overrides the path). Never print or commit the secret.
