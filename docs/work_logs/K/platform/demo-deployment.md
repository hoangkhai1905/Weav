# Demo deployment (domain, DNS, email, hosting)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-07 (Asia/Saigon) |
| Owner | K, coordinator (Claude) |
| Status | In progress: domain, DNS and system email done; hosting on hold until the partner finishes FE routing |
| Scope | Demo hosting of the backend (no infrastructure is created without K's approval of a written plan) |

## 2. Decisions

| Decision | Reason |
| --- | --- |
| Domain `weav.id.vn` (inet.vn, VNNIC free `.id.vn`, active until 2028-10-07) | Free for the thesis period |
| DNS on Cloudflare (Free): nameservers `gerardo.ns.cloudflare.com`, `summer.ns.cloudflare.com`; inet OneShield not used | `id.vn` is on the Public Suffix List, so the zone is allowed on the free plan; enables a named Cloudflare Tunnel |
| Planned: named Cloudflare Tunnel, `api.weav.id.vn` -> gateway, `app.weav.id.vn` -> frontend | No open ports on the host, Cloudflare TLS, stable Telegram webhook URL (replaces the quick tunnel). Proxy idle cutoff about 100 s: verify assistant SSE |
| Planned host: Oracle Cloud Always Free (ARM, home region ap-singapore-1, Pay-As-You-Go to avoid idle reclamation) | Budget; next to Neon. On hold |
| Release branch `main` (staging -> dev -> main when K says so) | K's decision |
| OCR disabled for the demo until the partner provides a stable URL (it runs on Google Colab) | Colab sessions stop |
| System email (identity OTP) via Resend SMTP from `no-reply@weav.id.vn` | Branded sender, no personal Gmail App Password on the server |

Open: which Neon branch the deployed stack uses (partner moves off `production`, recommended, or a new `demo` branch).

## 3. Changes

- Cloudflare zone `weav.id.vn`: imported OneShield A/AAAA records deleted; Resend records added by the Resend integration: `send` and `rsend` CNAME (switched to DNS only), `resend._domainkey` TXT (DKIM), `_dmarc` TXT (`p=none`).
- K's local `.env`: `SMTP_*` switched to Resend (`smtp.resend.com:587` STARTTLS, user `resend`, API key with sending access, from `no-reply@weav.id.vn`) by script without printing values; the previous Gmail lines are in `tmp/smtp-gmail-backup.env` (git-ignored).
- `.env.example`: SMTP comment documents the Resend option (no variable or default changed).

## 4. Checks

| Check | Result |
| --- | --- |
| `nslookup -type=NS weav.id.vn` via 1.1.1.1 and 8.8.8.8 | Cloudflare nameservers |
| Public DNS for the Resend records | CNAMEs resolve to Resend targets (not proxied), DKIM and DMARC TXT present |
| `POST /api/auth/otp/request` PASSWORD_RESET for a password account | HTTP 202; email from Weav <no-reply@weav.id.vn> received by K |

Note: a password reset for an account without a password (Google sign-in) is accepted but sends nothing by design (no account enumeration).

Left behind: throwaway account `nhoangkhai195+resendtest@gmail.com` ("Resend test", random unknown password) in the `dev-k` identity database; delete when no longer useful.

## 5. Next steps

1. Partner: finish FE routing; decide the Neon branch for the deployed stack.
2. Oracle account and ARM VM; cloudflared named tunnel.
3. Written plan for K's approval: `compose.prod.yml` (prod Dockerfiles, heap limits, restart policies), tunnel config, VM runbook, production RS256 keys, Google OAuth redirect URLs, Flyway/Prisma migrations on the chosen Neon branch (backup branch first), R2 lifecycle rule on `workflow-files/`, demo checklist.
