# HoLanLa

[繁體中文](README.md) | **English**

Version: v0.8.0

HoLanLa is an experimental browser tool that adds Photographic Styles and iOS 27
Texture/Grain metadata to supported photos. Photo analysis, inference and conversion
run exclusively on your device. Photos are never uploaded, and no usage statistics
(telemetry) are collected or transmitted.

**Keep your originals! Keep your originals! Keep your originals! Important things deserve saying three times.**

Like the original project, [nathanatgit/Shalielie](https://github.com/nathanatgit/Shalielie),
HoLanLa was developed through **vibe coding**: describing requirements in natural language
and using AI to help write and modify the code.

https://joy-0220-yoj.github.io/HoLanLa/

## Changes in v0.8.0

- Replace binary profile data in prebuilt ZIP archives with readable fields and explicit numeric values, generating the profiles in the browser so their contents and generation process are easier to inspect, trace and verify.
- Remove comparison test tools that depend on the old ZIP profiles.
- Remove the MediaPipe Tasks Vision runtime to avoid the transmission of performance and usage metrics (telemetry) described in MediaPipe's [official privacy notice](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md#privacy-notice); use ONNX Runtime Web WASM for all vision inference.
- Independently reproduce the conversions of all three community ONNX models currently used from Google's official original models and verify that their weights and computation graphs match.
- Pin the three community ONNX conversions to release revisions and SHA-256 hashes; show Google's original model names and versions with a community ONNX annotation in cache management.
- Generate independent 10-bit Display P3 linear thumbnails, correct neutral delta colour tags and property-index overflow, and share identical image properties.
- Upgrade libheif-js to 1.23.5 while retaining automatic JavaScript/asm.js fallback.
- Use matching JavaScript versions for page loading and Service Worker precaching, and require matching script versions offline.
- Fall back to local FFmpeg.wasm decoding for black/white range calibration when WebCodecs cannot expose native YUV samples, allowing processing to continue.
- Correct the rejection of HEIC image data stored before metadata, and support an additional Apple Display P3 ICC profile variant.
- Add local DNG (ProRAW) development and HEIC import, including lossless-JPEG Apple ProRAW, with tiled development and sequential WASM runtime release to reduce memory use, source DNG (ProRAW) inspection and native-mask reuse, decoder integrity checks and resource cache management.
- Move ONNX Runtime inference to a terminable worker, releasing the runtime on timeout or allocation failure.
- Fix total elapsed time resetting after a recoverable model preparation failure and identify insufficient memory explicitly.
- Add a Chinese title, feature description and dedicated image for link previews, and update browser and home-screen icons.
- Update related tests covering generated profiles, ONNX Runtime inference and resource caching.

## Why HoLanLa?

This project is based on [nathanatgit/Shalielie](https://github.com/nathanatgit/Shalielie).
The original name, **Shalielie**, is a phonetic rendering of **瞎咧咧**, an expression
for talking nonsense. Its author chose the name to poke fun at Apple's "imaginary
shareholders": fans who defend every Apple decision as though they own shares. For example:

> "Apple does not offer the Photographic Styles palette on older iPhones because
> it wants to provide a better, more consistent user experience."
>
> "瞎咧咧 🙄."

This version renames the project **唬爛啦 (HoLanLa)**, using a familiar Taiwanese
expression for "That's bullshit!" to carry on the original's tongue-in-cheek response
in a Taiwanese voice: "唬爛啦 🙄."

## Photo workflow

Photos from any phone or camera, as well as screenshots, can be imported in the
supported HEIC/PNG/JPEG/WebP/DNG (ProRAW) formats; browser decode/HEVC encoding support still
determines which files can be processed.

DNG (ProRAW) using lossless JPEG compression is developed locally with LibRaw WASM using camera white balance, then encoded as an 8-bit sRGB HEIC. RAW data, the original HDR rendering and ProRAW editing flexibility are not retained, and colour may differ from Apple Photos. JPEG XL DNG (ProRAW) is not supported yet. Choose JPEG lossless (not JPEG XL) in Camera format settings for future photos; this does not convert existing files. ProRAW images above 12 megapixels are developed tile by tile and reduced to about 12 megapixels to limit memory use. HEVC encoding starts after the LibRaw worker has been released. Large RAW layouts that cannot be processed in tiles are rejected before development.

“Compare all embedded data” reads the source DNG (ProRAW) IFD/SubIFD graph, RAW primary image, embedded previews, semantic masks, gain tables and tone curves. Recognized, decodable native masks aligned to the primary image take precedence and are re-encoded into HEIC; local inference fills missing data when enabled. DNG (ProRAW) gain tables and tone curves are available for inspection but are not yet applied to LibRaw development.

The decoder is downloaded only for DNG (ProRAW) imports. `libraw-wasm` 1.6.0 (LibRaw 0.22.1) is pinned, SHA-256 checked and retained in the resource cache for subsequent offline use. LibRaw-Wasm uses ISC, LibRaw uses CDDL 1.0, and Little CMS uses MIT; see [LibRaw-LICENSES.txt](LibRaw-LICENSES.txt) for sources and terms.

Selected photos process automatically in order. Original and processed thumbnails
stay at the top of each card; failed processing retains the original. Actions and
progress are below the photos, with each new progress line prepended above older
steps. Long histories scroll within their own area without pushing that card's photos
down. Reading older messages preserves the current position as new messages arrive.
Successful results show a small processed
HEIC image directly on the card for native iPhone long-press saving. Each result also
provides download, optional Photos sharing, and **Compare all embedded data**.
Browsers without native HEIC images can render a local canvas preview; save those
results using the file download or Photos sharing to retain the HEIC metadata.

Status times measure each individual step (including queue waiting) and freeze when
that step ends. Steps under a second display milliseconds (or `<1ms`); longer steps
display seconds to three decimal places. Completion/error summaries show the total time
from queue entry to completion, including queue waiting, and keep that value fixed.
Face corrections start a new total for each run. Shared model loading,
face detection and multiclass segmentation are timed separately from generating and
encoding each output mask. Person/Portrait reuse one encode. Native hair masks are
preserved on the lossless paths; the browser generator does not encode a new hair
mask. Synchronous decoding and inference can block the UI and pause the visible timer; it
catches up using the monotonic clock. The pipeline yields between stages and face
detection passes so the browser can refresh. **Compare all embedded data** is the
first action on each result card. Its labels include the localized name and technical
identifier (for example, Hair matte / `semantichairmatte`); progress uses only localized
names. All local module imports share the entry point's build tag so raster and
native HEIC paths cannot reuse different cached face/progress implementations.

Results with generated face detections provide **Correct faces** after the comparison
action. The dialog shows an upright photo, numbered face boxes, corresponding face
crops and zoom controls. Toggle exclusions and apply once; cancel discards the draft.
Applying updates the same card's HEIC download, Photos sharing, long-press thumbnail,
face count and inspection/overlay. Saved selections can be reopened and restored.
Corrections reuse the first detections and shared segmentation, rebuild face-dependent
local masks and person metadata, and reuse already encoded primary/HDR/thumbnail
pixels. Native source masks and shared skin/person masks are preserved. Excluding all
detections removes all generated person instances and face records. Restoring every
face restores the original output bytes. Failed updates leave the previous result and
selection available. The dialog corrects this run's detections; it does not add faces
or edit masks already embedded by the camera.

Native style photos retain
their original auxiliaries and receive Texture/Grain plus required v16 style schema updates; style-less photos use the
profile graft and independently generated 10-bit linear thumbnail.

The embedded-data inspection panel compares actual input/output metadata,
item payloads and masks.

Validation: `node tests/web/basic-workflow-browser.mjs` with an existing Playwright
runtime checks ordinary native output byte-for-byte, inspection,
and 320/390-pixel layouts. `node tests/web/linear8.mjs` validates real HEVC samples
using an externally installed FFmpeg test executable; the website loads FFmpeg.wasm/x265 on demand.

## Run locally

```bash
git clone https://github.com/joy-0220-yoj/HoLanLa.git
cd HoLanLa
python tools/serve_web.py
```

Open `http://localhost:8000/`. The static website has no build step or runtime
package installation. Python is only used by the optional development server;
the converter itself runs in JavaScript.
First use needs internet access to download the required public encoder, decoder or models.
Successful photo processing still depends on the browser's decoding and HEVC encoding support.

## Deploying

[.github/workflows/pages.yml](.github/workflows/pages.yml) validates and publishes `web/`
to GitHub Pages on pushes to `main` or `master` that touch the website, its tests,
or deployment settings. Enable
it once under **Settings → Pages → Source → GitHub Actions**. There is no build step; the
workflow checks the following before uploading:

- no `.heic`/`.heif` anywhere under `web/` — a guard against publishing a personal photo
- profile generation and encoding modules are present and non-empty
- the PWA metadata, icon dimensions, registration, and offline asset list are consistent
- portable web regressions and translations pass via `npm test`

For local testing, follow [Run locally](#run-locally). The helper serves HTTP and
supplies COOP/COEP headers; localhost is a secure-context exception and needs no certificate.

For iPhone/LAN testing, use the hosted website or trusted local HTTPS.
WebCodecs requires a secure context: loopback HTTP
is eligible, but plain HTTP through a LAN IP is not equivalent and does not provide
the required encoding/PWA APIs. See [WebCodecs](https://www.w3.org/TR/webcodecs/#videoencoder-interface)
and [Secure Contexts](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy).

Generate certificates using Python (uv manages the script's isolated `cryptography`
dependency without changing the project's dependencies):

```bash
uv run tools/create_https_cert.py --ip YOUR_LAN_IP
python tools/serve_web.py --bind 0.0.0.0 --port 8443 --cert .local-https/lan-cert.pem --key .local-https/lan-key.pem
```

Replace `YOUR_LAN_IP` with the computer's actual LAN IP, then open `https://YOUR_LAN_IP:8443/`
on the iPhone. Transfer only `.local-https/rootCA.cer` to the iPhone and open it.
Install the profile under Settings → Profile Downloaded, then enable it under
Settings → General → About → Certificate Trust Settings. Merely bypassing a
certificate warning is insufficient. Private keys stay on the computer, outside
the served directory; `.local-https/` is excluded from Git. The tools do not change
OS trust settings automatically.

The server certificate lasts 90 days. Re-running the generator renews it or changes
the IP while retaining the existing CA. If the CA files were deleted and regenerated,
the new `rootCA.cer` must be installed and trusted again on the iPhone.

Existing certificates from another tool can also be supplied:

```bash
python tools/serve_web.py --bind 0.0.0.0 --port 8443 --cert path/to/lan-cert.pem --key path/to/lan-key.pem
```

On secure static hosting, the app waits for the current build’s Service Worker
to control the page and verifies headers before at most one reload per build.

Everything uses relative paths, so a project subpath like `https://user.github.io/repo/`
works without configuration.

## PWA and offline use

The site is installable as a Progressive Web App. `web/manifest.webmanifest` supplies its app
identity and icons, while `web/sw.js` precaches the complete converter, generated-profile source, and
all first-party JavaScript. Paths stay relative so the same files work at the root of a
domain or under a GitHub Pages project subpath.
Page loading and offline precaching use the same JavaScript version tag; offline script requests require an exact version match.

Website files use the network first when available, then fall back to saved copies.
ONNX Runtime Web WASM's JavaScript runtime/loader scripts, WASM engine and three ONNX models are retained locally after successful downloads and subsequently
loaded from persistent cache, including after closing and reopening the browser.
The asset cache is independent of website releases and is not deleted by website updates; changing
an asset URL or the asset-cache revision requires a new download. Status messages
distinguish downloads from local-cache reads. Only public code and models are cached,
never photos. The LibRaw DNG (ProRAW) decoder and FFmpeg encoder use the same asset cache. A reopened page still needs to initialize the engine and model instances.

ONNX Runtime is pinned to `1.23.2`; three community ONNX models use pinned release revisions and SHA-256 checks.
Cache management shows Google's original model names and versions: BlazeFace and Face Landmarker
are `1` (float16 sources), SelfieMulticlass is `1` (float32 source), with a community ONNX annotation.
Actual ONNX revisions remain the cache identities. Open **Manage resource cache** beneath the photo picker
to inspect versions, local status and sizes. Current and previous versions are listed separately.
Delete a version individually, or choose **Delete all cached resource versions** to clear
all versions, including ONNX Runtime JavaScript runtime components. Deletion waits for queued photo processing to finish. Deleting a version used by this page also releases its live
instances; needed resources download again.

Private browsing, clearing site data or browser storage eviction can remove these assets.
Unavailable storage or failed cache writes produce a warning that a later visit may need
another download; see the [Cache API storage limits](https://developer.mozilla.org/en-US/docs/Web/API/Cache).
The optional libheif decoder remains outside this persistent cache. If automatic
decoding cannot analyze the photo, the default scene statistics in the locally generated profile are retained.

After changing runtime files or the manifest, check that the offline asset list is complete:

```bash
node tests/web/check-pwa.mjs
```

## What it ships

The website loads pinned FFmpeg.wasm/x265 and its worker on demand; no native FFmpeg installation is required. New HEVC main images, ordinary auxiliaries and detected masks use WebCodecs; synthetic assets and 10-bit linear thumbnails use FFmpeg.wasm/x265.
Some optional local verification tests use native FFmpeg; it is not a website dependency.
ONNX Runtime's WASM runtime is used for local inference and is unrelated to FFmpeg.

| | |
|---|---|
| Size | First-party JavaScript with generated profiles; optional ~33 MB FFmpeg.wasm/x265 runtime |
| Requests | `web/index.html`, `web/app.js`, first-party modules; profiles generated locally for each layout |
| External | optional decoder, ONNX Runtime, ONNX models and FFmpeg.wasm/x265 encoder — see below |
| Hosting | local HTTP on localhost, or the hosted HTTPS website; COOP/COEP supplied by the development server or Service Worker |

## Optional external dependencies

HEIC face analysis, color/brightness analysis and auxiliary-image inspection always use automatic
decoding. The app first tries WebCodecs VideoDecoder and loads the classic libheif-js 1.23.5
asm.js build from jsDelivr only if decoding or external color/crop handling fails. Progress
records decoder/encoder names and automatic fallback reasons.
Successful automatic fallback shows why asm.js was used; decoding is marked as failed
only when all available decoding paths fail.
HEIC source inputs for missing thumbnails, independent linear thumbnails and full re-encoding
still try `createImageBitmap()`/`Image.decode()` first. Native failure uses automatic WebCodecs
decoding with asm.js fallback. Fallback surfaces are color-managed Display P3 canvases without a
gamut-clipping sRGB intermediate. The asm.js source path supports standard sRGB/Display P3
ICCs (including linear variants) and known SDR nclx/SPS colors; unknown ICCs, HDR transfers
or conflicting colors fail explicitly instead of producing incorrectly colored output.
Independent linear thumbnails still isolate the SDR primary without applying a gain map,
and undo mirroring/rotation to recover stored orientation. Generating only a neutral HDR
map requires no source decode. Primary HEVC encoding uses WebCodecs. Black/white range calibration first reads
native YUV samples from WebCodecs; unavailable readback falls back to local FFmpeg.wasm decoding of the same
probe, measuring black/white sample values without RGB conversion or relying solely on browser range metadata.

On Windows/Edge, HEIC decoding does not imply HEVC encoding support through WebCodecs.
libheif-js asm.js provides decoding only; it cannot provide an HEVC encoder.
The app probes HEVC Main8 at the actual dimensions across variable/constant bitrate,
quality/realtime latency, hardware/OS encoder preferences and codec levels. Missing thumbnails,
HDR maps, linear thumbnails and primary re-encoding check the required encoding support before
downloading a decoder or decoding the full photo. If every configuration is unsupported, these
paths stop early. Container edits preserving existing image items remain available; new image
items require a usable HEVC encoder.

ICC recognition validates the matrix, D50 white point and all three channel curves. Standard
sRGB/Display P3 matrix/TRC profiles (including linear variants) become WebCodecs color settings;
progress labels them, for example `ICC: Display P3`. YUV matrix/range still come from nclx or
the HEVC bitstream, never from an RGB ICC profile. Custom LUTs/curves, malformed profiles and
conflicting color descriptions remain fallback cases.
If a decoder ignores ICC primaries/transfer overrides or a supported HEIF/HEVC YUV matrix,
native YUV planes are copied verbatim into a frame with corrected color tags, preserving format,
crop and sample values. The matrix comes from source metadata, such as `smpte170m`, never ICC.
Progress reports that HEIF/ICC tags were applied. RGB output, unreadable native YUV, unsupported
matrices and mismatched YUV range still trigger fallback.
Auxiliary images also support D50, linear `kTRC` `GRAY` ICC profiles. WebCodecs reads the
native luma plane and normalizes full/limited sample range for a scalar grayscale preview,
without display gamma changing mask coverage. Single images and grids, with 8/10/12-bit
samples, are supported; PNG previews are quantized to 8-bit. Progress identifies
`ICC: Gray Linear` and the auxiliary data preview. This path is restricted to auxiliary
images. Other gray curves or complex ICCs automatically fall back to asm.js.
Image orientation follows each item's `ipma` association order for `irot`/`imir`, rather than
assuming a fixed mirror/rotate sequence. Primary analysis, auxiliary previews, person geometry
and generated masks use the same transform and its inverse when storing pixels. Preserved
source images retain their original order; generated masks inherit the primary's order.

The asm.js fallback still decodes full-resolution images on the main thread before scaling;
large photos can temporarily block interaction. Decoded images are cached for reuse. Auxiliary items
are exposed as standalone primaries with their compressed samples, colors and transforms preserved.

These requests fetch processing code; photo data stays on the device. Optional scene
analysis failures retain the default scene statistics and fixed light maps in the locally generated profile.
Routes requiring decoded pixels or new HEVC
images still need a working decoder/encoder and report an error if those are unavailable.

To serve the decoder locally, vendor the matching classic build and point `LIBHEIF_URL` at it:

```bash
npm pack libheif-js@1.23.5
tar -xzf libheif-js-1.23.5.tgz
mkdir -p web/vendor
cp package/libheif/libheif.js web/vendor/
```

Only with experimental Soft Skin support enabled, `web/src/face-mattes.js`
lazily downloads ONNX Runtime Web WASM and models for face data or a missing portrait effect matte.
ONNX Runtime handles detection, landmarks and segmentation.

| Download | Purpose | Approximate size |
| --- | --- | --- |
| ONNX Runtime Web WASM 1.23.2 and JavaScript components | Runs all ONNX inference locally. | 12.0 MB |
| Google MediaPipe BlazeFace (community ONNX version) | Face detection for landmark crops. | 0.42 MB |
| Google MediaPipe Face Landmarker (community ONNX version) | 478 landmarks and person metadata. | 4.92 MB |
| Google MediaPipe SelfieMulticlass (community ONNX version) | Six-class confidence maps for skin and person masks. | 16.45 MB |

**ONNX Runtime Web WASM** uses the WASM provider of `onnxruntime-web@1.23.2`
with externally hosted [BlazeFace ONNX](https://huggingface.co/fernandotonon/QtMeshEditor-blazeface-onnx),
[478-point Face Landmarker ONNX](https://huggingface.co/senty-au/face_landmarks_detector-ONNX)
and [SelfieMulticlass ONNX](https://huggingface.co/senty-au/selfie_multiclass_256x256-ONNX).
These are community ONNX conversions of Google's TFLite models. Conversion occurs before
distribution; the browser downloads and runs the published ONNX files.
No model binary is included in this repository. Fixed artifacts are checked against SHA-256;
the initial download is about 33.8 MB and subsequent uses read from local cache.
Sizes describe pinned files; progress uses the actual response. Inference happens in the browser;
the photo is never sent with download requests. All three pinned ONNX models have been compared
with independent conversions of Google's official original models, confirming matching weights and computation graphs.
ONNX Runtime rebuilds pose from canonical face coordinates with a weighted geometric fit and the existing
Apple angle calibration; Apple Photos behavior still needs device validation.
ONNX Runtime's [privacy documentation says WASM contains no telemetry](https://github.com/microsoft/onnxruntime/blob/main/docs/Privacy.md).
Initial downloads still contact jsDelivr, Hugging Face and their file hosts, which may retain ordinary connection logs.
Resource cache management separately handles ONNX Runtime, detector, landmarks and segmentation.

With Soft Skin support unchecked, ONNX Runtime and its models are neither downloaded nor initialized,
and already loaded models are not used for inference. Existing native Portrait effect mattes
are preserved; missing mattes are omitted. Analyze photo content controls photo analysis and
style data adjustments; it does not independently activate the vision engine.
With Soft Skin enabled, Portrait-only generation requires the segmenter without the detector or landmark models.
Preparation displays separate runtime loading, WASM/face/segmentation downloads and WASM initialization steps.
Downloads show bytes received, plus a percentage
and progress bar when the server supplies a total size; otherwise they show bytes
and an indeterminate bar. Initialization is indeterminate because it has no measurable
percentage. First-use time depends on the connection and device; later photos in the
same page reuse initialized models. DNG (ProRAW) processing releases WASM runtimes between development, person inference and FFmpeg encoding to avoid overlapping large heaps; model files remain cached. Downloads stop after 30 seconds without new data;
ONNX Runtime preparation and asynchronous model initialization each have a
120-second limit. ONNX Runtime inference runs in a dedicated worker that can be terminated on timeout to release its WASM memory. Errors identify the affected resource and remain in
the result card; check the connection and process the photo again. A shared runtime
or segmentation failure is not automatically retried for Portrait on the same photo.
Reloading or reopening the browser creates new model instances while reading WASM and model bytes from persistent local cache first. Detection, landmarks and SelfieMulticlass
all use ONNX Runtime WASM on the CPU. Detection and segmentation are timed
in their own later steps.
Group photos use one full-frame face pass plus four overlapping enlarged crop passes; detections
are remapped to full-image coordinates and deduplicated before masks and people metadata are built.

Writing that mask needs HEVC. The implementation asks `VideoEncoder.isConfigSupported()` for
an HEVC encoder and uses the returned `HEVCDecoderConfigurationRecord` as the matte's `hvcC`
property. If face/mask generation is unavailable, otherwise supported routes continue with
empty 2026 semantic mattes and the result row explains why no generated face mask was included.
Routes requiring new main images or linear thumbnails still need an HEVC encoder; a missing
Portrait effect matte is omitted when its generation is unavailable.

The browser maps face-skin plus body-skin confidence to `semanticskinmattev2`, face-skin to
`semanticfaceskinmatte`, body-skin to `semanticnonfaceskinmatte`, and inverse-background confidence
to `semanticpersonmatte`. Source-native skin takes priority: an existing `semanticskinmatte`
is preserved and supplies a missing `semanticskinmattev2` by reusing its encoded pixels,
dimensions, codec, colour and transform properties. If both source masks exist, each keeps
its own original content. The two auxiliary URIs remain distinct. This applies to both locally generated
profiles, native style photos receiving Texture/Grain, and HEIC compatibility re-encoding.
Only when source skin is absent does browser-generated confidence supply both semantic
generations, including PNG/JPEG/WebP/DNG (ProRAW) imports. Profile placeholder masks are never treated as source-native skin.
Generated masks approximate Apple's detector; copying legacy pixels into a v2 item does
not reproduce Apple's v2 segmentation model. Shared properties on other items remain unchanged.
It partitions
the person confidence by the closest detected face for `semanticpersoninstances`. These confidence
maps are smoothly resampled with their source aspect ratio preserved, with a longest edge of
768 pixels and even dimensions for HEVC. Rotation and mirroring convert them to stored
orientation; each generated matte and person instance carries matching HEVC dimensions and
its own `ispe`. PNG/JPEG/WebP/DNG (ProRAW) face analysis also preserves the source aspect ratio. Empty fallback
mattes retain the reference 768x576 raster. It also derives the people/skin
coverage and statistics in the styles plist, creates one instance mask per detected face, and
writes per-face ROI, colour, roughness, and instance-mask references into
`TextureStylePostProcessedPeopleData`. Its 76 landmarks follow the native ordering inferred from
native reference samples: left/right eyes, left/right eyebrows, outer/inner lips, nose crest/base, then the
right-temple-to-left-temple face contour. The individual MediaPipe points are approximations of
Apple's private detector output; the group boundaries and array positions are kept stable. Face Mesh
contours populate nose, lips, eyebrows, and approximate ears; mouth pixels provide a conservative teeth
mask; the segmenter's accessory confidence is restricted to the eye region for glasses; and non-face
body skin outside the face/neck core supplies conservative hand candidates. Tattoo remains blank unless
a future dependable classifier can avoid confusing shadows and clothing with ink. All generated data is
experimental and not yet phone-validated as equivalent to Apple's private segmentation.

Yaw, pitch, and roll come from a column-major face matrix fitted to ONNX Runtime landmarks and Google's canonical face coordinates. The
rotation is decomposed as `Rz * Ry * Rx`, kept in radians (`faceUnitOfAngle = 1`), then calibrated
per axis against the four native faces in native reference samples. This corrects the different neutral-face
zero points without mixing axes; the largest residual on those four reference faces is about
0.036 radians (2.1 degrees), so the values are estimates rather than Apple detector output.

Every row has a single **Compare all embedded data** inspection entry, including photos
that already carry Texture/Grain and are left byte-for-byte untouched. It uses one canonical
row list for the input and output, so a missing item is shown as “Not present”. Masks, ratios,
statistics and ROI/numbered landmark geometry are read from the actual HEIC in this panel.
Each label shows a localized name and its technical identifier. Differences cover
payload bytes, properties and essential flags, property order, and graph relationships.
The compact `references` summary lists each reference type and its target count:
`["auxl", 1]` to `["auxl", 2]` means one target became two, not that an item was renumbered.
Grafted auxiliaries can be linked to both the primary and tmap while retaining encoded
pixels. Some depth/matte transplantation also changes descriptive-property order or
essential flags; the comparison reports these changes and does not claim Apple rendering
equivalence. Coverage percentages alone do not establish identical encoded data.
When browser face detection ran, the same panel includes a collapsible **Detection overlay
(not embedded)** with PNG download. Blue marks people, red marks skin, and green marks face
landmarks. This is the inference preview and can differ from source-native masks preserved
in the output. Without a detection run, the overlay section is hidden.

The inventory covers the HDR gain map, style delta map, tmap, styles and texture_styles plists,
TextureStylePostProcessedPeopleData, Portrait depth, six legacy Portrait/semantic mattes, all twelve 2026 mattes,
semanticpersoninstances, the three person-mask hints/ratios, and the seven person/skin statistics
blocks with their nine percentile fields. Direct HEVC masks are decoded to images when WebCodecs
allows it; grid maps and metadata items show their structure or JSON rather than pretending to be
semantic masks.

## Independent 10-bit linear thumbnails

Style-less HEIC and raster imports generate proportional thumbnails with a maximum 1024-pixel long edge.
Display P3 Canvas prefers Float16 pixels. After removing the sRGB/P3 transfer curve, RGB is converted
straight to 10-bit I420P10, limited Y=64–940 and Cb/Cr=64–960. Browser FFmpeg.wasm/x265 encodes losslessly.
SPS, hvcC, pixi and nclx agree on 10-bit, P3 primaries, linear transfer and BT.709 matrix. This is actual
10-bit encoding, not an 8-bit sample with edited depth tags. An 8-bit source canvas still limits source precision.
Native style photos keep their existing linear thumbnails. Library callers can explicitly select the 8-bit WebCodecs path.

## Generated profiles and resource cache

`generated-profile.js` builds ftyp, meta, MakerNote/styles binary plists and XMP from readable fields.
`synthetic-hevc.js` generates neutral delta planes and zero masks from numeric constants and encodes
them in the browser. Texture metadata is serialized from fields; startup uses the generated profile index in code.

Style-less HEIC and PNG/JPEG/WebP/DNG (ProRAW) imports apply a generated profile. Progress identifies generation or
page-local reuse of `45-15`/`48-12`, and the result confirms which generated profile was applied.
HEIC with existing styles keeps those styles and adds locally generated Texture/Grain data; files already
carrying Texture/Grain produce no new output.

The pinned `@ffmpeg/core-mt@0.12.10` loader, WASM and pthread worker are verified against SHA-256 hashes.
Public encoder code (about 33 MB) downloads on demand and persists locally; photos and generated profiles are
not stored in this cache. **Manage resource cache** covers ONNX Runtime, ONNX models and FFmpeg.wasm/x265.
Deleting the current encoder releases workers and in-memory generated assets; the next use downloads it again.
Multithreaded WASM requires a secure context and cross-origin isolation; the site's Service Worker supplies isolation headers.

Apple private fields use readable constants and neutral defaults. Generated style data is written into the output HEIC,
which identifies the profile as experimental.
Container, source-preservation and HEVC encoding tests cannot certify Apple's style rendering;
actual Apple Photos comparisons remain necessary.

Neutral StyleDeltaMap tiles use Display P3 Linear encoding and colour tags. Independent FFmpeg colour
conversion verifies a linear neutral value of about 0.502. `ipma` uses 15-bit indexes when property
indexes exceed 127, preserving item associations and essential flags. Output checks verify independent
thumbnail dimensions, orientation, pixels and codec/colour descriptors, and reject mismatches.
Byte-identical image properties are shared; unreferenced properties are removed before output.
Editing an individual image changes only that image's references.
Library callers must `await generateSyntheticHevc()` before synchronous `addTexture()` or `buildRasterHeic()`;
the application does this automatically. Decoder test caches include the package version, and regressions
check the executed core version.

## iPhone notes

Two iOS behaviours are handled explicitly:

- **Selecting from the Photo Library.** While selecting photos, tap **Show Selected** at the bottom, then **Options → Format**, and change
  **Automatic** to **Current** to keep the photo's existing format. A HEIC photo can then
  use the HEIC metadata-port path. **Browse** also lets you select a HEIC file directly.
  JPEG/PNG/WebP photos use the local import path when Safari exposes HEVC WebCodecs.
- **Getting the result back into Photos.** Where the browser supports sharing files, a
  **Save to Photos** button hands the finished `.heic` to the native share sheet, so
  **Save Image** puts it straight in the library. A normal download sits alongside it.

Send the output to your iPhone as a **file** so transfers do not convert it to JPEG
and strip its metadata. Open the saved copy in Photos and choose **Edit**.
Texture/Grain requires iOS 27.

## Editing the copy

Every word the page shows, in both languages, is in `web/src/i18n.js`. `web/index.html` has no text
of its own — elements carry `data-i18n` keys and are filled in at load and when the language
button is pressed.

```bash
python tools/serve_web.py   # then edit web/src/i18n.js and reload
node tests/web/check-i18n.mjs       # after editing
```

The checker catches the two mistakes that are otherwise invisible until someone switches
language: a key added to one language but not the other, and a key `web/index.html` asks for that
no longer exists.

Adding a third language means adding a block to `STRINGS` with the same keys; the button
cycles between exactly two, so more than that needs a small change to the switch in `web/app.js`.

## Correctness

Run the portable regression suite with Node.js 22 or later (no npm dependencies):

```bash
npm test
```

This checks PWA assets and translations, errors, face masks/person metadata,
orientation properties, native and legacy mattes, raster import/colour/Exif,
texture offsets, and service-worker isolation.
Cases requiring optional local photos are skipped without blocking the remaining tests.

Optional tests require additional local tools or photos:

```bash
node tests/web/basic-workflow-browser.mjs # Playwright + native-style.heic
node tests/web/libheif-api.mjs            # Download the pinned decoder and verify its actual core version
node tests/web/dng-browser.mjs            # Playwright; downloads the pinned LibRaw WASM on first run
node tests/web/decoder-browser.mjs        # Playwright + FFmpeg + tests/web/.cache/libheif-1.23.5.js (1.23.5)
node tests/web/generated-profile-browser.mjs # Playwright + native FFmpeg; WASM encoding, pixel comparisons, offline and resource cache
node tests/web/download-ort-fixtures.mjs  # Download and verify public ONNX Runtime/model fixtures
node tests/web/ort-vision-browser.mjs     # Real WASM inference, mattes, integrity checks and cache
node tests/web/model-options-browser.mjs # Soft Skin option and ONNX Runtime photo-import-to-HEIC flow
node tests/web/model-cache-restart-browser.mjs # Browser restart, offline inference and cache deletion
node tests/web/linear8.mjs                # native FFmpeg with HEVC encoding
node tests/web/hevc-range-native.mjs      # real HEVC calibration, absent VUI and misleading range metadata
node tests/web/generic-graft.mjs          # generic tile-layout photo fixtures
node tests/web/direct-hdr.mjs            # direct HDR fixture
node tests/web/source-consistency.mjs    # native, tiled HDR and direct HDR fixtures
node tests/web/gain-map.mjs              # HDR photo fixtures (plus synthetic checks)
node tests/web/inspection-compare.mjs    # processed-style.heic
node tests/web/portrait-matte.mjs        # native-style.heic
```

Photo fixtures stay local under the Git-ignored `tests/private-fixtures/` directory;
supply samples matching the filenames and layouts specified in each test. Tests that
depend on photos may skip cases or fail when those files are absent. Playwright must
be installed separately; `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE` can point to
an existing runtime and browser. `FFMPEG_EXECUTABLE` can select the encoder for `linear8.mjs`.
`generated-profile-browser.mjs`, `decoder-browser.mjs` and `hevc-range-native.mjs` also accept `FFMPEG_EXECUTABLE` for native FFmpeg.
`dng-browser.mjs` uses generated DNGs (including a 50MP tiled RAW), real LibRaw WASM, ONNX Runtime and FFmpeg linear thumbnails. It checks that WASM stages do not overlap and that allocation failures preserve native masks and total elapsed time; WebCodecs primary encoding uses a test double. Set `DNG_SAMPLE_FILE` to add a local camera sample, and `DNG_CORE_DIR` / `FFMPEG_CORE_DIR` / `ORT_FIXTURE_DIR` to reuse downloaded assets. Photos are never uploaded.

Run `libheif-api.mjs` before `decoder-browser.mjs` to download the pinned decoder.

ONNX Runtime tests use a public photo and verified model fixtures. Run `node tests/web/download-ort-fixtures.mjs`
to download them locally; `ORT_FIXTURE_DIR` can select the directory. These fixtures are not included in this repository.
Photo import and profile encoding tests use the FFmpeg core; `FFMPEG_CORE_DIR` can select a previously downloaded local core.

Normal tests and the decoder-failure test `degrade.mjs` use generated profiles.
`degrade.mjs` additionally requires local photo samples under `noSmartStyle/` or `noSmartStyle-people/`.

The native-photo tests cover the v16 style schema and identity tone curve needed
for Glow/Film while preserving image payloads. Generated-mask tests validate
structure and metadata; phone rendering still needs validation on real devices.

## Layout

| File | Role |
|---|---|
| `web/src/box.js` | ISO-BMFF box reading and writing |
| `web/src/heif.js` | Item graph: `iloc`/`iinf`/`iref`/`ipma`/`ipco`, discovery, surgery |
| `web/src/native-mattes.js` | Read-only WebCodecs viewer for embedded iPhone 18 semantic masks |
| `web/src/dng-decode.js` | Local LibRaw WASM DNG development, integrity checks and worker management |
| `web/src/dng-inspection.js` | Source DNG directories, previews, masks, gain tables and tone curves |
| `web/src/dng-mattes.js` | Source DNG mask alignment, reuse and HEIC encoding |
| `web/src/dng-tiles.js` | Bounded tile inputs for large LinearRaw images, retaining camera colour calibration |
| `web/src/dng-tiff.js` | DNG identification, compression inspection and compact Exif extraction |
| `web/src/raster-import.js` | Local Canvas/WebCodecs PNG/JPEG/WebP/DNG-to-HEIC encoder and container builder |
| `web/src/linear-thumbnail.js` | P3 linearization, 10-bit auxiliary encoding |
| `web/src/raster-color.js` | Explicit P3/sRGB RGB-to-I420 conversion and HEIC colour signalling |
| `web/src/bplist.js` | Apple binary plist reader and writer |
| `web/src/exif.js` | MakerNote `0x54` injection, preserving the target's Exif |
| `web/src/styles.js` | Scene statistics, `c`/`d` light maps, person-mask hint |
| `web/src/zip.js` | ZIP profile serialization and reading |
| `web/src/port.js` | The patch pipeline |
| `web/src/texture.js` | iOS 27 Texture/Grain set (texture_styles + 2026 mattes), and native-photo insertion |
| `web/src/decode.js` | Automatic WebCodecs / lazy asm.js decoding, shared by analysis and inspection |
| `web/src/generated-profile.js` | Generates profile structures and metadata from fields |
| `web/src/synthetic-hevc.js` | Generates profile assets from explicit pixel values |
| `web/src/ffmpeg-hevc.js` | Local FFmpeg.wasm/x265 encoding and resource caching |
| `web/src/ort-vision.js` | ONNX Runtime face detection, landmarks and segmentation |
| `web/src/ort-inference-worker.js` | Terminable ONNX Runtime inference and WASM memory management |
| `web/src/ort-assets.js`, `web/src/ffmpeg-assets.js` | Pinned public runtime/model URLs and SHA-256 digests |

`web/src/port.js` takes the decoder as a callback, keeping container manipulation independent
of libheif. This also lets `port.js` run unchanged under Node for the comparison tests.

## Layout support and limits

Generated profiles support 48/12 and 45/15 primary/HDR tile layouts. Matching sources use those profiles directly. A
matching primary layout with one standalone `hvc1` HDR gain map is also supported: the browser
preserves that gain-map payload, codec configuration, dimensions, orientation, and auxiliary
relationship byte-for-byte.

For many other sources with 1–48 primary tiles, the generic graph graft chooses a profile with enough
primary slots and, for tiled HDR, the same HDR tile count. It preserves the source primary/HDR
payloads and creates only missing auxiliaries. For example, 42/15 uses the 45/15 profile and removes
three unused primary slots.
The graft validates the item graph and reuses the generated profile's style metadata and neutral delta tiles.
HEIF/HEIC photos and screenshots with valid Exif but no Apple MakerNote can also use this pipeline.
Their original Exif fields, orientation and dimensions are preserved while a minimal Apple
MakerNote with the style marker is added. Existing Apple MakerNotes receive only the style marker injection.
Unknown tiled-HDR graphs, more than 48 primary tiles, missing Exif, unsupported HEIF box
layouts, and a missing thumbnail combined with non-identity orientation use the compatibility
re-encode when possible and otherwise produce a clear error.

When a compatibility re-encode is required and the source contains an Apple Portrait depth
auxiliary, the fallback preserves its original HEVC bitstream, dimensions, codec/orientation
properties, `auxl` relationship, and associated XMP blur metadata instead of silently dropping it.

## License and attribution

[MIT](LICENSE). This project is based on the browser implementation of
[nathanatgit/Shalielie](https://github.com/nathanatgit/Shalielie), including the committed v0.6 changes at
`62fc5f33d05e2fe595f926a1131e9f4f5cc2b360`. The upstream copyright notice is retained.

MediaPipe canonical face coordinates and pose geometry references, and the BlazeFace decoding procedure adapted from [yakhyo/mediapipe-face-mesh-onnx](https://github.com/yakhyo/mediapipe-face-mesh-onnx), use [Apache License 2.0](web/Apache-2.0.txt). The source copyrights belong to The MediaPipe Authors (2019/2020) and Yakhyokhuja Valikhujaev (2026).

HoLanLa is not affiliated with or endorsed by Apple. Apple, iPhone, Apple Photos,
and Photographic Styles are trademarks of Apple Inc. No Apple software or SDK is
included. Experimental output may behave differently across photos and devices.
