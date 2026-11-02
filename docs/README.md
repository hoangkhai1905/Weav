# Documentation

Start with the [architecture overview](architecture/overview.md), then the spec of the component you are working on.
How we work (branches, tests, logs, commits) is in [CLAUDE.md](../CLAUDE.md) / [AGENTS.md](../AGENTS.md).

| Folder | What is in it |
| --- | --- |
| [architecture/](architecture/) | [Overview](architecture/overview.md) (components, flows, deployment, key decisions), [deployment exposure rules](architecture/deployment-exposure.md), [JWT signing design](architecture/jwt-asymmetric-signing-design.md) |
| [rulebook.md](rulebook.md) | Business rules, use cases and their owners, architecture and security rules |
| [specs/](specs/README.md) | One living spec per service and app, with V1 status. Update it when a feature lands |
| [superpowers/specs/](superpowers/specs/) | Feature designs, one per change, with the alternatives considered. Old implementation plans: git tag `archive/plans-2026-11-02` |
| [api/](api/) | [Node contracts](api/week4-node-contracts.md) for the frontend. OpenAPI and event schemas live in [packages/contracts](../packages/contracts) |
| [development/](development/) | [Setup](development/SETUP.md), [OCR benchmark](development/OCR_BENCHMARK.md), [agent CLI](development/agent-cli.md) |
| [deployment/](deployment/) | [Demo runbook](deployment/demo-runbook.md): VM, tunnel, Neon, automatic deploy from `main` |
| [reviews/](reviews/) | [Backend review 2026-10-01](reviews/2026-10-01-backend-review.md), the source of the review-fix work logs |
| [handoff/](handoff/) | Notes for the partner (mobile, OCR), one per week or topic |
| [work_logs/](work_logs/README.md) | What each of us did, per member, area and week |
| [agents/](agents/) | How agent skills use the issue tracker, triage labels and domain docs |
| [brand/](brand/README.md) | Logo and icon files and how they are built |
