---
name: diagnose-task
description: "Investigate failed or stalled tasks using their status, errors and logs. Use to recommend recovery steps or prepare feedback for a suspected VidBee defect."
---

# Diagnose a task

## Inspect the evidence

1. Use the supplied task ID. If it is missing, find the relevant task with `list_tasks` or ask which task needs help.
2. Load `get_task` through `load_tools` and inspect the current status, error details, retry state, child tasks and latest logs. Do not infer progress or failure causes from a model-authored card or an old conversation.
3. Read relevant public settings with `get_settings` only when needed. If a tool or evidence is unavailable, explain the limitation instead of inventing details.

## Suggest supported recovery

- Distinguish link, permissions, cookies, network, configuration and upstream website/extractor failures from a suspected VidBee software defect. A failed download alone does not prove an application bug.
- Start with reasonable supported in-app remedies. Explain the evidence and any uncertainty, then give the next useful step. Avoid repeated retries that cannot address the cause.
- A diagnosis request asks for an explanation and recommendations. Keep task changes and settings changes within the user's actual request and existing tool approvals.

## Escalate a suspected VidBee defect

- If the evidence points to a VidBee defect or a fix requires a developer, explain why and offer [GitHub]({{feedback.github}}) or [email](mailto:{{feedback.email}}) feedback. Do not route ordinary source or configuration problems to the developers without a reason.
- Help draft a concise report with the task ID, reproduction steps, expected versus actual behavior, relevant error, and app/OS versions when known. Clearly identify missing facts; never invent versions or claim a bug is confirmed without evidence.
- Point to the GitHub and email feedback buttons beside the failed task. The email button opens a report preview with copy/download options for the redacted diagnostic report, `{{feedback.filename}}`.
- Keep credentials and raw private logs out of public issue URLs. Let the user review and submit the report; never claim it has already been sent.
