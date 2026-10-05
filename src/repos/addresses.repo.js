/** Saved addresses. Every query is scoped to the owner. */
import { db } from '../config/supabase.js';
import { unwrap, notFound } from '../utils/errors.js';

const COLS = 'id, user_id, label, line1, line2, city, pincode, lat, lng, is_default, created_at';
export const MAX_ADDRESSES = 10;

const point = (lat, lng) => `SRID=4326;POINT(${Number(lng)} ${Number(lat)})`;

export const listForUser = async (userId) =>
  unwrap(
    await db()
      .from('addresses')
      .select(COLS)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true }),
  );

export const getForUser = async (userId, id) => {
  const row = unwrap(
    await db().from('addresses').select(COLS).eq('id', id).eq('user_id', userId).is('deleted_at', null).maybeSingle(),
  );
  if (!row) throw notFound('Address');
  return row;
};

const clearDefault = async (userId) =>
  unwrap(await db().from('addresses').update({ is_default: false }).eq('user_id', userId).eq('is_default', true));

export const countForUser = async (userId) => {
  const { count, error } = await db()
    .from('addresses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (error) unwrap({ error });
  return count ?? 0;
};

export const create = async (userId, input) => {
  const existing = await countForUser(userId);
  const makeDefault = input.isDefault || existing === 0;
  if (makeDefault) await clearDefault(userId);
  return unwrap(
    await db()
      .from('addresses')
      .insert({
        user_id: userId,
        label: input.label,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        pincode: input.pincode,
        location: point(input.lat, input.lng),
        is_default: makeDefault,
      })
      .select(COLS)
      .single(),
  );
};

export const update = async (userId, id, input) => {
  await getForUser(userId, id);
  const patch = {};
  for (const [k, col] of [
    ['label', 'label'],
    ['line1', 'line1'],
    ['line2', 'line2'],
    ['city', 'city'],
    ['pincode', 'pincode'],
  ]) {
    if (input[k] !== undefined) patch[col] = input[k];
  }
  if (input.lat !== undefined && input.lng !== undefined) patch.location = point(input.lat, input.lng);
  if (input.isDefault === true) {
    await clearDefault(userId);
    patch.is_default = true;
  }
  return unwrap(await db().from('addresses').update(patch).eq('id', id).eq('user_id', userId).select(COLS).single());
};

/** Soft delete (bookings keep their address snapshot). Promotes another default if needed. */
export const remove = async (userId, id) => {
  const row = await getForUser(userId, id);
  unwrap(
    await db()
      .from('addresses')
      .update({ deleted_at: new Date().toISOString(), is_default: false })
      .eq('id', id)
      .eq('user_id', userId),
  );
  if (row.is_default) {
    const next = (await listForUser(userId))[0];
    if (next) unwrap(await db().from('addresses').update({ is_default: true }).eq('id', next.id));
  }
};
