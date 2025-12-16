/**
 * Theme type definitions
 */

export interface Theme {
  // Route styling
  routeColor: string;
  routeStrokeWidth: number;

  // Road styling
  roadColor: string;
  roadStrokeWidth: number;

  // Player marker styling
  playerMarkerColor: string;
  playerMarkerBorderColor: string;
  playerMarkerBorderWidth: number;
  playerMarkerSize: number;

  // HUD container styling
  hudBorderColor: string;
  hudBorderWidth: number;

  // North arrow styling
  northArrowColor: string;
  northArrowBorderColor: string;
  northArrowBorderWidth: number;
  northArrowSize: number;
  northArrowBaseDistance: (hudRadius: number) => number; // Function to calculate based on HUD radius

  // Background color
  backgroundColor: string;
}

