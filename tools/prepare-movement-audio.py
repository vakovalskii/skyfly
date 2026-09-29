"""Prepare CC0 Kenney RPG footsteps/cloth from .cache/audio-import; requires ffmpeg."""
from pathlib import Path
import subprocess

source = Path('.cache/audio-import/rpg-audio/Audio')
output = Path('public/audio')
output.mkdir(parents=True, exist_ok=True)
for index in range(4):
    for kind, original, filters in [
        ('step', f'footstep0{index}.ogg', 'highpass=f=65,lowpass=f=4800,afade=t=in:d=0.003,alimiter=limit=0.8:level=false'),
        ('cloth', f'cloth{index + 1}.ogg', 'highpass=f=450,lowpass=f=4300,afade=t=in:d=0.018,afade=t=out:st=0.15:d=0.15,atrim=0:0.3,volume=0.65'),
    ]:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source / original),
                        '-af', filters, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le',
                        str(output / f'move-{kind}-{index}.wav')], check=True)
