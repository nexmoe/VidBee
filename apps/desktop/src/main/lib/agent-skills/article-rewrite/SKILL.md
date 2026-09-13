---
name: article-rewrite
description: Rewrite the current source. Illustrate only when video frames are available. Cite screenshots with the full artifact UUID from the tool result.
---

# Article rewriting

Use this when the user wants a rewrite or illustrated article. Match the requested scope and level of detail. Full article rewrites include relevant source video screenshots by default, unless the user asks for text only or source metadata says `mediaKind` is `audio` / `hasVideoFrames` is false. If the source is audio-only, skip `capture_frames` and write a text-only article. Illustrations should fit the written content; there is no limit. This default does not apply to quick summaries or ordinary follow-up questions.

1. Use the supplied source evidence directly. Retrieve missing context with `read_transcript`; document mode is useful for broad reading. Follow pagination cursors when more source is needed.
2. If `hasVideoFrames` is true, before writing the final article or handing off to `write_article`, use `capture_frames` for its illustrations and follow its search and original-cue reading requirements. Reuse relevant existing artifacts when available. If the source is audio-only, skip this step.
3. Copy the tool result `embed` or `reference` exactly: `![caption](artifact:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)`. Never shorten the UUID, drop `artifact:`, or replace it with a timestamp.
4. If a requested capture fails, finish the article in text and do not retry visual tools. Explain the relevant limitation.
