/**
 * Kalman filter for 2D position estimation (latitude/longitude)
 * Smooths noisy GPS position updates
 */

export interface Position {
  lat: number;
  lng: number;
}

export class PositionKalmanFilter {
  private lat: number; // Current estimated latitude
  private lng: number; // Current estimated longitude
  private latUncertainty: number; // Latitude uncertainty (covariance)
  private lngUncertainty: number; // Longitude uncertainty (covariance)
  private processNoise: number; // Process noise (how much we expect position to change)
  private measurementNoise: number; // Measurement noise (GPS accuracy)

  constructor(
    initialPosition: Position,
    initialUncertainty: number = 0.0001, // ~11 meters in degrees
    processNoise: number = 0.00001, // Small process noise (position changes slowly)
    measurementNoise: number = 0.00005, // GPS measurement noise (~5.5 meters)
  ) {
    this.lat = initialPosition.lat;
    this.lng = initialPosition.lng;
    this.latUncertainty = initialUncertainty;
    this.lngUncertainty = initialUncertainty;
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
  }

  /**
   * Predict step - estimates position based on previous state
   * @param deltaTime Time elapsed since last update (in seconds)
   * @param velocity Optional velocity estimate (lat/lng per second)
   */
  predict(deltaTime: number = 0, velocity?: {lat: number; lng: number}): void {
    // If we have velocity, use it for prediction
    if (velocity) {
      this.lat += velocity.lat * deltaTime;
      this.lng += velocity.lng * deltaTime;
    }
    // Position doesn't change on its own, but uncertainty increases over time
    this.latUncertainty += this.processNoise * deltaTime;
    this.lngUncertainty += this.processNoise * deltaTime;
    
    // Cap uncertainty to prevent it from growing too large
    this.latUncertainty = Math.min(this.latUncertainty, 0.001);
    this.lngUncertainty = Math.min(this.lngUncertainty, 0.001);
  }

  /**
   * Update step - incorporates new GPS measurement
   * @param measurement New position measurement
   * @param measurementNoise Optional measurement noise override
   */
  update(
    measurement: Position,
    measurementNoise?: number,
  ): Position {
    const noise = measurementNoise ?? this.measurementNoise;

    // Calculate distance from current estimate to measurement
    const latDiff = measurement.lat - this.lat;
    const lngDiff = measurement.lng - this.lng;
    const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);

    // Kalman gain for latitude
    const latGain = this.latUncertainty / (this.latUncertainty + noise);
    
    // Kalman gain for longitude
    const lngGain = this.lngUncertainty / (this.lngUncertainty + noise);

    // Increase gain for larger changes to be more responsive to significant movements
    // This helps when actually driving (large movements) while filtering noise when stationary
    let adaptiveLatGain = latGain;
    let adaptiveLngGain = lngGain;
    
    if (distance > 0.0001) {
      // For significant movements (>~11 meters), use higher gain (more responsive)
      const adaptiveFactor = Math.min(1.5, 1.0 + distance * 1000);
      adaptiveLatGain = Math.min(0.9, latGain * adaptiveFactor);
      adaptiveLngGain = Math.min(0.9, lngGain * adaptiveFactor);
    }

    // Update estimates
    this.lat += adaptiveLatGain * latDiff;
    this.lng += adaptiveLngGain * lngDiff;

    // Update uncertainties
    this.latUncertainty = (1 - adaptiveLatGain) * this.latUncertainty;
    this.lngUncertainty = (1 - adaptiveLngGain) * this.lngUncertainty;

    return {lat: this.lat, lng: this.lng};
  }

  /**
   * Get current filtered position estimate
   */
  getPosition(): Position {
    return {lat: this.lat, lng: this.lng};
  }

  /**
   * Reset filter with new position (useful when GPS jumps significantly)
   */
  reset(position: Position): void {
    this.lat = position.lat;
    this.lng = position.lng;
    this.latUncertainty = 0.0001;
    this.lngUncertainty = 0.0001;
  }
}

