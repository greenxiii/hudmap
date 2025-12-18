/**
 * OpenStreetMap Overpass API service
 * Fetches nearby roads with caching and throttling
 */

import {LatLng, RoadSegment} from '../models/types';
import {OverpassResponse, OverpassWay} from '../models/types';

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';
const FETCH_INTERVAL_MS = 15000; // 15 seconds
const MIN_DISTANCE_M = 150; // 150 meters

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
    // Fetch with a bit more radius than requested to reduce re-fetching during small zooms
    const fetchRadius = Math.max(radiusM, 400); 
    const roads = await fetchRoadsFromOverpass(lat, lng, fetchRadius);
    cache = {
      roads,
      center,
      radiusM: fetchRadius,
      timestamp: Date.now(),
    };
    return roads;
  } catch (error) {
    console.error('Error fetching roads from Overpass:', error);
    // Return cached data if available, even if stale
    if (cache) {
      return cache.roads;
    }
    throw error;
  }
}

/**
 * Internal function to make the actual Overpass API request
 */
async function fetchRoadsFromOverpass(
  lat: number,
  lng: number,
  radiusM: number,
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
    const response = await fetch(OVERPASS_API_URL, {
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

    console.log(`Overpass API returned ${data.elements?.length || 0} elements`);

    // Parse ways into road segments
    const roads: RoadSegment[] = data.elements
      .filter((element) => element.geometry && element.geometry.length > 1)
      .map((element) => ({
        points: element.geometry!.map((node) => ({
          lat: node.lat,
          lng: node.lon,
        })),
        type: element.tags?.highway,
      }));

    console.log(`Parsed ${roads.length} road segments`);
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

