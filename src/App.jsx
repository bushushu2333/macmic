// macmic modifications Copyright 2026 bushushu2333. Derived from yan5xu/ququ; see NOTICE and LICENSE.
import { useEffect, useRef, useState } from 'react';
import { AudioLines, ArrowUpRight, Check, ChevronRight, Copy, History, Mic, Settings2, Sparkles, X, BookOpen, Plus, LoaderCircle, Cpu, CheckCheck, Command, Search, ShieldCheck, Power } from 'lucide-react';
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
  const [hint, setHint] = useState(isWindows ? shortcut : '⌘ ⇧ Space');
  useEffect(() => {
    window.electronAPI?.getReadiness().then(value => setHint(isWindows ? shortcut : value.nativeShortcut ? '右 ⌘' : '⌘ ⇧ Space')).catch(() => {});
  }, [voice.state]);
  useEffect(() => {
    if (voice.state !== 'recording') return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - voice.started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [voice.state, voice.started]);
  const busy = ['starting', 'recognizing', 'polishing', 'inserting'].includes(voice.state);
  const labels = { starting: '正在打开麦克风', recognizing: '正在识别', polishing: '正在整理', inserting: '正在输入' };
  if (voice.state === 'idle') return null;
  return <div className="voice-overlay">
    <div className={`voice-pill ${voice.state}`} role="status" aria-live="polite">
      {voice.state !== 'done' && <button className="pill-button" onClick={voice.cancel} title="取消 · Esc" aria-label="取消录音"><X size={17} /></button>}
      {voice.state === 'recording' ? <><LiveWave analyser={voice.analyser} /><span className="voice-time">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span><button className="pill-button finish" onClick={voice.finish} title={`完成 · ${hint}`} aria-label="停止并输入"><Check size={18} /></button></>
        : <div className="pill-message">{busy ? <LoaderCircle size={17} className="spin" /> : voice.state === 'done' ? <CheckCheck size={18} /> : null}<span>{labels[voice.state] || voice.message}</span></div>}
      {voice.state === 'error' && <button className="pill-button" aria-label="打开麦麦面板" onClick={() => window.electronAPI.openControlPanel()}><ArrowUpRight size={17} /></button>}
    </div>
    {voice.state === 'recording' && <div className="voice-hint">{hint} 完成 <i /> Esc 取消</div>}
  </div>;
}

