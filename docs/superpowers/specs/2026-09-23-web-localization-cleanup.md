# Web Localization Cleanup

## Goal

Keep the existing web interface consistently in the selected Vietnamese or English locale, including accessible labels and form hints, and never render a raw translation key.

## Approved scope

- All existing user-facing screens in `apps/web`: login, registration and recovery, Dashboard, Workflows and creation, Workflow Builder, Executions and execution detail, Connections, Workspace, Notifications, Settings, Help, AI generator, Telegram/Bot, and the shared navigation/auth showcase.
- Use the existing `TRANSLATIONS` dictionary and `useI18nStore().t` API.
- Vietnamese locale uses Vietnamese for ordinary labels, actions, statuses, messages, placeholders, and accessibility text; English locale uses English.
- Keep product names, provider names, protocol/API terms, code, identifiers, and genuine sample-data names intact where translation would change their meaning.
- No new localization framework and no business-logic changes.

## Acceptance criteria

1. `dashboard.quick_actions` resolves to localized text in VI and EN.
2. Translation key sets are equal across VI and EN.
3. Representative screens no longer show known hardcoded copy from the other locale, including visible and accessible text.
4. Playwright verifies both locales at desktop and narrow viewport widths using the local mock/fixture runtime; this is not evidence of an authenticated production runtime.
5. Relevant E2E tests, web lint/build, and `git diff --check` pass.

## Out of scope

Mobile, backend services, API/data contracts, business logic, translating identifiers/code/external branding, and unrelated dirty worktree changes.
