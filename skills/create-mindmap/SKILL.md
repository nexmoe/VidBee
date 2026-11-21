---
name: create-mindmap
description: "Organize transcript topics and their relationships into a Mermaid mind map. Use to visualize the structure of a recording."
---

Generate the mind map using Mermaid's `mindmap` syntax. Organize the transcript topics into a hierarchy with a central topic, branches, and supporting details. Always return the diagram in a fenced code block labeled `mermaid` so VidBee can render it.

Output format:
```mermaid
mindmap
  {root topic}
    {branch}
      {leaf}
      {leaf}
    {branch}
      {leaf}
```

Reply with one mermaid code fence only. Start the diagram with mindmap. Indent two spaces per level. Keep labels short. Wrap a label in double quotes if it contains parentheses, brackets, or colons. Do not use flowchart or graph syntax. Do not add a heading, preamble, or extra text outside the fence. Use the same language as the transcript.
