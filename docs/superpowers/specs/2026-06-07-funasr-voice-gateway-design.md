# FunASR Voice Gateway Design

Date: 2026-06-07

## Goal

Add real-time voice input to pi-web using FunASR, with a design that supports both browser dictation and a remote ESP32 voice device. The first implementation must stream audio continuously and surface partial transcripts while the user is speaking; it must not behave like record-then-transcribe.

The design also reserves a downstream TTS path so an ESP32 can later receive spoken assistant responses.

## Non-Goals

- Do not replace FunASR with another ASR backend in the first version.
- Do not implement WebRTC in the first version.
- Do not make MQTT relay a first-version requirement now that Cloudflare Tunnel will expose the gateway.
- Do not build TTS in the first version, but keep the protocol and service boundary ready for it.
- Do not put long-lived audio streaming inside Next.js route handlers.
- Do not adopt the full Xiaozhi ESP32 server platform in v1; only use its device protocol shape where it helps.

## Architecture

The voice gateway should be a separate local service process, kept in the pi-web repository for the first version.

```text
Browser ChatInput / Remote ESP32
        |
        v
pi-voice-gateway service
  - browser and device WSS endpoints
  - device auth and profiles
  - audio decode/normalization to mono 16 kHz PCM16
  - FunASR lifecycle ownership
  - FunASR streaming adapter
  - partial/final transcript events
  - future TTS downlink events
        |
        +--> FunASR streaming runtime
        |
        +--> pi-web local API -> pi-agent session
        |
        +--> browser transcript stream
```

The gateway is independent at runtime but not a separate repo/package yet. A first version can add an entrypoint such as:

```text
bin/pi-voice-gateway.js
lib/voice-gateway/
```

pi-web remains the UI and session authority. The gateway handles audio streams, FunASR connectivity, device sessions, and delivery of final transcripts through a pi-web local API.

The gateway core is pi-web-owned. For ESP32 devices, the transport should be Xiaozhi-compatible or Xiaozhi-inspired instead of a new custom PCM-only protocol. Xiaozhi already defines the useful device/server shape: a WebSocket hello exchange, authorization headers, JSON control events, binary Opus audio frames, STT events, TTS lifecycle events, abort/listen states, and future MCP messages. pi-web should not pull in the whole Xiaozhi server, but should reuse that protocol shape so existing ESP32 voice-device practice can inform the implementation.

## Deployment

The local gateway listens on loopback by default:

```json
{
  "gateway": {
    "host": "127.0.0.1",
    "port": 30142,
    "publicBaseUrl": "https://voice.example.com",
    "remoteTransport": "cloudflare-wss"
  }
}
```

Remote ESP32 devices connect through Cloudflare Tunnel:

```text
ESP32
  -> wss://voice.example.com/xiaozhi/v1
  -> Cloudflare Tunnel
  -> 127.0.0.1:30142 pi-voice-gateway
```

Cloudflare Tunnel solves public reachability and TLS. It does not replace application-level device authentication, and the device client must support reconnect because WebSocket connections can be interrupted by network or edge updates.

## FunASR Backend

FunASR is the only required ASR backend for v1. The gateway owns a small lifecycle adapter with two modes:

- `managed-command`: gateway starts FunASR with a configured command, captures stdout/stderr in a ring buffer, and performs health checks.
- `external-ws`: gateway connects to a user-managed FunASR WebSocket runtime.

Example settings:

```json
{
  "asr": {
    "provider": "funasr",
    "mode": "managed-command",
    "command": "python funasr_wss_server.py --port 10095",
    "cwd": "/path/to/FunASR/runtime/python/websocket",
    "wsUrl": "ws://127.0.0.1:10095",
    "healthTimeoutMs": 10000
  }
}
```

The gateway should implement a thin `FunAsrStreamingClient` rather than depend on low-star third-party wrappers. It can reference FunASR official demos and small browser ASR demos, but copied or adapted code must be reviewed for license compatibility and rewritten into pi-web's own adapter shape.

## Transport Protocol

The gateway owns the boundary between clients and FunASR. Browser and ESP32 clients must not depend on FunASR's protocol directly.

There are two first-version transports:

