// HEVC Main8 support depends on the platform encoder, rate control and latency
// mode. A working VideoDecoder (including libheif-js) says nothing about encoding.
export async function supportedHevcConfig(width, height, bitrate, {level = 93} = {}) {
  if (!globalThis.VideoEncoder?.isConfigSupported || !globalThis.VideoFrame) return null;
  // Keep quality/VBR first, but allow CBR-only platform encoders and realtime
  // implementations. no-preference also permits OS encoders excluded by a strict
  // hardware request. Every candidate keeps Main8 and length-prefixed HEVC output.
  const levels = [...new Set([level, 120, 153])].filter(value => value >= level);
  for (const candidateLevel of levels)
    for (const latencyMode of ['quality', 'realtime'])
      for (const bitrateMode of ['variable', 'constant'])
        for (const hardwareAcceleration of ['no-preference', 'prefer-hardware', 'prefer-software'])
          for (const entry of ['hvc1', 'hev1']) {
            const config = {codec: `${entry}.1.6.L${candidateLevel}.B0`, width, height,
              framerate: 1, bitrate, bitrateMode, hardwareAcceleration, latencyMode,
              hevc: {format: 'hevc'}};
            try {
              const support = await VideoEncoder.isConfigSupported(config);
              if (support.supported) return support.config || config;
            } catch { /* An unsupported candidate must not prevent later probes. */ }
          }
  return null;
}
