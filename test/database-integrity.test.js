import test from 'node:test';import assert from 'node:assert/strict';import db from '../src/database.js';
test('SQLite integrity and foreign keys are healthy',()=>{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);});
test('SQLite production pragmas are enabled',()=>{assert.equal(db.pragma('foreign_keys',{simple:true}),1);assert.equal(db.pragma('journal_mode',{simple:true}).toLowerCase(),'wal');assert.equal(db.pragma('busy_timeout',{simple:true}),5000);});
