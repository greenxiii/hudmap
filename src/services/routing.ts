/**
 * Routing service
 * Uses an external routing API (OSRM-compatible) when available,
 * and falls back to a straight-line route for robustness.
 *
 * TODO: Swap OSRM demo endpoint for your own OSRM / GraphHopper / Mapbox Directions server.
 */

import {LatLng, Route, Maneuver} from '../models/types';
import {distanceMeters, pointAtDistanceAndBearing, bearing} from '../utils/geo';

// Public OSRM demo server (best-effort; do not rely on this for production)
// Replace with your own instance for real-world usage.
// Note: Most routing services require API keys. For production, consider:
// - Setting up your own OSRM instance
// - Using Mapbox Directions API (requires API key)
// - Using GraphHopper (requires API key for hosted service)
const OSRM_BASE_URL = 'https://router.project-osrm.org';

// Timeout for routing requests (ms)
const ROUTING_TIMEOUT_MS = 8000;

// Track if OSRM is available (to suppress repeated warnings)
let osrmAvailable = true;
let lastOsrmFailureTime = 0;
let lastWarningTime = 0;
const OSRM_FAILURE_COOLDOWN_MS = 30000; // Don't warn again for 30 seconds

// Route cache: store routes by destination to avoid duplicate requests
// Note: We cache by destination only, since routes from different starting points
// to the same destination are different, but we want to avoid rebuilding the same route
// when the user hasn't moved significantly
interface RouteCacheEntry {
  route: Route;
  from: LatLng;
  to: LatLng;
  timestamp: number;
}

let routeCache: RouteCacheEntry | null = null;
const ROUTE_CACHE_MAX_AGE_MS = 5 * 60 * 1000; // Cache routes for 5 minutes
const ROUTE_CACHE_POSITION_TOLERANCE = 0.001; // ~100m tolerance for starting position

// Reset OSRM availability on new route request (allow retry)
export function resetOsrmAvailability(): void {
  osrmAvailable = true;
  lastOsrmFailureTime = 0;
}

// Clear route cache (useful for testing or forced refresh)
export function clearRouteCache(): void {
  routeCache = null;
}

/**
 * Build a route from start to destination
 * @param from Start point
 * @param to Destination point
 * @returns Route with points and maneuvers
 */
export async function buildRoute(
  from: LatLng,
  to: LatLng,
): Promise<Route> {
  // Check cache first - only rebuild if destination changed or cache is stale
  const now = Date.now();
  if (routeCache) {
    const cacheAge = now - routeCache.timestamp;
    const toMatch =
      Math.abs(routeCache.to.lat - to.lat) < 0.0001 &&
      Math.abs(routeCache.to.lng - to.lng) < 0.0001;
    
    // If destination matches and cache is fresh, reuse the route
    // (Starting position can be different - we'll use the cached route geometry)
    if (toMatch && cacheAge < ROUTE_CACHE_MAX_AGE_MS) {
      console.log('[routing] Using cached route (age:', Math.round(cacheAge / 1000), 'seconds, destination unchanged)');
      return routeCache.route;
    } else if (!toMatch) {
      // Destination changed, clear old cache
      console.log('[routing] Destination changed, clearing cache');
      routeCache = null;
    }
  }

  // Always try OSRM first - don't skip based on previous failures
  // The cooldown is only used to suppress repeated warning messages
  const inCooldown = !osrmAvailable && now - lastOsrmFailureTime < OSRM_FAILURE_COOLDOWN_MS;
  
  // Reset availability flag to allow retry (unless we're in active cooldown from very recent failure)
  if (!inCooldown) {
    osrmAvailable = true;
  }

  // Try OSRM first
  try {
    console.log('[routing] Attempting OSRM route from', from, 'to', to);
    const route = await buildRouteWithOsrm(from, to);
    console.log('[routing] OSRM route built successfully:', route.points.length, 'points');
    osrmAvailable = true; // Mark as available on success
    
    // Cache the route
    routeCache = {
      route,
      from: {...from},
      to: {...to},
      timestamp: now,
    };
    
    return route;
  } catch (osrmError) {
    console.warn('[routing] OSRM routing failed:', osrmError);
    osrmAvailable = false;
    lastOsrmFailureTime = now;
    
    // Fall back to straight-line route when OSRM fails
    // Only warn once per cooldown period
    if (now - lastWarningTime >= OSRM_FAILURE_COOLDOWN_MS) {
      console.warn(
        '[routing] OSRM routing unavailable, using straight-line route',
      );
      lastWarningTime = now;
    }
    
    const fallbackRoute = createStraightLineRoute(from, to);
    console.log('[routing] Using straight-line fallback route:', fallbackRoute.points.length, 'points');
    
    // Cache the fallback route too (so we don't keep retrying)
    routeCache = {
      route: fallbackRoute,
      from: {...from},
      to: {...to},
      timestamp: now,
    };
    
    return fallbackRoute;
  }
}

