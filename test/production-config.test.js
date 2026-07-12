import test from 'node:test';import assert from 'node:assert/strict';import {productionConfigErrors} from '../src/config.js';
const safe={NODE_ENV:'production',APP_BASE_URL:'https://pay.example.com',ADMIN_PASSWORD:'r4nd0m-admin-secret-2026',ENCRYPTION_KEY:'7c74373f884b48aaaf77fb34fcd565c9',TOKOPAY_MERCHANT_ID:'merchant',TOKOPAY_SECRET:'secret',SIMULATOR_ENABLED:'0',DATABASE_PATH:'/var/lib/nexuspay/gateway.db',TRUST_PROXY:'1'};
test('accepts safe production configuration',()=>assert.deepEqual(productionConfigErrors(safe),[]));
test('rejects development defaults in production',()=>{const errors=productionConfigErrors({NODE_ENV:'production',APP_BASE_URL:'http://localhost:3000',ADMIN_PASSWORD:'password',ENCRYPTION_KEY:'development',SIMULATOR_ENABLED:'1',DATABASE_PATH:':memory:',TRUST_PROXY:'all'});assert.ok(errors.length>=7);});
test('does not enforce production requirements in development',()=>assert.deepEqual(productionConfigErrors({NODE_ENV:'development'}),[]));
