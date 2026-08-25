import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const css=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
test('dashboard layouts keep navigation scrollable and views responsive',()=>{assert.match(css,/#sidebar nav\{[^}]*overflow-y:auto/);assert.match(css,/@media\(max-width:620px\)/);assert.match(css,/\.view>\*\+\*\{margin-top:18px/);assert.match(css,/\.workspace\{width:min\(100%,1440px\)/);assert.match(html,/<section class="panel developer-security">/);});
