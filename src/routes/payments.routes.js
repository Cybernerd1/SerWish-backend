import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { uuidParamValidation } from "../utils/validators.js";
import {
  getPaymentMethods,
  addPaymentMethod,
  deletePaymentMethod,
  addWalletFunds,
  getWalletBalance,
} from "../controllers/payments.controller.js";

const router = Router();

router.use(authenticate);

router.get("/methods", getPaymentMethods);
router.post("/methods", addPaymentMethod);
router.delete(
  "/methods/:id",
  [uuidParamValidation()],
  validate,
  deletePaymentMethod
);

router.get("/wallet/balance", getWalletBalance);
router.post("/wallet/add", addWalletFunds);

export default router;
