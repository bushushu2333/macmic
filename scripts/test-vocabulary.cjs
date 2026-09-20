const assert = require('node:assert/strict');
const { DEFAULT_VOCABULARY, normalizeVocabulary } = require('../src/helpers/vocabulary');
assert.deepEqual(normalizeVocabulary(' GPT，GPT; Codex\n麦麦 '), ['GPT', 'Codex', '麦麦']);
assert.equal(normalizeVocabulary(Array.from({ length: 200 }, (_, i) => 'term' + i)).length, 150);
assert.equal(normalizeVocabulary(['a'.repeat(100)])[0].length, 80);
assert.ok(DEFAULT_VOCABULARY.includes('macmic'));
process.stdout.write('PASS: vocabulary normalization, deduplication and limits.\n');
