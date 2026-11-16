import AVFoundation
import CoreLocation
import Foundation

/// GPS trip: route + miles while driving, and "stops" where you stayed ≥ 5 minutes (site visits).
/// Keeps running with the phone locked (background location, blue pill in the status bar).
final class TripTracker: NSObject, CLLocationManagerDelegate {
    static let shared = TripTracker()
    var onChange: (([String: Any]) -> Void)?

    private let manager = CLLocationManager()
    private(set) var startedAt: Date?
    private var points: [CLLocation] = []
    private var meters: CLLocationDistance = 0
    private var stops: [(loc: CLLocation, arrived: Date, left: Date)] = []
    private var anchor: CLLocation?      // where we might be stopped
    private var anchorSince: Date?
    private var pendingStart = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 20
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
        restore()
    }

    var running: Bool { startedAt != nil }
    var miles: Double { meters / 1609.344 }

    func start() {
        guard !running else { return emit() }
        switch manager.authorizationStatus {
        case .notDetermined: pendingStart = true; manager.requestWhenInUseAuthorization(); return
        case .denied, .restricted: onChange?(["type": "gps", "error": "Location is off for Abaya. Turn it on in Settings → Abaya → Location."]); return
        default: break
        }
        startedAt = Date(); points = []; meters = 0; stops = []; anchor = nil; anchorSince = nil
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        save(); emit()
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        if pendingStart, m.authorizationStatus == .authorizedWhenInUse || m.authorizationStatus == .authorizedAlways { pendingStart = false; start() }
        else if pendingStart, m.authorizationStatus == .denied { pendingStart = false; start() }
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard running else { return }
        for l in locs where l.horizontalAccuracy >= 0 && l.horizontalAccuracy <= 50 {
            if let last = points.last {
                let d = l.distance(from: last)
                if d < 2000 || l.timestamp.timeIntervalSince(last.timestamp) > 60 { meters += d } // drop GPS jumps
            }
            points.append(l)
            // stop detection: stayed within 120 m for 5+ minutes
            if let a = anchor, l.distance(from: a) < 120 {
                if let s = anchorSince, l.timestamp.timeIntervalSince(s) >= 300 {
                    if let i = stops.indices.last, stops[i].loc.distance(from: a) < 120, l.timestamp.timeIntervalSince(stops[i].left) < 600 { stops[i].left = l.timestamp }
                    else { stops.append((loc: a, arrived: s, left: l.timestamp)) }
                }
            } else { anchor = l; anchorSince = l.timestamp }
        }
        save(); emit()
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {}

    /// Stops tracking; returns the trip (stop addresses looked up) through onChange as type "gps-done".
    func stop() {
        guard let started = startedAt else { return emit() }
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        // a final stop where we ended up, if we've been there a while
        if let a = anchor, let s = anchorSince, Date().timeIntervalSince(s) >= 300, !(stops.last.map { $0.loc.distance(from: a) < 120 } ?? false) {
            stops.append((loc: a, arrived: s, left: Date()))
        }
        let ended = Date(), total = miles, route = simplified(), found = stops
        startedAt = nil; save()
        Task {
            var out: [[String: Any]] = []
            let geo = CLGeocoder()
            for s in found {
                let p = try? await geo.reverseGeocodeLocation(s.loc).first
                let address = [p?.subThoroughfare.map { "\($0) " + (p?.thoroughfare ?? "") } ?? p?.thoroughfare, p?.locality].compactMap { $0 }.joined(separator: ", ")
                out.append(["lat": s.loc.coordinate.latitude, "lng": s.loc.coordinate.longitude, "address": address,
                            "arrived": iso(s.arrived), "left": iso(s.left)])
            }
            let msg: [String: Any] = ["type": "gps-done", "started": iso(started), "ended": iso(ended), "miles": (total * 100).rounded() / 100, "stops": out, "route": route]
            await MainActor.run { self.onChange?(msg) }
        }
    }

    func emit() {
        onChange?(["type": "gps", "on": running, "miles": (miles * 10).rounded() / 10, "since": startedAt.map { iso($0) as Any } ?? NSNull()])
    }

    private func simplified() -> [[Double]] {
        var out: [[Double]] = []; var last: CLLocation?
        for p in points where last == nil || p.distance(from: last!) > 150 { out.append([p.coordinate.latitude, p.coordinate.longitude, p.timestamp.timeIntervalSince1970.rounded()]); last = p }
        return Array(out.suffix(2000))
    }

    // survive the app being closed by iOS mid-trip
    private func save() {
        let d = UserDefaults.standard
        d.set(startedAt, forKey: "trip.started"); d.set(meters, forKey: "trip.meters")
    }
    private func restore() {
        let d = UserDefaults.standard
        if let s = d.object(forKey: "trip.started") as? Date {
            startedAt = s; meters = d.double(forKey: "trip.meters")
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            manager.startUpdatingLocation()
        }
    }
}

