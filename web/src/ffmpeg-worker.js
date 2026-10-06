// Classic worker: the official UMD core executes exclusively in this worker.
let core;
self.onmessage = async ({data: {id, operation, script, wasm, threadScript, pixels, args}}) => {
  try {
    if (operation === 'load') {
      const url = URL.createObjectURL(new Blob([script], {type: 'text/javascript'}));
      const threadURL = URL.createObjectURL(new Blob([threadScript], {type: 'text/javascript'}));
      try { importScripts(url); core = await createFFmpegCore({wasmBinary: wasm,
        mainScriptUrlOrBlob: url + '#' + btoa(JSON.stringify({wasmURL: '', workerURL: threadURL}))}); }
      finally { URL.revokeObjectURL(url); URL.revokeObjectURL(threadURL); }
      self.postMessage({id});
      return;
    }
    if (!core) throw Error('FFmpeg runtime not initialized');
    const log = [];
    core.setLogger(({message}) => { log.push(message); if (log.length > 24) log.shift(); });
    core.setProgress(({progress}) => self.postMessage({id, progress}));
    const outputName = operation === 'decode' ? 'output.raw' : 'output.mp4';
    try {
      core.FS.writeFile('input.raw', pixels);
      core.reset(); core.setTimeout(120000);
      const result = core.exec(...args);
      if (result !== 0) throw Error(`FFmpeg exit ${result}: ${log.join('\n')}`);
      const output = core.FS.readFile(outputName).slice();
      self.postMessage({id, output}, [output.buffer]);
    } finally {
      for (const name of ['input.raw', outputName]) {
        try { core.FS.unlink(name); } catch { /* May not exist after a failed command. */ }
      }
    }
  } catch (error) { self.postMessage({id, error: error.message || String(error)}); }
};
