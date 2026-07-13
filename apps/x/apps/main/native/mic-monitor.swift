// mic-monitor: prints a JSON line whenever the set of processes using the
// microphone changes.
//
// This is the ambient meeting-detection signal (Granola-style): when another
// app (Zoom, Meet in a browser, Slack huddle, FaceTime…) opens the
// microphone, we report it. No audio is captured, so this requires no
// microphone permission (TCC) — it's device state, not content.
//
// Two signals, best available wins:
//  - macOS 14.4+: per-process audio objects (kAudioHardwarePropertyProcessObjectList
//    + kAudioProcessPropertyIsRunningInput) give the PIDs that own the mic,
//    so the consumer can attribute the call to Chrome vs Zoom vs Slack.
//  - Fallback: kAudioDevicePropertyDeviceIsRunningSomewhere on the default
//    input device — mic in use by *someone*, no attribution.
//
// Protocol: one JSON object per line on stdout, emitted on every state
// change (and once at startup): {"micInUse":true|false,"pids":[123,456]}
// ("pids" is empty when attribution is unavailable.)
// The process exits when stdin closes, so it can never outlive the app.
//
// Compiled by apps/main/bundle.mjs (best-effort, macOS only) to
// .package/dist/mic-monitor.

import Foundation
import CoreAudio

func defaultInputDeviceID() -> AudioDeviceID? {
    var deviceID = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &deviceID)
    guard status == noErr, deviceID != kAudioObjectUnknown else { return nil }
    return deviceID
}

func isRunningSomewhere(_ device: AudioDeviceID) -> Bool {
    var running = UInt32(0)
    var size = UInt32(MemoryLayout<UInt32>.size)
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    let status = AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &running)
    return status == noErr && running != 0
}

func audioProcessObjectIDs() -> [AudioObjectID] {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(0)
    let sysID = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(sysID, &addr, 0, nil, &size) == noErr, size > 0 else {
        return []
    }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(sysID, &addr, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

func processIsRunningInput(_ object: AudioObjectID) -> Bool {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioProcessPropertyIsRunningInput,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var value = UInt32(0)
    var size = UInt32(MemoryLayout<UInt32>.size)
    let status = AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value)
    return status == noErr && value != 0
}

func processPID(_ object: AudioObjectID) -> Int32? {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioProcessPropertyPID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var pid = pid_t(-1)
    var size = UInt32(MemoryLayout<pid_t>.size)
    guard AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &pid) == noErr, pid >= 0 else {
        return nil
    }
    return Int32(pid)
}

/// PIDs of processes currently capturing from any input device (macOS 14.4+;
/// returns [] where unsupported and the device-level fallback takes over).
func micOwningPIDs() -> [Int32] {
    var pids: [Int32] = []
    for object in audioProcessObjectIDs() where processIsRunningInput(object) {
        if let pid = processPID(object) { pids.append(pid) }
    }
    return pids.sorted()
}

// Exit when the parent closes our stdin (app quit/crash) — never orphan.
Thread {
    while readLine(strippingNewline: false) != nil {}
    exit(0)
}.start()

setbuf(stdout, nil)

var lastInUse: Bool? = nil
var lastPids: [Int32] = []
while true {
    let pids = micOwningPIDs()
    // Re-resolve the default device every poll: the user can switch input
    // devices (AirPods in/out) mid-session.
    let deviceInUse = defaultInputDeviceID().map(isRunningSomewhere) ?? false
    let inUse = deviceInUse || !pids.isEmpty
    if inUse != lastInUse || pids != lastPids {
        lastInUse = inUse
        lastPids = pids
        let pidList = pids.map(String.init).joined(separator: ",")
        print("{\"micInUse\":\(inUse),\"pids\":[\(pidList)]}")
    }
    Thread.sleep(forTimeInterval: 1.0)
}