- Browser transport: pi-web-owned local WSS protocol optimized for ChatInput dictation.
- Device transport: Xiaozhi-compatible WSS protocol optimized for remote ESP32 voice devices.

Both transports feed the same gateway core after audio is normalized to mono 16 kHz PCM16.

### Browser Transport

The browser path can remain simple because browser ChatInput is part of pi-web and runs locally.

Client control frames:

```json
{ "type": "start", "source": "browser", "profileId": "default", "sampleRate": 16000, "format": "pcm_s16le" }
{ "type": "stop" }
```

Browser audio frames should be binary PCM frames whenever possible. If a browser cannot send binary frames, it may use a JSON frame with base64 audio, but binary is preferred.

Gateway events:

```json
{ "type": "status", "state": "listening" }
{ "type": "partial", "text": "幫我看一下", "utteranceId": "u1" }
{ "type": "final", "text": "幫我看一下這個錯誤", "utteranceId": "u1" }
{ "type": "error", "message": "FunASR unavailable" }
```

### ESP32 Device Transport

ESP32 devices should use a Xiaozhi-compatible WebSocket flow:

- WebSocket handshake includes `Authorization`, `Protocol-Version`, `Device-Id`, and `Client-Id` headers.
- Device sends a `hello` JSON message with `transport: "websocket"` and `audio_params`.
- Audio uplink uses binary Opus frames, typically mono 16 kHz with 60 ms frame duration.
- Text frames carry JSON control/events such as `listen`, `abort`, `stt`, `tts`, and future `mcp`.

Example device hello:

```json
{
  "type": "hello",
  "version": 1,
  "transport": "websocket",
  "audio_params": {
    "format": "opus",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration": 60
  }
}
```

Example gateway hello:

```json
{
  "type": "hello",
  "transport": "websocket",
  "session_id": "voice-session-id",
  "audio_params": {
    "format": "opus",
    "sample_rate": 24000,
    "channels": 1,
    "frame_duration": 60
  }
}
```

The gateway must decode inbound Opus audio to PCM before sending it to FunASR. Downlink TTS can later use Opus frames to match Xiaozhi-style playback.

For v1, the gateway only needs the subset required for voice input and reserved TTS:

- `hello`
- `listen` with `state: "start" | "stop" | "detect"` and `mode: "manual" | "auto" | "realtime"`
- binary Opus audio frames
- `abort`
- server `stt` events for recognized text
- server `tts` lifecycle events, with no-op or unavailable behavior until TTS is implemented

The browser transcript events above remain pi-web UI events. The ESP32 side should emit Xiaozhi-compatible STT/TTS events instead of pi-web-specific `partial`/`final` names when speaking to device firmware.

Future TTS events for the gateway core are reserved:

```json
{ "type": "assistant_text", "text": "我來查..." }
{ "type": "tts_start", "format": "pcm_s16le", "sampleRate": 16000 }
{ "type": "tts_audio", "seq": 1 }
{ "type": "tts_end" }
{ "type": "tts_error", "message": "TTS unavailable" }
```

## Browser UX

ChatInput gets a microphone control and a page-scoped configurable hotkey. The browser client connects to `pi-voice-gateway`; it does not connect to FunASR directly.

Modes:

- `dictation`: default. Partial/final transcripts update the input box, but nothing is sent automatically.
- `auto-send`: final transcripts are sent automatically after utterance completion.

Behavior:

- Partial transcripts must appear while speaking.
- Final transcripts become stable input text.
- Partial text should be tracked separately from committed input text so revised partials do not corrupt manual edits.
- First version inserts finalized text at the end of the input.
- If the agent is already running, auto-send should default to follow-up rather than steer.

## ESP32 Behavior

ESP32 devices connect over WSS through Cloudflare Tunnel. They should not know FunASR or pi-agent protocols. Their gateway-facing protocol should follow the Xiaozhi WebSocket shape, not the browser dictation protocol.

Device settings are profile-based:

```json
{
  "devices": [
    {
      "id": "desk-esp32",
      "name": "Desk ESP32",
      "token": "<generated>",
      "transport": "cloudflare-wss",
      "targetCwd": "/home/timmypai/project",
      "targetSession": "active",
      "autoSend": true,
      "ttsEnabled": false
    }
  ]
}
```

