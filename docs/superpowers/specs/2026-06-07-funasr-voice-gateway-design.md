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

The gateway core is pi-web-owned, but its public voice-session protocol should be Xiaozhi-style for every client, including browser ChatInput and ESP32 devices. Xiaozhi already defines the useful device/server shape: a WebSocket hello exchange, authorization headers, JSON control events, binary audio frames, STT events, TTS lifecycle events, abort/listen states, and future MCP messages. pi-web should not pull in the whole Xiaozhi server, but should reuse that protocol shape so existing ESP32 voice-device practice can inform the implementation.

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

## Voice Session Protocol

The gateway owns the boundary between clients and FunASR. Browser and ESP32 clients must not depend on FunASR's protocol directly.

All clients use one Xiaozhi-style WebSocket session protocol:

- WebSocket handshake includes client identity where available. ESP32 uses `Authorization`, `Protocol-Version`, `Device-Id`, and `Client-Id` headers. Browser clients can use pi-web local auth/session context instead.
- Client sends a `hello` JSON message with `transport: "websocket"` and `audio_params`.
- Audio uplink uses binary audio frames.
- Text frames carry JSON control/events such as `listen`, `abort`, `stt`, `tts`, and future `mcp`.
- Gateway translates client audio into the ASR backend's required format.

Example browser hello:

```json
{
  "type": "hello",
  "version": 1,
  "transport": "websocket",
  "source": "browser",
  "audio_params": {
    "format": "pcm_s16le",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration": 40
  }
}
```

Example ESP32 hello:

```json
{
  "type": "hello",
  "version": 1,
  "transport": "websocket",
  "source": "device",
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

Listen control:

```json
{ "session_id": "voice-session-id", "type": "listen", "state": "start", "mode": "manual" }
{ "session_id": "voice-session-id", "type": "listen", "state": "stop", "mode": "manual" }
```

For v1, the gateway only needs the subset required for voice input and reserved TTS:

- `hello`
- `listen` with `state: "start" | "stop" | "detect"` and `mode: "manual" | "auto" | "realtime"`
- binary audio frames, with `audio_params.format` declaring `pcm_s16le` or `opus`
- `abort`
- server `stt` events for recognized text
- server `tts` lifecycle events, with no-op or unavailable behavior until TTS is implemented

STT events should follow the Xiaozhi-style event family, not pi-web-specific `partial`/`final` names. The gateway can still map them to ChatInput state internally:

```json
{ "session_id": "voice-session-id", "type": "stt", "state": "partial", "text": "幫我看一下" }
{ "session_id": "voice-session-id", "type": "stt", "state": "final", "text": "幫我看一下這個錯誤" }
```

FunASR local runtime compatibility is an adapter concern. If the selected FunASR backend accepts the client's compressed audio format directly, the gateway may pass it through. If the backend expects raw PCM16, the gateway must decode and resample audio before sending it to FunASR. The first local FunASR runtime target is expected to require mono 16 kHz PCM16 for streaming, so the design keeps a codec/normalization adapter in the gateway.

Future TTS events for the gateway core are reserved:

```json
{ "type": "assistant_text", "text": "我來查..." }
{ "type": "tts_start", "format": "pcm_s16le", "sampleRate": 16000 }
{ "type": "tts_audio", "seq": 1 }
{ "type": "tts_end" }
{ "type": "tts_error", "message": "TTS unavailable" }
```

## Browser UX

ChatInput gets a microphone control and a page-scoped configurable hotkey. The browser client connects to `pi-voice-gateway` with the same Xiaozhi-style voice-session protocol as devices; it does not connect to FunASR directly.

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

ESP32 devices connect over WSS through Cloudflare Tunnel. They should not know FunASR or pi-agent protocols. Their gateway-facing protocol is the same Xiaozhi-style voice-session protocol used by browser clients.

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
  -> gateway passes through or decodes Opus depending on FunASR backend support
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

Browser audio capture can be implemented as a small local adapter, with reference to existing AudioWorklet/WebCodecs patterns. The adapter should emit a format declared by the voice session hello, initially `pcm_s16le` for lowest implementation risk.

Opus decode/encode should be behind a small codec adapter. The implementation plan should choose a maintained Node-compatible Opus library, WebCodecs path, direct backend passthrough, or external codec process after testing install/runtime behavior on the target machine and FunASR backend format support.

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
- Codec conversion failure: close or reset the audio stream with an explicit protocol error.
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
- Browser and device clients both use the same Xiaozhi-style voice-session protocol.
- Device audio uplink accepts binary Opus frames and routes them through pass-through or codec conversion to the ASR path.
- Device final transcript is delivered to pi-web local API and then pi-agent.
- Xiaozhi-style TTS events are reserved and do not break v1 when no backend exists.
- Reconnect after WSS interruption starts a fresh stream cleanly.
- Typecheck passes with `node_modules/.bin/tsc --noEmit`.
- Lint passes with `node node_modules/next/dist/bin/next lint`.
- `next build` is not run during development verification.

Test strategy:

- Unit test settings loading, device auth, protocol parsing, FunASR event parsing, and transcript aggregation.
- Integration test gateway behavior with a fake FunASR WebSocket server that emits partial/final transcripts.
- Add mock Xiaozhi-style browser and device clients that perform hello/listen and send binary audio frames over WSS-compatible WebSocket.
- Browser QA with local dev server verifies mic button, hotkey, partial/final rendering, and auto-send behavior.
- Failure tests cover invalid token, bad sample rate, FunASR down, delivery failure, and reconnect.
