# Deployment exposure rules

> Source: backend review 2026-10 (G1, G9, G10). Applies to any non-local deployment.

## Public surface

- Only the Cloudflare Tunnel (`cloudflared`, named tunnel `weav-demo`, `infrastructure/cloudflared/config.yml`) is
  reachable from the internet; no service publishes a port. By default it forwards to the API Gateway. Two
  path-restricted exceptions on `api.`: `^/auth/(oauth|web)/[A-Za-z0-9/_-]*$` goes to identity-service (browser
  OAuth and cookie refresh) and `^/users/me/(oauth/google/link|oauth-accounts(/[A-Za-z0-9-]+)?)$` goes to identity-service (Settings: link and unlink Google, added 2026-10-27 after the rehearsal found these calls blocked by gateway CORS) and `^/oauth/google/callback$` goes to workspace-service (Google connection callback).
  Everything else, including `/actuator/**`, goes to the gateway.
- The API Gateway port must **not** be published when it runs behind the tunnel. Set `GATEWAY_TRUST_PROXY_HOPS=1`
  so client IPs (rate limits, audit logs) come from the tunnel's `X-Forwarded-For`. With `APP_ENV=production` the
  gateway refuses to start when the value is `0`. If the gateway port were reachable directly, a client could
  forge `X-Forwarded-For` and bypass per-IP limits.
- `GET /ready/upstreams` on the gateway needs an access token with `system_role=ADMIN` (401 without a token,
  403 for other roles). `/health` and `/ready` stay public for the proxy and orchestrator.

## Internal services

- Never publish the Spring service ports (identity, workspace, workflow) or the NestJS internal services outside
  the private network. Their `/actuator/health` and `/actuator/prometheus` endpoints are `permitAll` on purpose so
  the scraper and orchestrator can reach them without a token; that is only safe while the ports are private.
- `compose.dev.yml` binds the Spring ports to `127.0.0.1` for local debugging. A production compose file must not
  add `ports:` for them.
- Actuator health returns only the status (`management.endpoint.health.show-details=never`) in identity,
  workspace and workflow, so a misrouted request cannot read dependency details.
