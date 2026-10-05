import * as users from '../repos/users.repo.js';
import * as addresses from '../repos/addresses.repo.js';
import { revokeSessions } from '../config/firebase.js';
import { invalidateActor } from '../middleware/auth.js';
import { toAddress, toUser } from '../utils/dto.js';
import { created, noContent, ok } from '../utils/response.js';
import { conflict, notFound } from '../utils/errors.js';

export const getMe = async (req, res) => {
  const row = await users.findById(req.actor.id);
  if (!row) throw notFound('Account');
  return ok(res, toUser(row, { providerProfile: row.provider }));
};

export const updateMe = async (req, res) => {
  const patch = {};
  if (req.body.name !== undefined) patch.name = req.body.name;
  if (req.body.city !== undefined) patch.city = req.body.city;
  if (req.body.photoUrl !== undefined) patch.photo_url = req.body.photoUrl;
  if (req.body.email !== undefined) patch.email = req.body.email;
  const row = Object.keys(patch).length
    ? await users.updateProfile(req.actor.id, patch)
    : await users.findById(req.actor.id);
  invalidateActor(req.actor.id);
  return ok(res, toUser(row, { providerProfile: row.provider }), { message: 'Profile updated' });
};

/** DELETE /users/me - required by Play Store policy. Anonymises and signs out. */
export const deleteMe = async (req, res) => {
  await users.softDelete(req.actor.id);
  invalidateActor(req.actor.id);
  await revokeSessions(req.actor.id).catch(() => {});
  return noContent(res);
};

export const listAddresses = async (req, res) => ok(res, (await addresses.listForUser(req.actor.id)).map(toAddress));

export const createAddress = async (req, res) => {
  if ((await addresses.countForUser(req.actor.id)) >= addresses.MAX_ADDRESSES) {
    throw conflict(`You can save up to ${addresses.MAX_ADDRESSES} addresses`, 'LIMIT_REACHED');
  }
  return created(res, toAddress(await addresses.create(req.actor.id, req.body)), 'Address saved');
};

export const updateAddress = async (req, res) =>
  ok(res, toAddress(await addresses.update(req.actor.id, req.params.id, req.body)), { message: 'Address updated' });

export const deleteAddress = async (req, res) => {
  await addresses.remove(req.actor.id, req.params.id);
  return noContent(res);
};
