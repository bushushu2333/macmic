const assert = require('node:assert/strict');
assert.ok(process.versions.electron, 'Run this test using Electron with ELECTRON_RUN_AS_NODE=1');
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE test (value TEXT)');
db.prepare('INSERT INTO test VALUES (?)').run('macmic');
assert.equal(db.prepare('SELECT value FROM test').get().value, 'macmic');
db.close();
console.log(`PASS: SQLite native binding on Electron ${process.versions.electron}, ${process.platform}/${process.arch}`);
