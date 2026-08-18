"use strict";

const clean = value => String(value ?? "").trim();
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function normalizePoint(value = {}) {
  return {
    address: clean(value.address || value.formattedAddress || value.label),
    lat: value.lat == null ? null : num(value.lat),
    lng: value.lng == null ? null : num(value.lng)
  };
}

async function calculateGoogleRoute({ origin, destination, apiKey = process.env.GOOGLE_ROUTES_API_KEY } = {}) {
  if (!apiKey) {
    const error = new Error("Google Routes API key is not configured.");
    error.code = "FREIGHT_ROUTE_PROVIDER_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }

  const o = normalizePoint(origin);
  const d = normalizePoint(destination);
  const waypoint = point => point.address
    ? { address: point.address }
    : { location: { latLng: { latitude: point.lat, longitude: point.lng } } };

  if ((!o.address && (o.lat == null || o.lng == null)) || (!d.address && (d.lat == null || d.lng == null))) {
    const error = new Error("Origin and destination require a structured address or coordinates.");
    error.code = "FREIGHT_ROUTE_LOCATION_REQUIRED";
    error.status = 400;
    throw error;
  }

  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration"
    },
    body: JSON.stringify({
      origin: waypoint(o),
      destination: waypoint(d),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      units: "IMPERIAL"
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.routes?.length) {
    const error = new Error(payload?.error?.message || `Route provider failed with HTTP ${response.status}.`);
    error.code = "FREIGHT_ROUTE_FAILED";
    error.status = response.status || 502;
    error.details = payload?.error || null;
    throw error;
  }

  const route = payload.routes[0];
  const routeMiles = Math.round((num(route.distanceMeters) / 1609.344) * 10) / 10;
  const durationSeconds = Number.parseInt(String(route.duration || "0s").replace("s", ""), 10) || 0;
  return {
    routeMiles,
    distanceMeters: num(route.distanceMeters),
    durationMinutes: Math.round(durationSeconds / 60),
    routeProvider: "google-routes-v2",
    routeCalculatedAt: new Date().toISOString(),
    origin: o,
    destination: d
  };
}

async function calculateFreightRoute(input = {}) {
  const provider = clean(input.provider || process.env.IXI_FREIGHT_ROUTE_PROVIDER || "google").toLowerCase();
  if (provider === "google") return calculateGoogleRoute(input);
  const error = new Error(`Unsupported freight route provider: ${provider}`);
  error.code = "FREIGHT_ROUTE_PROVIDER_UNSUPPORTED";
  error.status = 400;
  throw error;
}

module.exports = { normalizePoint, calculateGoogleRoute, calculateFreightRoute };
