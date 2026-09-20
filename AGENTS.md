# macmic contributor guidance

macmic (麦麦) is a local dictation application for Apple Silicon and Windows x64. Keep the waveform overlay non-focusable and hidden while idle. Preserve cancellation semantics and the fallback to raw text if optional AI processing fails.

- Run `pnpm test` and `pnpm build:renderer` after functional changes.
- Build the renderer before packaging Electron.
- The persistent Python worker exchanges JSON over stdin/stdout. Diagnostic output belongs on stderr; never log audio, clipboard contents, credentials, or complete transcripts.
- Settings and user vocabulary live outside the repository. Do not commit databases, local configuration, audio, model weights, runtime environments or credentials.
- Keep the upstream LICENSE verbatim and preserve NOTICE attribution.
- Changes to data directories require an explicit migration plan; do not silently reset settings or re-download a multi-GB model.
- No telemetry, network ASR, or automatic transmission of clipboard/application context.
