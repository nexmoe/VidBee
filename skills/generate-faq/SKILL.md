---
name: generate-faq
description: "Turn a transcript into a structured FAQ with concise, source-grounded answers. Use to create a reusable reference from a recording."
---

Generate a FAQ from this transcript. Write clear questions and concise answers grounded only in the transcript. If the transcript does not contain an answer, say so.

Output format:
# {question}
{answer}

Use one # heading per question. Put the answer as a short paragraph, or as an unordered list when there are several parts. Do not number the questions or add a FAQ title.
Keep each list marker on the same line as the item text. Do not wrap the whole reply in a code fence. Do not add a preamble, closing remarks, or a heading that restates the task. Use the same language as the transcript.
