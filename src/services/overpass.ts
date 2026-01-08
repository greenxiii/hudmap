/**
 * OpenStreetMap Overpass API service
 * Fetches nearby roads with caching and throttling
 */

import {LatLng, RoadSegment} from '../models/types';
import {OverpassResponse, OverpassWay} from '../models/types';

// Multiple Overpass API endpoints for fallback
const OVERPASS_API_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter',
];

const FETCH_INTERVAL_MS = 15000; // 15 seconds
const MIN_DISTANCE_M = 150; // 150 meters
const MAX_RETRIES = 3; // Try up to 3 different endpoints
const RETRY_DELAY_MS = 1000; // Initial retry delay

interface CacheEntry {
  roads: RoadSegment[];
  center: LatLng;
  radiusM: number;
  timestamp: number;
}

let cache: CacheEntry | null = null;

/**
 * Fetch nearby roads from OpenStreetMap Overpass API
 * @param lat Center latitude
 * @param lng Center longitude
 * @param radiusM Radius in meters to search
 * @returns Array of road segments (polylines)
 */
export async function fetchNearbyRoads(
  lat: number,
  lng: number,
  radiusM: number = 800,
): Promise<RoadSegment[]> {
  const center: LatLng = {lat, lng};

  // Check cache
  if (cache) {
    const distance = distanceBetween(cache.center, center);
    const age = Date.now() - cache.timestamp;

    // Only re-fetch if:
    // 1. User moved significantly
    // 2. Requested radius is larger than cached radius (need more coverage)
    // 3. Cache is old
    if (distance < MIN_DISTANCE_M && radiusM <= cache.radiusM && age < FETCH_INTERVAL_MS) {
      // Roads are in world coordinates, will be re-projected in render
      return cache.roads;
    }
  }

  try {
    const fetchRadius = Math.max(radiusM, 400);
    const roads = await fetchRoadsFromOverpassWithRetry(lat, lng, fetchRadius);
    cache = {
      roads,
      center,
      radiusM: fetchRadius,
      timestamp: Date.now(),
    };
    return roads;
  } catch (error) {
    console.error('Error fetching roads from Overpass (all endpoints failed):', error);
    if (cache) {
      return cache.roads;
    }
    return [];
  }
}

/**
 * Fetch roads with retry logic across multiple Overpass API endpoints
 */
async function fetchRoadsFromOverpassWithRetry(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<RoadSegment[]> {
  let lastError: Error | null = null;

  // Try each endpoint with retry logic
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const endpointIndex = attempt % OVERPASS_API_URLS.length;
    const apiUrl = OVERPASS_API_URLS[endpointIndex];

    try {
      console.log(
        `Attempting to fetch roads from Overpass endpoint ${endpointIndex + 1}/${OVERPASS_API_URLS.length}: ${apiUrl}`,
      );
      const roads = await fetchRoadsFromOverpass(lat, lng, radiusM, apiUrl);
      console.log(`[Overpass] Endpoint ${endpointIndex + 1} returned ${roads.length} roads`);
      if (roads.length > 0 || attempt === MAX_RETRIES - 1) {
        // Success or last attempt (even if empty)
        console.log(`[Overpass] Returning ${roads.length} roads from endpoint ${endpointIndex + 1}`);
        return roads;
      }
      // If we got empty results but not last attempt, try next endpoint
      console.log(`Empty results from ${apiUrl}, trying next endpoint...`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `Overpass endpoint ${endpointIndex + 1} failed:`,
        lastError.message,
      );

      // If not the last attempt, wait before retrying
      if (attempt < MAX_RETRIES - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt); // Exponential backoff
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All endpoints failed
  throw lastError || new Error('All Overpass API endpoints failed');
}

/**
 * Internal function to make the actual Overpass API request
 */
async function fetchRoadsFromOverpass(
  lat: number,
  lng: number,
  radiusM: number,
  apiUrl: string = OVERPASS_API_URLS[0],
): Promise<RoadSegment[]> {
  // Convert radius to degrees (approximate)
  const radiusDeg = radiusM / 111000; // rough conversion

  // Build Overpass QL query
  // Request ways with highway tags suitable for cars
  // Using a more permissive query to get more roads
  const query = `
    [out:json][timeout:25];
    (
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street)$"](around:${radiusM},${lat},${lng});
    );
    out geom;
  `.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
    }

    const data: OverpassResponse = await response.json();

    const roads: RoadSegment[] = data.elements
      .filter((element) => element.geometry && element.geometry.length > 1)
      .map((element) => ({
        points: element.geometry!.map((node) => ({
          lat: node.lat,
          lng: node.lon,
        })),
        type: element.tags?.highway,
      }));

    return roads;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Overpass API request timeout');
    }
    throw error;
  }
}

/**
 * Clear the cache (useful for testing or forced refresh)
 */
export function clearOverpassCache(): void {
  cache = null;
}

/**
 * Simple distance calculation for cache checking
 */
function distanceBetween(a: LatLng, b: LatLng): number {
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  return Math.sqrt(dLat * dLat + dLng * dLng) * 111000; // rough meters
}

