# Photographic Style Port

**English** | [简体中文](README.zh-CN.md)

Current version: v0.5.0

This is an experimental tool that takes a HEIC from an iPhone **older than the iPhone 16**
(iPhone 15, 14, 13 … — any model whose photos match a supported tile layout) and adds the
metadata an iPhone 16/17 photo carries, so that Apple Photos offers the **Photographic Styles**
palette on it (风格 in Chinese, though most people just call it 调色盘).

Since v0.5 it also adds the **iOS 27 Texture/Grain** controls (质感/颗粒) that Apple introduced
with the iPhone 18 Pro. Ported photos get them as part of the port; native iPhone 16/17 photos
get only these controls and are otherwise left byte-identical.

It is an independent HEIC interoperability tool, not an Apple-supported format converter. It
works by reading and rewriting the ISO-BMFF item graph of photo files, and it is experimental.

**Keep your originals.**

## Known issue

- Soft skin currently seems no difference with standard. More images containing people from iPhone 18 is needed for reverse engineering. Investigating and opening issue to upload your contents are welcomed.

- The tweaked photo feel is not identical to those models with stock style tweaking. More images are required too to investigate this issue.

- Standalone iOS app in `swift-port` branch is under construction and is not available until my new mac arrives.
- 
## Use it in a browser

