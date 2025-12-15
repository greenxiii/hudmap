/**
 * Geographic utility functions
 * Conversions between lat/lng and local meters, distance calculations, bearings, projections
 */

import {LatLng, Point2D} from '../models/types';

// Earth's radius in meters
const EARTH_RADIUS_M = 6371000;

/**
 * Calculate distance between two lat/lng points using Haversine formula
 * @returns distance in meters
 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const a_val =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a_val), Math.sqrt(1 - a_val));

  return EARTH_RADIUS_M * c;
}

/**
 * Calculate bearing from point A to point B
 * @returns bearing in degrees (0-360), where 0 is north
 */
export function bearing(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  let bearing = Math.atan2(y, x);
  bearing = toDegrees(bearing);
  return (bearing + 360) % 360;
}

/**
 * Project a lat/lng point to local meters relative to a center point
 * Uses simple equirectangular projection (good for small distances)
 * @param point Point to project
 * @param center Center reference point
 * @returns Point in meters (x = east, y = north)
 */
export function projectToLocalMeters(point: LatLng, center: LatLng): Point2D {
  // Differences in degrees
  const dLatDeg = point.lat - center.lat;
  const dLngDeg = point.lng - center.lng;

  // Convert to radians
  const dLat = toRadians(dLatDeg);
  const dLng = toRadians(dLngDeg);

  // Convert to meters (equirectangular approximation)
  const x = dLng * EARTH_RADIUS_M * Math.cos(toRadians(center.lat));
  const y = dLat * EARTH_RADIUS_M;

  return {x, y};
}

/**
 * Convert local meters back to lat/lng relative to center
 * @param point Point in meters (x = east, y = north)
 * @param center Center reference point
 * @returns Lat/lng point
 */
export function unprojectFromLocalMeters(
  point: Point2D,
  center: LatLng,
): LatLng {
  const dLat = point.y / EARTH_RADIUS_M;
  const dLng = point.x / (EARTH_RADIUS_M * Math.cos(toRadians(center.lat)));

  return {
    lat: center.lat + dLat,
    lng: center.lng + dLng,
  };
}

/**
 * Rotate a 2D point around origin
 * @param point Point to rotate
 * @param angleDegrees Rotation angle in degrees (counterclockwise)
 * @returns Rotated point
 */
export function rotatePoint(point: Point2D, angleDegrees: number): Point2D {
  const angle = toRadians(angleDegrees);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

/**
 * Get a point at a given distance and bearing from a center
 * @param center Starting point
 * @param distanceMeters Distance in meters
 * @param bearingDegrees Bearing in degrees (0-360, 0 = north)
 * @returns Destination point
 */
export function pointAtDistanceAndBearing(
  center: LatLng,
  distanceMeters: number,
  bearingDegrees: number,
): LatLng {
  const bearingRad = toRadians(bearingDegrees);
  const lat1 = toRadians(center.lat);
  const lng1 = toRadians(center.lng);

  const angularDistance = distanceMeters / EARTH_RADIUS_M;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad),
  );

  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: toDegrees(lat2),
    lng: toDegrees(lng2),
  };
}

// Helper functions
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

