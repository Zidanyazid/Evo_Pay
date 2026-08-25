import {Router} from 'express';
import {authorize} from '../middleware/authorization.js';
import {requirePermission} from '../middleware/permissions.js';

export default function operationsRoutes(o){
 const r=Router(),a=authorize();
 r.get('/health',async(q,s,n)=>{try{s.json({data:await o.health()})}catch(e){n(e)}});
 r.use(a);
 r.get('/routes',requirePermission('operations:read'),async(q,s,n)=>{try{s.json({data:await o.routes()})}catch(e){n(e)}});
 r.post('/routes',requirePermission('operations:write'),async(q,s,n)=>{try{s.status(201).json({data:await o.saveRoute(q.body)})}catch(e){n(e)}});
 r.get('/risk/rules',requirePermission('risk:read'),async(q,s,n)=>{try{s.json({data:await o.riskRules(q.admin.workspace_id,q.query.merchant_id)})}catch(e){n(e)}});
 r.post('/risk/rules',requirePermission('risk:write'),async(q,s,n)=>{try{s.status(201).json({data:await o.createRiskRule(q.body,q.admin.workspace_id)})}catch(e){n(e)}});
 r.get('/risk/lists',requirePermission('risk:read'),async(q,s,n)=>{try{s.json({data:await o.riskLists(q.admin.workspace_id,q.query.merchant_id)})}catch(e){n(e)}});
 r.post('/risk/lists',requirePermission('risk:write'),async(q,s,n)=>{try{s.status(201).json({data:await o.addRiskList(q.body,q.admin.workspace_id,q.admin.user_id)})}catch(e){n(e)}});
 r.post('/risk/simulate',requirePermission('risk:write'),async(q,s,n)=>{try{const merchant=await (await import('../database.js')).default.get('SELECT * FROM merchants WHERE id=? AND workspace_id=?',[q.body.merchant_id,q.admin.workspace_id]);if(!merchant)return s.status(404).json({error:{message:'Project tidak ditemukan.'}});s.json({data:await o.evaluate(merchant,q.body.input||{},{dryRun:true})})}catch(e){n(e)}});
 r.post('/risk/events/:id/review',requirePermission('risk:write'),async(q,s,n)=>{try{s.json({data:await o.reviewRisk(q.params.id,q.body.decision,q.admin.user_id)})}catch(e){n(e)}});
 r.get('/disputes',requirePermission('disputes:read'),async(q,s,n)=>{try{s.json({data:await o.disputes()})}catch(e){n(e)}});
 r.post('/disputes',requirePermission('disputes:write'),async(q,s,n)=>{try{s.status(201).json({data:await o.createDispute(q.body,q.admin.user_id)})}catch(e){n(e)}});
 r.post('/disputes/:id/transition',requirePermission('disputes:write'),async(q,s,n)=>{try{s.json({data:await o.transitionDispute(q.params.id,q.body.status,q.body.notes,q.admin.user_id)})}catch(e){n(e)}});
 r.post('/disputes/:id/evidence',requirePermission('disputes:write'),async(q,s,n)=>{try{s.status(201).json({data:await o.addEvidence(q.params.id,q.body,q.admin.user_id)})}catch(e){n(e)}});
 r.get('/providers',requirePermission('operations:read'),async(q,s,n)=>{try{s.json({data:await o.providers.summary()})}catch(e){n(e)}});
 r.post('/providers/:name/probe',requirePermission('operations:write'),async(q,s,n)=>{try{s.json({data:await o.providers.probe(q.params.name)})}catch(e){n(e)}});
 r.put('/providers/:name/circuit-policy',requirePermission('operations:write'),async(q,s,n)=>{try{s.json({data:await o.providers.savePolicy(q.params.name,q.body,q.admin.user_id)})}catch(e){n(e)}});
 r.get('/status',async(q,s,n)=>{try{const incidents=(await o.incidents()).filter(x=>x.public_status);s.json({data:{providers:await o.providers.summary(),incidents}})}catch(e){n(e)}});
 r.get('/incidents',requirePermission('operations:read'),async(q,s,n)=>{try{s.json({data:await o.incidents()})}catch(e){n(e)}});
 r.post('/incidents',requirePermission('operations:write'),async(q,s,n)=>{try{s.status(201).json({data:await o.createIncident(q.body,q.admin.user_id)})}catch(e){n(e)}});
 r.post('/incidents/:id/updates',requirePermission('operations:write'),async(q,s,n)=>{try{s.json({data:await o.updateIncident(q.params.id,q.body,q.admin.user_id)})}catch(e){n(e)}});
 return r;
}
