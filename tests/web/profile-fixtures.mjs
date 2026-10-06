// Use our generated numeric schemas and codec fixtures, never bundled donor ZIPs.
// Keep a ZIP round trip so importer regressions remain covered.
import {syntheticAssets} from './synthetic-fixtures.mjs';
import {buildGeneratedProfile, generatedProfileZip} from '../../web/src/generated-profile.js';
import {loadProfile} from '../../web/src/zip.js';

export async function generatedProfileFixture(name) {
  return loadProfile(generatedProfileZip(buildGeneratedProfile(name, syntheticAssets)));
}
