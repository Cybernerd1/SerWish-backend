/**
 * Upload handling for verification photos: multer in memory (nothing touches
 * the server's disk), size and count limits, and a content check on the bytes
 * themselves so a renamed file cannot pass as an image.
 */
import multer from 'multer';
import { AppError, validationFailed } from '../../utils/errors.js';

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 2, fields: 6, fieldSize: 1024 },
});

/** Detect the real type from the first bytes. */
export const sniff = (buf) => {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { type: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP')
    return { type: 'image/webp', ext: 'webp' };
  if (
    buf
      .subarray(4, 12)
      .toString('ascii')
      .match(/^ftyp(heic|heix|mif1|msf1)/)
  )
    return { type: 'image/heic', ext: 'heic' };
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return { type: 'application/pdf', ext: 'pdf' };
  return null;
};

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: [413, 'FILE_TOO_LARGE', 'Each photo must be under 6 MB.'],
  LIMIT_FILE_COUNT: [400, 'TOO_MANY_FILES', 'Too many files in one upload.'],
  LIMIT_UNEXPECTED_FILE: [400, 'UNEXPECTED_FILE', 'Unexpected file field.'],
};

/**
 * multer for the named file fields, then type checks.
 *   fields: [{ name: 'front', required: true, pdf: false }, ...]
 */
export const acceptFiles = (fields) => {
  const mw = upload.fields(fields.map((f) => ({ name: f.name, maxCount: 1 })));
  return (req, res, next) => {
    if (!req.is('multipart/form-data')) {
      return next(new AppError(415, 'MULTIPART_REQUIRED', 'Send the photo as multipart/form-data.'));
    }
    mw(req, res, (err) => {
      if (err) {
        const m = MULTER_MESSAGES[err.code];
        return next(m ? new AppError(m[0], m[1], m[2]) : err);
      }
      const problems = [];
      req.uploads = {};
      for (const f of fields) {
        const file = req.files?.[f.name]?.[0];
        if (!file) {
          if (f.required) problems.push({ field: `files.${f.name}`, message: 'Add this photo' });
          continue;
        }
        const kind = sniff(file.buffer);
        const allowed = kind && (kind.type.startsWith('image/') || (f.pdf && kind.type === 'application/pdf'));
        if (!allowed) {
          problems.push({
            field: `files.${f.name}`,
            message: f.pdf ? 'Use a JPG, PNG or PDF file' : 'Use a JPG or PNG photo',
          });
          continue;
        }
        req.uploads[f.name] = { buffer: file.buffer, type: kind.type, ext: kind.ext, size: file.size };
      }
      if (problems.length) return next(validationFailed(problems));
      return next();
    });
  };
};
