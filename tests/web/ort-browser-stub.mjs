// App behavior fixture only. Real WASM inference is covered by ort-vision-browser.mjs.
export async function routeOrtStub(context, origin) {
  await context.route(origin + '/src/ort-vision.js*', route => route.fulfill({contentType: 'text/javascript', body: `
    let calls = 0;
    export async function loadOrtLandmarker() {
      return {detect: () => {
        globalThis.testFaceDetectCalls = (globalThis.testFaceDetectCalls || 0) + 1;
        return {faceLandmarks: calls++ % 5 ? [] : Array.from({length: globalThis.testFaceCount || 1}, (_, face) =>
          Array.from({length: 478}, (_, i) => ({x: (globalThis.testFaceCount === 2 ? .3 + face * .4 : .5)
            + .1 * Math.cos(i), y: .5 + .15 * Math.sin(i), z: 0})))};
      }, close() {}};
    }
    export async function loadOrtSegmenter() {
      return {indices: {background: 0, hair: 1, bodyskin: 2, faceskin: 3, clothes: 4, others: 5}, segmenter: {
        segment: () => {
          globalThis.testSegmentationCalls = (globalThis.testSegmentationCalls || 0) + 1;
          return {confidenceMasks: [.1,.1,.2,.4,.1,.1].map(value => ({width: 4, height: 4,
            getAsFloat32Array: () => new Float32Array(16).fill(value), close() {}}))};
        }, close() {}}
      };
    }
    export async function releaseOrtModels() {}
  `}));
}
