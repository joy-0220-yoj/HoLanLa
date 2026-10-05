const activeSteps = new WeakMap();
const resourceKeys = {
  runtime: "model.runtime", wasm: "model.wasm", face: "model.face", segmenter: "model.segmenter",
};
const size = bytes => bytes < 1000 ? `${bytes} B`
  : bytes < 1000000 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1000000).toFixed(1)} MB`;
const fill = (text, values) => Object.entries(values).reduce(
  (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), text);

// Update one status line throughout a download so its elapsed timer keeps running.
export function updateModelProgress(ui, event, translate) {
  if (!["modelDownload", "modelLoading", "modelError", "modelCache", "modelCacheWarning"].includes(event.stage)) {
    activeSteps.delete(ui);
    return false;
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
      : event.phase === "gpu" ? "st.modelInitGpu" : "st.modelInitCpu";
    text = fill(translate(key), {name});
  } else {
    const key = event.reason === "stalled" ? "st.modelStalled"
      : event.reason === "timeout" ? "st.modelTimeout" : "st.modelFailed";
    text = fill(translate(key), {name, detail: event.detail});
    progress = null; cls = "err";
  }
  const step = `${event.stage}:${event.resource}:${event.phase || ""}`;
  if (activeSteps.get(ui) === step) ui.update(text);
  else { ui.set(text, cls); activeSteps.set(ui, step); }
  // undefined gives a native indeterminate bar; null hides it.
  ui.progress(progress);
  return true;
}
