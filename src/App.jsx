// macmic modifications Copyright 2026 bushushu2333. Derived from yan5xu/ququ; see NOTICE and LICENSE.
import { useEffect, useRef, useState } from 'react';
import { AudioLines, ArrowUpRight, Check, ChevronRight, Copy, History, Mic, Settings2, Sparkles, X, BookOpen, Plus, LoaderCircle, Cpu, CheckCheck } from 'lucide-react';
import { useVoiceSession } from './hooks/useVoiceSession';
import './voice.css';

const isWindows = window.constants?.PLATFORM === 'win32';
const shortcut = isWindows ? 'Ctrl ⇧ Space' : '右 ⌘';
const trayName = isWindows ? '系统托盘' : '菜单栏';

function LiveWave({ analyser }) {
  const path = useRef(null);
  useEffect(() => {
    let frame;
    const data = new Float32Array(2048);
    const smooth = new Float32Array(90);
    const draw = () => {
      const node = analyser.current;
      node?.getFloatTimeDomainData(data);
      let d = '';
      for (let i = 0; i < 90; i++) {
        let value = 0;
        for (let j = 0; j < 8; j++) value += data[i * 8 + j];
        const target = Math.tanh(value / 8 * 9) * Math.sin(Math.PI * i / 89) * 15;
        smooth[i] = smooth[i] * 0.48 + target * 0.52;
        d += `${i ? 'L' : 'M'}${i * 2},${(18 + smooth[i]).toFixed(2)} `;
      }
      path.current?.setAttribute('d', d);
      frame = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(frame);
  }, [analyser]);
  return <svg className="live-wave" viewBox="0 0 178 36" aria-label="实时声音波形"><path ref={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function VoiceOverlay() {
  const voice = useVoiceSession();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (voice.state !== 'recording') return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - voice.started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [voice.state, voice.started]);
  const busy = ['starting', 'recognizing', 'polishing'].includes(voice.state);
  const labels = { starting: '正在打开麦克风', recognizing: '正在识别', polishing: '正在整理' };
  if (voice.state === 'idle') return null;
  return <div className="voice-overlay">
    <div className={`voice-pill ${voice.state}`} role="status" aria-live="polite">
      {voice.state !== 'done' && <button className="pill-button" onClick={voice.cancel} title="取消 · Esc" aria-label="取消录音"><X size={17} /></button>}
      {voice.state === 'recording' ? <><LiveWave analyser={voice.analyser} /><span className="voice-time">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span><button className="pill-button finish" onClick={voice.finish} title={`完成 · ${shortcut}`} aria-label="停止并输入"><Check size={18} /></button></>
        : <div className="pill-message">{busy ? <LoaderCircle size={17} className="spin" /> : voice.state === 'done' ? <CheckCheck size={18} /> : null}<span>{labels[voice.state] || voice.message}</span></div>}
      {voice.state === 'error' && <button className="pill-button" aria-label="打开麦麦面板" onClick={() => window.electronAPI.openControlPanel()}><ArrowUpRight size={17} /></button>}
    </div>
    {voice.state === 'recording' && <div className="voice-hint">{shortcut} 完成 <i /> Esc 取消</div>}
  </div>;
}

function Dashboard() {
  const api = window.electronAPI;
  const [tab, setTab] = useState('home');
  const [status, setStatus] = useState({});
  const [words, setWords] = useState([]);
  const [word, setWord] = useState('');
  const [records, setRecords] = useState([]);
  const [polish, setPolish] = useState(false);
  const [notice, setNotice] = useState('');
  const [config, setConfig] = useState({ ai_base_url: '', ai_model: '', ai_api_key: '' });
  const [hasKey, setHasKey] = useState(false);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const wordQueue = useRef(Promise.resolve());
  const flash = text => { setNotice(text); };
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!api) return;
    const refresh = () => {
      api.checkFunASRStatus().then(setStatus).catch(() => setStatus({ error: '模型状态暂不可用' }));
      api.getTranscriptions(100, 0).then(setRecords).catch(() => {});
    };
    Promise.all([api.getSetting('speech_vocabulary', []), api.getSetting('enable_ai_optimization', false),
      api.getSetting('ai_base_url', ''), api.getSetting('ai_model', ''), api.getSetting('ai_api_key', '')])
      .then(([terms, enabled, base, model, key]) => {
        setWords(terms); setPolish(enabled); setHasKey(!!key);
        setConfig({ ai_base_url: base, ai_model: model, ai_api_key: '' });
      });
    refresh(); const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [api]);
  const saveWords = next => {
    setWords(next);
    wordQueue.current = wordQueue.current.catch(() => {}).then(() => api.setSetting('speech_vocabulary', next))
      .then(() => flash('词库已保存，下次录音生效')).catch(() => flash('保存失败，请重试'));
  };
  const addWords = event => {
    event.preventDefault();
    const terms = word.split(/[\n,，;；]/).map(v => v.trim()).filter(Boolean);
    if (!terms.length) return;
    if (words.length + terms.length > 150 || terms.some(v => v.length > 80)) { flash('最多 150 个词，每个词不超过 80 字'); return; }
    saveWords([...new Set([...words, ...terms])]); setWord('');
  };
  const copy = async text => { await api.copyText(text); flash('已复制'); };
  const ready = status.server_ready;
  const nav = [{ key: 'home', label: '概览', icon: AudioLines }, { key: 'words', label: '专有词库', icon: BookOpen }, { key: 'history', label: '输入记录', icon: History }, { key: 'settings', label: '偏好设置', icon: Settings2 }];
  const recordList = (tab === 'history' ? records.filter(row => (row.processed_text || row.text).toLowerCase().includes(filter.toLowerCase())) : records.slice(0, 3));
  const restart = async () => {
    setRestarting(true);
    try { await api.restartFunasrServer(); setStatus(await api.checkFunASRStatus()); flash('本地模型已就绪'); }
    catch { flash('启动失败，请检查本地模型文件'); }
    finally { setRestarting(false); }
  };
  const saveConfig = async () => {
    setSaving(true);
    try {
      await api.setSetting('ai_base_url', config.ai_base_url.trim().replace(/\/$/, ''));
      await api.setSetting('ai_model', config.ai_model.trim());
      if (config.ai_api_key.trim()) { await api.setSetting('ai_api_key', config.ai_api_key.trim()); setHasKey(true); }
      setConfig(value => ({ ...value, ai_api_key: '' })); flash('设置已保存');
    } catch { flash('保存失败，请重试'); } finally { setSaving(false); }
  };
  return <div className="workspace"><div className="title-drag" />
    <aside className="sidebar"><div className="brand"><div className="brand-icon"><img src="./macmic.svg" width="36" height="36" alt="macmic" /></div><div><strong>麦麦</strong><span>让表达，自然发生</span></div></div>
      <nav>{nav.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => setTab(key)} className={tab === key ? 'selected' : ''}><Icon size={18} />{label}{key === 'words' && <small>{words.length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><span className={`status-dot ${ready ? 'ready' : ''}`} /><div><strong>{ready ? '本地模型已就绪' : status.error ? '模型需要检查' : '模型加载中'}</strong><span>Qwen3-ASR 1.7B</span></div></div>
    </aside>
    <main className="workspace-main"><header><div className="eyebrow">MACMIC / {tab === 'home' ? 'OVERVIEW' : tab === 'words' ? 'VOCABULARY' : tab === 'history' ? 'HISTORY' : 'PREFERENCES'}</div><h1>{tab === 'home' ? '说出来，就好。' : nav.find(n => n.key === tab).label}</h1><p>{tab === 'home' ? '留在思路里，让麦麦把声音变成文字。' : tab === 'words' ? '让人名、品牌和专业术语，更贴近你的表达。' : tab === 'history' ? '每一次表达，都可以重新找到。' : '按你的习惯，轻一点，再顺手一点。'}</p></header>
      {tab === 'home' && <><section className="hero-card"><div className="hero-top"><button className="tiny-label start-voice" onClick={() => api.toggleVoice()}><Mic size={14} />开始录音</button><span className="local-badge">本地语音识别</span></div><div className="hero-shortcut"><kbd className={isWindows ? 'wide-key' : ''}>{shortcut}</kbd><div><h2>按一下开始，再按一下完成</h2><p>文字直接输入当前光标所在的位置</p></div></div><div className="hero-bottom"><span><span className="key-cap">esc</span> 取消本次录音</span><span>录音结束后，浮条自动收起</span></div></section>
        <div className="summary-grid"><button className="summary-card" onClick={() => setTab('words')}><BookOpen size={20} /><strong>{words.length}<small> 个专有词</small></strong><span>懂你的常用表达 <ChevronRight size={14} /></span></button><button className="summary-card" onClick={() => setTab('settings')}><Sparkles size={20} /><strong>{polish ? '轻量整理' : '保留原文'}</strong><span>{polish ? '标点、重复与口头停顿' : '直接输入本地识别结果'} <ChevronRight size={14} /></span></button></div>
      </>}
      {tab === 'words' && <><section className="info-card"><BookOpen size={19} /><p>专有词会参与本地识别，并供文字整理参考。只需添加标准写法；词语越贴近日常使用，越有帮助。</p></section><form className="word-form" onSubmit={addWords}><input aria-label="添加专有词" placeholder="添加人名、品牌或术语，可用逗号分隔" value={word} onChange={event => setWord(event.target.value)} /><button className="primary" type="submit"><Plus size={16} />添加</button></form><div className="section-title"><h2>我的词库</h2><span>{words.length} / 150</span></div><div className="word-cloud">{words.map(term => <span className="word-tag" key={term}>{term}<button aria-label={`删除 ${term}`} onClick={() => saveWords(words.filter(v => v !== term))}><X size={13} /></button></span>)}</div><p className="footnote">自动保存 · 下一次录音即可使用</p></>}
      {(tab === 'home' || tab === 'history') && <section className="history-section"><div className="section-title"><h2>{tab === 'home' ? '最近的表达' : '最近 100 条记录'}</h2>{tab === 'home' && <button className="text-button" onClick={() => setTab('history')}>查看全部 <ArrowUpRight size={14} /></button>}</div>{tab === 'history' && <input className="search-input" placeholder="搜索输入内容" aria-label="搜索输入记录" value={filter} onChange={event => setFilter(event.target.value)} />}
        {!recordList.length ? <div className="empty"><AudioLines size={27} /><p>从第一句话开始</p><span>在任意输入框，按 {shortcut} 试试</span></div> : <div className="record-list">{recordList.map(row => <article className="record" key={row.id}><div className="record-meta"><time>{new Date(row.created_at.replace(' ', 'T') + 'Z').toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><button aria-label="复制这条记录" onClick={() => copy(row.processed_text || row.text)}><Copy size={15} /></button></div><p>{row.processed_text || row.text}</p>{tab === 'history' && row.raw_text && row.raw_text !== row.processed_text && <details><summary>查看识别原文</summary><p>{row.raw_text}</p></details>}</article>)}</div>}</section>}
      {tab === 'settings' && <div className="settings-stack"><section className="setting-card"><div className="setting-title"><Cpu size={20} /><h2>识别模型</h2><span className="local-badge">本地</span></div><div className="model-name">Qwen3-ASR <strong>1.7B</strong></div><p>{status.backend || (isWindows ? 'PyTorch · CPU / NVIDIA GPU' : 'MLX · Apple GPU · 8-bit')} · 中英文混合识别</p><div className="setting-row"><span className="model-state">{status.error || (ready ? '模型已就绪' : '正在预热模型…')}</span><button className="secondary" onClick={() => api.openSetupGuide()}>安装说明</button><button className="secondary" disabled={restarting} onClick={restart}>{restarting ? '正在重启…' : '重启模型'}</button></div></section>
        <section className="setting-card"><div className="setting-row"><div><h2>智能文字整理</h2><p>去掉无意义重复，保留你的意思和语气</p></div><button role="switch" aria-checked={polish} aria-label="智能文字整理" className={`switch ${polish ? 'on' : ''}`} onClick={async () => { try { await api.setSetting('enable_ai_optimization', !polish); setPolish(!polish); } catch { flash('保存失败'); } }}><span /></button></div><div className="privacy-note">语音始终在本机识别。开启整理后，仅识别出的文字发送给你配置的 AI 服务；整理失败或超时会使用原文。</div></section>
        <section className="setting-card"><div className="setting-title"><Settings2 size={20} /><h2>文字整理服务</h2></div><label>服务地址<input value={config.ai_base_url} onChange={event => setConfig({ ...config, ai_base_url: event.target.value })} /></label><label>模型<input value={config.ai_model} onChange={event => setConfig({ ...config, ai_model: event.target.value })} /></label><label>API 密钥<input type="password" autoComplete="off" placeholder={hasKey ? '已配置，留空保持不变' : '请输入 API 密钥'} value={config.ai_api_key} onChange={event => setConfig({ ...config, ai_api_key: event.target.value })} /></label><button className="primary" disabled={saving} onClick={saveConfig}>{saving ? '保存中…' : '保存设置'}</button></section>
        <section className="setting-card"><h2>快捷键</h2><p>{isWindows ? 'Ctrl + Shift + Space 可开始或结束录音。也可以右键系统托盘中的麦麦图标，选择开始录音。' : '⌘⇧Space 可直接开始或结束录音。右 ⌘ 单击需要按 README 配置 Hammerspoon；也可以使用菜单栏的录音入口。'}</p></section><section className="setting-card"><h2>安静地待在{trayName}</h2><p>关闭或最小化这个页面，仍然可以用 {shortcut} 输入。{isWindows ? '双击系统托盘' : '点击菜单栏'}的波形图标，可再次打开麦麦。</p></section></div>}
      <footer><AudioLines size={14} /> 麦麦 · 少一点打断，多一点流畅</footer>
    </main>{notice && <div className="notice" role="status"><Check size={16} />{notice}</div>}
  </div>;
}

export default function App() {
  const control = new URLSearchParams(window.location.search).get('panel') === 'control';
  useEffect(() => { document.body.classList.add(control ? 'control-body' : 'overlay-body'); }, [control]);
  return control ? <Dashboard /> : <VoiceOverlay />;
}