For v1, the ESP32 flow is:

```text
device button/wake
  -> open Xiaozhi-compatible WSS session
  -> send listen/start and binary Opus audio to gateway
  -> gateway decodes Opus to PCM16
  -> gateway streams to FunASR
  -> gateway receives final transcript
  -> gateway calls pi-web local API
  -> pi-web sends chat message to pi-agent
```

TTS downlink is reserved in the protocol but can return no-op or `tts_unavailable` until a TTS backend is added.

## Dependencies

Use mature dependencies only where they remove real complexity:

- Keep `ws` for Node WebSocket server/client behavior.
- Do not add RecordRTC for v1; it is oriented toward recording, not low-latency PCM streaming.
- Do not add low-star FunASR wrappers as core dependencies.
- Do not add browser VAD as a required dependency in v1.
- Do not add the full Xiaozhi server as a dependency; implement the required Xiaozhi-compatible device protocol subset locally.

Browser PCM capture can be implemented as a small local adapter, with reference to existing AudioWorklet patterns. The adapter's job is only to emit mono 16 kHz PCM16 chunks.

Device Opus decode/encode should be behind a small codec adapter. The implementation plan should choose a maintained Node-compatible Opus library or external codec process after testing install/runtime behavior on the target machine.

## Security

- Gateway defaults to loopback-only.
- Remote device access requires a per-device token.
- Cloudflare Tunnel provides reachability and TLS, not authorization.
- Gateway-to-pi-web delivery uses a loopback-only local API plus a shared secret or equivalent local trust mechanism.
- No anonymous device auto-registration.
- Xiaozhi-compatible headers are used for device identity, but gateway profile tokens remain the authorization source.
- Raw audio is not persisted by default.
- Transcript and audio debug dumps require explicit opt-in.

## Error Handling

Gateway states:

```text
stopped
starting
ready
streaming
degraded
error
```

Required error behavior:

- FunASR unavailable: return a clear status/error and do not silently buffer unbounded audio.
- FunASR start failure: expose recent stdout/stderr logs.
- Unsupported audio format: reject the stream with an explicit error.
- Opus decode failure: close or reset the device audio stream with an explicit protocol error.
- Stream interruption: send an error/status event and allow the client to reconnect.
- Chat delivery failure: preserve the final transcript in a failed delivery event.
- TTS failure: do not block ASR or chat delivery.

Backpressure:

- Each session has a maximum pending audio buffer.
- On overflow, disconnect or ask the client to slow down.
- Reserve `slow_down`, `resume`, and `ack` events for device clients, even if v1 only implements hard limits.

## Testing And Acceptance Criteria

Acceptance criteria:

- `pi-voice-gateway` starts as an independent process.
- Gateway can start managed FunASR or connect to external FunASR WebSocket.
- Browser mic button and hotkey start/stop voice input.
- Speaking produces visible partial text before the utterance ends.
- Final text is committed to ChatInput.
- Dictation mode does not auto-send.
- Auto-send mode sends final text to the current chat session.
- Device WSS endpoint accepts a mock Xiaozhi-compatible ESP32 session.
- Device audio uplink accepts binary Opus frames and routes decoded PCM to the ASR path.
- Device final transcript is delivered to pi-web local API and then pi-agent.
- Xiaozhi-style TTS events are reserved and do not break v1 when no backend exists.
- Reconnect after WSS interruption starts a fresh stream cleanly.
- Typecheck passes with `node_modules/.bin/tsc --noEmit`.
- Lint passes with `node node_modules/next/dist/bin/next lint`.
- `next build` is not run during development verification.

Test strategy:

- Unit test settings loading, device auth, protocol parsing, FunASR event parsing, and transcript aggregation.
- Integration test gateway behavior with a fake FunASR WebSocket server that emits partial/final transcripts.
- Add a mock Xiaozhi device client that performs hello/listen and sends Opus audio frames over WSS-compatible WebSocket.
- Browser QA with local dev server verifies mic button, hotkey, partial/final rendering, and auto-send behavior.
- Failure tests cover invalid token, bad sample rate, FunASR down, delivery failure, and reconnect.
