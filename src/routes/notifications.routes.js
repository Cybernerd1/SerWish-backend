/** In-app notifications (Notifications screen). */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { db } from '../config/supabase.js';
import { toNotification } from '../utils/dto.js';
import { unwrap, notFound } from '../utils/errors.js';
import { asyncHandler, ok } from '../utils/response.js';
import { pagination, uuid, validate } from '../utils/validators.js';

const router = Router();
router.use(authenticate);
const COLS = 'id, kind, title, body, data, read_at, created_at';

router.get(
  '/',
  validate({ query: pagination.extend({ unread: z.enum(['true', 'false']).optional() }) }),
  asyncHandler(async (req, res) => {
    const { limit, offset, unread } = req.query;
    let q = db().from('notifications').select(COLS, { count: 'exact' }).eq('user_id', req.actor.id);
    if (unread === 'true') q = q.is('read_at', null);
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    const { count: unreadCount } = await db()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.actor.id)
      .is('read_at', null);
    return ok(res, unwrap({ data, error }).map(toNotification), {
      meta: { total: count ?? 0, unread: unreadCount ?? 0, limit, offset },
    });
  }),
);

router.post(
  '/read',
  validate({ body: z.object({ ids: z.array(uuid).max(100).optional() }).strict() }),
  asyncHandler(async (req, res) => {
    let q = db()
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', req.actor.id)
      .is('read_at', null);
    if (req.body.ids?.length) q = q.in('id', req.body.ids);
    unwrap(await q);
    return ok(res, null, { message: 'Marked as read' });
  }),
);

router.post(
  '/:id/read',
  validate({ params: z.object({ id: uuid }) }),
  asyncHandler(async (req, res) => {
    const row = unwrap(
      await db()
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('user_id', req.actor.id)
        .select(COLS)
        .maybeSingle(),
    );
    if (!row) throw notFound('Notification');
    return ok(res, toNotification(row));
  }),
);

export default router;
