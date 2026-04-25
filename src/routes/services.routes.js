import { Router } from 'express';
import { getCategories, getCategoryBySlug } from '../controllers/services.controller.js';

const router = Router();

// GET /api/v1/services/categories
router.get('/categories', getCategories);

// GET /api/v1/services/categories/:slug
router.get('/categories/:slug', getCategoryBySlug);

export default router;
