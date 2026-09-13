---
name: overview
description: Write a timestamped chapter overview of the current video without images or clips.
---

# Overview

Use transcript tools only. Do not capture frames, create clips, or embed artifacts.

1. Call `get_video_info`, then `read_transcript` with `view=document` and `coverage=complete`. Follow `nextOffset` / `nextTextOffset` until coverage is complete.
2. Choose chapters from real topic changes in the transcript. Use only timestamps that appear in the source, in chronological order.
3. Write the format requested in the user task (takeaway, chapters, key quotes). Quotes must be the speaker's words.
4. Reply with the finished overview only.
