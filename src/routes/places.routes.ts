import { Router } from "express";
import { getAddressDetail, getAddressSuggestions } from "../controllers/places.controller";

const router = Router();

router.get("/autocomplete", getAddressSuggestions);
router.get("/details", getAddressDetail);

export default router;
