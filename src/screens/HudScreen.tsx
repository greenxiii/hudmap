/**
 * HUD Screen - Circular minimap navigation display
 * Renders roads, route, and player position using react-native-skia
 */

import React, {useEffect, useState, useCallback, useRef, useMemo} from 'react';
import {View, StyleSheet, Text, Dimensions, StatusBar, Animated, Easing, TextInput, TouchableOpacity, PanResponder} from 'react-native';
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
const MIN_VIEW_RADIUS_M = 50;
const MAX_VIEW_RADIUS_M = 1000;
const DEFAULT_VIEW_RADIUS_M = 200;

// Rotation settings - using requestAnimationFrame for smooth real-time following

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
  // Smooth interpolated position for display (animates toward actual GPS position)
  const [displayPosition, setDisplayPosition] = useState<LatLng | null>(null);
  
  // Animated values for smooth position interpolation
  const animatedLat = useRef(new Animated.Value(0)).current;
  const animatedLng = useRef(new Animated.Value(0)).current;
  const animatedPositionRef = useRef<LatLng | null>(null);
  const [roads, setRoads] = useState<RoadSegment[]>([]);
  const [roadsFetchCenter, setRoadsFetchCenter] = useState<LatLng | null>(null); // Center position where roads were last fetched
  const roadsFetchTimerRef = useRef<NodeJS.Timeout | null>(null); // Debounce timer for road fetching
  const isFetchingRoadsRef = useRef<boolean>(false); // Flag to prevent concurrent fetches
  const mountedRef = useRef<boolean>(true); // Track if component is mounted
  const routeRoadsFetchedRef = useRef<Set<string>>(new Set()); // Track which route points have had roads fetched
  const [route, setRoute] = useState<Route | null>(null);
  const routeRenderCenterRef = useRef<LatLng | null>(null); // Center position where route was last rendered
  const cachedRoutePathRef = useRef<ReturnType<typeof Skia.Path.Make> | null>(null); // Cached route path
  const [nextManeuver, setNextManeuver] = useState<{instruction: string; distance: number} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState<string>('');
  const [showUrlInput, setShowUrlInput] = useState<boolean>(false);
  const [viewRadius, setViewRadius] = useState(DEFAULT_VIEW_RADIUS_M);
  const pixelsPerMeter = HUD_RADIUS / viewRadius;
  
  // Mock movement for testing
  const [mockMovementEnabled, setMockMovementEnabled] = useState<boolean>(false);
  const mockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mockStartPositionRef = useRef<LatLng | null>(null);
  const mockHeadingRef = useRef<number>(45); // Start heading northeast
  const mockDistanceRef = useRef<number>(0); // Total distance traveled
  const mockRoutePointIndexRef = useRef<number>(0); // Current route point index
  const mockRouteDistanceRef = useRef<number>(0); // Distance along current route segment
  
  // Animation refs for smooth position interpolation
  const targetPositionRef = useRef<LatLng | null>(null);
  const currentDisplayPositionRef = useRef<LatLng | null>(null);
  const lastUpdateTimeRef = useRef<number>(Date.now());

  // Zoom handling
  const lastPinchDistanceRef = useRef<number | null>(null);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt) => {
        if (evt.nativeEvent.touches.length === 2) {
          const touches = evt.nativeEvent.touches;
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (lastPinchDistanceRef.current !== null) {
            const diff = lastPinchDistanceRef.current - distance;
            // Sensitivity decreases as radius increases to keep zoom feeling consistent
            const sensitivity = viewRadius / 150; 
            setViewRadius((prev) => {
              const next = prev + diff * sensitivity;
              return Math.max(MIN_VIEW_RADIUS_M, Math.min(next, MAX_VIEW_RADIUS_M));
            });
          }
          lastPinchDistanceRef.current = distance;
        }
      },
      onPanResponderRelease: () => {
        lastPinchDistanceRef.current = null;
      },
      onPanResponderTerminate: () => {
        lastPinchDistanceRef.current = null;
      },
    }),
  ).current;

  // Real-time rotation using requestAnimationFrame (compass-like smooth following)
  const targetHeadingRef = useRef<number>(0);
  const currentRotationRef = useRef<number>(0);
  const rotationAnimationFrameRef = useRef<number | null>(null);
  const [displayRotation, setDisplayRotation] = useState(0);

  // Pulsing animation for destination marker
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const [pulseScale, setPulseScale] = useState(1);
  const [pulseOpacity, setPulseOpacity] = useState(0.6);

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
      const dest = await extractDestinationFromUrl(inputUrl);
      
      if (dest) {
        setUrlInput('');
        setShowUrlInput(false);
        
        if (location) {
          if (lastDestinationRef.current && 
              (Math.abs(lastDestinationRef.current.lat - dest.lat) > 0.0001 ||
               Math.abs(lastDestinationRef.current.lng - dest.lng) > 0.0001)) {
            clearRouteCache();
          }
          lastDestinationRef.current = dest;
          resetOsrmAvailability();
          buildRoute(location.position, dest)
            .then(setRoute)
            .catch(err => {
              console.error('[HudScreen] Route building failed:', err);
              setError('Failed to build route. Please try again.');
            });
        } else {
          lastDestinationRef.current = dest;
          setError('Waiting for location...');
        }
      } else {
        setError('Could not extract destination from URL. Please check the URL format.');
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

  // Set up mounted ref
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Set heading debounce delay
  useEffect(() => {
      setHeadingDebounce(1); // Minimal debounce for responsiveness
  }, []);

  // Start pulsing animation for destination marker
  useEffect(() => {
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false, // We need to update state, so can't use native driver
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.in(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );

    pulseAnimation.start();

    const listenerId = pulseAnim.addListener(({value}) => {
      // Scale from 1.0 to 1.3 for visible pulsing effect
      setPulseScale(1.0 + value * 0.3);
      // Opacity from 0.4 to 0.1 (small opacity range for subtle pulsing)
      setPulseOpacity(0.1 + value * 0.3);
    });

    return () => {
      pulseAnim.removeListener(listenerId);
      pulseAnimation.stop();
    };
  }, [pulseAnim]);

  // Mock movement for testing smooth interpolation
  useEffect(() => {
    if (!mockMovementEnabled || !location) {
      // Stop mock movement
      if (mockTimerRef.current) {
        clearInterval(mockTimerRef.current);
        mockTimerRef.current = null;
      }
      // Reset mock state when disabled
      if (!mockMovementEnabled) {
        mockStartPositionRef.current = null;
        mockDistanceRef.current = 0;
        mockRoutePointIndexRef.current = 0;
        mockRouteDistanceRef.current = 0;
      }
      return;
    }

    // Initialize start position from current location when mock movement starts
    if (!mockStartPositionRef.current) {
      mockStartPositionRef.current = {...location.position};
      mockDistanceRef.current = 0;
      mockRoutePointIndexRef.current = 0;
      mockRouteDistanceRef.current = 0;
      
      // If we have a route, find the closest route point to start from
      if (route && route.points.length > 0) {
        const {distanceMeters} = require('../utils/geo');
        let closestIndex = 0;
        let closestDistance = distanceMeters(location.position, route.points[0]);
        
        for (let i = 1; i < route.points.length; i++) {
          const dist = distanceMeters(location.position, route.points[i]);
          if (dist < closestDistance) {
            closestDistance = dist;
            closestIndex = i;
          }
        }
        mockRoutePointIndexRef.current = closestIndex;
      } else {
        mockHeadingRef.current = location.heading || 45;
      }
    } else if (route && route.points.length > 0) {
      // If route was added while mock movement is active, reset to closest route point
      // Only reset if we're at the start (to avoid interrupting movement)
      if (mockRoutePointIndexRef.current === 0 && mockRouteDistanceRef.current === 0) {
        const {distanceMeters} = require('../utils/geo');
        let closestIndex = 0;
        let closestDistance = distanceMeters(location.position, route.points[0]);
        
        for (let i = 1; i < route.points.length; i++) {
          const dist = distanceMeters(location.position, route.points[i]);
          if (dist < closestDistance) {
            closestDistance = dist;
            closestIndex = i;
          }
        }
        mockRoutePointIndexRef.current = closestIndex;
        mockRouteDistanceRef.current = 0;
      }
    }

    // Simulate movement: update position every 2 seconds (like real GPS)
    // Move at approximately 50 km/h (13.9 m/s) = ~28 meters per 2 seconds
    const SPEED_M_PER_SEC = 13.9; // ~50 km/h
    const UPDATE_INTERVAL_MS = 500; // Update every 500ms for smoother movement
    const DISTANCE_PER_UPDATE = (SPEED_M_PER_SEC * UPDATE_INTERVAL_MS) / 1000;

    mockTimerRef.current = setInterval(() => {
      if (!location) return;

      const {distanceMeters, bearing, pointAtDistanceAndBearing} = require('../utils/geo');
      let newPosition: LatLng | null = null;
      let newHeading: number | null = null;

      // If we have a route, follow it exactly
      if (route && route.points.length > 1) {
        let currentIndex = mockRoutePointIndexRef.current;
        let remainingDistance = DISTANCE_PER_UPDATE;
        
        // Check if we've reached the end of the route
        if (currentIndex >= route.points.length - 1) {
          // Reached destination, stay at end point
          newPosition = route.points[route.points.length - 1];
          // Use heading from last segment to destination
          if (route.points.length >= 2) {
            newHeading = bearing(
              route.points[route.points.length - 2],
              route.points[route.points.length - 1],
            );
          } else {
            newHeading = mockHeadingRef.current; // Fallback to last heading
          }
        } else {
          // Move along route segments - follow route exactly
          while (remainingDistance > 0 && currentIndex < route.points.length - 1) {
            const currentPoint = route.points[currentIndex];
            const nextPoint = route.points[currentIndex + 1];
            const segmentDistance = distanceMeters(currentPoint, nextPoint);
            const distanceOnSegment = mockRouteDistanceRef.current + remainingDistance;
            
            if (distanceOnSegment <= segmentDistance) {
              // Stay on current segment - calculate exact position along route
              mockRouteDistanceRef.current = distanceOnSegment;
              const ratio = distanceOnSegment / segmentDistance;
              newPosition = {
                lat: currentPoint.lat + (nextPoint.lat - currentPoint.lat) * ratio,
                lng: currentPoint.lng + (nextPoint.lng - currentPoint.lng) * ratio,
              };
              // Heading always matches route direction (from current position to next point)
              newHeading = bearing(newPosition, nextPoint);
              remainingDistance = 0;
            } else {
              // Move to next segment
              remainingDistance = distanceOnSegment - segmentDistance;
              mockRoutePointIndexRef.current = currentIndex + 1;
              mockRouteDistanceRef.current = 0;
              currentIndex = mockRoutePointIndexRef.current;
              
              // If we've reached the end, stop at destination
              if (currentIndex >= route.points.length - 1) {
                newPosition = route.points[route.points.length - 1];
                // Heading from previous point to destination
                newHeading = bearing(
                  route.points[route.points.length - 2],
                  route.points[route.points.length - 1],
                );
                remainingDistance = 0;
              } else {
                // Continue to next segment - position is at the waypoint
                newPosition = route.points[currentIndex];
                // Heading from current waypoint to next waypoint
                newHeading = bearing(
                  route.points[currentIndex],
                  route.points[currentIndex + 1],
                );
              }
            }
          }
        }
      } else {
        // No route - move in straight line (original behavior)
        if (!mockStartPositionRef.current) return;
        
        mockDistanceRef.current += DISTANCE_PER_UPDATE;
        newPosition = pointAtDistanceAndBearing(
          mockStartPositionRef.current,
          mockDistanceRef.current,
          mockHeadingRef.current,
        );
        
        // Gradually change heading to simulate turning (slight curve)
        mockHeadingRef.current = (mockHeadingRef.current + 0.5) % 360;
        newHeading = mockHeadingRef.current;
      }

      // Skip update if position/heading weren't set (shouldn't happen, but safety check)
      if (!newPosition || newHeading === null) {
        return;
      }

      // Create mock location update
      const mockLocation: LocationData = {
        position: newPosition,
        heading: newHeading,
        accuracy: 5,
        timestamp: Date.now(),
      };

      // Update heading ref for next iteration
      mockHeadingRef.current = newHeading;

      // Update location (this will trigger smooth interpolation)
      setLocation(mockLocation);
      targetPositionRef.current = newPosition;
      lastUpdateTimeRef.current = Date.now();

          // Initialize display position and animated values if not set
          if (!currentDisplayPositionRef.current || !animatedPositionRef.current) {
            currentDisplayPositionRef.current = newPosition;
            animatedPositionRef.current = newPosition;
            setDisplayPosition(newPosition);
            animatedLat.setValue(newPosition.lat);
            animatedLng.setValue(newPosition.lng);
          }
    }, UPDATE_INTERVAL_MS);

    return () => {
      if (mockTimerRef.current) {
        clearInterval(mockTimerRef.current);
        mockTimerRef.current = null;
      }
    };
  }, [mockMovementEnabled, location, route]);

  // Smooth position interpolation using Animated API for buttery smooth movement
  useEffect(() => {
    const target = targetPositionRef.current;
    const current = currentDisplayPositionRef.current || animatedPositionRef.current;
    
    // Only animate if we have both target and current position
    if (!target || !current) {
      // Initialize if we have target but no current
      if (target && !current) {
        animatedPositionRef.current = target;
        currentDisplayPositionRef.current = target;
        setDisplayPosition(target);
        animatedLat.setValue(target.lat);
        animatedLng.setValue(target.lng);
      }
      return;
    }

    // Calculate distance to target
    const {distanceMeters} = require('../utils/geo');
    const distance = distanceMeters(current, target);

    // If we're very close, snap to target immediately
    if (distance < 0.01) {
      animatedPositionRef.current = target;
      currentDisplayPositionRef.current = target;
      setDisplayPosition(target);
      animatedLat.setValue(target.lat);
      animatedLng.setValue(target.lng);
      return;
    }

    // Use Animated API for smooth interpolation with longer, smoother transitions
    // Calculate animation duration based on distance for natural movement feel
    const baseSpeed = 30; // meters per second - slower for smoother, more visible transitions
    const minDuration = 300; // Minimum 300ms for smooth feel
    const maxDuration = 1200; // Maximum 1200ms for very large jumps
    const duration = Math.min(
      Math.max((distance / baseSpeed) * 1000, minDuration),
      maxDuration,
    );

    // Stop any ongoing animations
    animatedLat.stopAnimation();
    animatedLng.stopAnimation();

    // Animate to target position with smooth, natural easing
    Animated.parallel([
      Animated.timing(animatedLat, {
        toValue: target.lat,
        duration: duration,
        useNativeDriver: false, // Can't use native driver for custom values
        easing: Easing.bezier(0.25, 0.1, 0.25, 1), // Smooth bezier curve for natural movement
      }),
      Animated.timing(animatedLng, {
        toValue: target.lng,
        duration: duration,
        useNativeDriver: false,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1), // Smooth bezier curve for natural movement
      }),
    ]).start(finished => {
      if (finished) {
        animatedPositionRef.current = target;
        currentDisplayPositionRef.current = target;
        setDisplayPosition(target);
      }
    });

    // Update current position ref
    currentDisplayPositionRef.current = current;
  }, [targetPositionRef.current?.lat, targetPositionRef.current?.lng, animatedLat, animatedLng]);

  // Listen to animated values and update display position smoothly
  useEffect(() => {
    let latValue = 0;
    let lngValue = 0;
    
    const latListener = animatedLat.addListener(({value: lat}) => {
      latValue = lat;
      const newPosition: LatLng = {lat: latValue, lng: lngValue};
      animatedPositionRef.current = newPosition;
      setDisplayPosition(newPosition);
    });

    const lngListener = animatedLng.addListener(({value: lng}) => {
      lngValue = lng;
      const newPosition: LatLng = {lat: latValue, lng: lngValue};
      animatedPositionRef.current = newPosition;
      setDisplayPosition(newPosition);
    });

    return () => {
      animatedLat.removeListener(latListener);
      animatedLng.removeListener(lngListener);
    };
  }, [animatedLat, animatedLng]); // Run once on mount, animation loop continues indefinitely

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
          // Initialize display position and target
          currentDisplayPositionRef.current = initialLocation.position;
          targetPositionRef.current = initialLocation.position;
          setDisplayPosition(initialLocation.position);
          lastUpdateTimeRef.current = Date.now();
        }
      } catch (err) {
        // Continue - watchPosition might still work
      }

      // Start watching for location updates
      startLocationUpdates((loc) => {
        if (mounted) {
          // Ignore real GPS updates when mock movement is enabled
          if (mockMovementEnabled) {
            return;
          }
          
          setError(null);
          setLocation(loc);
          
          // Set target position for smooth interpolation
          targetPositionRef.current = loc.position;
          lastUpdateTimeRef.current = Date.now();
          
          // Initialize display position and animated values if not set
          if (!currentDisplayPositionRef.current || !animatedPositionRef.current) {
            currentDisplayPositionRef.current = loc.position;
            animatedPositionRef.current = loc.position;
            setDisplayPosition(loc.position);
            animatedLat.setValue(loc.position.lat);
            animatedLng.setValue(loc.position.lng);
          }
          
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

  // Fetch roads only when user approaches edge of loaded area (with debouncing)
  useEffect(() => {
    if (!location || !displayPosition) {
      return;
    }

    const {distanceMeters} = require('../utils/geo');

    // Check if we need to fetch new roads
    // Roads are fetched with radius viewRadius * 1.5, so the loaded area extends 1.5 * viewRadius from fetch center
    // We should fetch when user approaches within 0.3 * viewRadius of the edge of loaded area
    // That means when distance from fetch center > (1.5 - 0.3) * viewRadius = 1.2 * viewRadius
    const fetchRadius = viewRadius * 1.5;
    const edgeThreshold = viewRadius * 0.3; // Fetch when within 30% of viewRadius from edge
    const fetchTriggerDistance = fetchRadius - edgeThreshold; // 1.2 * viewRadius
    
    const shouldFetchRoads = !roadsFetchCenter || 
      (roadsFetchCenter && 
        distanceMeters(displayPosition, roadsFetchCenter) > fetchTriggerDistance);

    if (!shouldFetchRoads) {
      return;
    }

    const isInitialFetch = !roadsFetchCenter;
    
    const fetchRoads = async () => {
      if (isFetchingRoadsRef.current || !mountedRef.current) {
        return;
      }

      // Capture the position where we're fetching roads (may differ from current displayPosition due to debounce)
      const fetchPosition = displayPosition;

      // Double-check distance hasn't changed significantly (for debounced fetches)
      if (!isInitialFetch && roadsFetchCenter && 
          distanceMeters(fetchPosition, roadsFetchCenter) <= fetchTriggerDistance * 0.9) {
        return;
      }

      isFetchingRoadsRef.current = true;

      try {
        const fetchedRoads = await fetchNearbyRoads(
          fetchPosition.lat,
          fetchPosition.lng,
          fetchRadius,
        );
        if (!mountedRef.current) {
          return;
        }
        
        if (fetchedRoads.length === 0) {
          return;
        }
        
        requestAnimationFrame(() => {
          if (mountedRef.current) {
            setRoadsFetchCenter(fetchPosition);
            
            setRoads(prevRoads => {
              const combined = [...prevRoads, ...fetchedRoads];
              const roadMap = new Map<string, RoadSegment>();
              
              combined.forEach(road => {
                if (road.points && road.points.length > 0) {
                  // Use first point as key for deduplication
                  const firstPoint = road.points[0];
                  const key = `${firstPoint.lat.toFixed(6)},${firstPoint.lng.toFixed(6)}`;
                  
                  // Keep the first occurrence (existing roads take precedence)
                  if (!roadMap.has(key)) {
                    roadMap.set(key, road);
                  }
                }
              });
              
              return Array.from(roadMap.values());
            });
          }
        });
      } catch (err) {
        console.error('[HudScreen] Error fetching roads:', err);
      } finally {
        isFetchingRoadsRef.current = false;
        roadsFetchTimerRef.current = null;
      }
    };

    if (isInitialFetch) {
      // Initial fetch - execute immediately
      fetchRoads();
    } else {
      // Subsequent fetches - debounce to prevent excessive requests
      // Clear any pending fetch timer
      if (roadsFetchTimerRef.current) {
        clearTimeout(roadsFetchTimerRef.current);
        roadsFetchTimerRef.current = null;
      }

      // Debounce road fetching to prevent excessive requests
      // Wait 2 seconds after position stops changing before fetching
      roadsFetchTimerRef.current = setTimeout(fetchRoads, 2000);
    }

    return () => {
      if (roadsFetchTimerRef.current) {
        clearTimeout(roadsFetchTimerRef.current);
        roadsFetchTimerRef.current = null;
      }
    };
  }, [displayPosition?.lat, displayPosition?.lng, viewRadius, roadsFetchCenter]);

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

  // Pre-fetch roads along the route
  useEffect(() => {
    if (!route || !route.points || route.points.length === 0) {
      routeRoadsFetchedRef.current.clear();
      return;
    }

    let mounted = true;
    const {distanceMeters} = require('../utils/geo');
    const fetchRadius = viewRadius * 1.5;
    const fetchInterval = fetchRadius * 0.8;

    const prefetchRoadsAlongRoute = async () => {
      if (isFetchingRoadsRef.current) {
        return;
      }

      const newRoads: RoadSegment[] = [];
      const fetchedKeys = new Set<string>();

      for (let i = 0; i < route.points.length; i += Math.max(1, Math.floor(route.points.length / 20))) {
        if (!mounted) break;

        const point = route.points[i];
        const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;

        if (routeRoadsFetchedRef.current.has(key)) {
          continue;
        }

        let alreadyFetched = false;
        for (const fetchedKey of routeRoadsFetchedRef.current) {
          const [latStr, lngStr] = fetchedKey.split(',');
          const fetchedPoint = {lat: parseFloat(latStr), lng: parseFloat(lngStr)};
          if (distanceMeters(point, fetchedPoint) < fetchInterval) {
            alreadyFetched = true;
            break;
          }
        }

        if (alreadyFetched) {
          continue;
        }

        try {
          const fetchedRoads = await fetchNearbyRoads(point.lat, point.lng, fetchRadius);
          newRoads.push(...fetchedRoads);
          fetchedKeys.add(key);
          
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.error(`[HudScreen] Error pre-fetching roads at route point ${i}:`, err);
        }
      }

      if (mounted && newRoads.length > 0) {
        // Use requestAnimationFrame to ensure state updates are batched
        requestAnimationFrame(() => {
          if (!mounted) return;

          setRoads(prevRoads => {
            const combined = [...prevRoads, ...newRoads];
            const roadMap = new Map<string, RoadSegment>();
            combined.forEach(road => {
              if (road.points.length > 0) {
                const firstPoint = road.points[0];
                const key = `${firstPoint.lat.toFixed(6)},${firstPoint.lng.toFixed(6)}`;
                if (!roadMap.has(key)) {
                  roadMap.set(key, road);
                }
              }
            });
            return Array.from(roadMap.values());
          });

          // Set fetch center if not already set
          if (!roadsFetchCenter) {
            if (displayPosition) {
              setRoadsFetchCenter(displayPosition);
            } else if (route.points.length > 0) {
              setRoadsFetchCenter(route.points[0]);
            } else if (newRoads.length > 0 && newRoads[0].points.length > 0) {
              setRoadsFetchCenter(newRoads[0].points[0]);
            }
          }

          fetchedKeys.forEach(key => routeRoadsFetchedRef.current.add(key));
        });
      }
    };

    const timeoutId = setTimeout(() => {
      prefetchRoadsAlongRoute();
    }, 500);

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [route, viewRadius]);

  // Real-time smooth rotation using requestAnimationFrame (compass-like behavior)
  useEffect(() => {
    if (!location) {
      return;
    }

    // Update target heading
    let targetHeading = location.heading;
    targetHeading = ((targetHeading % 360) + 360) % 360;
    targetHeadingRef.current = targetHeading;

    // Initialize current rotation if needed
    if (currentRotationRef.current === 0 && targetHeading !== 0) {
      currentRotationRef.current = targetHeading;
    }

    // Smooth interpolation loop using requestAnimationFrame
    const animate = () => {
      const current = currentRotationRef.current;
      const target = targetHeadingRef.current;
      
      // Calculate shortest angular distance
      let diff = target - current;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      
      // Smooth interpolation factor (higher = faster, lower = smoother)
      // Increased for more responsive rotation
      const interpolationFactor = 0.4; // Higher factor for faster, more immediate rotation
      
      // Only update if there's a meaningful difference
      if (Math.abs(diff) > 0.01) {
        currentRotationRef.current = current + diff * interpolationFactor;
        
        // Normalize to 0-360
        let normalized = currentRotationRef.current;
        normalized = ((normalized % 360) + 360) % 360;
        if (normalized > 180) normalized -= 360;
        
        setDisplayRotation(-normalized); // Negative for heading-up map
        
        rotationAnimationFrameRef.current = requestAnimationFrame(animate);
      } else {
        // Close enough - snap to target
        currentRotationRef.current = target;
        let normalized = target;
        if (normalized > 180) normalized -= 360;
        setDisplayRotation(-normalized);
        rotationAnimationFrameRef.current = null;
      }
    };

    // Start animation loop if not already running
    if (rotationAnimationFrameRef.current === null) {
      rotationAnimationFrameRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (rotationAnimationFrameRef.current !== null) {
        cancelAnimationFrame(rotationAnimationFrameRef.current);
        rotationAnimationFrameRef.current = null;
      }
    };
  }, [location?.heading]);

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

  const roadPaths = useMemo(() => {
    if (roads.length === 0) {
      return [];
    }

    // Always use roadsFetchCenter if available, otherwise fallback
    // This ensures roads are calculated relative to the same center used for translation
    const fetchCenter = roadsFetchCenter || displayPosition || 
      (roads.length > 0 && roads[0].points && roads[0].points.length > 0 ? roads[0].points[0] : null);
    
    if (!fetchCenter) {
      return [];
    }

    const visualCenterX = HUD_RADIUS;
    const visualCenterY = HUD_RADIUS;

    const paths = roads.map((road, index) => {
      if (!road.points || road.points.length === 0) {
        return null;
      }
      
      const path = Skia.Path.Make();
      let isFirst = true;
      let hasPoints = false;
      let lastX = 0;
      let lastY = 0;
      let pointCount = 0;
      const minDistancePixels = 2;
      
      road.points.forEach(point => {
        const local = projectToLocalMeters(point, fetchCenter as LatLng);
        const x = visualCenterX + local.x * pixelsPerMeter;
        const y = visualCenterY + local.y * pixelsPerMeter;

        if (!isFinite(x) || !isFinite(y)) {
          return;
        }

        if (hasPoints) {
          const dx = x - lastX;
          const dy = y - lastY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDistancePixels) {
            return;
          }
        }

        if (isFirst) {
          path.moveTo(x, y);
          isFirst = false;
          hasPoints = true;
          pointCount = 1;
        } else {
          path.lineTo(x, y);
          pointCount++;
        }
        
        lastX = x;
        lastY = y;
      });

      if (!hasPoints || pointCount < 2) {
        return null;
      }

      const roadStyle = getRoadStyle(road.type);

      return {
        path,
        style: roadStyle,
        key: `road-${index}`,
      };
    }).filter(p => p !== null);
    
    return paths;
  }, [roads, roadsFetchCenter, displayPosition, pixelsPerMeter, getRoadStyle]);

  const renderRoads = useCallback(() => {
    if (roadPaths.length === 0) {
      return null;
    }

    return roadPaths.map(({path, style, key}) => (
      <Path
        key={key}
        path={path}
        color={theme.roadColor}
        style="stroke"
        strokeWidth={style.width}
        strokeJoin="round"
        strokeCap="round"
      />
    ));
  }, [roadPaths, theme.roadColor]);

  // Calculate route path once - cache it and only recalculate when route changes or position moves significantly
  const routePath = useMemo(() => {
    if (!route || !route.points || route.points.length === 0) {
      routeRenderCenterRef.current = null;
      cachedRoutePathRef.current = null;
      return null;
    }

    if (!displayPosition) {
      return cachedRoutePathRef.current;
    }

    // Check if we need to recalculate (route changed or position moved significantly)
    const {distanceMeters} = require('../utils/geo');
    const shouldRecalculate = !cachedRoutePathRef.current || 
      !routeRenderCenterRef.current ||
      (routeRenderCenterRef.current &&
        distanceMeters(displayPosition, routeRenderCenterRef.current) > viewRadius * 0.3); // Recalculate when 30% from center

    if (!shouldRecalculate && cachedRoutePathRef.current) {
      // Use cached path - will apply translation transform in renderRoute
      return cachedRoutePathRef.current;
    }

    // Recalculate route path relative to current display position
    const path = Skia.Path.Make();
    let isFirst = true;
    const visualCenterX = HUD_RADIUS;
    const visualCenterY = HUD_RADIUS;

    route.points.forEach((point) => {
      // Project each route point to local meters relative to display position
      const local = projectToLocalMeters(point, displayPosition);
      const x = visualCenterX + local.x * pixelsPerMeter;
      const y = visualCenterY + local.y * pixelsPerMeter;

      // Skip points that are way outside the view (optional optimization)
      const distanceFromCenter = Math.sqrt(
        Math.pow(x - visualCenterX, 2) + Math.pow(y - visualCenterY, 2),
      );
      if (distanceFromCenter > HUD_RADIUS * 1.5) {
        return;
      }

      if (isFirst) {
        path.moveTo(x, y);
        isFirst = false;
      } else {
        path.lineTo(x, y);
      }
    });

    // Cache the path and update render center
    cachedRoutePathRef.current = path;
    routeRenderCenterRef.current = displayPosition;

    return path;
  }, [route, pixelsPerMeter, viewRadius, displayPosition?.lat, displayPosition?.lng]);

  // Render route as a thick highlighted path (no rotation - handled by Animated.View)
  const renderRoute = useCallback(() => {
    if (!routePath) {
      return null;
    }

    // Apply translation if position has moved from render center
    if (!displayPosition || !routeRenderCenterRef.current) {
      return (
        <Path
          path={routePath}
          color={theme.routeColor}
          style="stroke"
          strokeWidth={theme.routeStrokeWidth}
          strokeJoin="round"
          strokeCap="round"
        />
      );
    }

    const {projectToLocalMeters} = require('../utils/geo');
    const offset = projectToLocalMeters(
      routeRenderCenterRef.current,
      displayPosition,
    );
    const translateX = offset.x * pixelsPerMeter;
    const translateY = offset.y * pixelsPerMeter;

    // If offset is very small, don't apply transform
    if (Math.abs(translateX) < 0.1 && Math.abs(translateY) < 0.1) {
      return (
        <Path
          path={routePath}
          color={theme.routeColor}
          style="stroke"
          strokeWidth={theme.routeStrokeWidth}
          strokeJoin="round"
          strokeCap="round"
        />
      );
    }

    return (
      <Group transform={[{translateX}, {translateY}]}>
        <Path
          path={routePath}
          color={theme.routeColor}
          style="stroke"
          strokeWidth={theme.routeStrokeWidth}
          strokeJoin="round"
          strokeCap="round"
        />
      </Group>
    );
  }, [routePath, displayPosition, pixelsPerMeter, theme.routeColor, theme.routeStrokeWidth]);

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

  // Render destination marker - orange dot with pulsing border
  // Shows on border when destination is off-screen
  const renderDestinationMarker = useCallback(() => {
    if (!displayPosition) {
      return null;
    }

    // Get destination coordinates
    let destination: LatLng | null = null;
    
    if (route && route.points.length > 0) {
      // Use last point of route as destination
      destination = route.points[route.points.length - 1];
    } else if (lastDestinationRef.current) {
      // Use stored destination
      destination = lastDestinationRef.current;
    } else if (destinationProp) {
      // Use prop destination
      destination = destinationProp;
    }

    if (!destination) {
      return null;
    }

    // Project destination to screen coordinates
    const visualCenterX = HUD_RADIUS;
    const visualCenterY = HUD_RADIUS;
    const local = projectToLocalMeters(destination, displayPosition);
    let x = visualCenterX + local.x * pixelsPerMeter;
    let y = visualCenterY + local.y * pixelsPerMeter;

    // Calculate distance from center
    const dx = x - visualCenterX;
    const dy = y - visualCenterY;
    const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);

    // Check if destination is outside visible area
    const visibleRadius = HUD_RADIUS - theme.hudBorderWidth;
    const isOffScreen = distanceFromCenter > visibleRadius;

    // If off-screen, position marker at the bottom of the border (below compass arrow)
    if (isOffScreen) {
      // Position at bottom of border (angle = 90 degrees or π/2 radians)
      x = visualCenterX;
      y = visualCenterY + visibleRadius;
    }

    // Destination marker sizes
    const dotRadius = 8;
    const pulseRadius = dotRadius * pulseScale;
    const pulseBorderWidth = 2.5;

    return (
      <Group>
        {/* Pulsing border circle - animates with small opacity */}
        <Circle
          cx={x}
          cy={y}
          r={pulseRadius}
          color="#FF8C00" // Orange color
          opacity={pulseOpacity}
          style="stroke"
          strokeWidth={pulseBorderWidth}
        />
        {/* Solid orange dot */}
        <Circle
          cx={x}
          cy={y}
          r={dotRadius}
          color="#FF8C00" // Orange color
          opacity={1}
          style="fill"
        />
        {/* Dot border */}
        <Circle
          cx={x}
          cy={y}
          r={dotRadius}
          color="#FF6600" // Darker orange for border
          opacity={1}
          style="stroke"
          strokeWidth={1.5}
        />
      </Group>
    );
  }, [displayPosition, route, destinationProp, pixelsPerMeter, pulseScale, pulseOpacity, theme.hudBorderWidth]);

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
        <View style={styles.topButtonsRow}>
          <TouchableOpacity
            style={styles.urlButton}
            onPress={() => setShowUrlInput(!showUrlInput)}>
            <Text style={styles.urlButtonText}>
              {showUrlInput ? 'Cancel' : 'Add Route'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.urlButton,
              mockMovementEnabled && styles.mockButtonActive,
            ]}
            onPress={() => {
              setMockMovementEnabled(!mockMovementEnabled);
              // Reset mock state when disabling
              if (mockMovementEnabled) {
                mockStartPositionRef.current = null;
                mockDistanceRef.current = 0;
                mockRoutePointIndexRef.current = 0;
                mockRouteDistanceRef.current = 0;
              }
            }}>
            <Text style={styles.urlButtonText}>
              {mockMovementEnabled ? 'Stop Mock' : 'Mock Move'}
            </Text>
          </TouchableOpacity>
        </View>

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
        {...panResponder.panHandlers}
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
            <View
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
                    {(() => {
                      const roadsToRender = renderRoads();
                      if (!roadsToRender) {
                        return null;
                      }

                      if (!displayPosition || !roadsFetchCenter) {
                        return roadsToRender;
                      }

                      const {projectToLocalMeters} = require('../utils/geo');
                      const offset = projectToLocalMeters(
                        roadsFetchCenter,
                        displayPosition,
                      );
                      const translateX = offset.x * pixelsPerMeter;
                      const translateY = offset.y * pixelsPerMeter;

                      if (Math.abs(translateX) < 0.1 && Math.abs(translateY) < 0.1) {
                        return roadsToRender;
                      }

                      return (
                        <Group transform={[{translateX}, {translateY}]}>
                          {roadsToRender}
                        </Group>
                      );
                    })()}
                    {/* Route is recalculated on every position change for accurate positioning */}
                    {renderRoute()}
                    {/* Destination marker is calculated relative to displayPosition, no translation needed */}
                    {renderDestinationMarker()}
                  </Group>
                </Group>
              </Canvas>
            </View>
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
  topButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    justifyContent: 'center',
    marginTop: 20,
  },
  urlButton: {
    backgroundColor: '#333333',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  mockButtonActive: {
    backgroundColor: '#00AA00',
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
