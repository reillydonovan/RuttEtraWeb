"""Kokoro TTS, batched (the model load dominates, so do every line in one process).

python tts_kokoro.py jobs.json   where jobs.json = [{"voice","speed","text","out"}, ...]
"""
import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro

here = os.path.dirname(os.path.abspath(__file__))
k = Kokoro(os.path.join(here, 'voices', 'kokoro-v1.0.onnx'), os.path.join(here, 'voices', 'voices-v1.0.bin'))
for job in json.load(open(sys.argv[1], encoding='utf-8')):
    samples, sr = k.create(job['text'], voice=job['voice'], speed=float(job['speed']), lang='en-us')
    sf.write(job['out'], samples, sr)
