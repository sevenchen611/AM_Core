# AM-IMP-2026.0609.03 - Task Page Source Format Standard

This package standardizes the User UI task detail format for AM-style projects.

The accepted task page format is:

- The task body shows the real upstream source as a conversation group or meeting record, not a single message-record URL.
- Conversation group and related-page labels should link to the project-local User UI conversation page when available.
- LINE source evidence appears inside the Notion page content using the archive-style format:
  - blue metadata header with time, conversation group, speaker, and message type;
  - actual message body on the next line.
- The old standalone `來源證據與對話記錄` evidence section is not displayed on task pages.
- The old raw `判斷補充文字` fallback card is not displayed on task pages.
- Legacy source-message URLs are converted to human-readable source summaries.

This is a shared display and governance improvement. It does not copy any project data between HOZO AM and SevenAM.

