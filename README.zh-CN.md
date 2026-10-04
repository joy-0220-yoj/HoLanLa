# Photographic Style Port

[English](README.md) | **简体中文**

当前版本：v0.5.0

注意这是一个实验性工具：它为 **iPhone 16 之前**的 iPhone（iPhone 15、14、13 …… 只要照片符合受支持的
tile 布局即可）拍摄的 HEIC 照片补上 iPhone 16/17 照片所携带的元数据，让编辑照片时，呈现 **摄影风格**（俗称“调色盘”）。

从 v0.5 开始，加入了随 iPhone 18 Pro 推出的 **iOS 27 质感/颗粒**（Texture/Grain）调节入口。
移植的照片会在移植时一并加上；原生的 iPhone 16/17 照片只添加这两个入口相关元数据，不触碰文件其他内容。

此工具不是 Apple 官方的格式转换器。它通过读取并改写照片文件的ISO-BMFF item 结构来工作，完全是个人出于愤怒开发，并 vibecoding 而来，与Apple没有任何关系。

**请务必保留原图。**

## 已知问题

- 目前“柔肤”与“标准”滤镜看起来没有明显差异。需要更多带有人物的 iPhone 18 照片来进行逆向分析。正在研究，欢迎提交 issue 以上传你的样图。

- 有反馈声称，经过移植的照片用同样的调色盘参数调整后，与原生机型自带的风格微调效果并不完全一致。也需要更多样本来进一步研究这个问题。

- swift-port 分支中的独立 iOS 应用仍在开发中，等到我的新 Mac 到货后才会推出。

## 在浏览器中使用

