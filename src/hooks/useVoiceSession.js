// macmic modifications Copyright 2026 bushushu2333. Derived from yan5xu/ququ; see NOTICE and LICENSE.
import { useCallback, useEffect, useRef, useState } from 'react';

export async function wavFromBlob(blob) {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = decoded.getChannelData(0);
    const output = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(output);
    const string = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    string(0, 'RIFF'); view.setUint32(4, output.byteLength - 8, true); string(8, 'WAVE');
    string(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, decoded.sampleRate, true);
    view.setUint32(28, decoded.sampleRate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); string(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const value = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, value * (value < 0 ? 32768 : 32767), true);
    }
    return output;
  } finally { await context.close(); }
}

export function useVoiceSession() {
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const [started, setStarted] = useState(0);
  const phase = useRef('idle');
  const session = useRef(null);
  const generation = useRef(0);
  const timer = useRef(null);
  const analyser = useRef(null);
  const api = window.electronAPI;

  const transition = useCallback((next, text = '') => {
    phase.current = next; setState(next); setMessage(text);
    api?.voiceUIState(next).catch(() => {});
  }, [api]);
  const release = useCallback((item) => {
    if (!item) return;
    clearTimeout(item.limit);
    clearTimeout(item.flushTimeout);
    item.rejectFlush?.(new Error('录音已结束'));
    item.resolveFlush = null; item.rejectFlush = null;
    item.capture?.disconnect();
    item.source?.disconnect?.();
    item.stream?.getTracks().forEach(track => track.stop());
    item.context?.close().catch(() => {});
    if (session.current === item) analyser.current = null;
  }, []);
  const abortCloud = useCallback(item => {
    if (item?.streamRequested) api.cancelAsrStream(item.streamId).catch(() => {});
  }, [api]);
  const cancel = useCallback(() => {
    generation.current++;
    clearTimeout(timer.current);
    const item = session.current;
    session.current = null;
    analyser.current = null;
    abortCloud(item);
    if (item?.recorder?.state === 'recording') item.recorder.stop();
    release(item);
    transition('idle');
  }, [abortCloud, release, transition]);

  const acceptResult = useCallback(async (item, result, fileSize) => {
    const current = () => generation.current === item.id;
    if (!current()) return;
    if (!result.success) throw new Error(result.error || '识别失败，请重试');
    const raw = result.text?.trim();
    if (!raw) { transition('error', '没有听到内容，再试一次吧'); return; }
    let text = raw;
    let fallback = false;
    const polish = await api.getSetting('enable_ai_optimization', false);
    if (!current()) return;
    if (polish) {
      transition('polishing');
      try {
        const enhanced = await api.processText(raw, 'optimize');
        if (enhanced.success && enhanced.text?.trim()) text = enhanced.text.trim();
        else fallback = true;
      } catch { fallback = true; }
    }
    if (!current()) return;
    await api.saveTranscription({ text, raw_text: raw, processed_text: text,
      language: result.language, duration: result.duration, file_size: fileSize });
    if (!current()) return;
    transition('inserting');
    try {
      await api.pasteText(text);
      if (!current()) return;
      transition('done', fallback ? '已输入原文 · 整理暂不可用' : '已输入');
      timer.current = setTimeout(() => { if (current()) transition('idle'); }, fallback ? 2200 : 1100);
    } catch {
      if (!current()) return;
      await api.copyText(text);
      if (!current()) return;
      transition('error', window.constants?.PLATFORM === 'win32' ? '已复制，请按 Ctrl+V 粘贴' : '已复制，请按 ⌘V 粘贴');
    }
  }, [api, transition]);
  const failed = useCallback((item, error) => {
    if (generation.current !== item.id) return;
    generation.current++;
    abortCloud(item); release(item);
    // Never log service replies, transcripts, or credentials from an upstream error.
    api.log('error', item.provider === 'doubao' ? '豆包语音输入失败' : '本地语音输入失败');
    const text = error?.message || '';
    transition('error', item.provider === 'doubao'
      ? (/豆包|网络|连接|密钥|配置|超时|录音太短|采样率/.test(text) ? text.slice(0, 80) : '豆包识别失败，请检查网络或服务设置')
      : text.includes('模型') ? text : '处理失败，请打开面板查看或重试');
  }, [abortCloud, api, release, transition]);

  const finish = useCallback(() => {
    const item = session.current;
    if (phase.current !== 'recording' || !item) return;
    if (item.provider !== 'doubao') {
      if (item.recorder?.state !== 'recording') return;
      transition('recognizing'); item.recorder.stop(); release(item); return;
    }
    transition('recognizing'); clearTimeout(item.limit);
    const current = () => generation.current === item.id;
    (async () => {
      try {
        if (performance.now() - item.startTime < 450) throw new Error('录音太短，再说一次吧');
        // The worklet sends its last PCM fragment before acknowledging this message.
        // Keep tracks/context alive until the acknowledgement, then send the final IPC.
        await new Promise((resolve, reject) => {
          item.resolveFlush = resolve; item.rejectFlush = reject;
          item.flushTimeout = setTimeout(() => reject(new Error('录音收尾超时，请重试')), 1500);
          item.capture.port.postMessage({ type: 'flush' });
        });
        if (!current()) return;
        item.sealed = true; release(item);
        const result = await api.finishAsrStream(item.streamId);
        if (!current()) return;
        await acceptResult(item, result, item.audioBytes);
      } catch (error) { failed(item, error); }
    })();
  }, [acceptResult, api, failed, release, transition]);

  const start = useCallback(async () => {
    if (['starting', 'recording', 'recognizing', 'polishing', 'inserting'].includes(phase.current)) return;
    clearTimeout(timer.current);
    const id = ++generation.current;
    const item = { id, chunks: [], audioBytes: 0 };
    session.current = item;
    transition('starting');
    const current = () => generation.current === id;
    try {
      const settings = await api.getAsrSettings();
      if (!current()) return;
      item.provider = settings.provider;
      if (item.provider === 'doubao') transition('starting', '正在连接豆包语音');
      if (item.provider === 'doubao' && !settings.configured) throw new Error('请先在设置中配置豆包语音');
      item.stream = await navigator.mediaDevices.getUserMedia({ audio: {
        sampleRate: 16000, channelCount: 1, echoCancellation: true,
        noiseSuppression: true, autoGainControl: true
      } });
      if (!current()) { release(item); return; }
      item.context = new AudioContext({ sampleRate: 16000 });
      await item.context.resume();
      if (!current()) { release(item); return; }
      const node = item.context.createAnalyser(); node.fftSize = 2048;
      item.source = item.context.createMediaStreamSource(item.stream);
      item.source.connect(node); analyser.current = node;
      if (item.provider === 'doubao') {
        if (item.context.sampleRate !== 16000) throw new Error('当前设备不支持 16 kHz 采样率');
        await item.context.audioWorklet.addModule('./pcm-capture-worklet.js');
        if (!current()) { release(item); return; }
        item.capture = new AudioWorkletNode(item.context, 'macmic-pcm-capture', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCount: 1, channelCountMode: 'explicit'
        });
        item.capture.port.onmessage = ({ data }) => {
          if (!current() || item.sealed) return;
          if (data.type === 'audio') {
            item.audioBytes += data.buffer.byteLength;
            try { api.sendAsrAudio(item.streamId, data.buffer); }
            catch (error) { failed(item, error); }
          } else if (data.type === 'flushed') {
            clearTimeout(item.flushTimeout);
            const resolve = item.resolveFlush;
            item.resolveFlush = null; item.rejectFlush = null;
            resolve?.();
          }
        };
        item.capture.onprocessorerror = () => failed(item, new Error('录音中断，请重试'));
        item.streamId = crypto.randomUUID(); item.streamRequested = true;
        const connected = await api.startAsrStream(item.streamId);
        if (!current()) { abortCloud(item); release(item); return; }
        if (!connected.success) throw new Error(connected.error || '豆包语音连接失败');
        item.startTime = performance.now(); setStarted(Date.now());
        item.source.connect(item.capture);
        // The processor outputs silence: this keeps its graph live without monitoring the mic.
        item.capture.connect(item.context.destination);
      } else {
        item.recorder = new MediaRecorder(item.stream, { mimeType: 'audio/webm;codecs=opus' });
        item.recorder.ondataavailable = event => { if (event.data.size) item.chunks.push(event.data); };
        item.recorder.onerror = () => failed(item, new Error('录音中断，请重试'));
        item.recorder.onstop = async () => {
          release(item);
          if (!current()) return;
          try {
            if (performance.now() - item.startTime < 450) {
              transition('error', '录音太短，再说一次吧'); return;
            }
            const audio = await wavFromBlob(new Blob(item.chunks, { type: 'audio/webm;codecs=opus' }));
            if (!current()) return;
            const result = await api.transcribeAudio(audio);
            if (!current()) return;
            await acceptResult(item, result, audio.byteLength);
          } catch (error) { failed(item, error); }
        };
        item.startTime = performance.now(); setStarted(Date.now());
        item.recorder.start(250);
      }
      item.limit = setTimeout(finish, 300000);
      transition('recording');
    } catch (error) {
      if (!current()) { abortCloud(item); release(item); return; }
      if (error.name === 'NotAllowedError') {
        abortCloud(item); release(item); transition('error', '请允许麦麦使用麦克风');
      } else failed(item, error);
    }
  }, [abortCloud, acceptResult, api, failed, finish, release, transition]);

  const toggle = useCallback(() => {
    if (phase.current === 'recording') finish();
    else if (!['starting', 'recognizing', 'polishing', 'inserting'].includes(phase.current)) start();
  }, [finish, start]);
  useEffect(() => {
    if (!api) return;
    const off = [api.onHotkeyTriggered(toggle), api.onToggleDictation(toggle), api.onCancelVoice(cancel)];
    api.registerHotkey(window.constants?.DEFAULT_HOTKEY || 'F19').then(result => {
      if (result?.success === false) transition('error', '快捷键注册失败，请重启麦麦');
    });
    return () => off.forEach(dispose => dispose());
  }, [api, toggle, cancel, transition]);
  useEffect(() => api?.onAsrStreamError?.(({ id, error }) => {
    const item = session.current;
    if (item?.provider !== 'doubao' || item.streamId !== id
      || !['starting', 'recording', 'recognizing'].includes(phase.current)) return;
    failed(item, new Error(error || '豆包语音连接已中断，请重试'));
  }), [api, failed]);
  useEffect(() => () => {
    generation.current++; clearTimeout(timer.current);
    const item = session.current;
    abortCloud(item);
    if (item?.recorder?.state === 'recording') item.recorder.stop();
    release(item);
  }, [abortCloud, release]);
  return { state, message, analyser, started, cancel, finish };
}
