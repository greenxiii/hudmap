/**
 * HUD Screen - Circular minimap navigation display
 * Renders roads, route, and player position using react-native-skia
 */

import React, {useEffect, useState, useCallback, useRef} from 'react';
import {View, StyleSheet, Text, Dimensions, StatusBar, Animated, Easing, TextInput, TouchableOpacity} from 'react-native';
import {
  Canvas,
  Path,
  Skia,
  Group,
  Circle,
} from '@shopify/react-native-skia';
import {LocationData, LatLng, RoadSegment, Route} from '../models/types';
import {projectToLocalMeters, rotatePoint} from '../utils/geo';
import {
  startLocationUpdates,
  stopLocationUpdates,
  requestLocationPermission,
  getCurrentLocation,
  getCurrentPosition,
  setHeadingDebounce,
} from '../services/location';
import {fetchNearbyRoads} from '../services/overpass';
import {buildRoute, extractDestinationFromUrl, resetOsrmAvailability, clearRouteCache} from '../services/routing';

const {width: SCREEN_WIDTH, height: SCREEN_HEIGHT} = Dimensions.get('window');
const HUD_SIZE = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.9;
const HUD_RADIUS = HUD_SIZE / 2;
const VIEW_RADIUS_M = 200; // 200 meter radius view - good balance between detail and coverage
const PIXELS_PER_METER = HUD_RADIUS / VIEW_RADIUS_M;

// Rotation animation settings
const ROTATION_DURATION_MS = 25; // Animation duration - smooth interpolation between heading updates
const HEADING_DEBOUNCE_MS = 1; // Lower = more responsive (try 0-16ms for instant, 16-50ms for smooth)
const HEADING_CHANGE_THRESHOLD = 3; // Ignore heading changes smaller than this (degrees) - reduces unnecessary calculations

// ============================================================================
// VISUAL STYLE CONSTANTS - Customize colors, sizes, and appearance here
// ============================================================================

// Route styling
const ROUTE_COLOR = '#2a64a4'; // Green route line
const ROUTE_STROKE_WIDTH = 10; // Route line thickness

// Road styling
const ROAD_COLOR = '#949493'; // White road lines
const ROAD_STROKE_WIDTH = 10; // Road line thickness

// Player marker styling
const PLAYER_MARKER_COLOR = '#31ce30'; // White triangle
const PLAYER_MARKER_CENTER_COLOR = '#31ce30'; // Red center dot
const PLAYER_MARKER_SIZE = 10; // Triangle size in pixels
const PLAYER_MARKER_CENTER_RADIUS = PLAYER_MARKER_SIZE * 0.5; // Center dot radius

// HUD container styling
const HUD_BORDER_COLOR = '#4a4f50'; // Border color around HUD circle
const HUD_BORDER_WIDTH = 12; // Border thickness

// North arrow styling
const NORTH_ARROW_COLOR = '#FF8C00'; // Orange color for north arrow
const NORTH_ARROW_SIZE = 16; // Size of the arrow triangle
const NORTH_ARROW_BASE_DISTANCE = HUD_RADIUS - 12; // Distance from center to arrow base (on border edge)

// Background color
const BACKGROUND_COLOR = '#272b27'; // Black background

// ============================================================================

interface HudScreenProps {
  destinationUrl?: string; // Optional URL passed from share extension
  destination?: LatLng; // Optional destination coordinates (alternative to URL)
}

