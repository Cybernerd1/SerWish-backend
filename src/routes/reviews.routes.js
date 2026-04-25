import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { ratingValidation, uuidParamValidation } from "../utils/validators.js";
import { body, query } from "express-validator";
import { submitReview, getReviews } from "../controllers/reviews.controller.js";

const router = Router();

// POST /api/v1/reviews
router.post(
  "/",
  authenticate,
  [
    body("bookingId").isUUID().withMessage("bookingId must be a valid UUID"),
    ratingValidation,
    body("comment").optional().trim().isLength({ max: 500 }),
    body("tags").optional().isArray(),
  ],
  validate,
  submitReview
);

// GET /api/v1/reviews
router.get(
  "/",
  [query("providerId").optional().isUUID()],
  validate,
  getReviews
);

export default router;
