/**
 * Main App component
 */

import React, {useEffect, useState} from 'react';
import {SafeAreaView, StyleSheet} from 'react-native';
import HudScreen from './src/screens/HudScreen';
import {setupUrlHandler} from './src/utils/urlHandler';
import {LatLng} from './src/models/types';

function App(): React.JSX.Element {
  const [destination, setDestination] = useState<LatLng | undefined>();

  useEffect(() => {
    // Set up URL handler for deep linking and share extension
    const cleanup = setupUrlHandler((dest: LatLng) => {
      console.log('Destination received from URL:', dest);
      setDestination(dest);
    });

    return cleanup;
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <HudScreen destination={destination} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
});

export default App;

