import Foundation
import CoreLocation
import React

@objc(HeadingModule)
class HeadingModule: RCTEventEmitter, CLLocationManagerDelegate {
  private let locationManager = CLLocationManager()
  private var hasListeners = false

  override init() {
    super.init()
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.headingFilter = 1 // degrees
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return true
  }

  @objc func start() {
    DispatchQueue.main.async {
      print("HeadingModule: start() called, hasListeners: \(self.hasListeners)")
      guard CLLocationManager.headingAvailable() else {
        print("HeadingModule: Heading not available on this device")
        return
      }
      
      let status = CLLocationManager.authorizationStatus()
      print("HeadingModule: Authorization status: \(status.rawValue)")
      if status == .notDetermined {
        print("HeadingModule: Requesting authorization...")
        self.locationManager.requestWhenInUseAuthorization()
      } else if status == .authorizedWhenInUse || status == .authorizedAlways {
        print("HeadingModule: Starting heading updates...")
        self.locationManager.startUpdatingHeading()
        print("HeadingModule: Started updating heading")
      } else {
        print("HeadingModule: Location authorization not granted: \(status.rawValue)")
      }
    }
  }

  @objc func stop() {
    DispatchQueue.main.async {
      self.locationManager.stopUpdatingHeading()
    }
  }

  // MARK: - Events

  override func supportedEvents() -> [String]! {
    return ["HeadingUpdate"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager,
                       didUpdateHeading newHeading: CLHeading) {
    guard hasListeners else {
      print("HeadingModule: hasListeners is false, ignoring heading update")
      return
    }

    // Prefer trueHeading if available, else magneticHeading
    let heading = newHeading.trueHeading >= 0
      ? newHeading.trueHeading
      : newHeading.magneticHeading

    print("HeadingModule: Sending heading update: \(heading)°")
    sendEvent(withName: "HeadingUpdate", body: ["heading": heading])
  }
  
  func locationManager(_ manager: CLLocationManager,
                       didChangeAuthorization status: CLAuthorizationStatus) {
    if status == .authorizedWhenInUse || status == .authorizedAlways {
      if hasListeners {
        manager.startUpdatingHeading()
        print("HeadingModule: Started updating heading after authorization")
      }
    }
  }
  
  func locationManager(_ manager: CLLocationManager,
                       didFailWithError error: Error) {
    print("HeadingModule: Location manager error: \(error.localizedDescription)")
  }
}