import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
test('dashboard does not use browser-native dialogs',()=>{assert.doesNotMatch(app,/\b(?:alert|confirm|prompt)\s*\(/);});
test('reusable modals expose accessible dialog contracts',()=>{for(const id of ['verification-modal','notice-modal','refund-modal'])assert.match(html,new RegExp(`id="${id}"`));assert.match(html,/role="alertdialog"[^>]+aria-labelledby="verification-title"[^>]+aria-describedby="verification-description"/);assert.match(html,/id="refund-modal"[\s\S]+?role="dialog"[^>]+aria-labelledby="refund-modal-title"[^>]+aria-describedby="refund-modal-description"/);});
test('refund modal enforces valid amount and reason inputs',()=>{assert.match(html,/id="refund-amount"[^>]+type="number"[^>]+min="1"/);assert.match(html,/id="refund-reason"[^>]+required[^>]+maxlength="200"/);assert.match(app,/button\.disabled=true;button\.textContent='Memproses…'/);});
