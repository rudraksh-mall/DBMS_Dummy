import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import * as h from "../test-utils/harness.js";

let server;
let ward;

before(async () => {
  server = await h.startServer();
  ward = await h.createWard();
});

after(async () => {
  await server.close();
  await h.closePool();
});

test("creating a complaint without an image fails fast", async () => {
  const unauth = await h.api(server.baseUrl, "POST", "/api/complaint", {
    body: { description: "pothole on the road", location: { lat: 10.1, lng: 10.1 } },
  });
  assert.equal(unauth.status, 401);

  const citizen = await h.createUser();
  const token = (await h.login(server.baseUrl, citizen.email, citizen.password)).accessToken;
  const noImage = await h.api(server.baseUrl, "POST", "/api/complaint", {
    token,
    body: { description: "pothole on the main road", location: { lat: 10.1, lng: 10.1 } },
  });
  assert.equal(noImage.status, 400);
});

test("trending feed orders by upvote count descending", async () => {
  const voter = await h.createUser();
  const voterToken = (await h.login(server.baseUrl, voter.email, voter.password)).accessToken;

  const popular = await h.createComplaint({ reporterId: voter.id, wardId: ward.id });
  const quiet = await h.createComplaint({ reporterId: voter.id, wardId: ward.id });

  await h.api(server.baseUrl, "POST", `/api/vote/complaints/${popular}/vote`, { token: voterToken });

  const res = await h.api(
    server.baseUrl,
    "GET",
    "/api/complaint/allComplaints?scope=trending&city=Testville",
    { token: voterToken }
  );
  assert.equal(res.status, 200);

  const counts = res.body.data.map((c) => c.upvoteCount);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i - 1] >= counts[i], "feed must be sorted by upvotes desc");
  }
  const popularRow = res.body.data.find((c) => c._id === String(popular));
  assert.ok(popularRow.upvoteCount >= 1);
});

test("ward scope returns only that ward's complaints", async () => {
  const citizen = await h.createUser();
  const token = (await h.login(server.baseUrl, citizen.email, citizen.password)).accessToken;
  const complaintId = await h.createComplaint({ reporterId: citizen.id, wardId: ward.id });

  const res = await h.api(
    server.baseUrl,
    "GET",
    `/api/complaint/allComplaints?scope=ward&wardId=${ward.id}`,
    { token }
  );
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length >= 1);
  for (const c of res.body.data) {
    assert.equal(c.wardId._id, String(ward.id));
  }
  assert.ok(res.body.data.some((c) => c._id === String(complaintId)));
});

test("nearby scope computes distance and applies radius", async () => {
  const citizen = await h.createUser();
  const token = (await h.login(server.baseUrl, citizen.email, citizen.password)).accessToken;

  const close = await h.createComplaint({
    reporterId: citizen.id,
    wardId: ward.id,
    lat: 10.1,
    lng: 10.1,
  });
  const far = await h.createComplaint({
    reporterId: citizen.id,
    wardId: ward.id,
    lat: 10.5,
    lng: 10.5,
  });

  const res = await h.api(
    server.baseUrl,
    "GET",
    "/api/complaint/allComplaints?scope=nearby&lat=10.1&lng=10.1&radius=5&city=Testville",
    { token }
  );
  assert.equal(res.status, 200);

  const ids = res.body.data.map((c) => c._id);
  assert.ok(ids.includes(String(close)));
  assert.ok(!ids.includes(String(far)));

  const distances = res.body.data.map((c) => c._distance);
  for (const d of distances) assert.equal(typeof d, "number");
  for (let i = 1; i < distances.length; i++) {
    assert.ok(distances[i - 1] <= distances[i], "nearby feed sorted by distance asc");
  }
});

test("my-reports returns newest first", async () => {
  const citizen = await h.createUser();
  const token = (await h.login(server.baseUrl, citizen.email, citizen.password)).accessToken;

  const first = await h.createComplaint({ reporterId: citizen.id, wardId: ward.id });
  await new Promise((r) => setTimeout(r, 1100));
  const second = await h.createComplaint({ reporterId: citizen.id, wardId: ward.id });

  const res = await h.api(server.baseUrl, "GET", "/api/complaint/my-reports", { token });
  assert.equal(res.status, 200);
  const ids = res.body.data.map((c) => c._id);
  assert.ok(ids.indexOf(String(second)) < ids.indexOf(String(first)));
});
