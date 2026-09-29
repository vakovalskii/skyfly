# Flight sound samples

All source recordings below are CC0 1.0: <https://creativecommons.org/publicdomain/zero/1.0/>.
Downloaded 2026-09-29. They are served locally; playback never contacts an asset site.

- **Air whoosh** — pyranostudios, <https://opengameart.org/content/air-whoosh>.
  Original: <https://opengameart.org/sites/default/files/whoosh2_0.wav>.
- **Sci-fi Sounds** — Kenney, <https://kenney.nl/assets/sci-fi-sounds>.
  Original pack: `kenney_sci-fi-sounds.zip` (70 sounds).
  Used: `spaceEngineLow_000.ogg`, `spaceEngineLow_002.ogg`, `thrusterFire_000.ogg`.

| Local file | Sources / changes |
| --- | --- |
| jump-air.wav | Whoosh: trimmed, sped up, filtered, faded |
| flight-rise.wav | Lowered whoosh + spaceEngineLow_000: filtered, mixed, faded, limited |
| boost-charge.wav | spaceEngineLow_002: trimmed, low-pass filtered, faded |
| boost-release.wav | Lowered whoosh + thrusterFire_000: filtered, mixed, faded, limited |

Rebuild with `python3 tools/prepare-flight-audio.py` (requires ffmpeg and originals
in `.cache/audio-import` as described by the script). Runtime uses the checked-in WAVs.

Movement: **RPG Audio**, Kenney Vleugels (Kenney.nl), CC0; original license in
`.cache/audio-import/rpg-audio/License.txt`. `move-step-0..3.wav` derive from
`footstep00..03.ogg` (filtered, short fade, limited); `move-cloth-0..3.wav` derive
from `cloth1..4.ogg` (filtered, trimmed, faded). Rebuild with
`python3 tools/prepare-movement-audio.py`.
