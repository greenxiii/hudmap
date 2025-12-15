/**
 * Location service using React Native's Geolocation API (CoreLocation on iOS)
 * Provides location and heading updates
 */

import {
  Platform,
  PermissionsAndroid,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import {LocationData, LatLng} from '../models/types';

// Native heading module integration
const {HeadingModule} = NativeModules;
console.log('[Location] HeadingModule test:', {
  available: !!HeadingModule,
  hasStart: typeof HeadingModule?.start === 'function',
  hasStop: typeof HeadingModule?.stop === 'function',
  moduleKeys: HeadingModule ? Object.keys(HeadingModule) : [],
});
const headingEmitter = HeadingModule
  ? new NativeEventEmitter(HeadingModule)
  : null;
console.log('[Location] HeadingEmitter created:', !!headingEmitter);
let headingSubscription: any | null = null;

// In early development we mocked heading so the HUD always rotated.
// For real-device behavior, keep this false so we rely on GPS or movement-based heading.
// If you ever want the spinning debug behavior back, set this to true in local dev only.
const USE_MOCK_HEADING = false;

let watchId: number | null = null;
let headingWatchId: number | null = null;
let currentLocation: LocationData | null = null;
let previousPosition: LatLng | null = null;
let mockHeading: number = 0;
let listeners: Set<(location: LocationData) => void> = new Set();

// Track last headings so we can prioritise GPS heading over compass,
// but still allow the compass to drive rotation when GPS heading isn't updating.
let lastGpsHeading: number | null = null;
let lastGpsHeadingTimestamp: number | null = null;

// Debouncing for heading updates
let headingDebounceTimer: NodeJS.Timeout | null = null;
let pendingHeading: number | null = null;
let HEADING_DEBOUNCE_MS = 50; // Update at most every 50ms (~20fps), adjustable

/**
 * Set the heading debounce delay
 * @param ms Debounce delay in milliseconds (lower = more responsive, higher = less CPU)
 */
export function setHeadingDebounce(ms: number): void {
  HEADING_DEBOUNCE_MS = Math.max(0, Math.min(ms, 1000)); // Clamp between 0-1000ms
}

/**
 * Request location permissions
 * @returns true if permission granted
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'HudMap needs access to your location to show navigation.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );
      const hasPermission = granted === PermissionsAndroid.RESULTS.GRANTED;
      console.log('[Location] Permission request result:', hasPermission);
      return hasPermission;
    } catch (err) {
      console.warn('Error requesting location permission:', err);
      return false;
    }
  }
  // iOS permissions are handled via Info.plist
  // The system will prompt automatically on first location request
  // We'll try to get location and let the system handle the prompt
  console.log(
    '[Location] iOS - permission will be requested on first location access',
  );
  return true;
}

/**
 * Get current position once (for initial location)
 */
export function getCurrentPosition(): Promise<LocationData> {
  return new Promise((resolve, reject) => {
    console.log('[Location] getCurrentPosition: Requesting location...');
    Geolocation.getCurrentPosition(
      position => {
        console.log('[Location] getCurrentPosition: SUCCESS', {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          timestamp: new Date(position.timestamp).toISOString(),
        });
        const location: LocationData = {
          position: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          heading: position.coords.heading ?? 0,
          accuracy: position.coords.accuracy ?? 0,
          timestamp: position.timestamp,
        };
        currentLocation = location;
        previousPosition = location.position;
        console.log('[Location] getCurrentPosition: Location stored in cache');
        resolve(location);
      },
      error => {
        console.error('[Location] getCurrentPosition: ERROR', {
          code: error.code,
          message: error.message,
        });
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000, // Accept cached location up to 1 minute old
      },
    );
  });
}

/**
 * Start watching location updates
 * @param callback Called with each location update
 */
export function startLocationUpdates(
  callback: (location: LocationData) => void,
): void {
  listeners.add(callback);
  console.log(
    '[Location] startLocationUpdates: Added listener, total listeners:',
    listeners.size,
  );

  if (watchId !== null) {
    console.log('[Location] startLocationUpdates: Already watching, skipping');
    return; // Already watching
  }

  console.log('[Location] startLocationUpdates: Starting watchPosition...');

  // Start location updates
  watchId = Geolocation.watchPosition(
    position => {
      console.log('[Location] watchPosition: UPDATE RECEIVED', {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        heading: position.coords.heading,
        accuracy: position.coords.accuracy,
        timestamp: new Date(position.timestamp).toISOString(),
      });

      const newPosition: LatLng = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      // Calculate heading from movement if available, otherwise use cached or GPS heading
      let heading = currentLocation?.heading ?? 0;

      // Distance moved since last position (used to detect tiny GPS \"twigs\")
      let movedDistanceM = 0;
      if (previousPosition) {
        const {distanceMeters} = require('../utils/geo');
        movedDistanceM = distanceMeters(previousPosition, newPosition);
      }

      if (!USE_MOCK_HEADING) {
        // Try to use GPS heading if available and valid
        if (
          position.coords.heading !== null &&
          position.coords.heading !== undefined &&
          !isNaN(position.coords.heading) &&
          position.coords.heading >= 0
        ) {
          // Use GPS course over ground as the primary heading while moving,
          // but ignore very small \"twigs\" (tiny movements that cause noisy heading)
          heading = position.coords.heading;

          if (movedDistanceM > 3) {
            // Only treat GPS heading as \"fresh\" if we've moved at least 3m
            lastGpsHeading = heading;
            lastGpsHeadingTimestamp = Date.now();
          }
        } else if (previousPosition) {
          // Calculate heading from movement direction
          heading = calculateHeadingFromMovement(previousPosition, newPosition);

          if (movedDistanceM > 3) {
            lastGpsHeading = heading;
            lastGpsHeadingTimestamp = Date.now();
          }
        }
      } else {
        // Development: spin heading slowly so the map visibly rotates
        mockHeading = (mockHeading + 5) % 360;
        heading = mockHeading;
      }

      const location: LocationData = {
        position: newPosition,
        heading,
        accuracy: position.coords.accuracy ?? 0,
        timestamp: position.timestamp,
      };

      previousPosition = newPosition;
      currentLocation = location;
      console.log(
        '[Location] watchPosition: Location stored, notifying',
        listeners.size,
        'listeners',
      );

      // Notify all listeners
      listeners.forEach(listener => listener(location));
    },
    error => {
      console.error('Location watch error:', error);
      const errorCode = error.code || 'UNKNOWN';
      const errorMessage = error.message || 'Location unavailable';

      console.error('Location error details:', {
        code: errorCode,
        message: errorMessage,
      });

      // Don't notify listeners of error - let them handle timeout instead
      // This prevents UI from showing error on temporary GPS glitches
    },
    {
      enableHighAccuracy: true,
      timeout: 20000, // Increased timeout
      maximumAge: 30000, // Accept cached location up to 30 seconds old
    },
  );

  // Subscribe to native heading updates if available
  // Don't block location updates if heading module fails
  try {
    if (HeadingModule && !headingSubscription) {
      console.log('[Location] Starting native heading module...');

      // Add listener first (this triggers startObserving in native module)
      headingSubscription = headingEmitter?.addListener(
        'HeadingUpdate',
        (event: {heading: number}) => {
          console.log('[Location] Received heading update:', event.heading);
          updateHeading(event.heading);
        },
      );
      console.log(
        '[Location] Heading subscription created:',
        !!headingSubscription,
      );

      // Then start the module
      if (typeof HeadingModule.start === 'function') {
        HeadingModule.start();
        console.log('[Location] HeadingModule.start() called');
      } else {
        console.error('[Location] HeadingModule.start is not a function!');
      }
    } else if (!HeadingModule) {
      console.warn(
        '[Location] HeadingModule not available - compass heading will not work',
      );
    } else {
      console.log('[Location] Heading subscription already exists');
    }
  } catch (err) {
    console.error('[Location] Error setting up heading module:', err);
    // Continue without heading module - location updates should still work
  }
}

/**
 * Stop watching location updates
 */
export function stopLocationUpdates(): void {
  if (watchId !== null) {
    Geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (headingWatchId !== null) {
    headingWatchId = null;
  }
  if (headingSubscription) {
    headingSubscription.remove();
    headingSubscription = null;
  }
  if (HeadingModule) {
    HeadingModule.stop();
  }
  if (headingDebounceTimer) {
    clearTimeout(headingDebounceTimer);
    headingDebounceTimer = null;
  }
  listeners.clear();
  previousPosition = null;
  mockHeading = 0;
  pendingHeading = null;
}

/**
 * Remove a specific listener
 */
export function removeLocationListener(
  callback: (location: LocationData) => void,
): void {
  listeners.delete(callback);
  if (listeners.size === 0 && watchId !== null) {
    stopLocationUpdates();
  }
}

/**
 * Get current location (if available)
 */
export function getCurrentLocation(): LocationData | null {
  if (currentLocation) {
    console.log('[Location] getCurrentLocation: Returning cached location', {
      lat: currentLocation.position.lat,
      lng: currentLocation.position.lng,
      heading: currentLocation.heading,
    });
  } else {
    console.log('[Location] getCurrentLocation: No cached location available');
  }
  return currentLocation;
}

/**
 * Update heading manually (for testing or when heading API is implemented)
 *
 * This is currently called from the native HeadingModule (compass).
 * We treat compass as secondary: GPS / movement heading wins while it's
 * updating frequently; when GPS hasn't updated for a bit (e.g. user is
 * stationary), compass can take over to rotate the HUD.
 */
export function updateHeading(heading: number): void {
  if (!currentLocation) {
    return;
  }

  const now = Date.now();
  const gpsIsFresh =
    lastGpsHeading !== null &&
    lastGpsHeadingTimestamp !== null &&
    now - lastGpsHeadingTimestamp < 3000; // 3 seconds

  // If GPS heading is fresh, keep using it (higher priority than compass).
  // If GPS heading is stale (user likely stationary), allow compass to drive heading.
  if (!gpsIsFresh) {
    // Store pending heading for debouncing
    pendingHeading = heading;

    // Clear existing timer
    if (headingDebounceTimer) {
      clearTimeout(headingDebounceTimer);
    }

    // Debounce heading updates
    headingDebounceTimer = setTimeout(() => {
      if (pendingHeading !== null && currentLocation) {
        // Create a NEW object so React detects the change
        const updatedLocation: LocationData = {
          ...currentLocation,
          heading: pendingHeading,
        };
        currentLocation = updatedLocation;
        listeners.forEach(listener => listener(updatedLocation));
        pendingHeading = null;
      }
      headingDebounceTimer = null;
    }, HEADING_DEBOUNCE_MS);
  }
}

/**
 * Calculate heading from movement (for MVP when heading API isn't available)
 * Call this when location updates to estimate heading from position change
 */
export function calculateHeadingFromMovement(
  previous: LatLng,
  current: LatLng,
): number {
  // Import here to avoid circular dependency
  const {bearing} = require('../utils/geo');
  return bearing(previous, current);
}