[![Web app visits](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fabacus.jasoncameron.dev%2Fget%2Fnathanatgit-shalielie%2Fweb&query=%24.value&label=web%20app%20visits&style=flat-square)](https://nathanatgit.github.io/Shalielie/)

There is a browser build that needs no install and no command line — drop a photo in, get the
patched one back. It runs entirely on your machine; nothing is uploaded.

**https://nathanatgit.github.io/Shalielie/**

The browser build includes v0.5's Texture/Grain and native-photo mode. The one thing it cannot
do is patch a photo without an embedded thumbnail, because the browser has no HEVC encoder to
create one; use the command-line tool for those.

It is the same porting logic as the Python tool, checked against it byte for byte — see
[`web/README.md`](web/README.md) for how that is verified, and for the two iPhone quirks it
works around. The command-line tool below remains the reference implementation and is the one
to use for batches or for the encoder-based linearthumbnail.

## Download a binary

[![Release downloads](https://img.shields.io/github/downloads/nathanatgit/Shalielie/total?label=release%20downloads&style=flat-square)](https://github.com/nathanatgit/Shalielie/releases)

Each tagged release provides a Python-free command-line executable for:

- Windows x86-64
- Linux x86-64
- macOS x86-64 (Intel)
- macOS arm64 (Apple silicon)

Download the archive for your system from the GitHub Releases page, extract it, and run
`photographic-style-port` (`photographic-style-port.exe` on Windows). Simply run

```bash
uv run photographic_style_port.py patch IN.HEIC OUT.HEIC
```

The executable includes
the Python runtime and both built-in donor profiles; use `--version` to check which release you
have.

The default, phone-validated patch mode still calls `ffmpeg` and `heif-convert`. For a completely
standalone run, use the validated no-encoder mode:

```bash
photographic-style-port patch IN.HEIC OUT.HEIC \
  --linear-thumb reuse-thumbnail --scene-stats donor --light-maps flat
```

The `Build binary release` GitHub Actions workflow builds and smoke-tests all four targets on
manual runs.

## Install from source

Needs **Python 3.12+**. [uv](https://docs.astral.sh/uv/) is the shortest path:

```bash
git clone https://github.com/nathanatgit/Shalielie.git
cd Shalielie
uv sync
```

The default mode also uses two external tools — `ffmpeg` (with libx265) to encode, and
`heif-convert` (libheif) to decode:

| OS              | Install                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| Debian / Ubuntu | `sudo apt install ffmpeg libheif-examples`                            |
| macOS           | `brew install ffmpeg libheif`                                         |
| Windows         | `winget install Gyan.FFmpeg`, then add this repo's `tools/` to PATH |

Windows has no libheif package, so `tools/` ships a drop-in `heif-convert` backed by
pillow-heif, which `uv sync` installs for you:

```powershell
$env:PATH = "$PWD\tools;$env:PATH"
```

Neither tool is required if you use [the no-encoder mode](#no-encoder-mode).

## Usage

```bash
uv run photographic_style_port.py patch INPUT.HEIC OUTPUT.HEIC
```

Copy the output to your iPhone and open it in Photos — Edit should now offer the style
palette, with Texture/Grain on iOS 27. Send it as a **file**, not through the Photo Library,
which re-encodes HEIC to JPEG and strips everything this tool adds.

`patch` chooses what to do from the photo:

| Photo                                        | What happens                                              |
| -------------------------------------------- | --------------------------------------------------------- |
| No style data (iPhones before the iPhone 16) | full port, plus Texture/Grain                             |
| Native style data (iPhone 16/17)             | Texture/Grain added only; everything else byte-identical  |
| Already has Texture/Grain (iPhone 18)        | refused, nothing to do                                    |

`add-texture IN.HEIC OUT.HEIC` runs the second route explicitly.

Useful flags:

| Flag                               | What it's for                                                       |
| ---------------------------------- | ------------------------------------------------------------------- |
| `--report`                       | also write `OUTPUT.HEIC.report.json` describing what changed      |
| `--zip`                          | bundle the HEIC and its report into `OUTPUT.zip` for transfer     |
| `--light-maps target`            | rebuild tone maps from your photo — the flag most likely to help   |
| `--scene-stats donor`            | fall back to donor tone anchors if colors look wrong                |
| `--linear-thumb reuse-thumbnail` | skip the encoder entirely                                           |
| `--texture off`                  | leave out the iOS 27 Texture/Grain items (v0.4.4 output)            |

By default the only file written is the output HEIC. A run summary is printed to the terminal;
pass `--report` or `--zip` if you want it saved as JSON too.

Portrait data — semantic mattes and depth — is carried automatically when the photo has it.
There is no flag, and a photo without it is unaffected.

### No-encoder mode

```bash
uv run photographic_style_port.py patch IN.HEIC OUT.HEIC \
  --linear-thumb reuse-thumbnail --scene-stats donor --light-maps flat
```

Runs with **ffmpeg and heif-convert both absent** by reusing the photo's own thumbnail instead
of encoding a new one. Fewer quality refinements, but zero setup, and the output is
reproducible byte-for-byte across machines.

### Other commands

```bash
uv run photographic_style_port.py profiles              # list the built-in donor profiles
uv run photographic_style_port.py inspect PHOTO.HEIC    # dump style-related metadata as JSON
uv run photographic_style_port.py extract-donor DONOR.HEIC PROFILE.zip
```

`extract-donor` is for adding support for a tile layout that has no built-in profile.

## Use from an AI agent

The CLI is non-interactive and reports in JSON, which makes it easy for coding agents to
drive. This repo ships a ready-made skill in [skills/photographic-style-port/](skills/photographic-style-port/).

**Claude Code** — copy it into your skills directory:

```bash
# just this project
mkdir -p .claude/skills && cp -r skills/photographic-style-port .claude/skills/

# or available everywhere
mkdir -p ~/.claude/skills && cp -r skills/photographic-style-port ~/.claude/skills/
```

Then ask normally — *"add Photographic Styles to these photos"* — and the agent loads the
skill on its own.

**Other agents** (Cursor, Codex, Copilot, Continue): the skill file is plain Markdown. Point
your agent's rules file at it, or paste its contents into `AGENTS.md` / `.cursorrules`.

The skill tells the agent to pick a mode based on what's installed, to process batches one file
at a time, and never to overwrite an original.

## What it actually does

Your photo's pixels are untouched — the primary image, HDR gain map, thumbnail and Exif all
stay yours, and the decoded output is pixel-identical to the input. What gets added is the
style machinery Photos looks for: the style plist and Apple MakerNote tag `0x54` from a
normalized donor profile, plus a `linearthumbnail`, scene statistics and light maps computed
from your own photo. For Texture/Grain it adds iOS 27's `texture_styles` item together with the
12 empty 2026 semantic mattes that must accompany it (Future investigation needed, seems related with soft skin fiter).

## Limits

- **Only two tile layouts (48/12 and 45/15) have built-in profiles.** Photos without an
  embedded thumbnail have been supported since v0.5, but need the default (encoder) mode.
- **Texture/Grain needs iOS 27** on the phone that opens the photo.
- **Not validated by Apple, and results vary by photo.** Try the flags above before concluding
  it does not work.
- **A normal photo cannot be turned into a "people" photo.** Portrait data is only ever copied
  from the photo itself, never invented.

## Disclaimer

This project is **not affiliated with, authorized, sponsored, or endorsed by Apple Inc.**

Apple, iPhone, Apple Photos and Photographic Styles are trademarks of Apple Inc., used here
only to describe what this tool interoperates with. No Apple software, source code or SDK is
included or redistributed.

The tool rewrites photo files. It is experimental, it has never been validated by Apple, and
it can produce files that behave unpredictably in any photo application. Work on copies.

## License

[MIT](LICENSE). The license covers this project's own source code; it makes no claim over any
third-party format, trademark or metadata structure described above.

## Why "Shalielie"?

Shalielie is the romanized pronunciation of a Chinese phrase, and it is my reply to Apple's
"shareholders in spirit" — the fans who defend every Apple decision as if they
owned the company. For example:

> "Apple doesn't bring the Photographic Styles palette to older models because it wants to
> provide a better, more consistent user experience."
>
> "Shalielie 🙄."