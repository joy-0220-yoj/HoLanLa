# HoLanLa

[繁體中文](README.md) | **English**

Version: v0.7.0

HoLanLa is an experimental browser tool that adds Photographic Styles and iOS 27
Texture/Grain metadata to supported photos. Processing runs locally on your device;
photos are never uploaded. Keep your originals and work on copies.

Like the original project, [nathanatgit/Shalielie](https://github.com/nathanatgit/Shalielie),
HoLanLa was developed through **vibe coding**: describing requirements in natural language
and using AI to help write and modify the code.

**[Open HoLanLa](https://joy-0220-yoj.github.io/HoLanLa/)**

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
supported HEIC/PNG/JPEG/WebP formats; browser decode/HEVC encoding support still
determines which files can be processed.

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
profile graft and independently generated 8-bit linear thumbnail.

The embedded-data inspection panel compares actual input/output metadata,
item payloads and masks.

Validation: `node tests/web/basic-workflow-browser.mjs` with an existing Playwright
runtime checks ordinary native output byte-for-byte, inspection,
and 320/390-pixel layouts. `node tests/web/linear8.mjs` validates real HEVC samples
using an externally installed FFmpeg test executable; the website ships no FFmpeg.

## Run locally

```bash
git clone https://github.com/joy-0220-yoj/HoLanLa.git
cd HoLanLa
python tools/serve_web.py
```

Open `http://localhost:8000/`. The static website has no build step or runtime
package installation. Python is only used by the optional development server;
the converter itself runs in JavaScript.

## Deploying

[.github/workflows/pages.yml](.github/workflows/pages.yml) validates and publishes `web/`
to GitHub Pages on pushes to `main` or `master` that touch the website, its tests,
or deployment settings. Enable
it once under **Settings → Pages → Source → GitHub Actions**. There is no build step; the
workflow checks the following before uploading:

- no `.heic`/`.heif` anywhere under `web/` — a guard against publishing a personal photo
- the two donor profiles are present and non-empty
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
identity and icons, while `web/sw.js` precaches the complete converter, both donor profiles, and
all first-party JavaScript. Paths stay relative so the same files work at the root of a
domain or under a GitHub Pages project subpath.

Website files use the network first when available, then fall back to saved copies.
Google MediaPipe's JavaScript runtime/loader scripts, WASM engine, face model and
segmentation model are retained locally after successful downloads and subsequently
loaded from persistent cache, including after closing and reopening the browser.
The asset cache is independent of website releases and survives app upgrades; changing
an asset URL or the asset-cache revision requires a new download. Status messages
distinguish downloads from local-cache reads. Only public code and models are cached,
never photos. A reopened page still needs to initialize the engine and model instances.

All three resources use pinned version URLs: MediaPipe Tasks Vision/WASM is
`0.10.22-rc.20250304`, Face Landmarker is `1` (float16), and SelfieMulticlass is `1`
(float32). Each full URL has its own cache entry.
Open **Manage model cache** beneath the photo picker to inspect versions, local status
and sizes. Versions used by this page, other cached versions, and legacy unpinned
`latest` entries are listed separately; a `latest` entry is not assumed to be verified version 1.
Delete a version individually, or choose **Delete all cached model versions** to clear
all versions, including MediaPipe JavaScript runtime components. Deletion waits for queued
photo processing to finish. Deleting a version used by this page also releases its live
instances; needed resources download again.

Private browsing, clearing site data or browser storage eviction can remove these assets.
Unavailable storage or failed cache writes produce a warning that a later visit may need
another download; see the [Cache API storage limits](https://developer.mozilla.org/en-US/docs/Web/API/Cache).
The optional libheif decoder remains outside this persistent cache. If automatic
decoding cannot analyze the photo, scene analysis uses the tested donor-statistics path.

After changing runtime files or the manifest, check that the offline asset list is complete:

```bash
node tests/web/check-pwa.mjs
```

## What it ships

The current website does not load or ship FFmpeg WASM, ffprobe WASM, or an FFmpeg
worker. New HEVC main images, auxiliaries, masks, and 8-bit linear thumbnails use
WebCodecs; the linear-thumbnail SPS colour tags are edited in JavaScript.
Some optional local verification tests use native FFmpeg; it is not a website dependency.
MediaPipe's WASM runtime is used for local inference and is unrelated to FFmpeg.

| | |
|---|---|
| Size | First-party JavaScript and two compact donor profiles; no bundled FFmpeg |
| Requests | `web/index.html`, `web/app.js`, first-party modules, one profile per photo layout |
| External | optional decoder plus optional MediaPipe runtime/model — see below |
| Hosting | local HTTP on localhost, or the hosted HTTPS website; COOP/COEP supplied by the development server or Service Worker |

## Optional external dependencies

HEIC face analysis, color/brightness analysis and auxiliary-image inspection always use automatic
decoding. The app first tries WebCodecs VideoDecoder and loads the classic libheif-js 1.18.2
asm.js build from jsDelivr only if decoding or external color/crop handling fails. The decoder
test selector has been removed, and previously saved manual choices are ignored. Progress
still retains engine names and fallback reasons.
HEIC source inputs for missing thumbnails, independent linear thumbnails and full re-encoding
still try `createImageBitmap()`/`Image.decode()` first. Native failure uses automatic WebCodecs
decoding with asm.js fallback. Fallback surfaces are color-managed Display P3 canvases without a
gamut-clipping sRGB intermediate. The asm.js source path supports standard sRGB/Display P3
ICCs (including linear variants) and known SDR nclx/SPS colors; unknown ICCs, HDR transfers
or conflicting colors fail explicitly instead of producing incorrectly colored output.
Independent linear thumbnails still isolate the SDR primary without applying a gain map,
and undo mirroring/rotation to recover stored orientation. Generating only a neutral HDR
map requires no source decode. HEVC encoding and black/white range calibration still use WebCodecs.

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
analysis failures use donor statistics and flat light maps, the configuration used for
deterministic reference comparisons. Routes requiring decoded pixels or new HEVC
images still need a working decoder/encoder and report an error if those are unavailable.

To serve the decoder locally, vendor the matching classic build and point `LIBHEIF_URL` at it:

```bash
npm pack libheif-js@1.18.2
tar -xzf libheif-js-1.18.2.tgz
mkdir -p web/vendor
cp package/libheif/libheif.js web/vendor/
```

Only with experimental Soft Skin support enabled, `web/src/face-mattes.js`
lazily downloads **Google MediaPipe** runtime components and models. Download and
initialization statuses identify Google and show each component's full name:

| Download | Purpose | Approximate size |
| --- | --- | --- |
| Google MediaPipe Tasks Vision JavaScript runtime | Loads and operates the MediaPipe runtime and models in the browser. | Varies with the download |
| Google MediaPipe Tasks Vision WASM engine | The underlying WebAssembly computation code, shared by face and segmentation models for local inference. | 9.6 MB |
| [Google MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) face and landmark model | Detects face positions and landmarks for person ROI/landmark metadata. | 3.8 MB |
| [Google MediaPipe SelfieMulticlass](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter) six-class segmentation model | Produces per-pixel confidence for background, hair, body skin, face skin, clothes, and other/accessories to build skin and person masks. | 16.4 MB |

The WASM engine and two models total approximately **29.8 MB**, plus JavaScript components.
These sizes were measured from the current files; the displayed bytes and percentages
use the actual download response. Inference happens in the browser; the photo is
never sent with download requests.
With Soft Skin support unchecked, MediaPipe JavaScript, WASM, face and segmentation
models are neither downloaded nor initialized, and already loaded models are not
used for inference. Existing native Portrait effect mattes are preserved; missing
mattes are omitted. Analyze photo content controls photo analysis and style data
adjustments; it does not independently activate MediaPipe.
With Soft Skin enabled, Portrait-only generation requires the segmenter without the Face Landmarker.
Preparation displays separate runtime loading, WASM/face/segmentation downloads,
and GPU/CPU initialization steps. Downloads show bytes received, plus a percentage
and progress bar when the server supplies a total size; otherwise they show bytes
and an indeterminate bar. Initialization is indeterminate because it has no measurable
percentage. First-use time depends on the connection and device; later photos in the
same page reuse initialized models. Downloads stop after 30 seconds without new data;
runtime module loading has a 60-second limit and asynchronous initialization a
120-second limit. Synchronous WASM work blocks the main thread, so a timeout cannot
be displayed until it yields. Errors identify the affected resource and remain in
the result card; check the connection and process the photo again. A shared runtime
or segmentation failure is not automatically retried for Portrait on the same photo.
Reloading or reopening the browser creates new model instances while reading WASM and model bytes from persistent local cache first. Face Landmarker tries GPU, then CPU on
initialization failure; SelfieMulticlass uses CPU. Detection and segmentation are timed
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
its own original content. The two auxiliary URIs remain distinct. This applies to both donor
profiles, native style photos receiving Texture/Grain, and HEIC compatibility re-encoding.
Only when source skin is absent does browser-generated confidence supply both semantic
generations, including PNG/JPEG/WebP imports. Donor masks are never treated as source-native skin.
Generated masks approximate Apple's detector; copying legacy pixels into a v2 item does
not reproduce Apple's v2 segmentation model. Shared properties on other items remain unchanged.
It partitions
the person confidence by the closest detected face for `semanticpersoninstances`. These confidence
maps are smoothly resampled with their source aspect ratio preserved, with a longest edge of
768 pixels and even dimensions for HEVC. Rotation and mirroring convert them to stored
orientation; each generated matte and person instance carries matching HEVC dimensions and
its own `ispe`. PNG/JPEG/WebP face analysis also preserves the source aspect ratio. Empty fallback
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

Yaw, pitch, and roll come from MediaPipe's column-major canonical-to-runtime face matrix. The
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

## Independent 8-bit linear thumbnails

Style-less HEIC and raster imports now encode a separate, proportional thumbnail with a
maximum 1024-pixel long edge. A Display P3 canvas provides colour-managed samples; the
sRGB/P3 transfer curve is removed before explicit full-range input YUV conversion.
Encoding uses 8-bit I420 samples and WebCodecs HEVC Main. To support browsers
that reject a linear-transfer VideoFrame, these already-linear raw samples use
encoder-negotiated SDR transport tags during encoding. A black/white probe detects the
encoder's transfer and YUV matrix. A local WebCodecs decoder reads its native YUV
endpoints to measure actual full/limited output range before the actual linear
samples are submitted. Linear RGB is converted directly into that negotiated
BT.709 or BT.601 YUV representation; it is not gamma-encoded again. A JavaScript
SPS VUI edit then sets P3 primaries and linear transfer without changing picture
NALs, preserving the negotiated matrix/range in both SPS and HEIC nclx. Actual
SPS fields take precedence for primaries, transfer and matrix; decoded endpoints establish range.
Full-range input samples and encoded output range are kept separate, since browser metadata
can claim full range for a limited-range bitstream. Colour
changes after negotiation and SPS disagreements are rejected. The output retains P3
primaries and linear transfer with the negotiated YUV matrix/range. The returned
hvcC, actual SPS and pixi must agree on 8-bit depth. The HEIC receives separate
hvcC, pixi, ispe and nclx properties for this auxiliary.

Unsupported canvas formats, unavailable calibration decoders, ambiguous endpoints,
encoder failures and changed colour metadata stop
conversion with an explicit error. Existing native style photos keep their original
linear thumbnail, including native 10-bit data. Float16 canvas samples are preferred.
This is an experimental reconstruction of an auxiliary image.

The Web build now has an experimental generic HEIF graph graft for many style-less HEIC files with
1–48 primary tiles and either no HDR gain map, one standalone HDR item, or a tiled HDR count that
matches an available donor graph. It rewrites the donor's item graph and grid descriptors to the
source layout while copying every original primary and compatible HDR HEVC tile payload byte-for-byte.
When the source lacks a thumbnail or HDR gain map, WebCodecs generates only the missing auxiliary;
the original primary compressed data is not re-encoded. Separate decoding can still be
needed for analysis or a new linear thumbnail. This covers the tested 42/0, 40/0,
36/0, and 42/15 layouts.

HEIC graphs that cannot be mapped safely—currently including tiled-HDR counts for which no donor exists or
more than 48 primary tiles—still fall back to the same local WebCodecs compatibility path used for
PNG/JPEG/WebP. That path rebuilds the pixels and therefore does not promise the generic graft's
primary-payload preservation. Its grid is now sized dynamically and does not upscale an image merely
to imitate the donor's 4032-pixel edge.

PNG/JPEG/WebP import is different because there is no compressed HEVC image to preserve. That path
requires a browser HEVC `VideoEncoder`: it keeps the source pixel dimensions whenever they fit in
the donor's 48 available item slots, computes the smallest required 512-pixel tile grid, and removes
the unused slots. It also makes an independent 8-bit linear thumbnail and a neutral tiled HDR
gain map. Images too large for 48 tiles are reduced only as much as necessary. It then adds v16 Photographic Styles,
Texture/Grain, and generated 2026 semantic mattes when Soft Skin support is enabled and local face inference is available,
otherwise empty semantic masks. A missing Portrait effect matte is generated only with Soft Skin enabled and person
segmentation available, and otherwise omitted. No Windows program, Python process or server upload
participates in primary encoding; new linear thumbnails use 8-bit WebCodecs.
WebP imports use the same pipeline, identified by the RIFF/WEBP file signature. Transparent
pixels are composited onto black, and the output is a still HEIC image.
Browsers without a compatible HEVC encoder receive an explicit
error and no partial file. This newly encoded path is experimental and must be kept separate from
the lossless container-only path used for existing HEIC photos.

Raster colour is encoded explicitly: Canvas colour-manages source ICC/Display P3 colours
into sRGB. Browser HEVC encoders can return BT.709 primaries even for a P3 input frame,
so this re-encode path targets the sRGB/BT.709 gamut. Before each encoding batch, one
discarded full-range black/white frame probes the same encoder and dimensions. SPS and
reported fields select the transfer curve (sRGB or BT.709) and YUV matrix (BT.709 or BT.601).
Real input I420 samples stay full-range; actual output range is measured by decoding the probe.
`web/src/hevc-color.js` reads native I420/NV12 luma without RGB conversion or range normalization,
so misleading full-range metadata cannot make limited-range black look gray. The measured
output range is written into the HEIC's `nclx` boxes.
The probe frame never enters the photo or its tile count. The primary tiles,
primary grid, tmap, ordinary thumbnail and neutral gain map receive their encoder's colour description
instead of inheriting the donor ICC. Conflicting colour metadata from an encoder fails the
import rather than producing a mislabeled photo. Existing HEIC primary bitstreams are preserved.

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

Optional tests require additional local tools or photos:

```bash
node tests/web/basic-workflow-browser.mjs # Playwright + native-style.heic
node tests/web/decoder-browser.mjs        # Playwright + FFmpeg + tests/web/.cache/libheif.js (1.18.2)
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

Historical reference-comparison utilities (`compare.mjs`, `diff.mjs`, and `degrade.mjs`)
are retained for developers who already have the original local sample collections.
They read input photos from `noSmartStyle/`, `noSmartStyle-people/`, or `Smartstyle/`;
`compare.mjs` and `diff.mjs` also read saved reference HEICs from `tests/web/ref/`.
Reference files must be supplied separately; the Python converter is not part of HoLanLa.

The native-photo tests cover the v16 style schema and identity tone curve needed
for Glow/Film while preserving image payloads. Generated-mask tests validate
structure and metadata; phone rendering still needs validation on real devices.

## Layout

| File | Role |
|---|---|
| `web/src/box.js` | ISO-BMFF box reading and writing |
| `web/src/heif.js` | Item graph: `iloc`/`iinf`/`iref`/`ipma`/`ipco`, discovery, surgery |
| `web/src/native-mattes.js` | Read-only WebCodecs viewer for embedded iPhone 18 semantic masks |
| `web/src/raster-import.js` | Local Canvas/WebCodecs PNG/JPEG/WebP-to-HEIC encoder and container builder |
| `web/src/linear-thumbnail.js` | P3 linearization, 8-bit auxiliary encoding |
| `web/src/raster-color.js` | Explicit P3/sRGB RGB-to-I420 conversion and HEIC colour signalling |
| `web/src/bplist.js` | Apple binary plist reader and writer |
| `web/src/exif.js` | MakerNote `0x54` injection, preserving the target's Exif |
| `web/src/styles.js` | Scene statistics, `c`/`d` light maps, person-mask hint |
| `web/src/zip.js` | Donor profile reader, via `DecompressionStream` |
| `web/src/port.js` | The patch pipeline |
| `web/src/texture.js` | iOS 27 Texture/Grain set (texture_styles + 2026 mattes), and native-photo insertion |
| `web/src/decode.js` | Selected WebCodecs / lazy asm.js decoding, shared by analysis and inspection |
| `web/profiles/` | The two bundled donor profiles |

`web/src/port.js` takes the decoder as a callback, keeping container manipulation independent
of libheif. This also lets `port.js` run unchanged under Node for the comparison tests.

## Layout support and limits

The two exact donor graphs remain 48/12 and 45/15. Matching sources use those profiles directly. A
matching primary layout with one standalone `hvc1` HDR gain map is also supported: the browser
preserves that gain-map payload, codec configuration, dimensions, orientation, and auxiliary
relationship byte-for-byte.

For many other sources with 1–48 primary tiles, the generic graph graft chooses a donor with enough
primary slots and, for tiled HDR, the same HDR tile count. It preserves the source primary/HDR
payloads and creates only missing auxiliaries. For example, 42/15 uses the 45/15 donor and removes
three unused primary slots.
This is not a formula that reconstructs every opaque Apple profile blob: it is an explicit graph
rewrite with structural checks, and it reuses the donor's style metadata and neutral delta tiles.
Unknown tiled-HDR graphs, more than 48 primary tiles, missing Apple Exif, unsupported HEIF box
layouts, and a missing thumbnail combined with non-identity orientation use the compatibility
re-encode when possible and otherwise produce a clear error.

When a compatibility re-encode is required and the source contains an Apple Portrait depth
auxiliary, the fallback preserves its original HEVC bitstream, dimensions, codec/orientation
properties, `auxl` relationship, and associated XMP blur metadata instead of silently dropping it.

## License and attribution

[MIT](LICENSE). This project is based on the browser implementation of
[nathanatgit/Shalielie](https://github.com/nathanatgit/Shalielie), including the committed v0.6 changes at
`62fc5f33d05e2fe595f926a1131e9f4f5cc2b360`. The upstream copyright notice is retained.

HoLanLa is not affiliated with or endorsed by Apple. Apple, iPhone, Apple Photos,
and Photographic Styles are trademarks of Apple Inc. No Apple software or SDK is
included. Experimental output may behave differently across photos and devices.
