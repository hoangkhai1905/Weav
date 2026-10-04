# workflow-schema

Node config contract shared by the backend and the frontend. `nodes/<type>.json` is a JSON Schema
(draft 2020-12 subset) for the `config` object of one node type, for example `nodes/email.send.json`.
workflow-service loads these files at startup (validation, node catalog); the web and mobile apps can
render node forms from the same files.

## Layout

- `nodes/<type>.json`: one file per node type; the file name is the node type.
- Top level: `title`/`description` (labels and help), `required`, `properties`, `additionalProperties: false`,
  and `x-weav-node` `{type, category: trigger|action|logic|ai, label, sideEffect}`.
- Other folders are placeholders and not used yet.

## Rendering a form

| Schema | Widget |
| --- | --- |
| `type: string` | text input |
| `type: integer` (+ `minimum`) | number input |
| `type: boolean` | checkbox |
| `type: array` of strings | list or tag input |
| `type: object` | key/value editor (or JSON editor when no `additionalProperties`) |
| no `type` | any JSON value (text or JSON editor) |
| `oneOf` | let the user pick a branch (email `to`: one address or a list) |
| `enum` | select |
| `x-weav-template: true` | text input with a mapping picker for `{{ ... }}` values; a literal is also fine |
| `x-weav-connection: {provider}` | dropdown of workspace connections filtered by `provider` |
| `x-weav-static: true` | literal only (no mapping picker) |
| `title` / `description` | label / help text |

`required` means required to **publish**. Drafts may omit any field, so do not block saving.
For `x-weav-template` fields a string containing `{{ }}` is accepted in place of the declared type, so integer, boolean, array and enum fields need a "use mapping" toggle, not free text; `enum` and `minLength` checks are skipped for mapping values.
`minLength: 1` means non-blank, enforced at publish for required fields. `x-weav-mutually-exclusive`
lists field groups of which only one may be set (OCR: `artifactId` or `fileUrl`).
The backend stays the authority: it also checks mapping grammar, URLs, schedules and the graph.

## Example: email.send

```json
{ "x-weav-node": { "type": "email.send", "category": "action", "label": "Send email", "sideEffect": true },
  "required": ["connectionId", "to", "subject", "body"],
  "properties": {
    "connectionId": { "type": "string", "x-weav-connection": { "provider": "GMAIL" } },
    "to": { "x-weav-template": true, "oneOf": [
        { "type": "string", "minLength": 1 },
        { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } } ] },
    "subject": { "type": "string", "minLength": 1, "x-weav-template": true },
    "body": { "type": "string", "x-weav-template": true } } }
```

Form: a Gmail connection dropdown, a recipient input (one address or a list, mappings allowed),
a subject and a body (mappings allowed). Publishing needs all four.

## Adding a node

Add `nodes/<type>.json` only. The backend catalog, validation and `x-weav-node` metadata follow. Supported
keywords are `type`, `enum`, `items`, `oneOf`, `additionalProperties` (schema), `minLength`, `minItems`,
`minimum`, `required`, `properties`, `title`, `description` and the `x-weav-*` extensions above; the
backend refuses to start on anything else. Executing the node still needs a Java executor.
