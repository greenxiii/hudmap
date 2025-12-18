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
import {projectToLocalMeters} from '../utils/geo';
import {
  startLocationUpdates,
  stopLocationUpdates,
  requestLocationPermission,
  getCurrentPosition,
  setHeadingDebounce,
} from '../services/location';
import {fetchNearbyRoads} from '../services/overpass';
import {buildRoute, extractDestinationFromUrl, resetOsrmAvailability, clearRouteCache} from '../services/routing';
import {defaultTheme} from '../themes';

const {width: SCREEN_WIDTH, height: SCREEN_HEIGHT} = Dimensions.get('window');
const HUD_SIZE = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.9;
const HUD_RADIUS = HUD_SIZE / 2;
const VIEW_RADIUS_M = 200; // 200 meter radius view - good balance between detail and coverage
const PIXELS_PER_METER = HUD_RADIUS / VIEW_RADIUS_M;

// Rotation animation settings
const ROTATION_DURATION_MS = 100; // Longer duration for smoother gliding
const HEADING_DEBOUNCE_MS = 10; // Moderate debounce to filter noise
const HEADING_CHANGE_THRESHOLD = 2.0; // Filter out tiny tremors

// Theme - can be switched to different themes
const theme = defaultTheme;

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
  const [nextManeuver, setNextManeuver] = useState<{instruction: string; distance: number} | null>(null);
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
      const maneuver = route.maneuvers[0];
      setNextManeuver({
        instruction: maneuver.instruction,
        distance: maneuver.distance,
      });
    } else {
      setNextManeuver(null);
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
    
    // Calculate shortest angular distance from CURRENT actual value
    // This avoids jumps caused by resetting the value
    let normalizedCurrent = ((currentValue % 360) + 360) % 360;
    let diff = targetHeading - normalizedCurrent;
    
    // Normalize to shortest path (-180 to +180)
    if (diff > 180) {
      diff -= 360;
    } else if (diff < -180) {
      diff += 360;
    }
    
    // Calculate final target value relative to the current accumulated value
    let finalTarget = currentValue + diff;

    // Store the heading we're animating to
    lastAnimatedHeadingRef.current = targetHeading;

    // Animate smoothly to new heading - smooth interpolation between significant heading updates
    rotationAnim.stopAnimation((currentValue) => {
      // Calculate shortest angular distance from where the animation actually IS right now
      let normalizedCurrent = ((currentValue % 360) + 360) % 360;
      let diff = targetHeading - normalizedCurrent;
      
      // Normalize to shortest path (-180 to +180)
      if (diff > 180) {
        diff -= 360;
      } else if (diff < -180) {
        diff += 360;
      }
      
      // Calculate final target value relative to the current actual value
      let finalTarget = currentValue + diff;

      // Store the heading we're animating to
      lastAnimatedHeadingRef.current = targetHeading;

      // Animate smoothly to new heading
      Animated.timing(rotationAnim, {
        toValue: finalTarget,
        duration: ROTATION_DURATION_MS,
        useNativeDriver: true,
        easing: Easing.out(Easing.quad),
      }).start();
    });
  }, [location?.heading, rotationAnim]);

  // Get road style based on road type (width only, no opacity variation)
  const getRoadStyle = useCallback((roadType?: string): {width: number} => {
    const baseWidth = theme.roadStrokeWidth;

    if (!roadType) {
      return {width: baseWidth * 0.6};
    }

    switch (roadType) {
      case 'motorway':
        return {width: baseWidth * 1.4};
      case 'trunk':
        return {width: baseWidth * 1.2};
      case 'primary':
        return {width: baseWidth * 1.1};
      case 'secondary':
        return {width: baseWidth * 1.0};
      case 'tertiary':
        return {width: baseWidth * 0.9};
      case 'residential':
        return {width: baseWidth * 0.7};
      case 'unclassified':
        return {width: baseWidth * 0.65};
      case 'service':
        return {width: baseWidth * 0.5};
      case 'living_street':
        return {width: baseWidth * 0.6};
      default:
        return {width: baseWidth * 0.6};
    }
  }, [theme.roadStrokeWidth]);

  // Render roads as paths (no rotation - handled by Animated.View)
  const renderRoads = useCallback(() => {
    if (!location || roads.length === 0) {
      return null;
    }

    const paths = roads.map((road, index) => {
      const path = Skia.Path.Make();
      let isFirst = true;
      let hasPoints = false;

      // Use absolute center to match rotation point
      const visualCenterX = HUD_RADIUS;
      const visualCenterY = HUD_RADIUS;
      
      road.points.forEach(point => {
        const local = projectToLocalMeters(point, location.position);
        // No rotation here - handled by Animated.View transform
        const x = visualCenterX + local.x * PIXELS_PER_METER;
        const y = visualCenterY + local.y * PIXELS_PER_METER;

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

      const roadStyle = getRoadStyle(road.type);

      return (
        <Path
          key={`road-${index}`}
          path={path}
          color={theme.roadColor}
          style="stroke"
          strokeWidth={roadStyle.width}
          strokeJoin="round"
          strokeCap="round"
        />
      );
    });

    const validPaths = paths.filter(p => p !== null);
    return validPaths;
  }, [roads, location?.position.lat, location?.position.lng, getRoadStyle, theme]); // Re-render when position changes

  // Render route as a thick highlighted path (no rotation - handled by Animated.View)
  // Route points are static world coordinates, only projected relative to current position
  const renderRoute = useCallback(() => {
    if (!route || !location || !route.points || route.points.length === 0) {
      return null;
    }

    const path = Skia.Path.Make();
    let isFirst = true;

    // Render all route points - they're static world coordinates
    // Use absolute center to match rotation point
    const visualCenterX = HUD_RADIUS;
    const visualCenterY = HUD_RADIUS;

    route.points.forEach((point) => {
      // Project each route point to local meters relative to current position
      const local = projectToLocalMeters(point, location.position);
      // No rotation here - handled by Animated.View transform
      const x = visualCenterX + local.x * PIXELS_PER_METER;
      const y = visualCenterY + local.y * PIXELS_PER_METER;

      // Skip points that are way outside the view (optional optimization)
      const distanceFromCenter = Math.sqrt(
        Math.pow(x - visualCenterX, 2) + Math.pow(y - visualCenterY, 2),
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
        color={theme.routeColor}
        style="stroke"
        strokeWidth={theme.routeStrokeWidth}
        strokeJoin="round"
        strokeCap="round"
      />
    );
  }, [route, location?.position.lat, location?.position.lng]); // Only depend on position, not heading

  const renderPlayerMarker = useCallback(() => {
    // Center at absolute HUD center
    const centerX = HUD_RADIUS;
    const centerY = HUD_RADIUS;

    const triangleLength = theme.playerMarkerSize * 1.5;
    const triangleWidth = theme.playerMarkerSize;
    const halfWidth = triangleWidth / 2;
    const tipY = centerY - triangleLength;
    const baseY = centerY;

    const path = Skia.Path.Make();
    path.moveTo(centerX, tipY);
    path.lineTo(centerX - halfWidth, baseY);
    path.lineTo(centerX + halfWidth, baseY);
    path.close();

    return (
      <Group>
        {/* Fill triangle first (background) */}
        <Path 
          path={path} 
          color={theme.playerMarkerColor} 
          style="fill"
          opacity={1}
        />
        {/* Then draw border on top */}
        <Path 
          path={path} 
          color={theme.playerMarkerBorderColor} 
          style="stroke" 
          strokeWidth={theme.playerMarkerBorderWidth}
          strokeJoin="miter"
          strokeCap="butt"
          opacity={1}
        />
      </Group>
    );
  }, []);

  // Render north arrow (rotates with map to always point north)
  const renderNorthArrow = useCallback(() => {
    if (!location) return null;
    
    const centerX = HUD_RADIUS;
    const centerY = HUD_RADIUS;

    // Rotate arrow position by heading so it always points north
    // Map rotates by -heading (displayRotation), so arrow needs to rotate by +heading to stay pointing north
    // displayRotation is -heading, so we use -displayRotation to get heading
    // Negate to reverse rotation direction
    const currentHeading = displayRotation;
    const headingRad = (currentHeading * Math.PI) / 180;
    const cos = Math.cos(headingRad);
    const sin = Math.sin(headingRad);
    
    // Rotate the arrow base position around the center
    const northArrowBaseDistance = theme.northArrowBaseDistance(HUD_RADIUS);
    // Start at top (north): dx=0, dy=-northArrowBaseDistance
    const dx = 0;
    const dy = -northArrowBaseDistance;
    const rotatedBaseX = centerX + dx * cos - dy * sin;
    const rotatedBaseY = centerY + dx * sin + dy * cos;

    // Create triangle in local coordinates (pointing outward from center)
    // The tip extends outward from the border, the base sits on the border
    // In local coords: tip at (0, -northArrowSize) pointing outward, base at y=0
    const triangleWidth = theme.northArrowSize * 0.866 * 2; // Base width of equilateral triangle
    const localTipX = 0;
    const localTipY = -theme.northArrowSize; // Tip extends outward (negative Y = up/outward in screen coords)
    const localBaseLeftX = -triangleWidth / 2;
    const localBaseLeftY = 0;
    const localBaseRightX = triangleWidth / 2;
    const localBaseRightY = 0;

    // Rotate the triangle shape itself so it points in the direction from center to arrow position
    // The triangle rotates by the same angle as the arrow position rotates around the circle
    // This makes the triangle always point outward from the center, in the direction of north
    const rotateCos = cos;
    const rotateSin = sin;

    // Rotate each point of the triangle around the arrow base position
    // Rotate tip (extends outward from border)
    const rotatedTipX = rotatedBaseX + (localTipX * rotateCos - localTipY * rotateSin);
    const rotatedTipY = rotatedBaseY + (localTipX * rotateSin + localTipY * rotateCos);

    // Rotate base left corner
    const rotatedBaseLeftX = rotatedBaseX + (localBaseLeftX * rotateCos - localBaseLeftY * rotateSin);
    const rotatedBaseLeftY = rotatedBaseY + (localBaseLeftX * rotateSin + localBaseLeftY * rotateCos);

    // Rotate base right corner
    const rotatedBaseRightX = rotatedBaseX + (localBaseRightX * rotateCos - localBaseRightY * rotateSin);
    const rotatedBaseRightY = rotatedBaseY + (localBaseRightX * rotateSin + localBaseRightY * rotateCos);

    const path = Skia.Path.Make();
    path.moveTo(rotatedTipX, rotatedTipY);
    path.lineTo(rotatedBaseLeftX, rotatedBaseLeftY);
    path.lineTo(rotatedBaseRightX, rotatedBaseRightY);
    path.close();

    return (
      <>
        <Path 
          path={path} 
          color={theme.northArrowColor} 
          style="fill" 
        />
        <Path 
          path={path} 
          color={theme.northArrowBorderColor} 
          style="stroke" 
          strokeWidth={theme.northArrowBorderWidth}
          strokeJoin="miter"
          strokeCap="butt"
        />
      </>
    );
  }, [displayRotation]);

  // Render turn icon based on maneuver instruction
  const renderTurnIcon = useCallback(() => {
    if (!nextManeuver) return null;

    const iconSize = theme.turnIconSize;
    const canvasSize = iconSize + 20;
    const centerX = canvasSize / 2; // Center horizontally in canvas
    const centerY = iconSize / 2 + 10; // Position at top of canvas (bottom of screen)

    const instruction = nextManeuver.instruction.toLowerCase();
    let path: any = null;

    // Determine icon type from instruction
    if (instruction.includes('left')) {
      // Left turn arrow
      path = Skia.Path.Make();
      const arrowLength = iconSize * 0.6;
      const arrowWidth = iconSize * 0.4;
      // Arrow pointing left
      path.moveTo(centerX - arrowLength / 2, centerY);
      path.lineTo(centerX + arrowLength / 2, centerY - arrowWidth / 2);
      path.lineTo(centerX + arrowLength / 2, centerY + arrowWidth / 2);
      path.close();
    } else if (instruction.includes('right')) {
      // Right turn arrow
      path = Skia.Path.Make();
      const arrowLength = iconSize * 0.6;
      const arrowWidth = iconSize * 0.4;
      // Arrow pointing right
      path.moveTo(centerX + arrowLength / 2, centerY);
      path.lineTo(centerX - arrowLength / 2, centerY - arrowWidth / 2);
      path.lineTo(centerX - arrowLength / 2, centerY + arrowWidth / 2);
      path.close();
    } else if (instruction.includes('straight') || instruction.includes('continue')) {
      // Straight arrow
      path = Skia.Path.Make();
      const arrowLength = iconSize * 0.6;
      const arrowWidth = iconSize * 0.3;
      // Arrow pointing up
      path.moveTo(centerX, centerY - arrowLength / 2);
      path.lineTo(centerX - arrowWidth / 2, centerY + arrowLength / 2);
      path.lineTo(centerX + arrowWidth / 2, centerY + arrowLength / 2);
      path.close();
    } else if (instruction.includes('arrive')) {
      // Destination icon (circle)
      return (
        <Circle
          cx={centerX}
          cy={centerY}
          r={iconSize * 0.3}
          color={theme.turnIconColor}
        />
      );
    } else {
      // Default: straight arrow
      path = Skia.Path.Make();
      const arrowLength = iconSize * 0.6;
      const arrowWidth = iconSize * 0.3;
      path.moveTo(centerX, centerY - arrowLength / 2);
      path.lineTo(centerX - arrowWidth / 2, centerY + arrowLength / 2);
      path.lineTo(centerX + arrowWidth / 2, centerY + arrowLength / 2);
      path.close();
    }

    if (!path) return null;

    return (
      <Group>
        <Path
          path={path}
          color={theme.turnIconColor}
          style="fill"
        />
        <Path
          path={path}
          color={theme.turnIconBorderColor}
          style="stroke"
          strokeWidth={theme.turnIconBorderWidth}
          strokeJoin="miter"
          strokeCap="butt"
        />
      </Group>
    );
  }, [nextManeuver, theme]);

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
        }}
      />

      {/* Map, Player, and North Arrow layers - positioned absolutely over the hudContainer */}
      {hudPosition && (
        <>
          {/* Rotating map layer */}
          <View
            style={[
              styles.layerContainer,
              {left: hudPosition.x, top: hudPosition.y, zIndex: 1},
            ]}>
            <Animated.View
              style={{
                width: HUD_SIZE,
                height: HUD_SIZE,
                transform: [{rotate: `${displayRotation}deg`}],
              }}>
              <Canvas style={styles.canvas}>
                <Group>
                  {/* Clip to circle - center at HUD_RADIUS to match outer HUD center */}
                  <Group
                    clip={Skia.Path.Make().addCircle(
                      HUD_RADIUS,
                      HUD_RADIUS,
                      HUD_RADIUS - theme.hudBorderWidth,
                    )}>
                    {/* Render roads */}
                    {renderRoads()}
                    {/* Render route */}
                    {renderRoute()}
                  </Group>
                </Group>
              </Canvas>
            </Animated.View>
          </View>

          {/* Fixed player marker layer (on top, doesn't rotate) */}
          <View
            style={[
              styles.layerContainer,
              {left: hudPosition.x, top: hudPosition.y, zIndex: 10},
            ]}>
            <Canvas style={styles.canvas}>
              <Group>{renderPlayerMarker()}</Group>
            </Canvas>
          </View>

          {/* North arrow layer */}
          <View
            style={[
              styles.layerContainer,
              {left: hudPosition.x, top: hudPosition.y, zIndex: 20},
            ]}>
            <Canvas style={styles.canvas}>
              <Group>{renderNorthArrow()}</Group>
            </Canvas>
          </View>
        </>
      )}
      {/* Turn icon and distance at bottom */}
      {nextManeuver && (
        <View style={styles.turnIconContainer}>
          <Text style={styles.turnInstructionText}>
            {nextManeuver.instruction}
          </Text>
          <Canvas style={styles.turnIconCanvas}>
            <Group>
              {renderTurnIcon()}
            </Group>
          </Canvas>
          <Text style={styles.turnDistanceText}>
            {nextManeuver.distance > 0
              ? `${Math.round(nextManeuver.distance)}m`
              : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.backgroundColor,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudContainer: {
    width: HUD_SIZE,
    height: HUD_SIZE,
    borderRadius: HUD_RADIUS,
    overflow: 'hidden',
    borderWidth: theme.hudBorderWidth,
    borderColor: theme.hudBorderColor,
  },
  layerContainer: {
    position: 'absolute',
    width: HUD_SIZE,
    height: HUD_SIZE,
    pointerEvents: 'none',
  },
  canvas: {
    width: HUD_SIZE,
    height: HUD_SIZE,
  },
  turnIconContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 30,
  },
  turnIconCanvas: {
    width: theme.turnIconSize + 20,
    height: theme.turnIconSize + 20,
  },
  turnInstructionText: {
    color: theme.turnInstructionTextColor,
    fontSize: theme.turnInstructionTextSize,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  turnDistanceText: {
    color: theme.turnDistanceTextColor,
    fontSize: theme.turnDistanceTextSize,
    fontWeight: 'bold',
    marginTop: 8,
    textAlign: 'center',
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
