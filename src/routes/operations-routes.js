import {Router} from 'express';
import {authorize} from '../middleware/authorization.js';
import {requirePermission} from '../middleware/permissions.js';

export default function operationsRoutes(o){
 const r=Router(),a=authorize();
 r.get('/health',async(q,s,n)=>{try{s.json({data:await o.health()})}catch(e){n(e)}});
 r.use(a);
 r.get('/routes',requirePermission('operations:read'),async(q,s,n)=>{try{s.json({data:await o.routes()})}catch(e){n(e)}});
 r.post('/routes',requirePermission('operations:write'),async(q,s,n)=>{try{s.status(201).json({data:await o.saveRoute(q.body)})}catch(e){n(e)}});
 r.get('/risk/rules',requirePermission('risk:read'),async(q,s,n)=>{try{s.json({data:await o.riskRules()})}catch(e){n(e)}});
 r.post('/risk/rules',requirePermission('risk:write'),async(q,s,n)=>{try{s.status(201).json({data:await o.createRiskRule(q.body)})}catch(e){n(e)}});
 r.post('/risk/events/:id/review',requirePermission('risk:write'),async(q,s,n)=>{try{s.json({data:await o.reviewRisk(q.params.id,q.body.decision,q.admin.user_id)})}catch(e){n(e)}});
 r.get('/disputes',requirePermission('disputes:read'),async(q,s,n)=>{try{s.json({data:await o.disputes()})}catch(e){n(e)}});
 r.post('/disputes',requirePermission('disputes:write'),async(q,s,n)=>{try{s.status(201).json({data:await o.createDispute(q.body,q.admin.user_id)})}catch(e){n(e)}});
 r.post('/disputes/:id/transition',requirePermission('disputes:write'),async(q,s,n)=>{try{s.json({data:await o.transitionDispute(q.params.id,q.body.status,q.body.notes,q.admin.user_id)})}catch(e){n(e)}});
 r.post('/disputes/:id/evidence',requirePermission('disputes:write'),async(q,s,n)=>{try{s.status(201).json({data:await o.addEvidence(q.params.id,q.body,q.admin.user_id)})}catch(e){n(e)}});
 r.get('/incidents',requirePermission('operations:read'),async(q,s,n)=>{try{s.json({data:await o.incidents()})}catch(e){n(e)}});
 r.post('/incidents',requirePermission('operations:write'),async(q,s,n)=>{try{s.status(201).json({data:await o.createIncident(q.body,q.admin.user_id)})}catch(e){n(e)}});
 r.post('/incidents/:id/updates',requirePermission('operations:write'),async(q,s,n)=>{try{s.json({data:await o.updateIncident(q.params.id,q.body,q.admin.user_id)})}catch(e){n(e)}});
 return r;
}
