// Fixed artifacts, verified before execution. Community conversions of Google's models;
// pipeline and floating-point differences require comparison against the original runtime.
export const ORT_VERSION = '1.23.2';
const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist`;
export const ORT_ASSETS = Object.freeze([
  {resource:'ort', url:`${base}/ort.wasm.min.mjs`, sha256:'69751720f611e37d1ce2fa3c6ebaa80f949014752636c5f8887a63d40feadcc7'},
  {resource:'ort', url:`${base}/ort-wasm-simd-threaded.mjs`, sha256:'90a557d15c02bac4504d95b67f431d8594635ed2a0a62a7f2cd83d090ff91d3e'},
  {resource:'ort', url:`${base}/ort-wasm-simd-threaded.wasm`, sha256:'45eaee27761ad883742a8d4b8fce1538d60ce43b51adf1726fafccc59b8c1a15'},
  // Display Google's audited source version/variant. Download identity remains
  // the pinned conversion revision; ONNX weights may use another dtype.
  {resource:'ortDetector', sourceVersion:'1', sourceVariant:'float16', url:'https://huggingface.co/fernandotonon/QtMeshEditor-blazeface-onnx/resolve/50f2c66ffbdf84beae8c267df2b49e5c5a5162e9/face_detector.onnx', sha256:'02a04d5d37c3558dc4d5274f7f8f0f0f01ac94e46c5ffb2cee82395d47e23181'},
  {resource:'ortFace', sourceVersion:'1', sourceVariant:'float16', url:'https://huggingface.co/senty-au/face_landmarks_detector-ONNX/resolve/337d58218b5b1cc597ca3c67360880b920f6ce7b/onnx/model.onnx', sha256:'7d6e82dee82a1dca5fbddb282b3cc74571833a530de317fc22ae325c3358beeb'},
  {resource:'ortSegmenter', sourceVersion:'1', sourceVariant:'float32', url:'https://huggingface.co/senty-au/selfie_multiclass_256x256-ONNX/resolve/6db8421a7150ac20558f2c24675078eb3a1a04d0/onnx/model.onnx', sha256:'35ec1ecd9ee7f85073c99c00020b7f6751b69506eeacf683bc8665f6117f85b0'},
]);
