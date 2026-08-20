import {Router} from 'express';import {authorize} from '../middleware/authorization.js';import {requirePermission} from '../middleware/permissions.js';import {audit} from '../services/audit-service.js';
export default function foundationRoutes(team,notifications,jobs){const router=Router(),auth=authorize();router.use(auth);
router.get('/permissions',(req,res)=>res.json({data:{role:req.admin.role}}));
router.get('/team',requirePermission('team:write'),(req,res)=>res.json({data:team.list()}));
router.post('/team',requirePermission('team:write'),(req,res,next)=>{try{const data=team.invite(req.body);audit('team.invited',{actorId:req.admin.user_id,targetType:'admin_user',targetId:data.id,metadata:{role:data.role}});notifications.create({userId:data.id,eventType:'team.invited',title:'Selamat datang di EvoPay',body:`Anda ditambahkan sebagai ${data.role}.`});res.status(201).json({data})}catch(e){next(e)}});
router.patch('/team/:id',requirePermission('team:write'),(req,res,next)=>{try{const data=team.update(req.admin.user_id,req.params.id,req.body);audit('team.updated',{actorId:req.admin.user_id,targetType:'admin_user',targetId:data.id,metadata:req.body});res.json({data})}catch(e){next(e)}});
router.post('/team/:id/revoke-sessions',requirePermission('team:write'),(req,res)=>res.json({data:{revoked:team.revokeSessions(req.params.id)}}));
router.get('/notifications',requirePermission('notifications:read'),(req,res)=>res.json({data:notifications.list(req.admin.user_id,{unreadOnly:req.query.unread==='1'}),meta:{unread:notifications.list(req.admin.user_id,{unreadOnly:true,limit:200}).length}}));
router.post('/notifications/read-all',requirePermission('notifications:read'),(req,res)=>res.json({data:{updated:notifications.markAllRead(req.admin.user_id)}}));
router.post('/notifications/:id/read',requirePermission('notifications:read'),(req,res,next)=>{try{res.json({data:notifications.markRead(req.params.id,req.admin.user_id)})}catch(e){next(e)}});
router.get('/jobs',requirePermission('operations:write'),(req,res)=>res.json({data:jobs?[]:[]}));return router}
