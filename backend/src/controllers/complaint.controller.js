import * as complaintsRepo from "../repositories/complaints.repo.js";
import * as wardsRepo from "../repositories/wards.repo.js";
import * as votesRepo from "../repositories/votes.repo.js";
import * as historyRepo from "../repositories/history.repo.js";
import { withTransaction } from "../db/mysql.js";
import { mapComplaintRow } from "../repositories/mappers.js";

import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { validateDescription } from "../utils/validateDescription.js";

import { analyzeComplaintWithAI } from "../services/ai.service.js";
import { calculatePriority } from "../services/priority.service.js";

const priorityInput = (row, upvoteCount) => ({
  aiSeverity: row.ai_severity,
  upvoteCount,
  createdAt: row.created_at,
  status: row.status,
});

/**
 * CREATE COMPLAINT (Citizen)
 */
export const createComplaint = asyncHandler(async (req, res) => {
  const user = req.user;
  if (user.role !== "citizen") {
    throw new ApiError(403, "Only citizens can report complaints");
  }

  const { description, location } = req.body;
  const imageUrl = req.imageUrl;

  if (!description || !imageUrl || !location?.lat || !location?.lng) {
    throw new ApiError(400, "Description, image and location are required");
  }

  if (!validateDescription(description)) {
    throw new ApiError(400, "Please enter a relevant civic issue description");
  }

  const lat = Number(location.lat);
  const lng = Number(location.lng);

  const ward = await wardsRepo.findByPoint(lng, lat);
  if (!ward) throw new ApiError(404, "Ward not found for this location");

  // External AI call happens before the transaction and never inside it.
  const aiResult = await analyzeComplaintWithAI({ imageUrl, description });

  if (aiResult.isRelevant === false) {
    throw new ApiError(
      400,
      aiResult.rejectionReason ||
        "Image rejected. Please upload a photo of a valid civic issue."
    );
  }

  if (aiResult.descriptionMatches === false) {
    throw new ApiError(
      400,
      aiResult.mismatchReason ||
        "The uploaded image and description appear to describe different issues. Please ensure the description matches what is visible in the image."
    );
  }

  const complaintId = await withTransaction(async (conn) => {
    const id = await complaintsRepo.insert(
      {
        reportedBy: user._id,
        description,
        imageUrl,
        lat,
        lng,
        wardId: ward.id,
        aiCategory: aiResult.category,
        aiSeverity: aiResult.severity,
        aiKeywords: aiResult.keywords,
        aiConfidence: aiResult.confidence,
        aiStatus: aiResult.source === "fallback" ? "fallback" : "ai",
      },
      conn
    );

    const row = await complaintsRepo.getById(id, conn);
    const score = calculatePriority(priorityInput(row, row.upvote_count));
    await complaintsRepo.updatePriority(id, score, conn);

    await historyRepo.create(
      { complaintId: id, status: "submitted", changedBy: user._id },
      conn
    );

    return id;
  });

  const created = await complaintsRepo.getById(complaintId);

  return res
    .status(201)
    .json(new ApiResponse(201, mapComplaintRow(created), "Complaint submitted successfully"));
});

/**
 * Haversine distance in kilometers between two lat/lng points.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * GET ALL COMPLAINTS (Community Discovery)
 * scope: nearby | trending | ward | city
 */
export const getAllComplaints = asyncHandler(async (req, res) => {
  const userId = req.user?._id || null;
  const { scope, lat, lng, wardId, city, radius } = req.query;

  let rows;
  let nearby = false;

  if (scope === "ward" && wardId) {
    rows = await complaintsRepo.listFeed({ userId, wardId, scope });
  } else if (scope === "city" && city) {
    rows = await complaintsRepo.listFeed({ userId, city, scope });
  } else if (scope === "trending") {
    rows = await complaintsRepo.listFeed({ userId, city: city || null, scope: "trending" });
  } else if (scope === "nearby" && lat && lng) {
    rows = await complaintsRepo.listFeed({ userId, city: city || null, scope });
    nearby = true;
  } else {
    rows = await complaintsRepo.listFeed({ userId, scope });
  }

  let mapped = rows.map((row) =>
    mapComplaintRow(row, { hasUpvoted: row.user_vote_id != null })
  );

  if (nearby) {
    const refLat = parseFloat(lat);
    const refLng = parseFloat(lng);
    const selectedRadius = parseFloat(radius) || 5;

    mapped = mapped
      .map((complaint) => ({
        ...complaint,
        _distance: haversineKm(
          refLat,
          refLng,
          complaint.location.lat,
          complaint.location.lng
        ),
      }))
      .filter((complaint) => complaint._distance <= selectedRadius)
      .sort((a, b) => a._distance - b._distance);
  }

  return res.json(
    new ApiResponse(200, mapped, "Fetched all complaints")
  );
});

/**
 * GET COMPLAINT BY ID
 */
export const getComplaintById = asyncHandler(async (req, res) => {
  const { complaintId } = req.params;
  const userId = req.user._id;

  const complaint = await complaintsRepo.getById(complaintId);
  if (!complaint) throw new ApiError(404, "Complaint not found");

  const hasUpvoted = await votesRepo.exists({ complaintId, userId });

  return res.json(
    new ApiResponse(
      200,
      mapComplaintRow(complaint, { hasUpvoted })
    )
  );
});

/**
 * UPDATE STATUS (Authority Only)
 */
