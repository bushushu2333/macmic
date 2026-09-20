// macmic modifications Copyright 2026 bushushu2333. Derived from yan5xu/ququ; see NOTICE and LICENSE.
const DEFAULT_VOCABULARY = [
  'macmic', '麦麦', 'GPT', 'ChatGPT', 'Codex', 'OpenAI', 'Claude', 'DeepSeek',
  'Qwen', 'FunASR', 'MLX', 'Apple Silicon', 'AI', 'API', 'Python', 'JavaScript',
  'TypeScript', 'React', 'GitHub', 'Docker', 'Mac', 'Command', '飞书', '多维表格',
  '人工智能', '智能体', '大语言模型', '多模态', '提示词'
];

function normalizeVocabulary(value) {
  const words = Array.isArray(value) ? value : String(value || '').split(/[\n,，;；]/);
  return [...new Set(words.map(word => String(word).trim()).filter(Boolean))]
    .map(word => word.slice(0, 80)).slice(0, 150);
}

module.exports = { DEFAULT_VOCABULARY, normalizeVocabulary };
