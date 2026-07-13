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
//    + kAudioProcessPropertyIsRunningInput) give the processes that own the
//    mic. Each owner is resolved to its bundle ID (CoreAudio) and executable
//    path (libproc) HERE, natively — the consumer must not need to shell out
//    (child-process spawns from Electron's main process fail with EBADF
//    while capture is active).
//  - Fallback: kAudioDevicePropertyDeviceIsRunningSomewhere on the default
//    input device — mic in use by *someone*, no attribution.
//
// Protocol: one JSON object per line on stdout, emitted on every state
// change (and once at startup):
//   {"micInUse":true,"owners":[{"pid":123,"bundleId":"com.google.Chrome.helper","path":"/Applications/..."}]}
// ("owners" is empty when attribution is unavailable.)
// The process exits when stdin closes, so it can never outlive the app.
//
// Compiled by apps/main/bundle.mjs (best-effort, macOS only) to
// .package/dist/mic-monitor.

import Foundation
import CoreAudio
import Darwin

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

func processBundleID(_ object: AudioObjectID) -> String? {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioProcessPropertyBundleID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var value: Unmanaged<CFString>? = nil
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr,
          let cf = value else { return nil }
    let str = cf.takeRetainedValue() as String
    return str.isEmpty ? nil : str
}

func processPath(_ pid: Int32) -> String? {
    var buffer = [CChar](repeating: 0, count: 4096)
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    guard length > 0 else { return nil }
    return String(cString: buffer)
}

struct MicOwner: Equatable {
    let pid: Int32
    let bundleId: String
    let path: String
}

/// Processes currently capturing from any input device (macOS 14.4+;
/// returns [] where unsupported and the device-level fallback takes over).
func micOwners() -> [MicOwner] {
    var owners: [MicOwner] = []
    for object in audioProcessObjectIDs() where processIsRunningInput(object) {
        guard let pid = processPID(object) else { continue }
        owners.append(MicOwner(
            pid: pid,
            bundleId: processBundleID(object) ?? "",
            path: processPath(pid) ?? ""))
    }
    return owners.sorted { $0.pid < $1.pid }
}

func jsonEscape(_ s: String) -> String {
    var out = ""
    for ch in s.unicodeScalars {
        switch ch {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if ch.value < 0x20 {
                out += String(format: "\\u%04x", ch.value)
            } else {
                out.unicodeScalars.append(ch)
            }
        }
    }
    return out
}

// Exit when the parent closes our stdin (app quit/crash) — never orphan.
Thread {
    while readLine(strippingNewline: false) != nil {}
    exit(0)
}.start()

setbuf(stdout, nil)

var lastInUse: Bool? = nil
var lastOwners: [MicOwner] = []
while true {
    let owners = micOwners()
    // Re-resolve the default device every poll: the user can switch input
    // devices (AirPods in/out) mid-session.
    let deviceInUse = defaultInputDeviceID().map(isRunningSomewhere) ?? false
    let inUse = deviceInUse || !owners.isEmpty
    if inUse != lastInUse || owners != lastOwners {
        lastInUse = inUse
        lastOwners = owners
        let ownerJson = owners.map { o in
            "{\"pid\":\(o.pid),\"bundleId\":\"\(jsonEscape(o.bundleId))\",\"path\":\"\(jsonEscape(o.path))\"}"
        }.joined(separator: ",")
        print("{\"micInUse\":\(inUse),\"owners\":[\(ownerJson)]}")
    }
    Thread.sleep(forTimeInterval: 1.0)
}
