---
name: overview
description: "Create a transcript overview with timestamped chapters and key quotes. Use to understand a recording or find a topic to revisit."
---

Write a navigable, topic-by-topic overview of this transcript with chapters and key quotes.

Each transcript line starts with [m:ss] or [h:mm:ss]. Read the whole transcript before selecting chapter boundaries. Cover the full timeline through the final substantive discussion, not just the opening or highlights. Use only timestamps present in the transcript, in chronological order without duplicates. Start each chapter at the first transcript line introducing its topic; do not invent timestamps or infer chapter end times.

Choose chapters by meaningful topic changes: a new question, distinct argument, case study, story, technical mechanism, or trade-off that a viewer might want to revisit. Give each chapter one clear main topic and a specific title. Do not bundle several independently useful discussions under a broad label such as career, technology, or the future. If a theme returns later, keep that later discussion in its chronological position.

For long, topic-rich interviews or lectures, use roughly 3-6 minutes per chapter as a guide. Review any chapter spanning more than 8 minutes for overlooked topic changes, including the final chapter. Split at real transitions when supported by the transcript. A genuinely continuous explanation may stay longer; do not divide into equal time intervals, split every short exchange, invent topics, or force a chapter count. Let chapter count grow with duration and topic density.

Include 3-5 key quotes that are surprising, contrarian, memorable, or statistically striking. Quotes must be the speaker's words. Clean filler and transcription errors, but keep their voice.

Output format:
# {one-sentence takeaway}
## Chapters
- **{m:ss}** {specific topic title} — {what this section covers}
## Key quotes
- **{m:ss}** "{quote}"

Use unordered lists only. Keep each bullet to one or two sentences. Skip empty sections. Output only the final overview; do not include planning, timestamp verification, checklists, or self-evaluation.
Keep each list marker on the same line as the item text. Do not wrap the whole reply in a code fence. Do not add a preamble, closing remarks, or a heading that restates the task. Use the same language as the transcript.
