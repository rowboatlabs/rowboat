# Self-hosted meeting transcription

Rowboat can keep its existing capture, live note, summary, and knowledge workflow while sending the two
meeting-audio channels to a transcription worker that you operate. The worker may run on the same machine,
on a private network, or on any VPS/cloud provider. No hosting company is part of the protocol.

This is an advanced, explicit override. When it is configured, Rowboat does **not** silently fall back to its
managed/Deepgram path if the worker is invalid, unreachable, too slow, or incompatible. Meeting start fails
visibly so audio is never sent to an unintended provider.

## Configure

Create `config/meeting-transcription.json` inside the Rowboat work directory. This is
`~/.rowboat/config/meeting-transcription.json` by default, or the equivalent path under
`ROWBOAT_WORKDIR` when that environment variable is set:

```json
{
  "provider": "self-hosted",
  "protocol": "transcribe-stream-v1",
  "baseUrl": "http://127.0.0.1:18091",
  "tokenFile": "/absolute/path/to/rowboat-meeting-stt.token",
  "language": "en"
}
```

The token file must:

- be an absolute path;
- be a regular file, not a symlink;
- contain 32-512 non-whitespace characters; and
- on macOS/Linux, have no group/other permission bits (for example, mode `0600`).

For ephemeral development or a service manager, these environment variables override the URL/token without
putting a secret in the workspace:

```sh
ROWBOAT_MEETING_STT_URL=http://127.0.0.1:18091
ROWBOAT_MEETING_STT_TOKEN='a-random-secret-of-at-least-32-characters'
```

Plain HTTP is accepted only for `localhost`, `127.0.0.1`, or `[::1]`. That covers a same-machine worker
and a restricted SSH/VPN tunnel. A remote address must use trusted HTTPS. URLs containing credentials, query
parameters, or fragments are rejected.

`language` accepts `auto` or a bounded language tag such as `en`, `hi`, or `en-IN`. The default is `en`.

## Protocol: `transcribe-stream-v1`

The current adapter is deliberately small and versioned. It is not advertised as an OpenAI, Deepgram,
WhisperLive, or universal speech protocol.

Every request except `/livez` carries `Authorization: Bearer <token>`.

| Route | Contract |
|---|---|
| `GET /health` | JSON `{"ok":true,"maxStreams":2}` or greater |
| `POST /stream/begin?session=...&language=en` | Create one named mono 16 kHz stream |
| `POST /stream/feed?session=...` | Little-endian mono signed-16 PCM; return a bounded snapshot |
| `POST /stream/finalize?session=...` | Flush and return the final snapshot |
| `POST /stream/reset?session=...` | Release the named stream |

A snapshot contains:

```json
{
  "full": "complete current hypothesis",
  "committed": "stable prefix that will never be revised",
  "tentative": "replaceable suffix",
  "final": false,
  "revision": 4,
  "inputMs": 2240,
  "bufferedMs": 560
}
```

Rowboat opens two named sessions—microphone and system audio—while the model may remain loaded once in the
worker. Main owns the endpoint and token, splits stereo PCM into the two mono feeds, validates all responses,
serializes each connection's feed requests, and resets sessions on stop or renderer exit. The renderer sees
only a random connection ID and bounded snapshots. Generated meeting Markdown records
`transcription_provider: self-hosted` in frontmatter so later processing retains provenance.

A compatible reference worker and provider-neutral Docker deployment are available in
[Meeting Assistant's self-hosted STT directory](https://github.com/Rahulk644/Meeting-Assitant/tree/main/deploy/self-hosted-stt).
That project records one-vCPU/4-GB measurements as a reference, not a Hostinger dependency.

## Current limits

- The worker must implement genuine streaming and stable committed prefixes. A batch-only Whisper/OpenAI
  endpoint needs a separate adapter rather than repeated fake streaming calls.
- This protocol preserves microphone versus system-audio separation but does not add remote diarization.
  System-audio text remains **System audio** until independent speaker evidence or a diarization adapter names
  it.
- Simultaneous local/remote speech stays on separate channels, but this v1 snapshot lacks word timestamps for
  perfect cross-channel interleaving.
- A five-second client queue is the hard backpressure bound. Exceeding it stops the transcription path
  visibly instead of consuming unbounded memory or silently dropping old audio.
- There is no settings UI in this PR. The file/environment boundary keeps the first contribution small and
  reviewable; a future UI should use OS-backed secret storage and preserve the same validation/fail-closed
  behavior.

## Qualification

Before claiming a worker configuration is meeting-ready, test the exact Rowboat artifact and worker revision
with:

1. local-only speech from the start;
2. remote-only speech;
3. simultaneous local/remote speech;
4. a 30-45 minute call;
5. worker restart and network/tunnel loss;
6. mute/unmute and audio-device switching; and
7. Rowboat/renderer exit while both sessions are active.

Record timings, queue lag, memory, and error states without committing audio, transcripts, tokens, names, or
meeting metadata.
