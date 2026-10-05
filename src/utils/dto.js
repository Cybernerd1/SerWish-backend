/**
 * Row -> API mappers (camelCase). These are allow-lists: a column is only
 * returned if it is named here, so secrets such as otp_hash, KYC document
 * paths or Razorpay ids can never leak by accident (audit BE-X4).
 * Shapes match the app models in serwishapp/src/data/types.ts.
 */

const num = (v) => (v === null || v === undefined ? null : Number(v));
const LABEL_OUT = { home: 'Home', work: 'Work', other: 'Other' };

export const toUser = (row, { providerProfile = null } = {}) => ({
  id: row.id,
  name: row.name ?? null,
  email: row.email ?? null,
  phone: row.phone ?? null,
  profilePhotoUrl: row.photo_url ?? null,
  city: row.city ?? null,
  role: providerProfile ? 'provider' : 'seeker',
  isPartner: !!providerProfile,
  kycStatus: providerProfile?.kyc_status ?? null,
  isAdmin: !!row.is_admin,
  createdAt: row.created_at,
});

export const toAddress = (row) => ({
  id: row.id,
  label: LABEL_OUT[row.label] ?? 'Other',
  line1: row.line1,
  line2: row.line2 ?? '',
  city: row.city,
  pincode: row.pincode,
  lat: num(row.lat),
  lng: num(row.lng),
  isDefault: !!row.is_default,
});

export const toCategory = (row, priceFrom) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  icon: row.icon,
  group: row.group_name,
  image: row.image_url ?? null,
  tagline: row.tagline ?? '',
  ...(priceFrom !== undefined && { priceFrom: Number.isFinite(priceFrom) ? priceFrom : null }),
});

export const toPackage = (row) => ({
  id: row.id,
  name: row.name,
  price: row.price,
  durationMins: row.duration_mins,
  pros: row.pros_count,
  includes: row.includes ?? [],
  popular: !!row.is_popular,
});

export const toExtra = (row) => ({ id: row.id, name: row.name, price: row.price });

const byOrder = (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0);

export const toService = (row) => ({
  id: row.id,
  slug: row.slug,
  categorySlug: row.category?.slug ?? null,
  name: row.name,
  subtitle: row.subtitle ?? '',
  image: row.image_url ?? null,
  priceFrom: row.base_price,
  rating: num(row.rating_avg),
  reviewCount: row.rating_count ?? 0,
  durationMins: row.duration_mins,
  description: row.description ?? '',
  included: row.included ?? [],
  packages: (row.packages ?? []).slice().sort(byOrder).map(toPackage),
  extras: (row.extras ?? []).slice().sort(byOrder).map(toExtra),
});

/** Card shape used by lists (nearby_providers RPC row). */
export const toProviderCard = (row) => ({
  id: row.provider_id,
  name: row.name ?? 'SerWish Partner',
  title: row.headline ?? 'Service Partner',
  avatar: row.photo_url ?? null,
  rating: num(row.rating_avg),
  reviewCount: row.rating_count ?? 0,
  jobs: row.total_jobs ?? 0,
  pricePerHour: row.hourly_rate ?? null,
  years: row.years_experience ?? 0,
  online: !!row.is_online,
  distanceKm: num(row.distance_km),
});

/**
 * Full profile. `profile` is a provider_profiles row joined with users;
 * KYC document paths and exact location are deliberately not mapped.
 */
export const toProviderDetail = ({ profile, categories, serviceIds, gallery, breakdown, distanceKm }) => ({
  id: profile.user_id,
  name: profile.user?.name ?? 'SerWish Partner',
  title: profile.headline ?? 'Service Partner',
  avatar: profile.user?.photo_url ?? null,
  rating: num(profile.rating_avg),
  reviewCount: profile.rating_count ?? 0,
  jobs: profile.total_jobs ?? 0,
  pricePerHour: profile.hourly_rate ?? null,
  years: profile.years_experience ?? 0,
  languages: profile.languages ?? [],
  bio: profile.bio ?? '',
  areas: profile.service_areas ?? [],
  online: !!profile.is_online,
  verified: profile.kyc_status === 'approved',
  categorySlugs: categories,
  serviceIds,
  gallery,
  ratingBreakdown: breakdown,
  distanceKm: distanceKm ?? null,
});

