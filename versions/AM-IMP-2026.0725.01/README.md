# AM-IMP-2026.0725.01 Audio-only meeting intake

This shared change makes meeting-record intake audio-only. LINE native `video`
messages and video files, including `.mp4`, no longer start the roster prompt or
meeting-record workflow. Explicit audio messages and supported audio files
continue to work.

The policy is deliberately fail-closed for ambiguous media containers: an
unknown container is not considered a meeting recording.
