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
    item.stream?.getTracks().forEach(track => track.stop());
    item.context?.close().catch(() => {});
    if (session.current === item) analyser.current = null;
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    clearTimeout(timer.current);
    const item = session.current;
    session.current = null;
    if (item?.recorder?.state === 'recording') item.recorder.stop();
    release(item);
    transition('idle');
  }, [release, transition]);
  const finish = useCallback(() => {
    const item = session.current;
    if (phase.current !== 'recording' || item?.recorder?.state !== 'recording') return;
    transition('recognizing');
    item.recorder.stop();
    release(item);
  }, [release, transition]);

  const start = useCallback(async () => {
    if (['starting', 'recording', 'recognizing', 'polishing'].includes(phase.current)) return;
    clearTimeout(timer.current);
    const id = ++generation.current;
    const item = { id, chunks: [] };
    session.current = item;
    transition('starting');
    const current = () => generation.current === id;
    try {
      item.stream = await navigator.mediaDevices.getUserMedia({ audio: {
        sampleRate: 16000, channelCount: 1, echoCancellation: true,
        noiseSuppression: true, autoGainControl: true
      } });
      if (!current()) { release(item); return; }
      item.context = new AudioContext();
      await item.context.resume();
      if (!current()) { release(item); return; }
      const node = item.context.createAnalyser(); node.fftSize = 2048;
      item.context.createMediaStreamSource(item.stream).connect(node);
      analyser.current = node;
      item.recorder = new MediaRecorder(item.stream, { mimeType: 'audio/webm;codecs=opus' });
      item.recorder.ondataavailable = event => { if (event.data.size) item.chunks.push(event.data); };
      item.recorder.onerror = () => {
        if (!current()) return;
        generation.current++; release(item);
        transition('error', '录音中断，请重试');
      };
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
            language: result.language, duration: result.duration, file_size: audio.byteLength });
          if (!current()) return;
          try {
            await api.pasteText(text);
            if (!current()) return;
            transition('done', fallback ? '已输入原文 · 整理暂不可用' : '已输入');
            timer.current = setTimeout(() => transition('idle'), fallback ? 2200 : 1100);
          } catch {
            if (!current()) return;
            await api.copyText(text);
            transition('error', window.constants?.PLATFORM === 'win32' ? '已复制，请按 Ctrl+V 粘贴' : '已复制，请按 ⌘V 粘贴');
          }
        } catch (error) {
          if (current()) {
            api.log('error', '语音输入失败：' + error.message);
            transition('error', error.message.includes('模型') ? error.message : '处理失败，请打开面板查看或重试');
          }
        }
      };
      item.startTime = performance.now(); setStarted(Date.now());
      item.recorder.start(250);
      item.limit = setTimeout(finish, 300000);
      transition('recording');
    } catch (error) {
      release(item);
      if (current()) transition('error', error.name === 'NotAllowedError' ? '请允许麦麦使用麦克风' : '麦克风启动失败，请重试');
    }
  }, [api, finish, release, transition]);

  const toggle = useCallback(() => {
    if (phase.current === 'recording') finish();
    else if (!['starting', 'recognizing', 'polishing'].includes(phase.current)) start();
  }, [finish, start]);
  useEffect(() => {
    if (!api) return;
    const off = [api.onHotkeyTriggered(toggle), api.onToggleDictation(toggle), api.onCancelVoice(cancel)];
    api.registerHotkey(window.constants?.DEFAULT_HOTKEY || 'F19').then(result => {
      if (result?.success === false) transition('error', '快捷键注册失败，请重启麦麦');
    });
    return () => off.forEach(dispose => dispose());
  }, [api, toggle, cancel, transition]);
  useEffect(() => () => {
    generation.current++; clearTimeout(timer.current);
    const item = session.current;
    if (item?.recorder?.state === 'recording') item.recorder.stop();
    release(item);
  }, [release]);
  return { state, message, analyser, started, cancel, finish };
}
