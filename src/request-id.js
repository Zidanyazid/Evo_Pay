import crypto from 'node:crypto';
export const validRequestId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
export const requestId = (value) => validRequestId(value) ? value : crypto.randomUUID();
export function requestCorrelation(req, res, next) { req.requestId = requestId(req.get('x-request-id')); res.set('x-request-id', req.requestId); next(); }