/// Records a conversation (keeps recording with the screen locked), then uploads it to a signed URL the portal provides.
final class Recorder: NSObject, AVAudioRecorderDelegate {
    static let shared = Recorder()
    var onChange: (([String: Any]) -> Void)?
    private var recorder: AVAudioRecorder?
    private var file: URL?
    private(set) var startedAt: Date?

    func start(purpose: String) {
        if recorder?.isRecording == true { return emit() }
        AVAudioApplication.requestRecordPermission { ok in
            DispatchQueue.main.async {
                guard ok else { self.onChange?(["type": "record", "error": "Microphone is off for Abaya. Turn it on in Settings → Abaya → Microphone."]); return }
                do {
                    let s = AVAudioSession.sharedInstance()
                    try s.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetooth])
                    try s.setActive(true)
                    let url = FileManager.default.temporaryDirectory.appendingPathComponent("rec-\(UUID().uuidString).m4a")
                    let r = try AVAudioRecorder(url: url, settings: [
                        AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 22050, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 24000,
                    ])
                    r.delegate = self
                    guard r.record() else { throw NSError(domain: "Abaya", code: 1, userInfo: [NSLocalizedDescriptionKey: "Couldn't start recording."]) }
                    self.recorder = r; self.file = url; self.startedAt = Date(); self.purpose = purpose
                    self.emit()
                } catch { self.onChange?(["type": "record", "error": error.localizedDescription]) }
            }
        }
    }
    private var purpose = "conversation"

    /// Stop; if uploadUrl is given, PUT the audio there and report "record-done".
    func stop(uploadUrl: String?, path: String?) {
        guard let r = recorder, let url = file else { return emit() }
        let seconds = Int(r.currentTime.rounded())
        r.stop(); recorder = nil; startedAt = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        emit()
        guard let uploadUrl, let target = URL(string: uploadUrl) else { try? FileManager.default.removeItem(at: url); return }
        var req = URLRequest(url: target)
        req.httpMethod = "PUT"
        req.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        req.setValue("true", forHTTPHeaderField: "x-upsert")
        let task = URLSession.shared.uploadTask(with: req, fromFile: url) { _, resp, err in
            let ok = err == nil && ((resp as? HTTPURLResponse)?.statusCode ?? 500) < 300
            try? FileManager.default.removeItem(at: url)
            DispatchQueue.main.async {
                self.onChange?(["type": "record-done", "ok": ok, "path": path ?? "", "seconds": seconds, "purpose": self.purpose,
                                "error": ok ? NSNull() as Any : (err?.localizedDescription ?? "Upload failed (\((resp as? HTTPURLResponse)?.statusCode ?? 0))") as Any])
            }
        }
        task.resume()
    }

    func emit() {
        onChange?(["type": "record", "on": recorder?.isRecording == true, "since": startedAt.map { iso($0) as Any } ?? NSNull(), "purpose": purpose])
    }
}

func iso(_ d: Date) -> String { ISO8601DateFormatter().string(from: d) }
