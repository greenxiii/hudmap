/**
 * NFS (Need for Speed) theme
 * Dark, high-contrast racing game style
 */

import {Theme} from './types';

export const nfsTheme: Theme = {
  // Route styling
  routeColor: '#2a64a4',
  routeStrokeWidth: 10,

  // Road styling
  roadColor: '#949493',
  roadStrokeWidth: 10,

  // Player marker styling
  playerMarkerColor: '#31ce30',
  playerMarkerBorderColor: '#000000',
  playerMarkerBorderWidth: 2,
  playerMarkerSize: 13,

  // HUD container styling
  hudBorderColor: '#4a4f50',
  hudBorderWidth: 20,

  // North arrow styling
  northArrowColor: '#50381f',
  northArrowBorderColor: '#97632f',
  northArrowBorderWidth: 2,
  northArrowSize: 18,
  northArrowBaseDistance: (hudRadius: number) => hudRadius - 19,

  // Background color
  backgroundColor: '#272b27',
};

