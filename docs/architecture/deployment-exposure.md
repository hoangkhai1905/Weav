# Deployment exposure rules

> Source: backend review 2026-10 (G1, G9, G10). Applies to any non-local deployment.

## Public surface

- Only the reverse proxy (Caddy) is published to the internet. It forwards to the API Gateway.
- The API Gateway port must **not** be published when it runs behind Caddy. Set `GATEWAY_TRUST_PROXY_HOPS=1`
  so client IPs (rate limits, audit logs) come from Caddy's `X-Forwarded-For`. With `APP_ENV=production` the
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
