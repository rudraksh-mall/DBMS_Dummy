import multer from "multer";
import { configureCloudinary } from "../db/cloudinary.js";
import { ApiError } from "../utils/ApiError.js";
import { v4 as uuid } from "uuid";

// Save file in memory instead of disk
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Cloudinary uploader wrapper
export const uploadImage = async (req, res, next) => {
  try {
    /**
     * LOGIC: Check if it's a NEW report vs an EDIT.
     * req.method === "POST" means it's a new report (Image is Mandatory).
     * req.method === "PATCH" means it's an update (Image is Optional).
     */
    if (!req.file) {
      if (req.method === "POST") {
        throw new ApiError(400, "Evidence image is required for new reports");
      }
      // If PATCH and no file, just move to the controller
      return next();
    }

    // Convert buffer to Base64 for Cloudinary upload
    const base64File = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    // Configure Cloudinary now (not at import time) so env vars are guaranteed
    // to be loaded regardless of startup order.
    const cloudinary = configureCloudinary();

    const result = await cloudinary.uploader.upload(base64File, {
      folder: "civicfix_issues",
      public_id: uuid(),
    });

    // Attach Cloudinary URL to request for controller
    req.imageUrl = result.secure_url;

    next();
  } catch (err) {
    next(err);
  }
};

export default upload;
