// macmic modifications Copyright 2026 bushushu2333. Derived from yan5xu/ququ; see NOTICE and LICENSE.
// Pure accelerator helpers for the peripheral adapter layer: shared by the
// renderer (binding capture UI) and the main process (binding validation).

// Actions a peripheral button can trigger. The main process dispatches them
// through the existing dictation channels, so the renderer needs no new IPC.
const BUTTON_ACTIONS = {
  dictation: '开始 / 结束听写',
  cancel: '取消本次听写',
  finish: '完成并输入（发送）',
  polish_toggle: '开启 / 关闭文字整理',
};

// Suggested for programmable remotes (翻页器 P 档): F13-F24 reach every app
// through globalShortcut yet collide with nothing on a normal keyboard.
// The default three mirror a remote's 录音 / 删除 / 发送 layout.
const DEFAULT_BUTTON_BINDINGS = [
  { id: 'button-1', accelerator: 'F13', action: 'dictation' },
  { id: 'button-2', accelerator: 'F14', action: 'cancel' },
  { id: 'button-3', accelerator: 'F15', action: 'finish' },
];

const MAX_BUTTON_BINDINGS = 6;
const BARE_MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight',
  'MetaLeft', 'MetaRight', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock',
]);

const KEY_BY_CODE = {
  Space: 'Space', Enter: 'Return', NumpadEnter: 'Return', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', Tab: 'Tab',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\', Comma: ',', Period: '.', Slash: '/',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};

// Turn a captured KeyboardEvent into an Electron accelerator, or null when the
// key cannot be bound (bare modifiers, Escape, IME compositions, unknown keys).
export function eventToAccelerator(event) {
  if (!event || event.repeat || event.isComposing) return null;
  const code = event.code;
  if (!code || BARE_MODIFIER_CODES.has(code) || code === 'Escape') return null;
  let key;
  if (/^F\d{1,2}$/.test(code) && Number(code.slice(1)) <= 24) key = code;
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad\d$/.test(code)) key = 'num' + code.slice(6);
  else key = KEY_BY_CODE[code];
  if (!key) return null;
  const parts = [];
  if (event.metaKey) parts.push('CommandOrControl');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

// Keep only well-formed bindings, drop duplicates and cap the list. Anything a
// user stored by hand in the settings database still passes through here.
export function normalizeBindings(raw) {
  if (!Array.isArray(raw)) return DEFAULT_BUTTON_BINDINGS.map(binding => ({ ...binding }));
  const seen = new Set();
  const result = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const accelerator = typeof item.accelerator === 'string' ? item.accelerator.trim() : '';
    const action = typeof item.action === 'string' ? item.action : '';
    const parts = accelerator.split('+');
    const validShape = accelerator.length > 0 && accelerator.length <= 60
      && !/\s/.test(accelerator) && parts.every(part => part.length > 0);
    if (!validShape || !(action in BUTTON_ACTIONS) || seen.has(accelerator)) continue;
    seen.add(accelerator);
    result.push({
      id: typeof item.id === 'string' && item.id ? item.id : `button-${result.length + 1}`,
      accelerator, action,
    });
    if (result.length >= MAX_BUTTON_BINDINGS) break;
  }
  return result;
}

export function formatAccelerator(accelerator, isMac = false) {
  return accelerator
    .replace('CommandOrControl', isMac ? '⌘' : 'Ctrl')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('Control', isMac ? '⌃' : 'Ctrl')
    .replace('Return', 'Enter')
    .split('+').join(' + ');
}

export { BUTTON_ACTIONS, DEFAULT_BUTTON_BINDINGS };
