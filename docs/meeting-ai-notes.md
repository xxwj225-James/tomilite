# Meeting AI Notes — Feature Planning

## Overview

会议语音输入 → AI 整理成结构化 Note / Report。

## Implementation Tiers

| Tier | Complexity | Description |
|------|-----------|-------------|
| **Record → Transcribe** | Medium | 录音 → Whisper/DeepSeek STT → 文本 → LLM 整理 → Note/Report |
| **Real-time** | High | WebSocket 流式音频 → 实时 STT → 逐句整理 |
| **Meeting Tool Integration** | Low-Med | 读 Zoom/Teams/GMeet 字幕/转录文本 → AI 整理 |

## Record → Transcribe (Recommended MVP)

**Effort**: 3-5 天

**Flow**:
1. Electron 麦克风录音 → 保存音频文件 (mp3/wav)
2. 调用 STT API（Whisper / DeepSeek Audio）转文字
3. 已有 LLM pipeline 整理成结构化 Note/Report
   - 会议主题
   - 参会人员
   - 讨论要点
   - 决策事项
   - Action Items

**UI**:
- 录音按钮（开始/暂停/停止）
- 录音时长显示
- 转录中 loading
- 结果预览 → 保存为 Note 或 Report

## Real-time (Later)

**Effort**: 1-2 周

Additional requirements:
- WebSocket audio streaming
- Realtime STT
- Incremental AI processing
- Live display while recording

## Status

- [ ] Design
- [ ] Implementation
- [ ] Testing
