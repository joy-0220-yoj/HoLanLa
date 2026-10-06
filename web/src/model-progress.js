const activeSteps = new WeakMap();
const resourceKeys = {
  ffmpeg: 'model.ffmpeg', dng: 'model.dng',
  ort: 'model.ort', ortDetector: 'model.ortDetector', ortFace: 'model.ortFace', ortSegmenter: 'model.ortSegmenter',
};
const size = bytes => bytes < 1000 ? `${bytes} B`
  : bytes < 1000000 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1000000).toFixed(1)} MB`;
const fill = (text, values) => Object.entries(values).reduce(
  (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), text);

// Update one status line throughout a download so its elapsed timer keeps running.
export function updateModelProgress(ui, event, translate) {
  if (!["modelDownload", "modelLoading", "modelError", "modelCache", "modelCacheWarning"].includes(event.stage)) {
    // Face analysis wraps every model event in {stage:'faces', detail:...}.
    // That wrapper and codec annotations do not start a new elapsed-time step.
    if (!['faces', 'codec'].includes(event.stage)) activeSteps.delete(ui);
    return false;
  }
  const step = `${event.stage}:${event.resource}:${event.phase || ""}`;
  const previous = activeSteps.get(ui);
  const state = previous?.step === step ? previous : {step, files: new Map()};
  if (['modelDownload', 'modelCache'].includes(event.stage)) {
    state.files.set(event.url || '', {loaded: event.loaded || 0, total: event.total, complete: !!event.complete});
    const files = [...state.files.values()];
    event = {...event, loaded: files.reduce((sum, file) => sum + file.loaded, 0),
      total: files.every(file => file.total > 0 || file.complete)
        ? files.reduce((sum, file) => sum + (file.total || file.loaded), 0) : undefined,
      complete: files.every(file => file.complete)};
  }
  const name = translate(resourceKeys[event.resource]);
  let text, progress, cls;
  if (event.stage === "modelCache") {
    text = fill(translate(event.complete ? "st.modelCacheLoaded" : "st.modelCacheLoading"), {name, size: size(event.loaded)});
    progress = event.complete ? null : undefined;
  } else if (event.stage === "modelCacheWarning") {
    text = fill(translate("st.modelCacheUnavailable"), {name});
    progress = null;
  } else if (event.stage === "modelDownload") {
    const percent = event.complete ? 100 : event.total ? Math.min(99, Math.floor(event.loaded / event.total * 100)) : undefined;
    const amount = event.total ? `${size(event.loaded)} / ${size(event.total)} (${percent}%)` : size(event.loaded);
    text = fill(translate(event.complete ? "st.modelDownloaded" : "st.modelDownloading"), {name, size: amount});
    progress = percent;
  } else if (event.stage === "modelLoading") {
    const key = event.phase === "load" ? "st.modelRuntime"
      : "st.modelInitCpu";
    text = fill(translate(key), {name});
  } else {
    const key = event.reason === "stalled" ? "st.modelStalled"
      : event.reason === "timeout" ? "st.modelTimeout" : "st.modelFailed";
    text = fill(translate(key), {name, detail: event.detail});
    progress = null; cls = "err";
  }
  if (previous?.step === step) ui.update(text);
  else ui.set(text, cls, {terminal:false});
  activeSteps.set(ui, state);
  // undefined gives a native indeterminate bar; null hides it.
  ui.progress(progress);
  return true;
}
