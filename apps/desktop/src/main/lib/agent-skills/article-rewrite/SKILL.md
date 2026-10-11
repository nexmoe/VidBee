---
name: article-rewrite
description: Rewrite the current source. Illustrate only when video frames are available. Cite screenshots with the full artifact UUID from the tool result.
---

# Article rewriting

Use this when the user wants a rewrite or illustrated article. Match the requested scope and level of detail. Full article rewrites include relevant source video screenshots by default, unless the user asks for text only or source metadata says `mediaKind` is `audio` / `hasVideoFrames` is false. If the source is audio-only, skip `capture_frames` and write a text-only article. Illustrations should fit the written content; there is no limit. This default does not apply to quick summaries or ordinary follow-up questions.

1. Use the supplied source evidence directly. Retrieve missing context with `read_transcript`; document mode is useful for broad reading. Follow pagination cursors when more source is needed.
2. If `hasVideoFrames` is true, use `capture_frames` whenever an illustration helps: while exploring the source, drafting a section, or refining the article. Choose the number and placement from the content and the user's needs, with no fixed minimum, maximum or per-section quota. Existing screenshots are reusable material, not the complete set of available illustrations. Section writers can capture and inspect additional frames after handing off to `write_article`. Use original subtitle cues to locate relevant moments; retrieve missing timing evidence as needed. If the source is audio-only, skip this step.
3. Copy the tool result `embed` or `reference` exactly: `![caption](artifact:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)`. Never shorten the UUID, drop `artifact:`, or replace it with a timestamp.
4. Inspect tool feedback and, when vision is available, the returned images. Adjust the time or try again when that can resolve a mismatch or capture failure. Reuse an identical successful capture rather than requesting it repeatedly. If suitable frames remain unavailable, finish the supported prose and explain the relevant limitation.
5. Deliver the complete article body with supported arguments, examples and a finished conclusion. Screenshots illustrate the prose; their captions never replace article paragraphs. A title, image gallery, outline or opening sentence of a conclusion is not a finished rewrite. For a long source, use `write_article` when available rather than ending with a placeholder.
