---
name: overview
description: Write a timestamped chapter overview of the current video without images or clips.
---

# Overview

Use text evidence only. Do not capture frames, create clips, or embed artifacts.

1. Reuse supplied complete source evidence. When missing, load `get_video_info` and `read_transcript`, then read with `view=document` and `coverage=complete`. Follow `nextOffset` / `nextTextOffset` until coverage is complete.
2. Choose chapters from real topic changes in the transcript. Use only timestamps that appear in the source, in chronological order.
3. Write the format requested in the user task (takeaway, chapters, key quotes). Quotes must be the speaker's words.
4. Reply with the finished overview only.
