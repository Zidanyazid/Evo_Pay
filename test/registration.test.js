import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const routes=fs.readFileSync(new URL('../src/routes/admin-routes.js',import.meta.url),'utf8');
const throttle=fs.readFileSync(new URL('../src/middleware/login-throttle.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
test('public registration uses validation, isolated owner workspace, hashed password, and a session',()=>{assert.match(routes,/router\.post\('\/register', registrationThrottle/);assert.match(routes,/password\.length<10/);assert.match(routes,/password!==confirmation/);assert.match(routes,/role:'owner'/);assert.match(routes,/hashPassword\(password\)/);assert.match(routes,/INSERT INTO workspaces/);assert.match(routes,/INSERT INTO workspace_members/);assert.match(routes,/INSERT INTO admin_sessions/);assert.match(routes,/Set-Cookie/);assert.match(throttle,/registrationThrottle/);});
test('registration screen exposes required accessible fields',()=>{for(const id of ['register-form','register-name','register-email','register-password','register-confirmation','show-register'])assert.match(html,new RegExp(`id="${id}"`));});
