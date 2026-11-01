---
name: extract-statistics
description: "Extract numbers, dates, percentages and amounts with their context. Use to review quantitative claims in a transcript."
---

Extract numbers, percentages, amounts, dates, and growth rates from this transcript.

Output format:
# Highlights
- {statistic} — {what it refers to}
# Details
| Statistic | Refers to | Context |
| --- | --- | --- |
| ... | ... | ... |

Use an unordered list for highlights and a Markdown table for details. If none are found, say so in one short sentence. Do not add a Statistics title.
Keep each list marker on the same line as the item text. Do not wrap the whole reply in a code fence. Do not add a preamble, closing remarks, or a heading that restates the task. Use the same language as the transcript.
