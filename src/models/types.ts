/**
 * Core data types for the HUD navigation app
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface RoadSegment {
  points: LatLng[];
  type?: string; // highway type from OSM
}

export interface Route {
  points: LatLng[];
  maneuvers: Maneuver[];
  totalDistance: number; // meters
}

export interface Maneuver {
  type: 'turn' | 'straight' | 'arrive' | 'depart';
  instruction: string;
  distance: number; // meters to this maneuver
  bearing?: number; // degrees, 0-360
}

export interface LocationData {
  position: LatLng;
  heading: number; // degrees, 0-360, where 0 is north
  accuracy: number; // meters
  timestamp: number;
}

export interface OverpassWay {
  type: 'way';
  id: number;
  nodes: number[];
  geometry?: Array<{lat: number; lon: number}>;
  tags?: {
    highway?: string;
    [key: string]: string | undefined;
  };
}

export interface OverpassResponse {
  elements: OverpassWay[];
}

