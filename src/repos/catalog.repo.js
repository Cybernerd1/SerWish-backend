/** Categories, services, packages, extras and offers (public, read-only). */
import { db } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

const SERVICE_COLS = `id, category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included,
  rating_avg, rating_count, display_order,
  category:categories!services_category_id_fkey(slug),
  packages:service_packages(id, name, price, duration_mins, pros_count, includes, is_popular, display_order),
  extras:service_extras(id, name, price, display_order)`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const listCategories = async () =>
  unwrap(
    await db()
      .from('categories')
      .select('id, slug, name, icon, image_url, group_name, tagline, display_order')
      .eq('is_active', true)
      .order('display_order'),
  );

export const getCategory = async (idOrSlug) =>
  unwrap(
    await db()
      .from('categories')
      .select('id, slug, name, icon, image_url, group_name, tagline')
      .eq(UUID_RE.test(idOrSlug) ? 'id' : 'slug', idOrSlug)
      .eq('is_active', true)
      .maybeSingle(),
  );

/**
 * @param {{ categoryId?: string, q?: string, sort?: 'popular'|'price_asc'|'price_desc'|'rating', limit: number, offset: number }} f
 */
export const listServices = async (f) => {
  let query = db().from('services').select(SERVICE_COLS, { count: 'exact' }).eq('is_active', true);
  if (f.categoryId) query = query.eq('category_id', f.categoryId);
  if (f.q) {
    // Escape PostgREST filter syntax and LIKE wildcards in user input.
    const term = f.q.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[,()*"]/g, ' ');
    query = query.or(`name.ilike.*${term}*,subtitle.ilike.*${term}*`);
  }
  switch (f.sort) {
    case 'price_asc':
      query = query.order('base_price', { ascending: true });
      break;
    case 'price_desc':
      query = query.order('base_price', { ascending: false });
      break;
    case 'rating':
      query = query.order('rating_avg', { ascending: false, nullsFirst: false });
      break;
    default:
      query = query.order('rating_count', { ascending: false }).order('display_order');
  }
  const { data, error, count } = await query.range(f.offset, f.offset + f.limit - 1);
  return { rows: unwrap({ data, error }), total: count ?? 0 };
};

export const getService = async (idOrSlug) =>
  unwrap(
    await db()
      .from('services')
      .select(SERVICE_COLS)
      .eq(UUID_RE.test(idOrSlug) ? 'id' : 'slug', idOrSlug)
      .eq('is_active', true)
      .maybeSingle(),
  );

export const listActiveOffers = async () => {
  const now = new Date().toISOString();
  return unwrap(
    await db()
      .from('offers')
      .select('code, title, description, kind, value, max_discount, min_order, valid_to, category:categories(slug)')
      .eq('is_active', true)
      .or(`valid_from.is.null,valid_from.lte.${now}`)
      .or(`valid_to.is.null,valid_to.gte.${now}`)
      .order('created_at', { ascending: false }),
  );
};

/** Lowest service price per category id (for "from ₹299" on category tiles). */
export const priceFromByCategory = async () => {
  const rows = unwrap(await db().from('services').select('category_id, base_price').eq('is_active', true));
  const map = new Map();
  for (const r of rows) map.set(r.category_id, Math.min(map.get(r.category_id) ?? Infinity, r.base_price));
  return map;
};

const likeTerm = (q) =>
  q
    .replace(/[%_\\]/g, (c) => `\\${c}`)
    .replace(/[,()*"]/g, ' ')
    .trim();

/** Search categories and services by name (search screen + autocomplete). */
export const search = async (q, limit = 10) => {
  const term = likeTerm(q);
  if (!term) return { categories: [], services: [] };
  const [cats, svcs] = await Promise.all([
    db()
      .from('categories')
      .select('id, slug, name, icon, image_url, group_name, tagline')
      .eq('is_active', true)
      .or(`name.ilike.*${term}*,tagline.ilike.*${term}*`)
      .order('display_order')
      .limit(limit),
    db()
      .from('services')
      .select(SERVICE_COLS)
      .eq('is_active', true)
      .or(`name.ilike.*${term}*,subtitle.ilike.*${term}*,description.ilike.*${term}*`)
      .order('rating_count', { ascending: false })
      .limit(limit),
  ]);
  return { categories: unwrap(cats), services: unwrap(svcs) };
};
