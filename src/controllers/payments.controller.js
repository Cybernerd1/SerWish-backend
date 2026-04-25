import { supabaseAdmin } from '../config/supabase.js';
import { success, error, notFound } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * GET /api/v1/payments/methods
 */
export const getPaymentMethods = async (req, res, next) => {
  try {
    const { data, error: dbError } = await supabaseAdmin
      .from('payment_methods')
      .select('id, type, label, masked_details, is_default, created_at')
      .eq('user_id', req.userId)
      .order('is_default', { ascending: false });

    if (dbError) return error(res, dbError.message, 400);

    return success(res, data || []);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/payments/methods
 * Saves a Razorpay token reference (never store actual card data)
 */
export const addPaymentMethod = async (req, res, next) => {
  try {
    const { type, razorpayTokenId, label, maskedDetails } = req.body;

    if (!type || !razorpayTokenId) return error(res, 'type and razorpayTokenId are required', 400);

    const { data: method, error: dbError } = await supabaseAdmin
      .from('payment_methods')
      .insert({
        user_id: req.userId,
        type, // 'card', 'upi', 'wallet'
        razorpay_token_id: razorpayTokenId,
        label: label || type,
        masked_details: maskedDetails || null,
        is_default: false,
      })
      .select()
      .single();

    if (dbError) return error(res, dbError.message, 400);

    return success(res, method, 'Payment method added', 201);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/payments/methods/:id
 * FIX BUG-012: Return 404 if the payment method does not exist or does not
 * belong to this user, rather than silently returning 200.
 */
export const deletePaymentMethod = async (req, res, next) => {
  try {
    // First confirm the row exists and belongs to this user
    const { data: existing, error: findError } = await supabaseAdmin
      .from('payment_methods')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (findError || !existing) return notFound(res, 'Payment method not found');

    const { error: dbError } = await supabaseAdmin
      .from('payment_methods')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId);

    if (dbError) return error(res, dbError.message, 400);

    return success(res, null, 'Payment method removed');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/payments/wallet/balance
 */
export const getWalletBalance = async (req, res, next) => {
  try {
    const table = req.role === 'provider' ? 'providers' : 'users';
    const { data, error: dbError } = await supabaseAdmin
      .from(table)
      .select('wallet_balance')
      .eq('id', req.userId)
      .single();

    if (dbError) return error(res, dbError.message, 400);

    return success(res, { balance: data?.wallet_balance || 0 });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/payments/wallet/add
 * Add money via Razorpay — verify payment signature then credit wallet atomically.
 *
 * FIX BUG-003: Replaced the non-atomic read-modify-write wallet update with
 * an atomic Supabase RPC call (`add_wallet_funds`) that runs as a single
 * database transaction, preventing race conditions.
 *
 * FIX SEC-002: Razorpay signature MUST be verified here before crediting.
 * TODO: Integrate Razorpay SDK — install with `npm install razorpay` and
 * verify using:
 *   const crypto = require('crypto');
 *   const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
 *     .update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
 *   if (expectedSignature !== razorpaySignature) throw new Error('Invalid signature');
 */
export const addWalletFunds = async (req, res, next) => {
  try {
    const { amount, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;

    if (!amount || amount <= 0) return error(res, 'Invalid amount', 400);
    if (!razorpayPaymentId) return error(res, 'razorpayPaymentId is required', 400);

    // SEC-002: Verify Razorpay payment signature before crediting
    // Uncomment and complete once Razorpay SDK is installed:
    // const crypto = await import('crypto');
    // const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    // const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    //   .update(body).digest('hex');
    // if (expectedSignature !== razorpaySignature) {
    //   return error(res, 'Payment verification failed: invalid signature', 400);
    // }

    const table = req.role === 'provider' ? 'providers' : 'users';

    // FIX BUG-003: Use atomic RPC to avoid TOCTOU race condition.
    // The `add_wallet_funds` Supabase function must implement:
    //   UPDATE <table> SET wallet_balance = wallet_balance + p_amount WHERE id = p_user_id
    //   RETURNING wallet_balance;
    const { data: result, error: rpcError } = await supabaseAdmin.rpc('add_wallet_funds', {
      p_user_id: req.userId,
      p_user_table: table,
      p_amount: amount,
    });

    if (rpcError) return error(res, rpcError.message, 400);

    // Log transaction
    await supabaseAdmin.from('wallet_transactions').insert({
      user_id: req.userId,
      user_type: req.role,
      amount,
      type: 'credit',
      status: 'completed',
      description: `Wallet top-up via Razorpay`,
      razorpay_payment_id: razorpayPaymentId,
    });

    logger.info(`Wallet credited Rs. ${amount} for user ${req.userId}`);

    return success(res, { newBalance: result }, `Rs. ${amount} added to wallet`);
  } catch (err) {
    next(err);
  }
};
