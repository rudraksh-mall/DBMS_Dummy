import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import * as h from "../test-utils/harness.js";

let server;
let ward;
let authority;
let authorityToken;

before(async () => {
  server = await h.startServer();
  ward = await h.createWard();
  authority = await h.createUser({ role: "authority", wardId: ward.id });
  authorityToken = (await h.login(server.baseUrl, authority.email, authority.password)).accessToken;
});

after(async () => {
  await server.close();
  await h.closePool();
});

test("complaint feed hides nothing and preserves the API shape", async () => {
  const citizen = await h.createUser();
  const token = (await h.login(server.baseUrl, citizen.email, citizen.password)).accessToken;
  const complaintId = await h.createComplaint({ reporterId: citizen.id, wardId: ward.id });

  const res = await h.api(server.baseUrl, "GET", "/api/complaint/allComplaints", { token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));

  const found = res.body.data.find((c) => c._id === String(complaintId));
  assert.ok(found, "created complaint should appear in the feed");
  assert.equal(typeof found._id, "string");
  assert.equal(typeof found.location.lat, "number");
  assert.equal(typeof found.location.lng, "number");
  assert.equal(found.wardId._id, String(ward.id));
  assert.equal(found.hasUpvoted, false);
  assert.ok(found.createdAt);
});

test("complaint detail reports hasUpvoted per user", async () => {
  const citizen = await h.createUser();
  const session = await h.login(server.baseUrl, citizen.email, citizen.password);
  const complaintId = await h.createComplaint({ reporterId: citizen.id, wardId: ward.id });

  const before = await h.api(
    server.baseUrl,
    "GET",
    `/api/complaint/${complaintId}`,
    { token: session.accessToken }
  );
  assert.equal(before.body.data.hasUpvoted, false);

  await h.api(server.baseUrl, "POST", `/api/vote/complaints/${complaintId}/vote`, {
    token: session.accessToken,
  });

  const afterRes = await h.api(
    server.baseUrl,
    "GET",
    `/api/complaint/${complaintId}`,
    { token: session.accessToken }
  );
  assert.equal(afterRes.body.data.hasUpvoted, true);
});

test("my-reports only returns the caller's complaints", async () => {
  const mine = await h.createUser();
  const other = await h.createUser();
  const token = (await h.login(server.baseUrl, mine.email, mine.password)).accessToken;

  const myComplaint = await h.createComplaint({ reporterId: mine.id, wardId: ward.id });
  const otherComplaint = await h.createComplaint({ reporterId: other.id, wardId: ward.id });

  const res = await h.api(server.baseUrl, "GET", "/api/complaint/my-reports", { token });
  assert.equal(res.status, 200);
  const ids = res.body.data.map((c) => c._id);
  assert.ok(ids.includes(String(myComplaint)));
  assert.ok(!ids.includes(String(otherComplaint)));
});

test("status updates enforce role and ward boundaries", async () => {
  const citizen = await h.createUser();
  const citizenToken = (await h.login(server.baseUrl, citizen.email, citizen.password)).accessToken;
  const complaintId = await h.createComplaint({ reporterId: citizen.id, wardId: ward.id });

  const asCitizen = await h.api(
    server.baseUrl,
    "PUT",
    `/api/complaint/${complaintId}`,
    { token: citizenToken, body: { status: "in_progress" } }
  );
  assert.equal(asCitizen.status, 403);

  const otherWard = await h.createWard();
  const outsider = await h.createUser({ role: "authority", wardId: otherWard.id });
  const outsiderToken = (await h.login(server.baseUrl, outsider.email, outsider.password)).accessToken;

  const asOutsider = await h.api(
    server.baseUrl,
    "PUT",
    `/api/complaint/${complaintId}`,
    { token: outsiderToken, body: { status: "in_progress" } }
  );
  assert.equal(asOutsider.status, 403);

  const ok = await h.api(server.baseUrl, "PUT", `/api/complaint/${complaintId}`, {
    token: authorityToken,
    body: { status: "in_progress", authorityRemarks: "On it" },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.status, "in_progress");
});

test("status update writes a history row", async () => {
  const citizen = await h.createUser();
  const complaintId = await h.createComplaint({ reporterId: citizen.id, wardId: ward.id });

  await h.api(server.baseUrl, "PUT", `/api/complaint/${complaintId}`, {
    token: authorityToken,
    body: { status: "acknowledged" },
  });

  const rows = await h.exec(
    null,
    "SELECT status FROM complaint_status_history WHERE complaint_id = ? ORDER BY id",
    [complaintId]
  );
  assert.deepEqual(
    rows.map((r) => r.status),
    ["acknowledged"]
  );
});

test("resolving without an after-fix image fails", async () => {
  const citizen = await h.createUser();
  const complaintId = await h.createComplaint({ reporterId: citizen.id, wardId: ward.id });

  const res = await h.api(server.baseUrl, "PUT", `/api/complaint/${complaintId}`, {
    token: authorityToken,
    body: { status: "resolved" },
  });
  assert.equal(res.status, 400);
});

test("delete is ownership and status aware", async () => {
  const owner = await h.createUser();
  const other = await h.createUser();
  const ownerToken = (await h.login(server.baseUrl, owner.email, owner.password)).accessToken;
  const otherToken = (await h.login(server.baseUrl, other.email, other.password)).accessToken;

  const submitted = await h.createComplaint({ reporterId: owner.id, wardId: ward.id });
  const inProgress = await h.createComplaint({
    reporterId: owner.id,
    wardId: ward.id,
    status: "in_progress",
  });

  const notOwner = await h.api(server.baseUrl, "DELETE", `/api/complaint/${submitted}`, {
    token: otherToken,
  });
  assert.equal(notOwner.status, 403);

  const active = await h.api(server.baseUrl, "DELETE", `/api/complaint/${inProgress}`, {
    token: ownerToken,
  });
  assert.equal(active.status, 400);

  const ok = await h.api(server.baseUrl, "DELETE", `/api/complaint/${submitted}`, {
    token: ownerToken,
  });
  assert.equal(ok.status, 200);
});

test("query parameters cannot be used for SQL injection", async () => {
  const citizen = await h.createUser();
  const token = (await h.login(server.baseUrl, citizen.email, citizen.password)).accessToken;
  const complaintId = await h.createComplaint({ reporterId: citizen.id, wardId: ward.id });

  const injection = await h.api(
    server.baseUrl,
    "GET",
    `/api/complaint/allComplaints?scope=city&city=${encodeURIComponent("' OR '1'='1")}`,
    { token }
  );
  assert.equal(injection.status, 200);
  assert.equal(injection.body.data.length, 0);

  // Table still intact (no DROP / corrupted state).
  const [[count]] = await h.getPool().query("SELECT COUNT(*) AS n FROM complaints");
  assert.ok(Number(count.n) >= 1);

  const badWard = await h.api(
    server.baseUrl,
    "GET",
    `/api/complaint/allComplaints?scope=ward&wardId=abc`,
    { token }
  );
  assert.equal(badWard.status, 200);

  const stillThere = await h.api(server.baseUrl, "GET", `/api/complaint/${complaintId}`, {
    token,
  });
  assert.equal(stillThere.status, 200);
});