function SettingRow({ icon: Icon, color = 'blue', title, detail, children }) {
  return <div className="setting-row"><span className={`row-icon ${color}`}><Icon size={16} /></span><div className="row-label"><strong>{title}</strong>{detail && <p>{detail}</p>}</div><div className="row-action">{children}</div></div>;
}
function Toggle({ checked, onChange, label, disabled }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={onChange}><span /></button>;
}
function Dashboard() {
  const api = window.electronAPI;
  const [tab, setTab] = useState('home');
  const [status, setStatus] = useState({});
  const [readiness, setReadiness] = useState({});
  const [words, setWords] = useState([]);
  const [word, setWord] = useState('');
  const [records, setRecords] = useState([]);
  const [polish, setPolish] = useState(false);
  const [notice, setNotice] = useState('');
  const [config, setConfig] = useState({ ai_base_url: '', ai_model: '', ai_api_key: '' });
  const [hasKey, setHasKey] = useState(false);
  const [filter, setFilter] = useState('');
  const [wordFilter, setWordFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [wordSaving, setWordSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [switchSaving, setSwitchSaving] = useState(false);
  const [recordError, setRecordError] = useState(false);
  const dialog = useRef(null);
  const flash = text => setNotice(text);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!api) return;
    let active = true;
    const refresh = async () => {
      try {
        const [model, access] = await Promise.all([api.checkFunASRStatus(), api.getReadiness()]);
        if (active) { setStatus(model); setReadiness(access); }
      } catch { if (active) setStatus({ error: '暂时无法读取状态' }); }
    };
    Promise.all([api.getSetting('speech_vocabulary', []), api.getSetting('enable_ai_optimization', false),
      api.getSetting('ai_base_url', ''), api.getSetting('ai_model', ''), api.getSetting('ai_api_key', '')])
      .then(([terms, enabled, base, model, key]) => {
        if (!active) return;
        setWords(terms); setPolish(enabled); setHasKey(!!key);
        setConfig({ ai_base_url: base, ai_model: model, ai_api_key: '' });
      }).catch(() => flash('无法读取设置，请重新打开麦麦'));
    refresh();
    const timer = setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [api]);
  useEffect(() => {
    if (tab !== 'history' || !api) return;
    let active = true;
    const refresh = () => api.getTranscriptions(100, 0).then(rows => {
      if (active) { setRecords(rows); setRecordError(false); }
    }).catch(() => { if (active) setRecordError(true); });
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [api, tab]);
  const action = async task => {
    try { await task(); } catch { flash('操作未完成，请再试一次'); }
  };
  const saveWords = async next => {
    if (wordSaving) return false;
    setWordSaving(true);
    try {
      await api.setSetting('speech_vocabulary', next);
      setWords(next); flash('词库已保存，下次听写生效'); return true;
    } catch { flash('保存失败，词库未更改'); return false; }
    finally { setWordSaving(false); }
  };
  const addWords = async event => {
    event.preventDefault();
    const terms = word.split(/[\n,，;；]/).map(v => v.trim()).filter(Boolean);
    if (!terms.length) return;
    const next = [...new Set([...words, ...terms])];
    if (next.length > 150 || terms.some(v => v.length > 80)) { flash('最多 150 个词，每个词不超过 80 字'); return; }
    if (await saveWords(next)) { setWord(''); dialog.current.close(); }
  };
  const copy = text => action(async () => { await api.copyText(text); flash('已复制到剪贴板'); });
  const ready = status.server_ready === true;
  const nativeReady = readiness.nativeShortcut === true;
  const activeShortcut = isWindows ? 'Ctrl ⇧ Space' : nativeReady ? '右 ⌘' : '⌘ ⇧ Space';
  const shortcutReady = nativeReady || readiness.fallbackShortcut;
  const micReady = readiness.microphone === 'granted';
  const microphoneLabel = micReady ? '已允许' : readiness.microphone === 'denied' || readiness.microphone === 'restricted' ? '需要开启权限' : '首次使用时授权';
  const nav = [{ key: 'home', label: '听写', icon: AudioLines }, { key: 'words', label: '词库', icon: BookOpen }, { key: 'history', label: '记录', icon: History }, { key: 'settings', label: '设置', icon: Settings2 }];
  const recordList = records.filter(row => (row.processed_text || row.text || '').toLowerCase().includes(filter.toLowerCase()));
  const wordList = words.filter(term => term.toLowerCase().includes(wordFilter.toLowerCase()));
  const restart = async () => {
    setRestarting(true);
    try {
      await api.restartFunasrServer();
      const next = await api.checkFunASRStatus(); setStatus(next);
      flash(next.server_ready ? '本地模型已就绪' : '模型仍未就绪，请查看安装说明');
    } catch { flash('启动失败，请检查本地模型文件'); }
    finally { setRestarting(false); }
  };
  const repair = () => action(async () => { await api.repairShortcuts(); setReadiness(await api.getReadiness()); flash('已重新连接快捷键，状态将自动更新'); });
  const saveConfig = async event => {
    event.preventDefault(); setSaving(true);
    try {
      const url = new URL(config.ai_base_url.trim());
      if (!['https:', 'http:'].includes(url.protocol) || !config.ai_model.trim()) throw new Error('config');
      await api.setSetting('ai_base_url', config.ai_base_url.trim().replace(/\/$/, ''));
      await api.setSetting('ai_model', config.ai_model.trim());
      if (config.ai_api_key.trim()) { await api.setSetting('ai_api_key', config.ai_api_key.trim()); setHasKey(true); }
      setConfig(value => ({ ...value, ai_api_key: '' })); flash('服务设置已保存');
    } catch (error) { flash(error.message === 'config' || error instanceof TypeError ? '请填写有效的服务地址和模型名称' : '保存失败，请重试'); }
    finally { setSaving(false); }
  };
  const togglePolish = async () => {
    setSwitchSaving(true);
    await action(async () => { await api.setSetting('enable_ai_optimization', !polish); setPolish(!polish); });
    setSwitchSaving(false);
  };
  const toggleLogin = async () => {
    setSwitchSaving(true);
    await action(async () => { const login = await api.setLoginStart(!readiness.login); setReadiness(value => ({ ...value, login })); });
    setSwitchSaving(false);
  };
  return <div className={`workspace ${isWindows ? 'windows' : 'mac'}`}>
    <aside className="sidebar">
      <div className="sidebar-titlebar" />
      <div className="brand"><img src="./macmic.svg" width="40" height="40" alt="" /><div><strong>麦麦</strong><span>macmic</span></div></div>
      <nav aria-label="主导航">{nav.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'selected' : ''}><Icon size={18} strokeWidth={1.8} />{label}{key === 'words' && <small>{words.length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div><span className={`status-dot ${ready ? 'ready' : 'pending'}`} /><strong>{ready ? '本地模型已就绪' : status.error ? '模型需要检查' : '正在准备模型'}</strong></div><span>声音在本机，表达更自在。</span></div>
    </aside>
    <main className="workspace-main">
      <header className="toolbar"><h1>{nav.find(item => item.key === tab).label}</h1><span className="toolbar-caption">{tab === 'home' ? '你的声音，即刻成文' : tab === 'words' ? `${words.length} 个专有词` : tab === 'history' ? '保存在这台设备上' : '按你的习惯'}</span></header>
      <div className={`page-content ${tab}`}>
      {tab === 'home' && <>
        <section className="dictation-hero"><div className="mic-orb"><AudioLines size={38} strokeWidth={1.65} /></div><h2>想到，就说出来。</h2><p>在任意输入框，按一下开始，再按一下完成。</p><button className="shortcut-key" disabled={!ready} onClick={() => action(() => api.toggleVoice())} aria-label="开始听写"><span>{activeShortcut}</span><Mic size={17} /></button><div className="shortcut-caption">{ready ? '按快捷键，或点击上方按钮开始' : '本地模型准备好后，即可开始听写'}</div></section>
        <div className="section-heading"><h2>准备就绪</h2><span>随时可以检查</span></div>
        <section className="group readiness-group" aria-label="听写准备状态">
          <SettingRow icon={Mic} title="麦克风" color="orange"><span className={micReady ? 'value good' : 'value'}>{microphoneLabel}</span>{!micReady && <button className="text-button" onClick={() => action(() => api.allowMicrophone())}>设置<ChevronRight size={13} /></button>}</SettingRow>
          <SettingRow icon={Command} title="快捷键" color="purple"><span className={shortcutReady ? 'value good' : 'value'}>{nativeReady ? '右 Command 已连接' : readiness.fallbackShortcut ? `${activeShortcut} 可用` : '等待连接'}</span><button className="icon-button" aria-label="检查快捷键设置" onClick={() => setTab('settings')}><ChevronRight size={15} /></button></SettingRow>
          <SettingRow icon={Cpu} title="本地识别" color="green"><span className={ready ? 'value good' : 'value'}>{ready ? '已就绪' : status.error ? '需要检查' : '正在加载'}</span>{!ready && <button className="text-button" onClick={() => setTab('settings')}>查看<ChevronRight size={13} /></button>}</SettingRow>
        </section>
        <p className="quiet-note"><ShieldCheck size={14} />语音在本机识别{polish ? ' · 文字整理已开启' : ' · 不上传录音'}</p>
      </>}
      {tab === 'words' && <>
        <div className="page-intro"><h2>更懂你的用词。</h2><p>添加常用的人名、品牌和术语，让识别更准确。</p></div>
        <div className="list-toolbar"><label className="search-field"><Search size={16} /><input placeholder="搜索词库" aria-label="搜索词库" value={wordFilter} onChange={event => setWordFilter(event.target.value)} /></label><button className="primary" onClick={() => { setNotice(''); dialog.current.showModal(); }}><Plus size={16} />添加词语</button></div>
        <div className="section-heading"><h2>{wordFilter ? '搜索结果' : '我的词库'}</h2><span>{wordFilter ? `${wordList.length} 个结果` : `${words.length} / 150`}</span></div>
        <section className="group word-cloud">{wordList.length ? wordList.map(term => <span className="word-tag" key={term}>{term}<button disabled={wordSaving} aria-label={`删除 ${term}`} title="删除词语" onClick={() => saveWords(words.filter(value => value !== term))}><X size={13} /></button></span>) : <div className="empty"><BookOpen size={28} /><strong>{wordFilter ? '没有找到这个词' : '让麦麦记住你的常用词'}</strong><p>{wordFilter ? '换一个关键词试试' : '支持一次粘贴多个词语'}</p></div>}</section>
        <p className="footnote">词库保存在本机，下次听写生效。开启文字整理时，词库也会发送给你配置的 AI 服务。</p>
        <dialog ref={dialog} className="word-dialog" aria-labelledby="word-dialog-title"><form onSubmit={addWords}><div className="dialog-heading"><span className="row-icon blue"><BookOpen size={19} /></span><h2 id="word-dialog-title">添加专有词</h2></div><p>输入标准写法，一行一个，也可以用逗号分隔。</p><textarea autoFocus aria-label="要添加的词语" placeholder={'例如：\nChatGPT\nTypeScript'} value={word} onChange={event => setWord(event.target.value)} rows={5} maxLength={12000} /><p className="footnote">最多 150 个词，每个词不超过 80 字。</p><p role="status" className="dialog-notice">{notice}</p><div className="dialog-actions"><button type="button" className="secondary" disabled={wordSaving} onClick={() => dialog.current.close()}>取消</button><button type="submit" className="primary" disabled={wordSaving || !word.trim()}>{wordSaving ? '保存中…' : '添加'}</button></div></form></dialog>
      </>}
      {tab === 'history' && <>
        <div className="page-intro"><h2>说过的话，随时找回。</h2><p>最近 100 条听写记录，可查看原文或再次复制。</p></div>
        <label className="search-field full"><Search size={16} /><input placeholder="搜索听写内容" aria-label="搜索听写内容" value={filter} onChange={event => setFilter(event.target.value)} /></label>
        {recordError ? <div className="empty"><History size={28} /><strong>记录暂时无法读取</strong><p>请重新打开页面试试</p></div> : !recordList.length ? <div className="empty history-empty"><History size={30} /><strong>{filter ? '没有找到相关记录' : '第一句话，从这里开始'}</strong><p>{filter ? '试试更短的关键词' : `在输入框中按 ${activeShortcut}，开始听写`}</p></div> : <div className="record-list">{recordList.map(row => <article className="group record" key={row.id}><div className="record-meta"><time>{new Date(row.created_at.replace(' ', 'T') + (/[Z+]\d*$/.test(row.created_at) ? '' : 'Z')).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><button className="icon-button" aria-label="复制这条记录" title="复制" onClick={() => copy(row.processed_text || row.text)}><Copy size={15} /></button></div><p>{row.processed_text || row.text}</p>{row.raw_text && row.raw_text !== row.processed_text && <details><summary>识别原文</summary><p>{row.raw_text}</p></details>}</article>)}</div>}
      </>}
      {tab === 'settings' && <div className="settings-stack">
        <section><div className="section-heading"><h2>日常使用</h2></div><div className="group">
          <SettingRow icon={Power} title="登录时启动" detail={`启动后安静地留在${trayName}`}><Toggle checked={!!readiness.login} onChange={toggleLogin} label="登录时启动" disabled={switchSaving} /></SettingRow>
          <SettingRow icon={Command} color="purple" title={isWindows ? '听写快捷键' : '右 Command 轻按'} detail={isWindows ? 'Ctrl + Shift + Space' : nativeReady ? '已内置监听，无需其他辅助应用' : '尚未连接，可使用 ⌘ ⇧ Space'}><button className="secondary" onClick={repair}>重新连接</button></SettingRow>
          {!isWindows && !nativeReady && <div className="inline-help"><p>若重新连接后仍不可用，请在系统“输入监控”中允许麦麦，再重新连接。</p><button className="text-button" onClick={() => action(() => api.openInputPermissions())}>打开输入监控<ArrowUpRight size={13} /></button></div>}
          <SettingRow icon={ShieldCheck} color="green" title={isWindows ? '输入方式' : '自动输入权限'} detail={isWindows ? '识别完成后粘贴到当前光标处' : readiness.accessibility ? '辅助功能已允许' : '允许辅助功能，才能直接输入当前应用'}>{!isWindows && !readiness.accessibility ? <button className="secondary" onClick={() => action(() => api.openSystemPermissions())}>允许权限</button> : <Check size={17} className="good" />}</SettingRow>
        </div><p className="footnote">关闭窗口后，麦麦仍在{trayName}运行。Esc 可取消听写。</p></section>
        <section><div className="section-heading"><h2>语音识别</h2></div><div className="group"><SettingRow icon={Cpu} color="green" title="Qwen3-ASR 1.7B" detail={isWindows ? '本机运行 · CPU / NVIDIA GPU' : '本机运行 · Apple 芯片'}><span className={`state-chip ${ready ? 'good' : ''}`}><span className={`status-dot ${ready ? 'ready' : 'pending'}`} />{ready ? '已就绪' : '未就绪'}</span></SettingRow><div className="model-actions"><span>{status.error ? '模型需要检查，请查看安装说明' : ready ? '支持中文、英文及混合表达' : '首次加载需要一点时间'}</span><button className="text-button" onClick={() => action(() => api.openSetupGuide())}>安装说明</button><button className="secondary" disabled={restarting} onClick={restart}>{restarting ? '启动中…' : '重启模型'}</button></div></div></section>
        <section><div className="section-heading"><h2>文字整理</h2><span>可选</span></div><div className="group"><SettingRow icon={Sparkles} color="purple" title="智能整理" detail="整理标点与口头重复，保留原意"><Toggle checked={polish} onChange={togglePolish} label="智能文字整理" disabled={switchSaving} /></SettingRow><div className="inline-help"><p>开启后，识别文字和词库会发送给你配置的 AI 服务。录音仍留在本机；整理失败时使用原文。</p></div><details className="service-details"><summary>文字整理服务<span>{hasKey ? '已配置' : '待配置'}<ChevronRight size={14} /></span></summary><form className="service-form" onSubmit={saveConfig}><label>服务地址<input type="url" required placeholder="https://api.example.com/v1" value={config.ai_base_url} onChange={event => setConfig({ ...config, ai_base_url: event.target.value })} /></label><label>模型名称<input required value={config.ai_model} onChange={event => setConfig({ ...config, ai_model: event.target.value })} /></label><label>API 密钥<input type="password" autoComplete="off" placeholder={hasKey ? '已配置，留空保持不变' : '请输入 API 密钥'} value={config.ai_api_key} onChange={event => setConfig({ ...config, ai_api_key: event.target.value })} /></label><div className="dialog-actions"><button className="primary" disabled={saving}>{saving ? '保存中…' : '保存设置'}</button></div></form></details></div></section>
        <div className="about"><img src="./macmic.svg" width="28" height="28" alt="" /><span>麦麦 macmic<span>让表达，自然发生 · {window.constants?.VERSION || '0.2.0'}</span></span></div>
      </div>}
      </div>
    </main>{notice && <div className="notice" role="status">{notice}</div>}
  </div>;
}

export default function App() {
  const control = new URLSearchParams(window.location.search).get('panel') === 'control';
  useEffect(() => { document.body.classList.add(control ? 'control-body' : 'overlay-body'); }, [control]);
  return control ? <Dashboard /> : <VoiceOverlay />;
}