export const toReview = (row) => ({
  id: row.id,
  author: row.customer?.name ?? 'SerWish customer',
  avatar: row.customer?.photo_url ?? null,
  date: row.created_at,
  rating: row.rating,
  text: row.comment ?? '',
  tags: row.tags ?? [],
  photos: row.photos ?? [],
  service: row.booking?.service?.name ?? null,
});

export const toOffer = (row) => ({
  code: row.code,
  title: row.title,
  description: row.description ?? '',
  kind: row.kind,
  value: row.value,
  maxDiscount: row.max_discount ?? undefined,
  minOrder: row.min_order ?? undefined,
  categorySlug: row.category?.slug ?? null,
  validTo: row.valid_to ?? null,
});

/** % of reviews per star, 5 -> 1, rounded so the bars add up to 100 (or all zero). */
export const ratingBreakdown = (ratings) => {
  const counts = [5, 4, 3, 2, 1].map((s) => ratings.filter((r) => r === s).length);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return [0, 0, 0, 0, 0];
  const pct = counts.map((c) => Math.floor((c * 100) / total));
  let rest = 100 - pct.reduce((a, b) => a + b, 0);
  const order = counts
    .map((c, i) => [((c * 100) / total) % 1, i])
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);
  for (const i of order) {
    if (rest <= 0) break;
    pct[i] += 1;
    rest -= 1;
  }
  return pct;
};

/* ---------- Bookings (Backend Phase 3) ---------- */

const TIMELINE = ['searching', 'assigned', 'en_route', 'arrived', 'in_progress', 'completed'];

/**
 * The app's four tabs: upcoming | ongoing | completed | cancelled.
 * A 'later' booking stays upcoming until the partner starts the trip.
 */
export const appStatusFor = (row, now = Date.now()) => {
  switch (row.status) {
    case 'completed':
      return 'completed';
    case 'cancelled':
    case 'no_providers':
      return 'cancelled';
    case 'searching':
    case 'assigned':
      return row.schedule_type === 'later' && Date.parse(row.scheduled_at) > now ? 'upcoming' : 'ongoing';
    default:
      return 'ongoing';
  }
};

const toTimeline = (row) => {
  const at = {
    searching: row.created_at,
    assigned: row.assigned_at,
    en_route: row.en_route_at,
    arrived: row.arrived_at,
    in_progress: row.started_at,
    completed: row.completed_at,
  };
  return TIMELINE.map((status) => ({ status, at: at[status] ?? null, done: !!at[status] }));
};

/**
 * @param {object} row bookings row with embeds (see bookings.repo BOOKING_COLS)
 * @param {'customer'|'partner'} viewer
 */
