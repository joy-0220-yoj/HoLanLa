// Photos reach only this local worker's memory. Runtime code and WASM arrive already hash-checked.
import {dngTilePlan} from './dng-tiles.js?v=0.8.0';
let runtimeUrl, module;
self.onmessage = async ({data: {script, wasm, bytes, maxPixels}}) => {
  try {
    runtimeUrl = URL.createObjectURL(new Blob([script], {type: 'text/javascript'}));
    const {default: factory} = await import(runtimeUrl);
    // Supplying wasmBinary avoids the factory's default network loader.
    module = await factory({wasmBinary: wasm, mainScriptUrlOrBlob: runtimeUrl, locateFile: () => 'libraw.wasm',
      print: () => {}, printErr: () => {}});
    const plan = dngTilePlan(bytes, maxPixels);
    const raw = new module.LibRaw();
    try {
      const settings = {useCameraWb: true, useCameraMatrix: 1, outputColor: 1,
        outputBps: 8, halfSize: false, userFlip: plan ? 0 : -1,
        noAutoBright: true, adjustMaximumThr: 0, gamm: [1 / 2.4, 12.92, 0, 0, 0, 0]};
      const decode = input => {
        raw.open(input, settings);
        const result = raw.imageData();
        if (!result || result.bits !== 8 || result.colors !== 3 || !result.width || !result.height
          || result.data?.byteLength !== result.width * result.height * 3)
          throw Error('LibRaw did not return a complete RGB image');
        return result;
      };
      if (!plan) {
        const result = decode(bytes);
        self.postMessage({result}, [result.data.buffer]);
      } else {
        const canvas = new OffscreenCanvas(plan.outputWidth, plan.outputHeight);
        const ctx = canvas.getContext('2d', {alpha: false, colorSpace: 'srgb'});
        if (!ctx) throw Error('DNG tile rendering canvas unavailable');
        let done = 0;
        for (const tile of plan.tiles()) {
          const rgb = decode(tile.bytes);
          if (rgb.width < tile.width || rgb.height < tile.height) throw Error('DNG RAW tile dimensions disagree');
          const surface = new OffscreenCanvas(rgb.width, rgb.height), context = surface.getContext('2d', {alpha: false, colorSpace: 'srgb'});
          const image = context.createImageData(rgb.width, rgb.height);
          for (let p = 0, q = 0; p < rgb.data.length; p += 3, q += 4) {
            image.data[q] = rgb.data[p]; image.data[q + 1] = rgb.data[p + 1]; image.data[q + 2] = rgb.data[p + 2]; image.data[q + 3] = 255;
          }
          context.putImageData(image, 0, 0);
          // Integer destination edges prevent gaps between neighbouring tiles.
          const x = Math.round(tile.x * plan.outputWidth / plan.width), y = Math.round(tile.y * plan.outputHeight / plan.height);
          const right = Math.round((tile.x + tile.width) * plan.outputWidth / plan.width);
          const bottom = Math.round((tile.y + tile.height) * plan.outputHeight / plan.height);
          ctx.drawImage(surface, 0, 0, tile.width, tile.height, x, y, right - x, bottom - y);
          surface.width = surface.height = 0;
          self.postMessage({progress: {stage: 'dngDecode', done: ++done, total: plan.count}});
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        // Match LibRaw's EXIF orientation for the full-frame path.
        const orientation = plan.orientation, swapped = orientation >= 5 && orientation <= 8;
        const output = new OffscreenCanvas(swapped ? canvas.height : canvas.width, swapped ? canvas.width : canvas.height);
        const target = output.getContext('2d', {alpha: false, colorSpace: 'srgb'}), w = canvas.width, h = canvas.height;
        const transforms = {2:[-1,0,0,1,w,0],3:[-1,0,0,-1,w,h],4:[1,0,0,-1,0,h],
          5:[0,1,1,0,0,0],6:[0,1,-1,0,h,0],7:[0,-1,-1,0,h,w],8:[0,-1,1,0,0,w]};
        target.setTransform(...(transforms[orientation] || [1,0,0,1,0,0])); target.drawImage(canvas, 0, 0);
        canvas.width = canvas.height = 0;
        const bitmap = output.transferToImageBitmap(); output.width = output.height = 0;
        self.postMessage({result: {bitmap, width: bitmap.width, height: bitmap.height}}, [bitmap]);
      }
    } finally {raw.delete();}
  } catch (error) {self.postMessage({error: String(error?.message || error)});}
  finally {if (runtimeUrl) URL.revokeObjectURL(runtimeUrl);}
};
