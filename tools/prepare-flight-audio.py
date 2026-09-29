"""Build four flight sounds from CC0 originals in .cache/audio-import (see public/audio/LICENSES.md)."""
from pathlib import Path
import subprocess
root = Path('.cache/audio-import')
out = Path('public/audio'); out.mkdir(parents=True, exist_ok=True)
def build(name, inputs, filters, duration, complex=False):
    args=['ffmpeg','-v','error','-y']
    for file in inputs: args += ['-i', str(root/file)]
    args += ['-filter_complex' if complex else '-af', filters, '-t', str(duration), '-ac','1','-ar','44100','-c:a','pcm_s16le',str(out/(name+'.wav'))]
    subprocess.run(args,check=True)
build('jump-air',['whoosh.wav'],'atrim=0:0.72,atempo=1.25,highpass=f=100,lowpass=f=3500,afade=t=in:d=0.012,afade=t=out:st=0.38:d=0.196,volume=1.4',.576)
build('flight-rise',['whoosh.wav','sci-fi-sounds/Audio/spaceEngineLow_000.ogg'],
    '[0:a]atrim=0:0.85,asetpts=PTS-STARTPTS,asetrate=32000,aresample=44100,lowpass=f=2600,afade=t=in:d=0.025,afade=t=out:st=0.65:d=0.5,volume=1.4[a];[1:a]atrim=0:1.2,asetpts=PTS-STARTPTS,lowpass=f=550,highpass=f=45,afade=t=in:d=0.12,afade=t=out:st=0.35:d=0.85,volume=0.35[b];[a][b]amix=inputs=2:normalize=0,alimiter=limit=0.8:level=false',1.2,True)
build('boost-charge',['sci-fi-sounds/Audio/spaceEngineLow_002.ogg'],'highpass=f=45,lowpass=f=400,afade=t=in:d=0.32,afade=t=out:st=0.88:d=0.16,volume=0.45',1.04)
build('boost-release',['whoosh.wav','sci-fi-sounds/Audio/thrusterFire_000.ogg'],
    '[0:a]atrim=0:0.75,asetpts=PTS-STARTPTS,asetrate=36000,aresample=44100,lowpass=f=3200,afade=t=in:d=0.01,afade=t=out:st=0.55:d=0.35,volume=1.5[a];[1:a]atrim=0:0.9,asetpts=PTS-STARTPTS,lowpass=f=850,highpass=f=45,afade=t=in:d=0.025,afade=t=out:st=0.2:d=0.7,volume=0.35[b];[a][b]amix=inputs=2:normalize=0,alimiter=limit=0.8:level=false',1,True)
for file in out.glob('*.wav'): print(file, file.stat().st_size)
