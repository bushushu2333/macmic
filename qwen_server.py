"""Local-only Qwen3-ASR worker. stdout is exclusively UTF-8 JSON IPC."""
import contextlib
import json
import os
import sys
import time
import wave
from array import array


def is_silence(pcm):
    samples = array('h', pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    return not samples or (max(abs(v) for v in samples) < 100 and sum(v * v for v in samples) / len(samples) < 256)


def clean_transcript(text, hotwords):
    # Some ASR models echo their entire vocabulary prompt on silence.
    # Discard only an exact full-list echo; do not replace words in real speech.
    normalize = lambda value: ''.join(c.lower() for c in value if c.isalnum())
    if len(hotwords) >= 10 and normalize(text) == normalize(''.join(hotwords)):
        return ''
    return text.strip()


def read_audio(path):
    with wave.open(path, 'rb') as audio:
        if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (16000, 1, 2):
            raise ValueError('需要 16 kHz、单声道、16-bit PCM WAV')
        if not 0 < audio.getnframes() <= 16000 * 301:
            raise ValueError('录音为空或超过 5 分钟')
        return audio.readframes(audio.getnframes())


def split_pcm(pcm, rate=16000):
    """Partition every sample once, choosing a quiet 20 ms boundary at 25–30 s."""
    samples = array('h', pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    start, length = 0, len(samples)
    while start < length:
        end = min(start + rate * 30, length)
        if end < length:
            step = rate // 50
            candidates = range(start + rate * 25, end + 1, step)
            end = min(candidates, key=lambda i: (sum(v * v for v in samples[i-step:i]), -i))
        yield pcm[start * 2:end * 2]
        start = end


class MlxBackend:
    label = 'MLX · Apple GPU · 8-bit'

    def __init__(self, path):
        from mlx_audio.stt.utils import load_model
        import mlx.core as mx
        import numpy as np
        self.mx = mx
        self.model = load_model(path)
        self.model.generate(np.zeros(16000, dtype=np.float32), max_tokens=2, verbose=False)
        mx.clear_cache()

    def transcribe(self, path, pcm, hotwords):
        try:
            output = self.model.generate(
                path, language='Chinese', hotwords=hotwords, temperature=0.0,
                max_tokens=min(4096, max(128, int(len(pcm) / 32000 * 18))),
                chunk_duration=30.0, verbose=False,
            )
            return output.text.strip()
        finally:
            self.mx.clear_cache()


class TorchBackend:
    def __init__(self, path):
        import torch
        from transformers import AutoProcessor, AutoModelForMultimodalLM
        self.torch = torch
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        dtype = torch.float16 if self.device == 'cuda' else torch.float32
        torch.set_num_threads(max(1, min(4, (os.cpu_count() or 4) // 2)))
        self.processor = AutoProcessor.from_pretrained(path, local_files_only=True)
        self.model = AutoModelForMultimodalLM.from_pretrained(
            path, dtype=dtype, local_files_only=True,
        ).to(self.device).eval()
        self.label = 'PyTorch · NVIDIA GPU · FP16' if self.device == 'cuda' else 'PyTorch · CPU · FP32'

    def transcribe(self, path, pcm, hotwords):
        import numpy as np
        pieces = []
        prompt = 'Vocabulary: ' + ', '.join(hotwords) if hotwords else None
        with self.torch.inference_mode():
            for chunk in split_pcm(pcm):
                audio = np.frombuffer(chunk, dtype='<i2').astype(np.float32) / 32768.0
                inputs = self.processor.apply_transcription_request(
                    audio=audio, language='Chinese', prompt=prompt, return_tensors='pt',
                    audio_kwargs={'sampling_rate': 16000},
                ).to(self.model.device, self.model.dtype)
                output_ids = self.model.generate(
                    **inputs, do_sample=False, max_new_tokens=max(128, int(len(audio) / 16000 * 18)),
                )
                generated = output_ids[:, inputs['input_ids'].shape[1]:]
                text = self.processor.decode(generated, return_format='transcription_only')
                pieces.append((text[0] if isinstance(text, list) else text).strip())
        return ' '.join(piece for piece in pieces if piece)


def serve():
    backend = None
    for line in sys.stdin:
        message = {}
        try:
            message = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                action = message.get('action')
                if action == 'init':
                    kind = os.environ.get('MACMIC_ASR_BACKEND', 'torch' if sys.platform == 'win32' else 'mlx')
                    if kind not in ('mlx', 'torch'):
                        raise ValueError('不支持的识别后端')
                    backend = (TorchBackend if kind == 'torch' else MlxBackend)(os.environ['MACMIC_MODEL_PATH'])
                    result = {'success': True, 'ready': True, 'backend': backend.label}
                elif action == 'transcribe':
                    if backend is None:
                        raise RuntimeError('模型尚未就绪')
                    path = message['audio_path']
                    pcm = read_audio(path)
                    hotwords = message.get('hotwords', [])
                    if not isinstance(hotwords, list) or len(hotwords) > 150 or any(not isinstance(v, str) or len(v) > 80 for v in hotwords):
                        raise ValueError('词库格式无效')
                    started = time.monotonic()
                    text = '' if is_silence(pcm) else clean_transcript(backend.transcribe(path, pcm, hotwords), hotwords)
                    result = {'success': True, 'text': text, 'raw_text': text, 'language': 'zh-CN',
                              'duration': len(pcm) / 32000, 'elapsed': round(time.monotonic() - started, 3)}
                else:
                    raise ValueError('不支持的模型操作')
            result['id'] = message.get('id')
        except Exception as exc:
            result = {'id': message.get('id'), 'success': False, 'error': str(exc)}
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    serve()
