import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('dashboard interactive IDs are unique',()=>{const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length);});
test('every dashboard data-view has a corresponding section',()=>{for(const [,view] of html.matchAll(/data-view="([^"]+)"/g))assert.match(html,new RegExp(`id="${view}-view"`));});
test('dashboard selectors reference static or dynamically rendered IDs',()=>{const selectors=[...app.matchAll(/\$\('#([^']+)'\)/g)].map(x=>x[1]);const missing=[...new Set(selectors)].filter(id=>!html.includes(`id="${id}"`)&&!app.includes(`id="${id}"`));assert.deepEqual(missing,[]);});
test('dashboard has no browser-native dialogs',()=>assert.doesNotMatch(app,/\b(alert|confirm|prompt)\s*\(/));
