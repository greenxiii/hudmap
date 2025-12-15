/**
 * URL handler for receiving shared URLs from other apps
 * Supports both Share Extension and URL scheme approaches
 */

import {Linking} from 'react-native';
import {extractDestinationFromUrl} from '../services/routing';
import {LatLng} from '../models/types';

/**
 * Initialize URL listener for deep linking
 * Call this in App.tsx or a navigation setup
 * @param callback Called when a URL is received
 */
export function setupUrlHandler(
  callback: (destination: LatLng) => void,
): () => void {
  // Handle initial URL if app was opened via URL
  Linking.getInitialURL().then((url) => {
    if (url) {
      handleUrl(url, callback);
    }
  });

  // Listen for URLs while app is running
  const subscription = Linking.addEventListener('url', (event) => {
    handleUrl(event.url, callback);
  });

  return () => {
    subscription.remove();
  };
}

/**
 * Handle a received URL
 */
function handleUrl(
  url: string,
  callback: (destination: LatLng) => void,
): void {
  console.log('Received URL:', url);

  try {
    const urlObj = new URL(url);
    
    // Handle hudmap://import?url=... format
    if (urlObj.protocol === 'hudmap:' && urlObj.searchParams.has('url')) {
      const sharedUrl = urlObj.searchParams.get('url');
      if (sharedUrl) {
        // Decode and extract destination from the shared URL (async)
        extractDestinationFromUrl(sharedUrl).then(destination => {
          if (destination) {
            callback(destination);
          }
        }).catch(console.error);
        return;
      }
    }
    
    // Try to extract destination directly from the URL (async)
    extractDestinationFromUrl(url).then(destination => {
      if (destination) {
        callback(destination);
      } else {
        console.warn('Could not extract destination from URL:', url);
      }
    }).catch(error => {
      console.error('Error parsing URL:', error);
    });
  } catch (error) {
    console.error('Error parsing URL:', error);
    // Fallback: try to extract directly (async)
    extractDestinationFromUrl(url).then(destination => {
      if (destination) {
        callback(destination);
      }
    }).catch(console.error);
  }
}

