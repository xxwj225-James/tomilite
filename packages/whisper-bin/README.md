# @tomilite/whisper-bin

Vendored `whisper-cli` binary used for **local, offline speech-to-text**.

The actual binaries are **not committed** — run `node scripts/fetch-whisper-bin.js`
(or just `npm run pack`, which calls it) to populate `bin/`.

## Why not committed

10.9 MB of DLLs would permanently live in git history for every clone of an
otherwise binary-free repo. Fetching at _pack_ time keeps the repo small, and
the download is verified against a pinned SHA-256.

Note this is **build-time** fetching, not runtime. Downloading and executing an
unsigned binary on the end user's machine is a Defender/SmartScreen magnet — the
installer always ships the binary, never downloads it.

## What gets fetched

`ggml-org/whisper.cpp` release **b4938**, asset `whisper-bin-x64.zip`.

17 files, ~10.9 MB:

| File                                                     | Why                                                                                                                                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whisper-cli.exe`                                        | The CLI itself (only 479 KB — a thin shell)                                                                                                                                      |
| `whisper.dll`                                            | Transcription implementation                                                                                                                                                     |
| `ggml.dll`, `ggml-base.dll`                              | Tensor ops                                                                                                                                                                       |
| `ggml-cpu-*.dll` (×9)                                    | **All nine are required** — ggml picks a CPU-microarchitecture variant at runtime (`ggml-cpu-haswell.dll` on the author's machine). Ship a subset and it may fail on other CPUs. |
| `vcomp140.dll`                                           | OpenMP runtime — linked in, and **not included in the upstream zip**                                                                                                             |
| `msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll` | MSVC runtime — also absent upstream                                                                                                                                              |

The four runtime DLLs are copied from the build machine's `%SystemRoot%\System32`.
Microsoft's redistributable licence permits shipping them, and putting them
alongside `whisper-cli.exe` means Windows resolves them from the application
directory — System32 is never touched. A build machine without the VC++
Redistributable will fail loudly rather than produce a broken installer.

## Runtime layout

In the packaged app the folder lands at
`resources/app/packages/whisper-bin/bin/` (the `packages/**/*` files glob),
resolved through the same `join(__dirname, '..', '..', '..')` idiom the API
already uses to locate the Prisma CLI. No `process.resourcesPath` involved.
