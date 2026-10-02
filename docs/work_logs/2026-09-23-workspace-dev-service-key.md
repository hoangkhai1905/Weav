# Workspace internal service key — 2026-09-23

## Metadata

- Repository / branch: `Weav` / `api-gateway` (`7e14de0` at start).
- Scope: restore local Identity ↔ Workspace internal directory authentication for the Workspace members flow.
- Status: configuration fixed and runtime checks passed; authenticated Gateway `/members` request remains unverified.

## Result

- Root `.env` had one blank `IDENTITY_INTERNAL_SERVICE_KEY` declaration. The same setting is passed to Identity and Workspace by `compose.dev.yml`.
- Generated a cryptographically random, development-only key and set it on that existing `.env` line. The value is intentionally not recorded here.
- Recreated only `identity-service` and `workspace-service` with `docker compose -f compose.yml -f compose.dev.yml --profile app up -d --no-deps --force-recreate --no-build identity-service workspace-service`. No volumes or data were removed; Gateway and unrelated services were not recreated.
- `.env` is Git-ignored. No source changes, staging, or commit were made.

## Verification

| Check | Result |
|---|---|
| Key present and nonblank in both containers; values match each other and root `.env` | PASS; value not printed |
| Identity `/actuator/health/readiness` | HTTP 200 |
| Workspace `/actuator/health/readiness` | HTTP 200 |
| Identity internal directory auth probe | HTTP 200 for a batch lookup using only the all-zero UUID sentinel; empty response, no user data |
| Gateway `/ready` | HTTP 200 |
| Identity/Workspace logs after recreation | No matching internal-auth, directory dependency, or error lines |
| Authenticated Gateway `GET /api/v1/workspaces/{workspaceId}/members` | Not tested; no browser JWT was accessed |
| Unit/integration test suites | Not run; this was a local environment configuration repair |

## Handoff

- Retest the members screen/request in the browser. The backend internal directory path and Gateway readiness now pass; the exact authenticated members request still needs UI verification.
- Keep `.env` local and never commit or share its development key.
