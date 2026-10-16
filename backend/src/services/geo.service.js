import * as complaintsRepo from "../repositories/complaints.repo.js";

const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000; // meters
  const toRad = (x) => (x * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Find nearby complaints (radius-based).
 */
export const findNearbyComplaints = async ({ lat, lng, radiusMeters = 200 }) => {
  const complaints = await complaintsRepo.allWithCoordinates();

  return complaints.filter((c) => {
    const d = getDistanceMeters(lat, lng, Number(c.lat), Number(c.lng));
    return d <= radiusMeters;
  });
};

/**
 * Duplicate detection: another open complaint of the same category within 100m.
 */
export const isDuplicateComplaint = async ({ lat, lng, category }) => {
  const complaints = await complaintsRepo.activeByCategory(category);

  for (const c of complaints) {
    const d = getDistanceMeters(lat, lng, Number(c.lat), Number(c.lng));
    if (d <= 100) return true; // within 100m
  }

  return false;
};
