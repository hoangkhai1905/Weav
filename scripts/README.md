# Scripts

Development, build, test, and database helper scripts.

## live-test-nodes.ps1

Live test for the Telegram and Google Calendar/Drive workflow nodes, driven through the API Gateway (it stands in for the UI). It prompts for your Weav email and password, and for the bot token, using hidden input. Nothing secret is printed or written to disk. It uses PowerShell 5.1 and no extra modules.

Preconditions:
- Dev stack up; gateway on `http://localhost:3000` (override with `-GatewayUrl`).
- Telegram: `cloudflared tunnel --url http://localhost:3000` running, `WORKFLOW_PUBLIC_BASE_URL` in `.env` set to the tunnel's https URL, workflow-service restarted, and a bot from @BotFather.
- Google: `GOOGLE_OAUTH_CLIENT_ID/SECRET` set, redirect URI `http://localhost:8082/oauth/google/callback` allowed on the OAuth client. After consent, Google redirects to `GOOGLE_OAUTH_FRONTEND_RETURN_URL`; copy the full address-bar URL (it holds a single-use `completion` value, valid 5 minutes) and paste it into the script.

Parameters: `-Flow telegram|google|all` (default `all`), `-WorkspaceId` (default: your first workspace), `-Cleanup` (pause the workflows it created; pausing the Telegram workflow removes the webhook), `-GatewayUrl`.

```powershell
.\scripts\live-test-nodes.ps1 -Flow all -Cleanup
```

It ends with a PASS/FAIL table and a checklist to verify by eye (echo reply, calendar event, Drive file, consent scopes). Exit code 0 when every executed step passed, 1 otherwise.
