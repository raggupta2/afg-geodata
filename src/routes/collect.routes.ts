import {Router} from "express";
import {collect} from "../controllers/collect.controller";

const router=Router();

router.post("/",collect);

export default router;