/**
 * Call an OSRM-compatible routing API to build a real route.
 * This uses the public OSRM demo server by default.
 */
async function buildRouteWithOsrm(from: LatLng, to: LatLng): Promise<Route> {
  const fromLonLat = `${from.lng},${from.lat}`;
  const toLonLat = `${to.lng},${to.lat}`;

  const url = `${OSRM_BASE_URL}/route/v1/driving/${fromLonLat};${toLonLat}?overview=full&geometries=geojson&steps=true`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROUTING_TIMEOUT_MS);

  try {
    const response = await fetch(url, {signal: controller.signal});
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Routing API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No routes returned from routing API');
    }

    const routeData = data.routes[0];

    // GeoJSON coordinates: [lon, lat][]
    const points: LatLng[] = routeData.geometry.coordinates.map(
      (coord: [number, number]) => ({
        lng: coord[0],
        lat: coord[1],
      }),
    );

    const totalDistance: number = routeData.distance ?? distanceMeters(from, to);

    const maneuvers: Maneuver[] = [];

    if (Array.isArray(routeData.legs)) {
      routeData.legs.forEach((leg: any) => {
        if (Array.isArray(leg.steps)) {
          leg.steps.forEach((step: any) => {
            if (!step.maneuver) {
              return;
            }

            const type: string = step.maneuver.type ?? 'turn';
            const modifier: string | undefined = step.maneuver.modifier;
            const distance: number = step.distance ?? 0;

            let instruction = 'Continue';

            if (type === 'arrive') {
              instruction = 'Arrive at destination';
            } else if (modifier) {
              instruction = `Turn ${modifier.replace('_', ' ')}`;
            } else if (type === 'depart') {
              instruction = 'Depart';
            }

            const maneuver: Maneuver = {
              type: type === 'arrive' ? 'arrive' : type === 'depart' ? 'depart' : 'turn',
              instruction,
              distance,
              // Bearing is optional; OSRM exposes bearing at the maneuver location in step.maneuver.bearing_after
              bearing: step.maneuver.bearing_after,
            };

            maneuvers.push(maneuver);
          });
        }
      });
    }

    if (maneuvers.length === 0) {
      // Fallback simple maneuver if none parsed
      const routeBearing = bearing(from, to);
      maneuvers.push({
        type: 'arrive',
        instruction: 'Arrive at destination',
        distance: totalDistance,
        bearing: routeBearing,
      });
    }

    const route: Route = {
      points,
      maneuvers,
      totalDistance,
    };

    return route;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Routing API request timeout');
    }
    throw error;
  }
}

/**
 * Build a route using GraphHopper API
 * Free tier, no API key required for basic usage
 */
