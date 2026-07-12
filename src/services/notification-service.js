import db,{id,now} from '../database.js';
export class NotificationService{
 create({userId=null,eventType,title,body,metadata=null}){const item={id:id('ntf'),user_id:userId,event_type:eventType,title,body,metadata_json:metadata?JSON.stringify(metadata):null,read_at:null,created_at:now()};db.prepare('INSERT INTO in_app_notifications (id,user_id,event_type,title,body,metadata_json,read_at,created_at) VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(item));return item}
 list(userId,{unreadOnly=false,limit=100}={}){return db.prepare(`SELECT * FROM in_app_notifications WHERE (user_id IS NULL OR user_id=?) ${unreadOnly?'AND read_at IS NULL':''} ORDER BY created_at DESC LIMIT ?`).all(userId,Math.min(200,limit))}
 markRead(notificationId,userId){const timestamp=now();const result=db.prepare('UPDATE in_app_notifications SET read_at=? WHERE id=? AND (user_id IS NULL OR user_id=?)').run(timestamp,notificationId,userId);if(!result.changes)throw Object.assign(new Error('Notifikasi tidak ditemukan.'),{status:404});return db.prepare('SELECT * FROM in_app_notifications WHERE id=?').get(notificationId)}
 markAllRead(userId){return db.prepare('UPDATE in_app_notifications SET read_at=? WHERE read_at IS NULL AND (user_id IS NULL OR user_id=?)').run(now(),userId).changes}
}
