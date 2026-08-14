# Meeting AI Notes — Feature Planning

## Overview

Meeting voice input → AI organizes it into structured Notes / Reports.

## Implementation Tiers

| Tier | Complexity | Description |
|------|-----------|-------------|
| **Record → Transcribe** | Medium | Record → Whisper/DeepSeek STT → text → LLM organizes → Note/Report |
| **Real-time** | High | WebSocket streaming audio → real-time STT → per-sentence organization |
| **Meeting Tool Integration** | Low-Med | Read Zoom/Teams/GMeet subtitles/transcripts → AI organizes |

## Record → Transcribe (Recommended MVP)

**Effort**: 3-5 days

**Flow**:
1. Electron microphone recording → saves audio file (mp3/wav)
2. Call the STT API (Whisper / DeepSeek Audio) to transcribe to text
3. Existing LLM pipeline organizes into structured Note/Report
   - Meeting topic
   - Attendees
   - Discussion points
   - Decisions
   - Action Items

**UI**:
- Record button (start/pause/stop)
- Recording-duration display
- Transcription loading state
- Result preview → save as Note or Report

## Real-time (Later)

**Effort**: 1-2 weeks

Additional requirements:
- WebSocket audio streaming
- Realtime STT
- Incremental AI processing
- Live display while recording

## Status

- [ ] Design
- [ ] Implementation
- [ ] Testing
