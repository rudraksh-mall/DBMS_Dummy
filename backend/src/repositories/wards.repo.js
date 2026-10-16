import { exec } from "../db/mysql.js";

/**
 * Find the ward whose boundary contains the given point.
 * Replaces the previous `$geoIntersects` query. GeoJSON coordinates are
 * [lng, lat]; `LIMIT 1` mirrors MongoDB's single-document `findOne`.
 */
export async function findByPoint(lng, lat, conn) {
  const point = JSON.stringify({
    type: "Point",
    coordinates: [Number(lng), Number(lat)],
  });
  const rows = await exec(
    conn,
    `SELECT id, name, city
       FROM wards
      WHERE ST_Intersects(boundary, ST_GeomFromGeoJSON(?))
      LIMIT 1`,
    [point]
  );
  return rows[0] || null;
}

export async function findById(id, conn) {
  const rows = await exec(
    conn,
    "SELECT id, name, city FROM wards WHERE id = ? LIMIT 1",
    [id]
  );
  return rows[0] || null;
}

/**
 * Case-insensitive exact city match (collation utf8mb4_0900_ai_ci), matching
 * the previous `/^city$/i` regex without constructing a regex from user input.
 */
export async function findByCity(city, conn) {
  return exec(
    conn,
    "SELECT id, name, city FROM wards WHERE city = ? ORDER BY name ASC",
    [city]
  );
}

export async function listCities(conn) {
  const rows = await exec(
    conn,
    "SELECT DISTINCT city FROM wards ORDER BY city ASC"
  );
  return rows.map((r) => r.city);
}

export async function insert({ name, city, boundaryGeoJson }, conn) {
  const result = await exec(
    conn,
    "INSERT INTO wards (name, city, boundary) VALUES (?, ?, ST_GeomFromGeoJSON(?))",
    [name, city, boundaryGeoJson]
  );
  return result.insertId;
}

export async function existsByCityAndName(city, name, conn) {
  const rows = await exec(
    conn,
    "SELECT id FROM wards WHERE city = ? AND name = ? LIMIT 1",
    [city, name]
  );
  return !!rows[0];
}
