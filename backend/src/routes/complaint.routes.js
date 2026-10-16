import express from "express";
import {
  createComplaint,
  deleteComplaint,
  getAllComplaints,
  getComplaintById,
  getWardComplaints,
  updateComplaintStatus,
  getMyComplaints,
  updateComplaint,
} from "../controllers/complaint.controller.js";

import auth from "../middleware/auth.middleware.js";
import upload, { uploadImage } from "../middleware/upload.middleware.js";

const router = express.Router();

/**
 * CITIZEN ROUTES
 */

// 1. Create a new complaint (with Image Upload)
// Flow: Authenticate -> Multer -> Cloudinary -> Controller
router.post("/", auth, upload.single("image"), uploadImage, createComplaint);

// 2. Get the logged-in user's own complaints
router.get("/my-reports", auth, getMyComplaints);

// 3. Get all complaints for Map View
router.get("/allComplaints",auth, getAllComplaints);

// 4. Edit an existing complaint (FULLY UNLOCKED)
// Now includes upload middleware to handle NEW photos during edit
router.patch(
  "/:complaintId",
  auth,
  upload.single("image"),
  uploadImage,
  updateComplaint
);

/**
 * AUTHORITY / WARD OFFICER ROUTES
 */

// 5. Get complaints for the Officer's specific Ward
router.get("/ward", auth, getWardComplaints);

// 6. Update complaint status (Acknowledged, In Progress, Resolved)
router.put(
  "/:complaintId",
  auth,
  upload.single("image"),
  uploadImage,
  updateComplaintStatus
);

/**
 * SHARED MANAGEMENT
 */

// 7. Get detailed info for a single complaint
router.get("/:complaintId",auth, getComplaintById);

// 8. Delete a complaint (Ownership-aware)
router.delete("/:complaintId", auth, deleteComplaint);

export default router;
