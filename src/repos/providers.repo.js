/** Partner discovery and public profiles. Never selects KYC document paths. */
import { db } from '../config/supabase.js';
import { unwrap } from '../utils/errors.js';

const PUBLIC_PROFILE = `user_id, headline, bio, years_experience, languages, hourly_rate, service_areas, kyc_status,
  is_online, rating_avg, rating_count, total_jobs,
  user:users!provider_profiles_user_id_fkey(name, photo_url, is_active, deleted_at)`;

export const nearby = async (f) =>
  unwrap(
    await db().rpc('nearby_providers', {
      p_lat: f.lat,
      p_lng: f.lng,
      p_radius_km: f.radiusKm,
      p_category_slug: f.category ?? null,
      p_service_id: f.serviceId ?? null,
      p_sort: f.sort,
      p_online_only: f.onlineOnly,
      p_limit: f.limit,
      p_offset: f.offset,
    }),
  );

/** Public profile of an approved, active partner, or null. */
export const getPublicProfile = async (providerId) => {
  const row = unwrap(
    await db()
      .from('provider_profiles')
      .select(PUBLIC_PROFILE)
      .eq('user_id', providerId)
      .eq('kyc_status', 'approved')
      .maybeSingle(),
  );
  if (!row || !row.user?.is_active || row.user?.deleted_at) return null;
  return row;
};

export const getProfileExtras = async (providerId) => {
  const [cats, gallery, ratings] = await Promise.all([
    db().from('provider_categories').select('category:categories(id, slug)').eq('provider_id', providerId),
    db()
      .from('provider_gallery')
      .select('image_url, created_at')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false })
      .limit(12),
    db().from('reviews').select('rating').eq('provider_id', providerId).limit(5000),
  ]);
  const categories = unwrap(cats)
    .map((r) => r.category)
    .filter(Boolean);
  let serviceIds = [];
  if (categories.length) {
    serviceIds = unwrap(
      await db()
        .from('services')
        .select('id')
        .in(
          'category_id',
          categories.map((c) => c.id),
        )
        .eq('is_active', true),
    ).map((s) => s.id);
  }
  return {
    categories: categories.map((c) => c.slug),
    serviceIds,
    gallery: unwrap(gallery).map((g) => g.image_url),
    ratings: unwrap(ratings).map((r) => r.rating),
  };
};

export const listReviews = async (providerId, { limit, offset }) => {
  const { data, error, count } = await db()
    .from('reviews')
    .select(
      `id, rating, tags, comment, photos, created_at,
       customer:users!reviews_customer_id_fkey(name, photo_url),
       booking:bookings!reviews_booking_id_fkey(service:services!bookings_service_id_fkey(name))`,
      { count: 'exact' },
    )
    .eq('provider_id', providerId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return { rows: unwrap({ data, error }), total: count ?? 0 };
};

/** Used by socket presence. */
export const getPartnerState = async (providerId) =>
  unwrap(
    await db()
      .from('provider_profiles')
      .select('user_id, kyc_status, is_online')
      .eq('user_id', providerId)
      .maybeSingle(),
  );

export const setOnline = async (providerId, online) =>
  unwrap(
    await db()
      .from('provider_profiles')
      .update({ is_online: online, last_seen_at: new Date().toISOString() })
      .eq('user_id', providerId)
      .select('user_id, kyc_status, is_online')
      .single(),
  );

export const setLocation = async (providerId, lat, lng) =>
  unwrap(await db().rpc('set_provider_location', { p_provider_id: providerId, p_lat: lat, p_lng: lng }));

/* ---------- Partner self-service (Backend Phase 2) ---------- */

const OWN_PROFILE = `user_id, headline, bio, years_experience, languages, hourly_rate, service_areas, kyc_status,
  kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason, is_online, location_updated_at, rating_avg, rating_count,
  total_jobs, created_at,
  user:users!provider_profiles_user_id_fkey(name, email, phone, photo_url, city),
  categories:provider_categories(category:categories(id, slug, name))`;

export const getOwnProfile = async (providerId) =>
  unwrap(await db().from('provider_profiles').select(OWN_PROFILE).eq('user_id', providerId).maybeSingle());

export const categoryIdsForSlugs = async (slugs) => {
  if (!slugs?.length) return [];
  const rows = unwrap(await db().from('categories').select('id, slug').in('slug', slugs).eq('is_active', true));
  return rows;
};

/** Insert or update profile fields (never touches KYC or online state). */
export const upsertProfile = async (providerId, patch) =>
  unwrap(
    await db()
      .from('provider_profiles')
      .upsert({ user_id: providerId, ...patch }, { onConflict: 'user_id' }),
  );

export const updateProfile = async (providerId, patch) =>
  unwrap(await db().from('provider_profiles').update(patch).eq('user_id', providerId));

/** Replace the partner's categories with exactly this set. */
export const setCategories = async (providerId, categoryIds) => {
  unwrap(await db().from('provider_categories').delete().eq('provider_id', providerId));
  if (categoryIds.length) {
    unwrap(
      await db()
        .from('provider_categories')
        .insert(categoryIds.map((id) => ({ provider_id: providerId, category_id: id }))),
    );
  }
};

export const hasActiveJob = async (providerId) => {
  const { count, error } = await db()
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('provider_id', providerId)
    .in('status', ['assigned', 'en_route', 'arrived', 'in_progress']);
  if (error) unwrap({ error });
  return (count ?? 0) > 0;
};

export const latestReviews = async (providerId, n = 5) => (await listReviews(providerId, { limit: n, offset: 0 })).rows;
