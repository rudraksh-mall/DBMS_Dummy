// routes/ward.routes.js
import express from "express";
import { getWards, getCities, lookupWard } from "../controllers/ward.controller.js";

const router = express.Router();

// GET /api/wards?city=Lucknow
router.get("/cities", getCities);
router.get("/lookup", lookupWard);
router.get("/", getWards);

export default router;
