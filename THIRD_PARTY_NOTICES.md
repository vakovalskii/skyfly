# Third-party notices

The root proprietary license covers original Skyfly material only. It does not
replace or restrict the licenses listed here. Dependencies are installed with
`npm ci`; their exact versions and license metadata are in `package-lock.json`.

- **Models:** [public/models/LICENSES.md](public/models/LICENSES.md).
  The active `hero-base.glb` is Quaternius' Animated Base Character, CC BY 3.0;
  this includes its original embedded animations. Other models have individual
  CC0 or CC BY notices. Derived portions retain applicable attribution requirements.
- **Imported animations:** [public/animations/LICENSES.md](public/animations/LICENSES.md),
  Quaternius Universal Animation Library 2 Standard, CC0.
- **Sounds:** [public/audio/LICENSES.md](public/audio/LICENSES.md), CC0 source
  recordings by Kenney and pyranostudios, with edits documented there.
- **City data:** `public/data/moscow.json`, `spb.json`, `moscow-green.json` are
  derived from © OpenStreetMap contributors and provided under the
  [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  See [OpenStreetMap copyright](https://www.openstreetmap.org/copyright).
  These data files are excluded from the root restrictions on copying/distribution.
  `public/data/animations.json` is animation data, not OpenStreetMap data.
- **Atmosphere/cloud assets:** `public/takram/` is from
  [Takram three-geospatial](https://github.com/takram-design-engineering/three-geospatial).
  Its MIT notice is preserved in [public/takram/LICENSE](public/takram/LICENSE).
  The upstream star catalog derives from Yale Bright Star Catalog version 5;
  upstream asset-specific notices remain applicable.
- **Libraries:** Three.js, postprocessing, ws, Vite, 3d-tiles-renderer and Takram
  retain their respective upstream licenses. Installing them does not license
  Skyfly's original code under MIT or another open-source license.
- **Online map services:** Esri imagery and terrain providers are accessed at
  runtime under their own terms. Cached map tiles are not included in this
  repository. A source checkout does not grant rights to mirror their services.
- **Third-party identities:** Superman-related names, symbols and character
  references are not owned or licensed by this repository. This is an unofficial
  project; no affiliation or endorsement is claimed.
