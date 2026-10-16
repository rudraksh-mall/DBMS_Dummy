import * as wardsRepo from "../repositories/wards.repo.js";
import { mapWardRow } from "../repositories/mappers.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const lookupWard = asyncHandler(async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    throw new ApiError(400, "lat and lng query parameters are required");
  }

  const ward = await wardsRepo.findByPoint(Number(lng), Number(lat));

  if (!ward) {
    return res.json(new ApiResponse(200, null, "No ward found for this location"));
  }

  return res.json(
    new ApiResponse(
      200,
      {
        wardId: String(ward.id),
        wardName: ward.name,
        city: ward.city,
      },
      "Ward found"
    )
  );
});

export const getWards = asyncHandler(async (req, res) => {
  const { city } = req.query;

  if (!city) {
    return res.json(new ApiResponse(200, [], "City is required"));
  }

  const wards = await wardsRepo.findByCity(city);

  return res.json(
    new ApiResponse(200, wards.map(mapWardRow), "Wards fetched successfully")
  );
});

export const getCities = asyncHandler(async (req, res) => {
  const cities = await wardsRepo.listCities();

  return res.json(new ApiResponse(200, cities, "Cities fetched successfully"));
});