async function buildRouteWithGraphHopper(
  from: LatLng,
  to: LatLng,
): Promise<Route> {
  // GraphHopper uses lat,lng format
  const url = `${GRAPHHOPPER_BASE_URL}/route?point=${from.lat},${from.lng}&point=${to.lat},${to.lng}&type=json&instructions=true&calc_points=true&points_encoded=false`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROUTING_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(
        `GraphHopper API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    if (!data.paths || data.paths.length === 0) {
      throw new Error('No routes returned from GraphHopper API');
    }

    const path = data.paths[0];

    if (!path.points || !path.points.coordinates) {
      throw new Error('Invalid route geometry from GraphHopper');
    }

    // GeoJSON coordinates: [lon, lat][]
    const points: LatLng[] = path.points.coordinates.map(
      (coord: [number, number]) => ({
        lng: coord[0],
        lat: coord[1],
      }),
    );

    const totalDistance: number = path.distance || distanceMeters(from, to);

    const maneuvers: Maneuver[] = [];

    // Extract maneuvers from instructions
    if (Array.isArray(path.instructions)) {
      path.instructions.forEach((instruction: any) => {
        const maneuver: Maneuver = {
          type: instruction.sign < 0 ? 'turn' : instruction.sign === 4 ? 'arrive' : 'turn',
          instruction: instruction.text || 'Continue',
          distance: instruction.distance || 0,
          bearing: instruction.interval?.[0] ? undefined : undefined, // GraphHopper doesn't provide bearing directly
        };
        maneuvers.push(maneuver);
      });
    }

    if (maneuvers.length === 0) {
      // Fallback simple maneuver if none parsed
      const routeBearing = bearing(from, to);
      maneuvers.push({
        type: 'arrive',
        instruction: 'Arrive at destination',
        distance: totalDistance,
        bearing: routeBearing,
      });
    }

    const route: Route = {
      points,
      maneuvers,
      totalDistance,
    };

    return route;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('GraphHopper API request timeout');
    }
    throw error;
  }
}

/**
 * Create a straight-line route with intermediate points for visualization
 * This is a placeholder implementation
 */
function createStraightLineRoute(from: LatLng, to: LatLng): Route {
  const totalDistance = distanceMeters(from, to);
  const routeBearing = bearing(from, to);

  // Create intermediate points every ~100m
  const points: LatLng[] = [from];
  const segmentLength = 100; // meters
  const numSegments = Math.max(1, Math.floor(totalDistance / segmentLength));

  for (let i = 1; i < numSegments; i++) {
    const distance = (i * totalDistance) / numSegments;
    const point = pointAtDistanceAndBearing(from, distance, routeBearing);
    points.push(point);
  }

  points.push(to);

  // Create a simple maneuver (next turn)
  const maneuvers: Maneuver[] = [
    {
      type: 'arrive',
      instruction: 'Arrive at destination',
      distance: totalDistance,
      bearing: routeBearing,
    },
  ];

  return {
    points,
    maneuvers,
    totalDistance,
  };
}

/**
 * Resolve Google Maps short link (maps.app.goo.gl) to full URL
 * @param shortUrl Short Google Maps URL
 * @returns Resolved full URL or original URL if resolution fails
 */
async function resolveShortLink(shortUrl: string): Promise<string> {
  try {
    // Check if it's a short link
    if (!shortUrl.includes('maps.app.goo.gl') && !shortUrl.includes('goo.gl/maps')) {
      return shortUrl; // Not a short link, return as-is
    }

    // Use GET request to follow redirects and get the final URL
    // React Native fetch follows redirects automatically, but we need to check the actual response
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    try {
      const response = await fetch(shortUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // In React Native, the response.url should contain the final URL after redirects
      // If not available, try to get it from headers or use the original URL
      if (response.url && response.url !== shortUrl) {
        return response.url;
      }
      
      // Fallback: check if we can get location from headers (some servers send this)
      const location = response.headers.get('location');
      if (location) {
        return location;
      }
      
      // If we can't get the final URL, return original and let parsing try
      return shortUrl;
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.warn('Short link resolution timeout');
      } else {
        console.warn('Failed to resolve short link:', fetchError);
      }
      return shortUrl; // Fallback to original URL
    }
  } catch (error) {
    console.warn('Error resolving short link, using original URL:', error);
    return shortUrl; // Fallback to original URL
  }
}

/**
 * Extract destination coordinates from a shared URL
 * Supports Google Maps and Waze URLs, including short links (maps.app.goo.gl)
 * @param url Shared URL from Google Maps or Waze
 * @returns Destination coordinates, or null if parsing fails
 */
export async function extractDestinationFromUrl(url: string): Promise<LatLng | null> {
  try {
    console.log('[routing] Extracting from URL:', url);
    
    // Resolve short links first
    const resolvedUrl = await resolveShortLink(url);
    console.log('[routing] Resolved URL:', resolvedUrl);
    
    // Google Maps URL patterns:
    // https://www.google.com/maps?q=lat,lng
    // https://www.google.com/maps/dir/?api=1&destination=lat,lng
    // https://maps.google.com/?q=lat,lng
    // https://www.google.com/maps/search/?api=1&query=lat,lng
    // https://maps.app.goo.gl/... (short link, resolved above)

    // Waze URL patterns:
    // https://www.waze.com/ul?q=lat,lng
    // https://waze.com/ul?q=lat,lng

    const urlObj = new URL(resolvedUrl);

    // Google Maps: q parameter (could be coordinates or address)
    if (urlObj.searchParams.has('q')) {
      const q = urlObj.searchParams.get('q')!;
      // Try parsing as coordinates first
      const coords = parseCoordinates(q);
      if (coords) {
        console.log('[routing] Extracted from q param (coordinates):', coords);
        return coords;
      }
      // If q is an address, try to geocode it
      console.log('[routing] q parameter is an address, attempting geocoding:', q);
      const geocoded = await geocodeAddress(q);
      if (geocoded) {
        console.log('[routing] Geocoded address to:', geocoded);
        return geocoded;
      }
    }

    // Google Maps: destination parameter
    if (urlObj.searchParams.has('destination')) {
      const dest = urlObj.searchParams.get('destination')!;
      const coords = parseCoordinates(dest);
      if (coords) return coords;
    }

    // Google Maps: query parameter
    if (urlObj.searchParams.has('query')) {
      const query = urlObj.searchParams.get('query')!;
      const coords = parseCoordinates(query);
      if (coords) return coords;
    }

    // Waze: q parameter
    if (urlObj.hostname.includes('waze.com') && urlObj.searchParams.has('q')) {
      const q = urlObj.searchParams.get('q')!;
      const coords = parseCoordinates(q);
      if (coords) {
        console.log('[routing] Extracted from Waze q param:', coords);
        return coords;
      }
    }

    // Try parsing from pathname (some formats with @ symbol)
    if (urlObj.pathname.includes('@')) {
      // Match @lat,lng or @lat,lng,zoom
      const match = urlObj.pathname.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (match) {
        const coords = {
          lat: parseFloat(match[1]),
          lng: parseFloat(match[2]),
        };
        console.log('[routing] Extracted from @ pathname:', coords);
        return coords;
      }
    }

    // Try parsing from /place/ format: /maps/place/Name/@lat,lng,zoom
    const placeMatch = urlObj.pathname.match(/\/place\/[^/]+\/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (placeMatch) {
      const coords = {
        lat: parseFloat(placeMatch[1]),
        lng: parseFloat(placeMatch[2]),
      };
      console.log('[routing] Extracted from place pathname:', coords);
      return coords;
    }

    console.warn('[routing] Could not extract coordinates from URL:', resolvedUrl);
    console.warn('[routing] URL parts:', {
      hostname: urlObj.hostname,
      pathname: urlObj.pathname,
      search: urlObj.search,
    });
    return null;
  } catch (error) {
    console.error('Error parsing URL:', error);
    return null;
  }
}

/**
 * Synchronous version for backwards compatibility
 * Note: This will not resolve short links. Use async version for full support.
 */
export function extractDestinationFromUrlSync(url: string): LatLng | null {
  try {
    const urlObj = new URL(url);

    // Google Maps: q parameter
    if (urlObj.searchParams.has('q')) {
      const q = urlObj.searchParams.get('q')!;
      const coords = parseCoordinates(q);
      if (coords) return coords;
    }

    // Google Maps: destination parameter
    if (urlObj.searchParams.has('destination')) {
      const dest = urlObj.searchParams.get('destination')!;
      const coords = parseCoordinates(dest);
      if (coords) return coords;
    }

    // Google Maps: query parameter
    if (urlObj.searchParams.has('query')) {
      const query = urlObj.searchParams.get('query')!;
      const coords = parseCoordinates(query);
      if (coords) return coords;
    }

    // Waze: q parameter
    if (urlObj.hostname.includes('waze.com') && urlObj.searchParams.has('q')) {
      const q = urlObj.searchParams.get('q')!;
      const coords = parseCoordinates(q);
      if (coords) return coords;
    }

    // Try parsing from pathname (some formats)
    if (urlObj.pathname.includes('@')) {
      const match = urlObj.pathname.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (match) {
        return {
          lat: parseFloat(match[1]),
          lng: parseFloat(match[2]),
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Error parsing URL:', error);
    return null;
  }
}

/**
 * Parse coordinates from a string like "lat,lng" or "lat, lng"
 */
function parseCoordinates(str: string): LatLng | null {
  const parts = str.split(',').map((s) => s.trim());
  if (parts.length >= 2) {
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    // Check if both are valid numbers and within valid lat/lng ranges
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return {lat, lng};
    }
  }
  return null;
}

/**
 * Geocode an address to coordinates using OpenStreetMap Nominatim (free, no API key needed)
 * @param address Address string to geocode
 * @returns Coordinates or null if geocoding fails
 */
async function geocodeAddress(address: string): Promise<LatLng | null> {
  try {
    // Decode URL-encoded address
    const decodedAddress = decodeURIComponent(address.replace(/\+/g, ' '));
    
    // Use OpenStreetMap Nominatim geocoding API (free, no API key)
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(decodedAddress)}&limit=1`;
    
    const response = await fetch(geocodeUrl, {
      headers: {
        'User-Agent': 'HudMap/1.0', // Required by Nominatim
      },
    });
    
    if (!response.ok) {
      console.warn('[routing] Geocoding API error:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    if (Array.isArray(data) && data.length > 0) {
      const result = data[0];
      const coords = {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
      };
      console.log('[routing] Geocoded successfully:', coords);
      return coords;
    }
    
    console.warn('[routing] No geocoding results for:', decodedAddress);
    return null;
  } catch (error) {
    console.warn('[routing] Geocoding error:', error);
    return null;
  }
}

