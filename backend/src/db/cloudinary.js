import { v2 as cloudinary } from "cloudinary";

/**
 * (Re)configure Cloudinary from the current process.env.
 * Called lazily at upload time so it never depends on module import order
 * relative to dotenv being loaded.
 */
export function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_KEY,
    api_secret: process.env.CLOUD_SECRET,
  });
  return cloudinary;
}

export default cloudinary;
