# Scripts

Development, build, test, and database helper scripts.

## live-test-nodes.ps1

Live test for the Telegram, Google Calendar/Drive, logic (`data.set`, `logic.switch`), `ai.generate` and `trigger.gmail` workflow nodes, driven through the API Gateway (it stands in for the UI). It prompts for your Weav email and password (the git-ignored `tmp/live-test-account.txt` holds the test account), and for the bot token, using hidden input. Nothing secret is printed or written to disk. It uses PowerShell 5.1 and no extra modules.

Flows (`-Flow telegram|google|logic|ai|gmail|all`, default `all`):

| Flow | Preconditions | Checks |
| --- | --- | --- |
| `telegram` | `cloudflared tunnel --url http://localhost:3000` running, `WORKFLOW_PUBLIC_BASE_URL` in `.env` set to the tunnel's https URL, workflow-service restarted, a bot from @BotFather | bot token verified, trigger ACTIVE, a message you send produces a SUCCESS run and an echo reply (this also covers the numeric chat id text coercion) |
| `google` | `GOOGLE_OAUTH_CLIENT_ID/SECRET` set, redirect URI `http://localhost:8082/oauth/google/callback` allowed. After consent, copy the full address-bar URL (single-use `completion`, valid 5 minutes) into the script | Calendar event, Drive upload and list all SUCCESS |
| `logic` | dev stack only (no connection, no AI) | one workflow `data.set` -> `logic.switch` (cases 1, 2, default) -> three `data.set` branches; three manual runs (`plan` 1, 2, "gold") assert the renamed field and number in `data.set`, the switch port, and that the matching branch is SUCCESS while the others are SKIPPED. A text-coercion check is not repeated here (no side-effect-free node has a string-only field) |
| `ai` | AI service enabled: `node scripts/ai-dev-keys.mjs`, `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL` in `.env`, `WORKFLOW_AI_ENABLED=true`, `WORKFLOW_AI_GENERATION_ENABLED=true`, stack started without `compose.ai-local.yml`. One run; up to 3 DeepSeek calls if it times out (retries), each using 1 daily quota, so the script asks you to type `yes` | one run of `ai.generate` (`maxLength` 200); `text` non-empty and within the limit, shown truncated. `DEPENDENCY_NOT_CONFIGURED` prints an "AI is disabled" hint |
| `gmail` | Google OAuth as above, plus `gmail.readonly` added to the consent screen scopes and the Gmail API enabled. You must send an email while it waits | publishes `trigger.gmail` (poll every 1 minute, query matching the exact per-run subject `Weav live test <timestamp>`, so earlier mails and replies cannot match) -> `data.set`; prints the exact subject to send; polls up to 3 minutes for a GMAIL run; shows from, subject, snippet length, body length, `bodyTruncated`, `bodyOmitted` (never the body); asserts exactly one GMAIL run, waits two intervals (130 s) and asserts it is still exactly one. With no run it prints the trigger `reasonCode` and a hint (`CONNECTION_RECONNECT_REQUIRED`, `AUTHENTICATION_REJECTED`, `GMAIL_POLL_FAILED`, ...) |

`all` runs every flow, including `gmail` (type `skip` at its prompt to skip it) and `ai` (answer anything but `yes` to skip it).

Gmail scope note (applies once the Gmail trigger lane is merged; it merges together with this script): add `https://www.googleapis.com/auth/gmail.readonly` in Google Cloud Console (Data access / scopes) and enable the Gmail API; `gmail.metadata` is no longer used. Gmail connections created before this scope existed must be reconnected: pass `-GmailConnectionId <id>` and the script runs the OAuth authorize/complete flow on that connection instead of creating a new one. While the OAuth app is in Testing mode, refresh tokens expire after 7 days, so a Gmail connection needs a reconnect weekly.

Parameters: `-Flow`, `-WorkspaceId` (default: your first workspace), `-GmailConnectionId`, `-Cleanup` (pause the workflows it created; pausing the Telegram workflow removes the webhook and pausing the Gmail workflow stops polling), `-GatewayUrl` (default `http://localhost:3000`).

```powershell
.\scripts\live-test-nodes.ps1 -Flow logic -Cleanup
.\scripts\live-test-nodes.ps1 -Flow gmail -GmailConnectionId <id> -Cleanup
```

It ends with a PASS/FAIL table and a checklist to verify by eye. Exit code 0 when every executed step passed, 1 otherwise.
