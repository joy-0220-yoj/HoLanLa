// Version-specific real decoder fixture, shared by API and browser regressions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const source=readFileSync(new URL('../../web/src/decode.js',import.meta.url),'utf8');
export const LIBHEIF_URL=source.match(/const LIBHEIF_URL = "([^"]+)"/)?.[1];
export const LIBHEIF_VERSION=LIBHEIF_URL?.match(/libheif-js@([^/]+)\/libheif\/libheif\.js$/)?.[1];
assert.ok(LIBHEIF_VERSION,'Decoder fixture must use the pinned classic bundle from decode.js');
export const LIBHEIF_CACHE=fileURLToPath(new URL(`.cache/libheif-${LIBHEIF_VERSION}.js`,import.meta.url));