export const toBooking = (row, viewer = 'customer') => {
  const isPartner = viewer === 'partner';
  const base = {
    id: row.id,
    code: row.code,
    status: row.status,
    appStatus: appStatusFor(row),
    service: row.service
      ? {
          id: row.service.id,
          slug: row.service.slug,
          name: row.service.name,
          image: row.service.image_url ?? null,
          durationMins: row.service.duration_mins,
        }
      : { id: row.service_id },
    package: row.package ? { id: row.package.id, name: row.package.name, pros: row.package.pros_count } : null,
    extras: (row.extras ?? []).map((x) => ({ id: x.id, name: x.name, price: x.price })),
    scheduleType: row.schedule_type,
    asap: row.schedule_type === 'now',
    scheduledAt: row.scheduled_at,
    address: { id: row.address_id ?? null, text: row.address_text, lat: num(row.lat), lng: num(row.lng) },
    notes: row.notes ?? null,
    price: {
      base: row.base_price,
      extras: row.extras_total,
      discount: row.discount,
      fee: row.platform_fee,
      total: row.total,
    },
    couponCode: row.coupon_code ?? null,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    paid: row.payment_status === 'paid',
    cancelledBy: row.cancelled_by ?? null,
    cancelReason: row.cancel_reason ?? null,
    timeline: toTimeline(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    review: row.review
      ? {
          rating: row.review.rating,
          text: row.review.comment ?? '',
          tags: row.review.tags ?? [],
          at: row.review.created_at,
        }
      : null,
  };
  if (isPartner) {
    return {
      ...base,
      payout: row.total - row.platform_fee,
      customer: row.customer
        ? { id: row.customer.id, name: row.customer.name ?? 'SerWish customer', avatar: row.customer.photo_url ?? null }
        : null,
    };
  }
  return {
    ...base,
    provider: row.provider
      ? {
          id: row.provider.user_id,
          name: row.provider.user?.name ?? 'SerWish Partner',
          avatar: row.provider.user?.photo_url ?? null,
          title: row.provider.headline ?? 'Service Partner',
          rating: num(row.provider.rating_avg),
          reviewCount: row.provider.rating_count ?? 0,
          jobs: row.provider.total_jobs ?? 0,
        }
      : null,
  };
};

/** Locality only (no house number) until the partner accepts. */
export const areaOf = (addressText = '') => {
  const parts = String(addressText)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(', ') : (parts[0] ?? '');
};

/** Incoming-job card for the partner app (ProviderJob shape). */
export const toJobOffer = (row) => ({
  id: row.id,
  bookingId: row.booking_id,
  status: row.status,
  serviceId: row.booking?.service?.id ?? null,
  serviceName: row.booking?.service?.name ?? 'Service',
  packageName: row.booking?.package?.name ?? null,
  image: row.booking?.service?.image_url ?? null,
  durationMins: row.booking?.service?.duration_mins ?? null,
  customerName: row.booking?.customer?.name ?? 'SerWish customer',
  area: areaOf(row.booking?.address_text),
  distanceKm: num(row.distance_km),
  payout: row.booking ? row.booking.total - row.booking.platform_fee : null,
  scheduleType: row.booking?.schedule_type ?? 'now',
  scheduledAt: row.booking?.scheduled_at ?? null,
  extras: (row.booking?.extras ?? []).map((x) => x.name),
  offeredAt: row.offered_at,
  expiresAt: row.expires_at,
});

export const toNotification = (row) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  at: row.created_at,
  read: !!row.read_at,
  bookingId: row.data?.bookingId ?? undefined,
  offerCode: row.data?.offerCode ?? undefined,
  icon: row.data?.icon ?? 'feature',
});

/** The partner's own profile (Partner Profile + KYC status screens). Doc paths stay hidden. */
export const toOwnPartnerProfile = (row) => ({
  id: row.user_id,
  name: row.user?.name ?? null,
  email: row.user?.email ?? null,
  phone: row.user?.phone ?? null,
  avatar: row.user?.photo_url ?? null,
  city: row.user?.city ?? null,
  title: row.headline ?? null,
  bio: row.bio ?? '',
  years: row.years_experience ?? 0,
  languages: row.languages ?? [],
  pricePerHour: row.hourly_rate ?? null,
  areas: row.service_areas ?? [],
  categories: (row.categories ?? [])
    .map((c) => c.category)
    .filter(Boolean)
    .map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
  kyc: {
    status: row.kyc_status,
    submittedAt: row.kyc_submitted_at ?? null,
    reviewedAt: row.kyc_reviewed_at ?? null,
    rejectionReason: row.kyc_rejection_reason ?? null,
  },
  online: !!row.is_online,
  canGoOnline: row.kyc_status === 'approved',
  rating: num(row.rating_avg),
  reviewCount: row.rating_count ?? 0,
  jobs: row.total_jobs ?? 0,
  joinedAt: row.created_at,
});
