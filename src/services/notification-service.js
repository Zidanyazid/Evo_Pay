import db, { id, now } from '../database.js';

export class NotificationService {
  async create({ userId = null, eventType, title, body, metadata = null }) {
    const item = { id: id('ntf'), user_id: userId, event_type: eventType, title, body, metadata_json: metadata ? JSON.stringify(metadata) : null, read_at: null, created_at: now() };
    await db.run('INSERT INTO in_app_notifications (id,user_id,event_type,title,body,metadata_json,read_at,created_at) VALUES (?,?,?,?,?,?,?,?)', Object.values(item));
    return item;
  }

  async list(userId, { unreadOnly = false, limit = 100 } = {}) {
    return db.all(`SELECT * FROM in_app_notifications WHERE (user_id IS NULL OR user_id=?) ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT ?`, [userId, Math.min(200, limit)]);
  }

  async markRead(notificationId, userId) {
    const result = await db.run('UPDATE in_app_notifications SET read_at=? WHERE id=? AND (user_id IS NULL OR user_id=?)', [now(), notificationId, userId]);
    if (!result.changes) throw Object.assign(new Error('Notifikasi tidak ditemukan.'), { status: 404 });
    return db.get('SELECT * FROM in_app_notifications WHERE id=?', [notificationId]);
  }

  async markAllRead(userId) {
    return (await db.run('UPDATE in_app_notifications SET read_at=? WHERE read_at IS NULL AND (user_id IS NULL OR user_id=?)', [now(), userId])).changes;
  }
}
