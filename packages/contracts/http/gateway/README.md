# API Gateway Workspace contract

This directory documents the API Gateway’s public Workspace surface only. It
contains exactly seventeen explicit operations under `/api/v1/workspaces`; the
gateway does not expose the Workspace service’s service-to-service endpoints or
any wildcard proxy route.

The gateway requires the existing access JWT guard, validates UUIDs, strict JSON
bodies, and the Workspace query allow-lists/bounds, then forwards the request
to the configured Workspace upstream with `/api/v1` removed. The downstream
Workspace service remains responsible for business authorization and its
business response statuses. The original Bearer value is preserved, while
canonical `X-Request-ID` and `X-Correlation-ID` values are propagated.

The gateway forwards only safe transport headers. Cookies, internal service
keys, forged actor headers, and other client-controlled authorization context do
not cross the boundary. Redirects are rejected, mutations are not retried, and
the shared 10-second abort covers upstream response-body reading and client
disconnects. Successful responses cannot be sent after that abort; `204`
responses remain bodyless.

The eight connection operations are explicitly limited to collection and item
metadata, test, disable, and Google authorization start. Internal, OAuth
callback, and manual credential routes are not exposed. The OpenAPI file
references the existing Workspace parameters, schemas, and business response
contracts rather than redefining them. Gateway-generated
validation, authentication, upstream-invalid-response, and unavailable errors
use `GatewayErrorResponse`; valid downstream JSON/status bodies are otherwise
passed through unchanged.

The executable coverage for the nine method/path pairs and external reference
files is in `services/api-gateway/test/workspace.e2e-spec.ts`.
