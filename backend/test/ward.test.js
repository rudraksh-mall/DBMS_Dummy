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

test("GET /api/wards/cities lists distinct cities", async () => {
  const res = await h.api(server.baseUrl, "GET", "/api/wards/cities");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.includes("Testville"));
});

test("GET /api/wards?city returns wards, and requires city", async () => {
  const withCity = await h.api(server.baseUrl, "GET", "/api/wards?city=Testville");
  assert.equal(withCity.status, 200);
  const ids = withCity.body.data.map((w) => w._id);
  assert.ok(ids.includes(String(ward.id)));
  assert.equal(typeof withCity.body.data[0].name, "string");

  const noCity = await h.api(server.baseUrl, "GET", "/api/wards");
  assert.equal(noCity.status, 200);
  assert.deepEqual(noCity.body.data, []);
});

test("GET /api/wards/lookup validates input and resolves points", async () => {
  const missing = await h.api(server.baseUrl, "GET", "/api/wards/lookup");
  assert.equal(missing.status, 400);

  const inside = await h.api(server.baseUrl, "GET", "/api/wards/lookup?lat=10.1&lng=10.1");
  assert.equal(inside.status, 200);
  assert.equal(typeof inside.body.data.wardId, "string");
  assert.equal(typeof inside.body.data.wardName, "string");
  assert.equal(typeof inside.body.data.city, "string");

  const outside = await h.api(server.baseUrl, "GET", "/api/wards/lookup?lat=0&lng=0");
  assert.equal(outside.status, 200);
  assert.equal(outside.body.data, null);
});

test("ward endpoints are public (no auth required)", async () => {
  const cities = await h.api(server.baseUrl, "GET", "/api/wards/cities");
  assert.equal(cities.status, 200);
});
