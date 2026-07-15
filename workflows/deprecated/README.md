# Deprecated workflows

## `high-priority-workflow.json`

Superseded by `../auto-escalation-workflow.json` ("V2 Stateful Auto-Escalation Workflow").

Both workflows' Webhook Trigger node use the same path, `escalate-ticket`. n8n can only
register one active webhook per path, so these two can never both be active at the same
time — importing/activating both causes the losing workflow's webhook to silently fail
to register, which surfaces in the app as a 404 "not registered" error when the
escalation trigger fires.

`auto-escalation-workflow.json` is the current live version (adds a 30-minute wait and
ticket-status recheck before escalating, instead of escalating immediately). This file
is kept for reference only — **do not import or activate it** unless
`auto-escalation-workflow.json` is deactivated first, or you assign it a different
webhook path.
