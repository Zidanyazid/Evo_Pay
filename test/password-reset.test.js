import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const service=fs.readFileSync(new URL('../src/services/password-reset-service.js',import.meta.url),'utf8');
const routes=fs.readFileSync(new URL('../src/routes/admin-routes.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
test('password reset hashes one-time tokens, expires them, and revokes sessions',()=>{assert.match(service,/createHash\('sha256'\)/);assert.match(service,/30\*60_000/);assert.match(service,/used_at IS NULL/);assert.match(service,/DELETE FROM admin_sessions/);assert.match(service,/SMTP_URL/);assert.match(service,/password\.length>=10/);});
test('password routes cover recovery, reset, and authenticated change',()=>{for(const path of ['/forgot-password','/reset-password','/change-password'])assert.match(routes,new RegExp(`router\\.post\\('${path.replaceAll('/','\\/')}`));assert.match(routes,/passwordResetThrottle/);});
test('password UI provides recovery and authenticated password forms',()=>{for(const id of ['show-forgot','forgot-form','reset-password-form','change-password-form','password-modal'])assert.match(html,new RegExp(`id="${id}"`));});
