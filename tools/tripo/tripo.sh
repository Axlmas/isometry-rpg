#!/usr/bin/env bash
# Minimal client for the Tripo 3D API (v3): create tasks, wait for them, download results.
#
# Auth: in the cloud environment the network proxy injects the API key into requests to
# the API host. Elsewhere, export TRIPO_API_KEY and it is sent as a Bearer token.
#
# Usage:
#   tripo.sh balance
#   tripo.sh post <endpoint> <json>     # e.g. post generation/text-to-image '{"prompt":"..."}'
#   tripo.sh get <task_id>
#   tripo.sh wait <task_id>             # polls until the task ends, prints the final task JSON
#   tripo.sh run <endpoint> <json>      # post + wait, prints the final task JSON
#   tripo.sh fetch <url> <out_file>
#
# Every created task is appended to tools/tripo/tasks.jsonl (endpoint, body, task id),
# so each asset can be traced back to the request that produced it.
set -euo pipefail

BASE="${TRIPO_BASE_URL:-https://openapi.tripo3d.ai/v3}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="$HERE/tasks.jsonl"

auth=()
if [[ -n "${TRIPO_API_KEY:-}" ]]; then auth=(-H "Authorization: Bearer $TRIPO_API_KEY"); fi

api() { # method path [json]
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -m 60 -X "$method" "${auth[@]}" -H 'Content-Type: application/json' --data "$body" "$BASE/$path"
  else
    curl -sS -m 60 -X "$method" "${auth[@]}" "$BASE/$path"
  fi
}

post() {
  local endpoint="$1" body="$2" resp id code
  # Each task category has a small concurrency pool (image generation: 1 at a time).
  # A full pool answers with code 2000; wait and retry instead of failing.
  for _ in $(seq 1 120); do
    resp="$(api POST "$endpoint" "$body")"
    code="$(jq -r '.code // empty' <<<"$resp" 2>/dev/null || true)"
    [[ "$code" == 2000 || "$code" == 1007 ]] || break
    sleep 10
  done
  id="$(jq -r '.data.task_id // empty' <<<"$resp")"
  if [[ -z "$id" ]]; then echo "create failed: $resp" >&2; exit 1; fi
  jq -cn --arg e "$endpoint" --argjson b "$body" --arg id "$id" --arg t "$(date -u +%FT%TZ)" \
    '{time:$t, endpoint:$e, task_id:$id, body:$b}' >>"$LOG"
  echo "$id"
}

wait_task() {
  local id="$1" resp status
  for _ in $(seq 1 360); do
    resp="$(api GET "tasks/$id" || true)"
    status="$(jq -r '.data.status // "unknown"' <<<"$resp" 2>/dev/null || echo unknown)"
    case "$status" in
      success|failed|cancelled|banned|expired) echo "$resp"; [[ "$status" == success ]]; return;;
    esac
    sleep 5
  done
  echo "timeout waiting for $id: $resp" >&2; return 1
}

cmd="${1:-}"; shift || true
case "$cmd" in
  balance) api GET account/balance; echo;;
  post) post "$1" "$2";;
  get) api GET "tasks/$1"; echo;;
  wait) wait_task "$1";;
  run) id="$(post "$1" "$2")"; echo "task $id" >&2; wait_task "$id";;
  fetch) curl -sS -m 300 -L -o "$2" "$1"; ls -l "$2" >&2;;
  *) sed -n '2,17p' "$0"; exit 1;;
esac