[![Web app visits](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fabacus.jasoncameron.dev%2Fget%2Fnathanatgit-shalielie%2Fweb&query=%24.value&label=web%20app%20visits&style=flat-square)](https://nathanatgit.github.io/Shalielie/)

网页版为纯前端处理，支持 PWA ，可直接通过 Safari 分享按钮分享到主屏幕，无需安装、无需命令行。把照片拖如待放区，即可得到输出。它完全在你的设备上运行，不会上传任何内容。

**https://nathanatgit.github.io/Shalielie/**

网页版包含 v0.5 的质感/颗粒功能和原生照片模式。但前端脚本没有办法处理无内嵌缩略图（`linearthumbnail`）的照片（浏览器没有 HEVC 编码器，无法生成缩略图），这类照片请使用命令行工具。

网页版与 命令行/Python 工具使用同一套移植逻辑，见 [`web/README.md`](web/README.md)。
批量处理或需要基于编码器，需要生成内嵌缩略图时请用 命令行/Python 版本。

## 下载可执行文件

[![Release downloads](https://img.shields.io/github/downloads/nathanatgit/Shalielie/total?label=release%20downloads&style=flat-square)](https://github.com/nathanatgit/Shalielie/releases)

下载时请对应平台，可执行文件支持：

- Windows x86-64
- Linux x86-64
- macOS x86-64（Intel）
- macOS arm64（Apple 芯片）

从 GitHub Releases 页面下载对应系统的压缩包，解压后运行 `photographic-style-port`（Windows 上为
`photographic-style-port.exe`），执行：

```bash
photographic-style-port patch IN.HEIC OUT.HEIC
```

可执行文件内置了 Python 运行时和两个内置 donor 配置；用 `--version`
查看当前版本。

默认的 patch 模式仍会调用 `ffmpeg` 和 `heif-convert`。如果想完全独立运行，
请使用已验证的免编码器模式：

```bash
photographic-style-port patch IN.HEIC OUT.HEIC \
  --linear-thumb reuse-thumbnail --scene-stats donor --light-maps flat
```

`Build binary release` 由 GitHub Actions 工作流自动生成。

## 从源码安装

需要 **Python 3.12+**。最省事的方式是用 [uv](https://docs.astral.sh/uv/)：

```bash
git clone https://github.com/nathanatgit/Shalielie.git
cd Shalielie
uv sync
```

默认模式还需要两个外部工具——用于编码的 `ffmpeg`（需带 libx265），以及用于解码的
`heif-convert`（libheif）：

| 系统            | 安装方式                                                  |
| --------------- | --------------------------------------------------------- |
| Debian / Ubuntu | `sudo apt install ffmpeg libheif-examples`                |
| macOS           | `brew install ffmpeg libheif`                             |
| Windows         | `winget install Gyan.FFmpeg`，再把本仓库的 `tools/` 加入 PATH |

Windows 上没有 libheif 包，所以 `tools/` 附带了一个基于 pillow-heif 的 `heif-convert` 替代品，
`uv sync` 会自动安装所需依赖：

```powershell
$env:PATH = "$PWD\tools;$env:PATH"
```

如果使用[免编码器模式](#免编码器模式)，这两个工具都不需要。

## 用法

```bash
uv run photographic_style_port.py patch INPUT.HEIC OUTPUT.HEIC
```

把输出文件拷到 iPhone，在“照片”中打开——点“编辑”后应该就能看到风格调色盘，iOS 27 上还会有质感/颗粒。
请以**文件**形式传输，不要通过照片图库：图库会把 HEIC 重新编码为 JPEG，并去掉本工具添加的所有内容。

`patch` 会根据照片自动决定怎么处理：

| 照片                                   | 处理方式                                    |
| -------------------------------------- | ------------------------------------------- |
| 没有风格数据（iPhone 16 之前的机型）   | 完整移植，并加上质感/颗粒                   |
| 有原生风格数据（iPhone 16/17）         | 只添加质感/颗粒，其余内容逐字节不变         |
| 已经有质感/颗粒（iPhone 18）           | 拒绝处理，无需操作                          |

`add-texture IN.HEIC OUT.HEIC` 可以显式执行第二种处理。

常用参数：

| 参数                               | 用途                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| `--report`                         | 额外写出 `OUTPUT.HEIC.report.json`，记录改动内容      |
| `--zip`                            | 把 HEIC 和报告打包成 `OUTPUT.zip`，方便传输           |
| `--light-maps target`              | 根据你的照片重建色调图——最可能改善效果的参数          |
| `--scene-stats donor`              | 颜色看起来不对时，改用 donor 的色调锚点               |
| `--linear-thumb reuse-thumbnail`   | 完全跳过编码器                                        |
| `--texture off`                    | 不添加 iOS 27 质感/颗粒项（即 v0.4.4 的输出）         |

默认只写出输出的 HEIC 文件，运行摘要会打印在终端中；如果还想保存为 JSON，请加 `--report` 或 `--zip`。

人像数据（语义遮罩和深度）在照片中存在时会自动保留。

### 免编码器模式

```bash
uv run photographic_style_port.py patch IN.HEIC OUT.HEIC \
  --linear-thumb reuse-thumbnail --scene-stats donor --light-maps flat
```

在 **ffmpeg 和 heif-convert 都不存在**的情况下也能运行：它直接复用照片自带的缩略图，而不是重新编码
一张。画质上的细节优化少一些，但无需任何配置，而且在不同机器上输出逐字节一致、可复现。

### 其他命令

```bash
uv run photographic_style_port.py profiles              # 列出内置的 donor 配置
uv run photographic_style_port.py inspect PHOTO.HEIC    # 以 JSON 输出与风格相关的元数据
uv run photographic_style_port.py extract-donor DONOR.HEIC PROFILE.zip
```

`extract-donor` 用于为尚无内置配置的 tile 布局添加支持。

## 通过 AI 智能体使用

本仓库在
[skills/photographic-style-port/](skills/photographic-style-port/) 中提供了一个现成的 skill。

**Claude Code**——把它复制到你的 skills 目录：

```bash
# 仅当前项目
mkdir -p .claude/skills && cp -r skills/photographic-style-port .claude/skills/

# 或全局可用
mkdir -p ~/.claude/skills && cp -r skills/photographic-style-port ~/.claude/skills/
```

然后正常提问即可——比如 *“给这些照片加上摄影风格”*——智能体会自动加载这个 skill。

**其他智能体**（Cursor、Codex、Copilot、Continue）：skill 文件就是普通的 Markdown。在智能体的规则文件
中引用它，或把内容粘贴进 `AGENTS.md` / `.cursorrules`。

这个 skill 会告诉智能体：根据已安装的工具选择模式，批量处理时逐个文件进行，不覆盖原图。

## 它实际工作原理

照片的像素不会被改动，主图像、HDR 增益图、缩略图和 Exif 都原样保留，解码后的输出与输入逐像素一致。
修改照片Metadata，添加的是“照片” App 所需的风格相关数据：来自归一化 donor 配置的风格 plist 和 Apple MakerNote 标签
`0x54`，以及根据你自己的照片计算出的 `linearthumbnail`、场景统计和光照图。对于质感/颗粒，它会添加
iOS 27 的 `texture_styles` 项，以及随之出现的 12 个空的 2026 语义遮罩（待确认，可能是soft skin模式相关）。

## 限制

- **只有两种 tile 布局（48/12 和 45/15）有内置配置。** 自 v0.5 起支持没有内嵌缩略图的照片，但需要使用
  默认（编码器）模式。
- **质感/颗粒需要打开照片的手机运行 iOS 27。**
- **未经 Apple 验证，效果因照片而异。** 在放弃之前，可以请先试试上面的不同的运行参数。
- **无法把普通照片变成“人像”照片。** 人像数据只会从照片本身复制，绝不会凭空生成。

## 免责声明

本项目与 Apple Inc. **没有任何关联，也未获得其授权、赞助或认可**。

Apple、iPhone、Apple Photos 和 Photographic Styles 是 Apple Inc. 的商标，此处仅用于描述本工具与之
互操作的对象。本项目不包含、也不再分发任何 Apple 软件、源代码或 SDK。

本工具会改写照片文件。它是实验性的，从未经过 Apple 验证，生成的文件在任何照片应用中都可能出现不可预期的
行为。请在副本上操作。

## 许可证

[MIT](LICENSE)。许可证仅涵盖本项目自身的源代码，不对上文提到的任何第三方格式、商标或元数据结构主张权利。

## Why Shalielie？

此仓库的初衷是为了怼某个评论区 Apple “精神股东”

> “Apple 不给老机型开放摄影风格调色盘，是因为 Apple 想提供更好、更一致的用户体验。”
>
> “瞎咧咧 🙄。”