export const updateComplaintStatus = asyncHandler(async (req, res) => {
  const user = req.user;
  const { status, authorityRemarks } = req.body;
  const afterFixImageUrl = req.imageUrl;

  if (user.role !== "authority") throw new ApiError(403, "Unauthorized");
  if (!status) throw new ApiError(400, "Status is required");

  const complaint = await complaintsRepo.getById(req.params.complaintId);
  if (!complaint) throw new ApiError(404, "Not found");

  if (user.wardId === null || Number(complaint.ward_id) !== Number(user.wardId)) {
    throw new ApiError(403, "This complaint belongs to a different ward");
  }

  const remarks = authorityRemarks || complaint.authority_remarks;

  let finalAfterFix = complaint.after_fix_image_url;
  let resolvedAt = complaint.resolved_at;

  if (status === "resolved") {
    if (!afterFixImageUrl) throw new ApiError(400, "After-fix image required");
    finalAfterFix = afterFixImageUrl;
    resolvedAt = new Date();
  }

  await withTransaction(async (conn) => {
    // NOTE: mirrors the original behavior of this route, which does not
    // recalculate priority (unlike the admin route).
    await complaintsRepo.updateStatusFields(
      complaint.id,
      {
        status,
        authorityRemarks: remarks,
        afterFixImageUrl: finalAfterFix,
        resolvedAt,
        priorityScore: complaint.priority_score,
      },
      conn
    );

    await historyRepo.create(
      {
        complaintId: complaint.id,
        status,
        changedBy: user._id,
        remarks: remarks || null,
      },
      conn
    );
  });

  const updated = await complaintsRepo.getById(complaint.id);
  res.json(new ApiResponse(200, mapComplaintRow(updated), "Status updated"));
});

/**
 * EDIT COMPLAINT (Citizen)
 */
export const updateComplaint = asyncHandler(async (req, res) => {
  const { complaintId } = req.params;
  const { description, location } = req.body;
  const userId = req.user._id;
  const newImageUrl = req.imageUrl;

  const complaint = await complaintsRepo.getById(complaintId);
  if (!complaint) throw new ApiError(404, "Complaint not found");

  if (Number(complaint.reported_by) !== Number(userId)) {
    throw new ApiError(403, "You are not authorized to edit this report");
  }

  if (complaint.status !== "submitted") {
    throw new ApiError(400, "Cannot edit a report already in progress or resolved");
  }

  let nextDescription = complaint.description;
  let nextImageUrl = complaint.image_url;
  let nextLat = complaint.lat;
  let nextLng = complaint.lng;
  let nextWardId = complaint.ward_id;

  if (description) nextDescription = description;
  if (newImageUrl) nextImageUrl = newImageUrl;

  if (location?.lat && location?.lng) {
    nextLat = Number(location.lat);
    nextLng = Number(location.lng);
    const newWard = await wardsRepo.findByPoint(nextLng, nextLat);
    if (newWard) nextWardId = newWard.id;
  }

  const aiResult = await analyzeComplaintWithAI({
    imageUrl: nextImageUrl,
    description: nextDescription,
  });

  if (aiResult.isRelevant === false) {
    throw new ApiError(
      400,
      aiResult.rejectionReason ||
        "Updated image rejected. Please upload a photo of a valid civic issue."
    );
  }

  if (aiResult.descriptionMatches === false) {
    throw new ApiError(
      400,
      aiResult.mismatchReason ||
        "The uploaded image and description appear to describe different issues. Please ensure the description matches what is visible in the image."
    );
  }

  const score = calculatePriority({
    aiSeverity: aiResult.severity,
    upvoteCount: complaint.upvote_count,
    createdAt: complaint.created_at,
    status: complaint.status,
  });

  await complaintsRepo.updateCitizenEdit(complaint.id, {
    description: nextDescription,
    imageUrl: nextImageUrl,
    lat: nextLat,
    lng: nextLng,
    wardId: nextWardId,
    aiCategory: aiResult.category,
    aiSeverity: aiResult.severity,
    aiKeywords: aiResult.keywords,
    aiConfidence: aiResult.confidence,
    aiStatus: aiResult.source === "fallback" ? "fallback" : "ai",
    priorityScore: score,
  });

  const updated = await complaintsRepo.getById(complaint.id);
  res.json(
    new ApiResponse(200, mapComplaintRow(updated), "Complaint fully updated successfully")
  );
});

/**
 * DELETE COMPLAINT
 */
export const deleteComplaint = asyncHandler(async (req, res) => {
  const user = req.user;
  const { complaintId } = req.params;

  const complaint = await complaintsRepo.getById(complaintId);
  if (!complaint) throw new ApiError(404, "Complaint not found");

  if (user.role === "citizen") {
    if (Number(complaint.reported_by) !== Number(user._id)) {
      throw new ApiError(403, "Unauthorized");
    }
    if (complaint.status !== "submitted") {
      throw new ApiError(400, "Cannot delete active reports");
    }
  }

  await complaintsRepo.deleteById(complaintId);
  res.json(new ApiResponse(200, null, "Deleted successfully"));
});

/**
 * ADDITIONAL GETTERS
 */
export const getWardComplaints = asyncHandler(async (req, res) => {
  const rows = await complaintsRepo.listByWard(req.user.wardId);
  res.json(
    new ApiResponse(200, rows.map((row) => mapComplaintRow(row)), "Success")
  );
});

export const getMyComplaints = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const rows = await complaintsRepo.listByReporter(userId);

  res.json(
    new ApiResponse(
      200,
      rows.map((row) =>
        mapComplaintRow(row, { hasUpvoted: row.user_vote_id != null })
      ),
      "Success"
    )
  );
});
