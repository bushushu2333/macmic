"""No model downloads. Validate audio boundaries and worker protocol on every OS."""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import wave
from array import array
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import qwen_server as worker

class WorkerTests(unittest.TestCase):
    def test_partition_preserves_every_sample(self):
        pcm = array('h', [1] * (16000 * 65)).tobytes()
        parts = list(worker.split_pcm(pcm))
        self.assertEqual(b''.join(parts), pcm)
        self.assertEqual(len(parts), 3)
        self.assertTrue(all(len(p) <= 30 * 32000 for p in parts))

    def test_quiet_boundary(self):
        pcm = array('h', [100] * (16000 * 40))
        pcm[16000 * 27 - 320:16000 * 27] = array('h', [0] * 320)
        parts = list(worker.split_pcm(pcm.tobytes()))
        self.assertEqual(len(parts[0]), 27 * 32000)
        self.assertEqual(b''.join(parts), pcm.tobytes())

    def test_rejects_wrong_sample_rate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'invalid.wav')
            with wave.open(path, 'wb') as output:
                output.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
                output.writeframes(b'\0' * 16000)
            with self.assertRaises(ValueError):
                worker.read_audio(path)

    def test_json_errors_do_not_end_worker(self):
        output = io.StringIO()
        with patch('sys.stdin', io.StringIO('invalid\n{"id":"x","action":"transcribe"}\n')), patch('sys.stdout', output):
            worker.serve()
        results = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(results), 2)
        self.assertFalse(results[0]['success'])
        self.assertFalse(results[1]['success'])
        self.assertEqual(results[1]['id'], 'x')

if __name__ == '__main__':
    unittest.main()