export default function HudScreen({
  destinationUrl,
  destination: destinationProp,
}: HudScreenProps) {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [roads, setRoads] = useState<RoadSegment[]>([]);
  const [route, setRoute] = useState<Route | null>(null);
  const [nextTurn, setNextTurn] = useState<string>('No route');
  const [distanceToTurn, setDistanceToTurn] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState<string>('');
  const [showUrlInput, setShowUrlInput] = useState<boolean>(false);

  // Native rotation animation (much faster - uses GPU/compositor)
  const rotationAnim = useRef(new Animated.Value(0)).current;
  const currentRotationRef = useRef(0);
  const lastAnimatedHeadingRef = useRef<number | null>(null);
  const [displayRotation, setDisplayRotation] = useState(0);

  // Track last destination to avoid rebuilding route unnecessarily
  const lastDestinationRef = useRef<LatLng | null>(null);
  
  // Track HUD container position for arrow alignment
  const [hudPosition, setHudPosition] = useState<{x: number; y: number} | null>(null);

  // Handle URL input submission
  const handleUrlSubmit = useCallback(async () => {
    if (!urlInput.trim()) {
      return;
    }

    // Show loading state
    setError(null);
    const inputUrl = urlInput.trim();

    try {
      console.log('Processing URL:', inputUrl);
      const dest = await extractDestinationFromUrl(inputUrl);
      console.log('Extracted destination:', dest);
      
      if (dest) {
        // Clear the input and hide it
        setUrlInput('');
        setShowUrlInput(false);
        
        // Update destination and build route
        if (location) {
          // Clear cache if destination changed
          if (lastDestinationRef.current && 
              (Math.abs(lastDestinationRef.current.lat - dest.lat) > 0.0001 ||
               Math.abs(lastDestinationRef.current.lng - dest.lng) > 0.0001)) {
            clearRouteCache();
          }
          lastDestinationRef.current = dest;
          // Reset OSRM availability to allow retry on new route request
          resetOsrmAvailability();
          console.log('[HudScreen] Building route from', location.position, 'to', dest);
          buildRoute(location.position, dest)
            .then(routeResult => {
              console.log('[HudScreen] Route built successfully:', routeResult.points.length, 'points');
              setRoute(routeResult);
            })
            .catch(err => {
              console.error('[HudScreen] Route building failed:', err);
              setError('Failed to build route. Please try again.');
            });
        } else {
          // Store destination for when location becomes available
          lastDestinationRef.current = dest;
          setError('Waiting for location...');
        }
      } else {
        setError('Could not extract destination from URL. Please check the URL format.');
        console.warn('Failed to extract destination from:', inputUrl);
      }
    } catch (err) {
      console.error('Error processing URL:', err);
      setError('Failed to process URL. Please try again.');
    }
  }, [urlInput, location]);

  // Load destination from URL or direct destination prop
  useEffect(() => {
    let dest: LatLng | null = null;

    if (destinationProp) {
      // Use direct destination if provided
      dest = destinationProp;
    } else if (destinationUrl) {
      // Try to extract from URL (async - will need to handle this differently)
      extractDestinationFromUrl(destinationUrl).then(extractedDest => {
        if (extractedDest) {
          // Clear cache if destination changed
          if (lastDestinationRef.current && 
              (Math.abs(lastDestinationRef.current.lat - extractedDest.lat) > 0.0001 ||
               Math.abs(lastDestinationRef.current.lng - extractedDest.lng) > 0.0001)) {
            clearRouteCache();
          }
          lastDestinationRef.current = extractedDest;
          // Build route when location is available
          if (location) {
            // Reset OSRM availability to allow retry on new route request
            resetOsrmAvailability();
            buildRoute(location.position, extractedDest).then(setRoute).catch(console.error);
          }
        }
      }).catch(console.error);
      return; // Exit early, will be handled by promise
    }

    // Only rebuild route if destination changed (not when location changes)
    if (dest && location) {
      const destChanged =
        !lastDestinationRef.current ||
        lastDestinationRef.current.lat !== dest.lat ||
        lastDestinationRef.current.lng !== dest.lng;

      if (destChanged) {
        lastDestinationRef.current = dest;
        buildRoute(location.position, dest).then(setRoute).catch(console.error);
      }
    } else if (!dest) {
      // Clear route if no destination
      if (route) {
        setRoute(null);
      }
      if (lastDestinationRef.current) {
        lastDestinationRef.current = null;
      }
    }
  }, [destinationUrl, destinationProp]); // Only rebuild when destination changes, not when location changes

  // Set heading debounce delay
  useEffect(() => {
    setHeadingDebounce(HEADING_DEBOUNCE_MS);
  }, []);

  // Request permissions and start location updates
  useEffect(() => {
    let mounted = true;
    let timeoutId: NodeJS.Timeout;

    const init = async () => {
      const hasPermission = await requestLocationPermission();
      if (!hasPermission) {
        if (mounted) {
          setError('Location permission denied. Please enable location in Settings.');
        }
        return;
      }

      // Try to get initial location first
      try {
        const initialLocation = await getCurrentPosition();
        if (mounted) {
          setError(null);
          setLocation(initialLocation);
        }
      } catch (err) {
        // Continue - watchPosition might still work
      }

      // Start watching for location updates
      startLocationUpdates((loc) => {
        if (mounted) {
          setError(null);
          setLocation(loc);
          
          // If we have a pending destination but no route yet, build it now that we have location
          // Only build once when location first becomes available, not on every update
          if (lastDestinationRef.current && !route && loc) {
            const dest = lastDestinationRef.current;
            // Reset OSRM availability to allow retry on new route request
            resetOsrmAvailability();
            buildRoute(loc.position, dest)
              .then(routeResult => {
                if (mounted && lastDestinationRef.current === dest) {
                  // Only set route if destination hasn't changed
                  setRoute(routeResult);
                }
              })
              .catch(console.error);
          }
          
          // Clear any timeout since we got a location
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined as any;
          }
        }
      });

      // Set a timeout to show error if no location received after 20 seconds
      timeoutId = setTimeout(() => {
        if (mounted && !location) {
          setError(
            'Location not available. Make sure location services are enabled in Settings and try again.',
          );
        }
      }, 20000);
    };

    init();

    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      stopLocationUpdates();
    };
  }, []);

  // Fetch roads when location changes
  useEffect(() => {
    if (!location) {
      return;
    }

    let mounted = true;

    const fetchRoads = async () => {
      try {
        const fetchedRoads = await fetchNearbyRoads(
          location.position.lat,
          location.position.lng,
          VIEW_RADIUS_M,
        );
        if (mounted) {
          setRoads(fetchedRoads);
        }
      } catch (err) {
        // Ignore errors, we'll just render with no roads
      }
    };

    fetchRoads();
  }, [location?.position.lat, location?.position.lng]);

  // Update next turn info from route
  useEffect(() => {
    if (route && route.maneuvers.length > 0) {
      const nextManeuver = route.maneuvers[0];
      setNextTurn(nextManeuver.instruction);
      setDistanceToTurn(nextManeuver.distance);
    } else {
      setNextTurn('No route');
      setDistanceToTurn(0);
    }
  }, [route]);

  // Listen to rotation changes and normalize for display
  useEffect(() => {
    const listenerId = rotationAnim.addListener(({value}) => {
      currentRotationRef.current = value;
      // Normalize to -180 to 180 range for display (shortest rotation)
      let normalized = ((value % 360) + 360) % 360;
      if (normalized > 180) normalized -= 360;
      setDisplayRotation(-normalized); // Negative for heading-up map
    });

    return () => {
      rotationAnim.removeListener(listenerId);
    };
  }, [rotationAnim]);

  // Animate rotation using native driver (GPU-accelerated, smooth interpolation)
  useEffect(() => {
    if (!location) {
      return;
    }

    // Target heading (0-360)
    let targetHeading = location.heading;
    targetHeading = ((targetHeading % 360) + 360) % 360;
    
    // Check if heading change is significant enough to animate
    const lastHeading = lastAnimatedHeadingRef.current;
    if (lastHeading !== null) {
      let headingDiff = targetHeading - lastHeading;
      // Normalize to shortest path
      if (headingDiff > 180) headingDiff -= 360;
      if (headingDiff < -180) headingDiff += 360;
      
      // Ignore small changes (threshold) - but when we do animate, make it smooth
      if (Math.abs(headingDiff) < HEADING_CHANGE_THRESHOLD) {
        return; // Skip animation for small changes
      }
    }
    
    // Get current rotation value from ref
    let currentValue = currentRotationRef.current;
    let normalizedCurrent = ((currentValue % 360) + 360) % 360;
    
    // If value has drifted too far, reset it to normalized value to prevent accumulation
    if (Math.abs(currentValue) > 720) {
      rotationAnim.setValue(normalizedCurrent);
      currentValue = normalizedCurrent;
      currentRotationRef.current = normalizedCurrent;
    }
    
    // Calculate shortest angular distance (handles 0/360 wrap-around)
    let diff = targetHeading - normalizedCurrent;
    
    // Normalize to shortest path (-180 to +180)
    if (diff > 180) {
      diff -= 360;
    } else if (diff < -180) {
      diff += 360;
    }
    
    // Calculate final target value (normalized current + shortest diff)
    // This keeps the value close to 0-360 range
    let finalTarget = normalizedCurrent + diff;

    // Store the heading we're animating to
    lastAnimatedHeadingRef.current = targetHeading;

    // Animate smoothly to new heading - smooth interpolation between significant heading updates
    Animated.timing(rotationAnim, {
      toValue: finalTarget,
      duration: ROTATION_DURATION_MS,
      useNativeDriver: true, // GPU-accelerated
      easing: Easing.linear, // Linear for smooth, consistent rotation between updates
    }).start();
  }, [location?.heading, rotationAnim]);

  // Render roads as paths (no rotation - handled by Animated.View)
  const renderRoads = useCallback(() => {
    if (!location || roads.length === 0) {
      return null;
    }

    const paths = roads.map((road, index) => {
      const path = Skia.Path.Make();
      let isFirst = true;
      let hasPoints = false;

      road.points.forEach(point => {
        const local = projectToLocalMeters(point, location.position);
        // No rotation here - handled by Animated.View transform
        const x = HUD_RADIUS + local.x * PIXELS_PER_METER;
        const y = HUD_RADIUS + local.y * PIXELS_PER_METER;

        if (isFirst) {
          path.moveTo(x, y);
          isFirst = false;
          hasPoints = true;
        } else {
          path.lineTo(x, y);
        }
      });

      if (!hasPoints) {
        return null;
      }

      return (
        <Path
          key={`road-${index}`}
          path={path}
          color={ROAD_COLOR}
          style="stroke"
          strokeWidth={ROAD_STROKE_WIDTH}
          strokeJoin="round"
          strokeCap="round"
        />
      );
    });

    const validPaths = paths.filter(p => p !== null);
    return validPaths;
  }, [roads, location?.position.lat, location?.position.lng]); // Re-render when position changes

  // Render route as a thick highlighted path (no rotation - handled by Animated.View)
  // Route points are static world coordinates, only projected relative to current position
  const renderRoute = useCallback(() => {
    if (!route || !location || !route.points || route.points.length === 0) {
      return null;
    }

    const path = Skia.Path.Make();
    let isFirst = true;

    // Render all route points - they're static world coordinates
    route.points.forEach((point) => {
      // Project each route point to local meters relative to current position
      const local = projectToLocalMeters(point, location.position);
      // No rotation here - handled by Animated.View transform
      const x = HUD_RADIUS + local.x * PIXELS_PER_METER;
      const y = HUD_RADIUS + local.y * PIXELS_PER_METER;

      // Skip points that are way outside the view (optional optimization)
      const distanceFromCenter = Math.sqrt(
        Math.pow(x - HUD_RADIUS, 2) + Math.pow(y - HUD_RADIUS, 2),
      );
      if (distanceFromCenter > HUD_RADIUS * 1.5) {
        // Point is way outside visible area, skip it
        return;
      }

      if (isFirst) {
        path.moveTo(x, y);
        isFirst = false;
      } else {
        path.lineTo(x, y);
      }
    });

    return (
      <Path
        path={path}
        color={ROUTE_COLOR}
        style="stroke"
        strokeWidth={ROUTE_STROKE_WIDTH}
        strokeJoin="round"
        strokeCap="round"
      />
    );
  }, [route, location?.position.lat, location?.position.lng]); // Only depend on position, not heading

  // Render player marker (triangle at center)
  const renderPlayerMarker = useCallback(() => {
    const centerX = HUD_RADIUS;
    const centerY = HUD_RADIUS;

    const path = Skia.Path.Make();
    // Triangle pointing up (north)
    path.moveTo(centerX, centerY - PLAYER_MARKER_SIZE);
    path.lineTo(centerX - PLAYER_MARKER_SIZE * 0.866, centerY + PLAYER_MARKER_SIZE * 0.5);
    path.lineTo(centerX + PLAYER_MARKER_SIZE * 0.866, centerY + PLAYER_MARKER_SIZE * 0.5);
    path.close();

    return (
      <Group>
        <Circle
          cx={centerX}
          cy={centerY}
          r={PLAYER_MARKER_CENTER_RADIUS}
          color={PLAYER_MARKER_CENTER_COLOR}
        />
        <Path path={path} color={PLAYER_MARKER_COLOR} style="fill" />
      </Group>
    );
  }, []);

  // Render north arrow (rotates with map to always point north)
  const renderNorthArrow = useCallback(() => {
    if (!location) return null;
    
    const centerX = HUD_RADIUS;
    const centerY = HUD_RADIUS;
    
    // Start with arrow at top of circle (north position)
    // Arrow base sits exactly on the border edge
    // centerY is HUD_RADIUS, so border is at y = 0 (top of canvas)
    const arrowBaseX = centerX; // Centered horizontally
    const arrowBaseY = 0; // At top border (north) - exactly on the circle edge

    // Rotate arrow position by heading so it always points north
    // Map rotates by -heading (displayRotation), so arrow needs to rotate by +heading to stay pointing north
    // displayRotation is -heading, so we use -displayRotation to get heading
    const currentHeading = -displayRotation;
    const headingRad = (currentHeading * Math.PI) / 180;
    const cos = Math.cos(headingRad);
    const sin = Math.sin(headingRad);
    
    // Rotate the arrow base position around the center
    // Start at top (north): dx=0, dy=-NORTH_ARROW_BASE_DISTANCE
    const dx = 0;
    const dy = -NORTH_ARROW_BASE_DISTANCE;
    const rotatedBaseX = centerX + dx * cos - dy * sin;
    const rotatedBaseY = centerY + dx * sin + dy * cos;

    const path = Skia.Path.Make();
    // Triangle pointing up (north)
    // Tip extends outward from border, base sits on border
    const tipX = rotatedBaseX;
    const tipY = rotatedBaseY - NORTH_ARROW_SIZE; // Tip extends outward
    const baseLeftX = rotatedBaseX - NORTH_ARROW_SIZE * 0.866;
    const baseLeftY = rotatedBaseY;
    const baseRightX = rotatedBaseX + NORTH_ARROW_SIZE * 0.866;
    const baseRightY = rotatedBaseY;
    
    path.moveTo(tipX, tipY);
    path.lineTo(baseLeftX, baseLeftY);
    path.lineTo(baseRightX, baseRightY);
    path.close();

    return (
      <Path path={path} color={NORTH_ARROW_COLOR} style="fill" />
    );
  }, [displayRotation]);

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!location) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Getting location...</Text>
      </View>
    );
  }


  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* URL Input at top of screen */}
      <View style={styles.urlInputTopContainer}>
        <TouchableOpacity
          style={styles.urlButton}
          onPress={() => setShowUrlInput(!showUrlInput)}>
          <Text style={styles.urlButtonText}>
            {showUrlInput ? 'Cancel' : 'Add Route'}
          </Text>
        </TouchableOpacity>

        {showUrlInput && (
          <View style={styles.urlInputContainer}>
            <TextInput
              style={styles.urlInput}
              placeholder="Paste Google Maps or Waze URL"
              placeholderTextColor="#888888"
              value={urlInput}
              onChangeText={setUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleUrlSubmit}>
              <Text style={styles.submitButtonText}>Go</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View
        style={styles.hudContainer}
        onLayout={(event) => {
          const {x, y} = event.nativeEvent.layout;
          setHudPosition({x, y});
        }}>
        {/* Rotating map layer */}
        <Animated.View
          style={{
            width: HUD_SIZE,
            height: HUD_SIZE,
            transform: [{rotate: `${displayRotation}deg`}],
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 1,
          }}>
          <Canvas style={styles.canvas}>
            <Group>
              {/* Clip to circle */}
              <Group
                clip={Skia.Path.Make().addCircle(
                  HUD_RADIUS,
                  HUD_RADIUS,
                  HUD_RADIUS,
                )}
              >
                {/* Render roads */}
                {renderRoads()}
                {/* Render route */}
                {renderRoute()}
              </Group>
            </Group>
          </Canvas>
        </Animated.View>
        {/* Fixed player marker layer (on top, doesn't rotate) */}
        <Canvas
          style={[
            styles.canvas,
            {
              position: 'absolute',
              top: 0,
              left: 0,
              zIndex: 10,
            },
          ]}>
          <Group>
            {renderPlayerMarker()}
          </Group>
        </Canvas>
      </View>
      {/* North arrow layer - rendered outside hudContainer so it's above the border */}
      {/* Position arrow Canvas to exactly match hudContainer position */}
      {hudPosition && (
        <View
          style={{
            position: 'absolute',
            width: HUD_SIZE,
            height: HUD_SIZE,
            left: hudPosition.x,
            top: hudPosition.y,
            zIndex: 20,
            pointerEvents: 'none',
          }}>
          <Canvas style={styles.canvas}>
            <Group>
              {renderNorthArrow()}
            </Group>
          </Canvas>
        </View>
      )}
      <View style={styles.infoContainer}>
        <Text style={styles.turnText}>{nextTurn}</Text>
        <Text style={styles.distanceText}>
          {distanceToTurn > 0
            ? `${Math.round(distanceToTurn)}m`
            : ''}
        </Text>
        {roads.length > 0 && (
          <Text style={styles.debugText}>
            {roads.length} roads loaded
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BACKGROUND_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudContainer: {
    width: HUD_SIZE,
    height: HUD_SIZE,
    borderRadius: HUD_RADIUS,
    overflow: 'hidden',
    borderWidth: HUD_BORDER_WIDTH,
    borderColor: HUD_BORDER_COLOR,
  },
  canvas: {
    width: HUD_SIZE,
    height: HUD_SIZE,
  },
  infoContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  turnText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  distanceText: {
    color: '#AAAAAA',
    fontSize: 16,
    marginTop: 4,
  },
  debugText: {
    color: '#666666',
    fontSize: 12,
    marginTop: 8,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  errorText: {
    color: '#FF0000',
    fontSize: 16,
  },
  urlInputTopContainer: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
    width: '100%',
    paddingHorizontal: 20,
  },
  urlButton: {
    backgroundColor: '#333333',
    paddingHorizontal: 46,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 8,
    marginTop: 20,
  },
  urlButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  urlInputContainer: {
    flexDirection: 'row',
    width: '100%',
    gap: 8,
    paddingHorizontal: 0,
  },
  urlInput: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444444',
    fontSize: 14,
  },
  submitButton: {
    backgroundColor: '#00FF00',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: 'center',
  },
  submitButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
