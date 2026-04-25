import { supabaseAdmin } from '../config/supabase.js';
import { success, error, notFound } from '../utils/response.js';

/**
 * GET /api/v1/services/categories
 */
export const getCategories = async (req, res, next) => {
  try {
    const { data, error: dbError } = await supabaseAdmin
      .from('service_categories')
      .select('id, name, slug, icon_url, description')
      .order('display_order', { ascending: true });

    if (dbError) return error(res, dbError.message, 400);

    return success(res, data || []);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/services/categories/:slug
 * FIX BUG-027: Replaced select('*') with explicit column list to avoid
 * exposing internal/admin fields like base_price, cost price, etc.
 */
export const getCategoryBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const { data, error: dbError } = await supabaseAdmin
      .from('service_categories')
      .select('id, name, slug, icon_url, description, base_price, display_order')
      .eq('slug', slug)
      .single();

    if (dbError || !data) return notFound(res, 'Category not found');

    return success(res, data);
  } catch (err) {
    next(err);
  }
};
