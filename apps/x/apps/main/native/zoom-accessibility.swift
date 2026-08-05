// zoom-accessibility: bounded, read-only Zoom Accessibility evidence.
//
// The helper emits newline-delimited JSON and never emits raw AX nodes, window
// titles, arbitrary labels, screenshots, transcript text, or process paths.
// It exits when the parent closes stdin, so it cannot outlive Rowboat.
//
// Protocol:
//   {"type":"permission","trusted":true,"observedAtMs":...}
//   {"type":"surface","state":"active|missing|unknown","observedAtMs":...}
//   {"type":"speaker","displayName":"...","isSelf":false,
//    "isActive":true,"isMuted":null,"confidence":0.98,
//    "signals":["explicit-talking-label"],"observedAtMs":...}
//
// The bounded traversal and explicit-label parsing are adapted from Anarlog's
// MIT-licensed meeting_ax module at revision
// 609ee772801f29292e4edee453f269089ebf0e8b. See
// zoom-accessibility-LICENSE.txt and docs/zoom-accessibility-evidence.md.

import AppKit
import ApplicationServices
import Foundation

private let zoomBundleIdentifier = "us.zoom.xos"
private let maximumWindows = 8
private let maximumDepth = 18
private let maximumNodes = 1_800
private let maximumChildrenPerNode = 128
private let inspectionBudgetSeconds = 0.60
private let pollIntervalSeconds = 0.75

private enum SurfaceState: String, Encodable {
    case active
    case missing
    case unknown
}

private struct PermissionEvent: Encodable {
    let type = "permission"
    let trusted: Bool
    let observedAtMs: UInt64
}

private struct SurfaceEvent: Encodable {
    let type = "surface"
    let state: SurfaceState
    let observedAtMs: UInt64
}

private struct SpeakerEvent: Encodable, Equatable {
    let type = "speaker"
    let displayName: String
    let isSelf: Bool?
    let isActive: Bool
    let isMuted: Bool?
    let confidence: Double
    let signals: [String]
    let observedAtMs: UInt64

    static func == (lhs: SpeakerEvent, rhs: SpeakerEvent) -> Bool {
        lhs.displayName.caseInsensitiveCompare(rhs.displayName) == .orderedSame
            && lhs.isSelf == rhs.isSelf
            && lhs.isActive == rhs.isActive
            && lhs.isMuted == rhs.isMuted
    }
}

private struct Inspection {
    let surface: SurfaceState
    let speakers: [SpeakerEvent]
}

private struct AxNode {
    let role: String?
    let labels: [String]
}

private struct TraversalBudget {
    let deadline: DispatchTime
    var visited: Set<CFHashCode> = []
    var count = 0

    mutating func canVisit(_ element: AXUIElement, depth: Int) -> Bool {
        guard depth <= maximumDepth,
              count < maximumNodes,
              DispatchTime.now() < deadline else {
            return false
        }
        let identity = CFHash(element)
        guard visited.insert(identity).inserted else { return false }
        count += 1
        return true
    }
}

private func nowMilliseconds() -> UInt64 {
    UInt64(Date().timeIntervalSince1970 * 1_000)
}

private func emit<T: Encodable>(_ event: T) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(event),
          let line = String(data: data, encoding: .utf8) else {
        return
    }
    print(line)
    fflush(stdout)
}

private func copyString(_ element: AXUIElement, _ attribute: String) -> String? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &raw) == .success,
          let value = raw as? String else {
        return nil
    }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : String(trimmed.prefix(512))
}

private func copyChildren(_ element: AXUIElement) -> [AXUIElement] {
    var values: CFArray?
    guard AXUIElementCopyAttributeValues(
        element,
        kAXChildrenAttribute as CFString,
        0,
        maximumChildrenPerNode,
        &values
    ) == .success,
    let values else {
        return []
    }
    return (values as NSArray).compactMap { $0 as! AXUIElement? }
}

private func copyWindows(_ application: AXUIElement) -> [AXUIElement] {
    var values: CFArray?
    guard AXUIElementCopyAttributeValues(
        application,
        kAXWindowsAttribute as CFString,
        0,
        maximumWindows,
        &values
    ) == .success,
    let values else {
        return []
    }
    return (values as NSArray).compactMap { $0 as! AXUIElement? }
}

private func isTextInputRole(_ role: String?) -> Bool {
    role == kAXTextFieldRole || role == kAXTextAreaRole || role == "AXSecureTextField"
}

private func labels(for element: AXUIElement, role: String?) -> [String] {
    var result: [String] = []
    for attribute in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute] {
        if let value = copyString(element, attribute) { result.append(value) }
    }
    // Static text and controls often expose their accessibility label through
    // AXValue. Never read it from editable or secure controls.
    if !isTextInputRole(role),
       role == kAXStaticTextRole || role == kAXButtonRole || role == kAXCheckBoxRole,
       let value = copyString(element, kAXValueAttribute) {
        result.append(value)
    }
    var seen: Set<String> = []
    return result.filter { seen.insert($0.lowercased()).inserted }
}

private func collectNodes(
    from element: AXUIElement,
    depth: Int,
    budget: inout TraversalBudget,
    into nodes: inout [AxNode]
) {
    guard budget.canVisit(element, depth: depth) else { return }
    let role = copyString(element, kAXRoleAttribute)
    nodes.append(AxNode(role: role, labels: labels(for: element, role: role)))
    for child in copyChildren(element) {
        collectNodes(from: child, depth: depth + 1, budget: &budget, into: &nodes)
    }
}

private func normalized(_ value: String) -> String {
    value
        .replacingOccurrences(of: "\u{00a0}", with: " ")
        .split(whereSeparator: { $0.isWhitespace })
        .joined(separator: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private let genericNames: Set<String> = [
    "active speaker", "audio", "camera", "chat", "host", "meeting", "more",
    "mute", "participant", "participants", "screen", "speaker", "talking",
    "unmute", "video", "you", "zoom"
]

private func plausibleParticipantName(_ candidate: String) -> String? {
    let name = normalized(candidate)
        .trimmingCharacters(in: CharacterSet(charactersIn: "-–—:,. "))
    guard name.count >= 2,
          name.count <= 100,
          !genericNames.contains(name.lowercased()),
          name.rangeOfCharacter(from: .letters) != nil,
          !name.contains("http"),
          !name.contains("@") else {
        return nil
    }
    return name
}

private func removingSelfMarker(_ raw: String) -> (name: String, marked: Bool) {
    var value = normalized(raw)
    let patterns = [" (Me)", " (me)", " (You)", " (you)", ", Me", ", me", ", You", ", you"]
    for pattern in patterns where value.hasSuffix(pattern) {
        value.removeLast(pattern.count)
        return (value, true)
    }
    return (value, false)
}

private func parseTalkingLabel(_ label: String) -> (name: String, isSelf: Bool)? {
    let text = normalized(label)
    let lower = text.lowercased()
    let rawName: String

    if lower.hasPrefix("talking:") {
        rawName = String(text.dropFirst("talking:".count))
    } else if lower.hasPrefix("speaking:") {
        rawName = String(text.dropFirst("speaking:".count))
    } else if let range = lower.range(of: " is talking"), range.upperBound == lower.endIndex {
        rawName = String(text[..<range.lowerBound])
    } else if let range = lower.range(of: " is speaking"), range.upperBound == lower.endIndex {
        rawName = String(text[..<range.lowerBound])
    } else if let range = lower.range(of: ", talking"), range.upperBound == lower.endIndex {
        rawName = String(text[..<range.lowerBound])
    } else if let range = lower.range(of: ", speaking"), range.upperBound == lower.endIndex {
        rawName = String(text[..<range.lowerBound])
    } else {
        return nil
    }

    let marked = removingSelfMarker(rawName)
    guard let name = plausibleParticipantName(marked.name) else { return nil }
    return (name, marked.marked)
}

private func parseParticipantSelfName(_ label: String) -> String? {
    let text = normalized(label)
    let lower = text.lowercased()
    let markers = [" (me)", " (you)", ", me", ", you"]
    guard let markerRange = markers.compactMap({ lower.range(of: $0) }).min(by: {
        $0.lowerBound < $1.lowerBound
    }) else {
        return nil
    }
    return plausibleParticipantName(String(text[..<markerRange.lowerBound]))
}

private enum TileAudioState {
    case muted
    case unmuted
}

private struct VideoTile {
    let name: String
    let isSelf: Bool
    let audio: TileAudioState
}

private func parseVideoTile(_ label: String) -> VideoTile? {
    let text = normalized(label)
    let lower = text.lowercased()
    let audio: TileAudioState
    if lower.contains("audio unmuted") || lower.contains("microphone unmuted") {
        audio = .unmuted
    } else if lower.contains("audio muted") || lower.contains("microphone muted") {
        audio = .muted
    } else {
        return nil
    }
    guard let first = text.split(separator: ",", maxSplits: 1).first else { return nil }
    let marked = removingSelfMarker(String(first))
    guard let name = plausibleParticipantName(marked.name) else { return nil }
    return VideoTile(name: name, isSelf: marked.marked, audio: audio)
}

private func isMeetingSurface(_ nodes: [AxNode]) -> Bool {
    let labels = nodes.flatMap(\.labels).map { $0.lowercased() }
    let joined = labels.joined(separator: " | ")
    let hasMeetingTitle = joined.contains("zoom meeting") || joined.contains("in a zoom meeting")
    let hasAudioControl = joined.contains("mute my audio") || joined.contains("unmute my audio")
    let hasLeaveControl = joined.contains("leave meeting") || joined.contains("end meeting")
    let hasParticipantsControl = labels.contains { $0 == "participants" || $0.hasPrefix("participants,") }
    let controls = [hasAudioControl, hasLeaveControl, hasParticipantsControl].filter { $0 }.count
    return (hasMeetingTitle && controls >= 1) || controls >= 2
}

private func inspectZoom() -> Inspection {
    guard AXIsProcessTrusted() else {
        return Inspection(surface: .unknown, speakers: [])
    }

    let running = NSRunningApplication.runningApplications(withBundleIdentifier: zoomBundleIdentifier)
        .filter { !$0.isTerminated }
    guard !running.isEmpty else {
        return Inspection(surface: .missing, speakers: [])
    }

    // One budget covers the complete observation, not each window. This keeps
    // the documented 1,800-node/600-ms bound true even when Zoom has several
    // auxiliary windows or processes.
    var budget = TraversalBudget(
        deadline: DispatchTime.now() + inspectionBudgetSeconds,
        visited: [],
        count: 0
    )
    var meetingNodes: [AxNode] = []
    var sawReadableWindow = false
    for process in running.prefix(2) {
        guard DispatchTime.now() < budget.deadline else { break }
        let application = AXUIElementCreateApplication(process.processIdentifier)
        AXUIElementSetMessagingTimeout(application, Float(inspectionBudgetSeconds))

        // Zoom does not consistently expose its meeting subtree until one of
        // these application attributes is enabled. This is a best-effort
        // interoperability hint; failure leaves the helper read-only.
        _ = AXUIElementSetAttributeValue(application, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        _ = AXUIElementSetAttributeValue(application, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)

        for window in copyWindows(application) {
            guard DispatchTime.now() < budget.deadline, budget.count < maximumNodes else { break }
            var nodes: [AxNode] = []
            collectNodes(from: window, depth: 0, budget: &budget, into: &nodes)
            guard !nodes.isEmpty else { continue }
            sawReadableWindow = true
            if isMeetingSurface(nodes) { meetingNodes.append(contentsOf: nodes) }
        }
    }

    guard !meetingNodes.isEmpty else {
        return Inspection(surface: sawReadableWindow ? .missing : .unknown, speakers: [])
    }

    let selfNames = Set(meetingNodes.flatMap(\.labels).compactMap(parseParticipantSelfName).map { $0.lowercased() })
    let observedAt = nowMilliseconds()
    var speakers: [SpeakerEvent] = []

    for label in meetingNodes.flatMap(\.labels) {
        guard let parsed = parseTalkingLabel(label) else { continue }
        let matchesSelf = parsed.isSelf || selfNames.contains(parsed.name.lowercased())
        speakers.append(SpeakerEvent(
            displayName: parsed.name,
            isSelf: matchesSelf ? true : (selfNames.isEmpty ? nil : false),
            isActive: true,
            isMuted: false,
            confidence: parsed.isSelf ? 1.0 : 0.98,
            signals: parsed.isSelf
                ? ["explicit-talking-label", "explicit-self-marker"]
                : ["explicit-talking-label"],
            observedAtMs: observedAt
        ))
    }

    // Current compact Zoom windows sometimes expose tile audio state but no
    // explicit Talking label. Exactly one unmuted visible tile is useful,
    // bounded evidence; two or more unmuted tiles deliberately remain
    // ambiguous (including during overlap).
    if speakers.isEmpty {
        let tiles = meetingNodes.flatMap(\.labels).compactMap(parseVideoTile)
        let unmuted = tiles.filter { $0.audio == .unmuted }
        if unmuted.count == 1, let tile = unmuted.first {
            let matchesSelf = tile.isSelf || selfNames.contains(tile.name.lowercased())
            speakers.append(SpeakerEvent(
                displayName: tile.name,
                isSelf: matchesSelf ? true : (selfNames.isEmpty ? nil : false),
                isActive: true,
                isMuted: false,
                confidence: tile.isSelf ? 0.90 : 0.82,
                signals: tile.isSelf
                    ? ["sole-unmuted-video-tile", "explicit-self-marker"]
                    : ["sole-unmuted-video-tile"],
                observedAtMs: observedAt
            ))
        }
    }

    var unique: [String: SpeakerEvent] = [:]
    for speaker in speakers {
        let key = "\(speaker.displayName.lowercased())|\(speaker.isSelf.map(String.init) ?? "unknown")"
        if unique[key] == nil || speaker.confidence > unique[key]!.confidence {
            unique[key] = speaker
        }
    }
    return Inspection(surface: .active, speakers: Array(unique.values).prefix(8).map { $0 })
}

private func runSelfTest() -> Never {
    var failures: [String] = []
    func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() { failures.append(message) }
    }

    expect(parseTalkingLabel("Talking: Rahul Khatri")?.name == "Rahul Khatri", "Talking prefix")
    expect(parseTalkingLabel("Rahul Khatri is talking")?.name == "Rahul Khatri", "is talking suffix")
    expect(parseTalkingLabel("Rahul Khatri (Me), Talking")?.isSelf == true, "explicit self marker")
    expect(parseTalkingLabel("Mute my audio") == nil, "reject controls")
    expect(parseParticipantSelfName("Rahul Khatri (Me), Host") == "Rahul Khatri", "participant self row")
    expect(parseVideoTile("Akbar Singh, video on, audio unmuted")?.name == "Akbar Singh", "video tile")
    expect(parseVideoTile("Akbar Singh, video on, audio muted")?.audio == .muted, "muted tile")

    if failures.isEmpty {
        print("zoom-accessibility self-test passed")
        exit(0)
    }
    fputs("zoom-accessibility self-test failed: \(failures.joined(separator: ", "))\n", stderr)
    exit(1)
}

if CommandLine.arguments.contains("--self-test") {
    runSelfTest()
}

// The parent's writable stdin is our lifetime token.
DispatchQueue.global(qos: .utility).async {
    while readLine(strippingNewline: false) != nil {}
    exit(0)
}

var lastTrusted: Bool?
while true {
    autoreleasepool {
        let trusted = AXIsProcessTrusted()
        let observedAt = nowMilliseconds()
        if lastTrusted != trusted {
            emit(PermissionEvent(trusted: trusted, observedAtMs: observedAt))
            lastTrusted = trusted
        }
        let inspection = inspectZoom()
        emit(SurfaceEvent(state: inspection.surface, observedAtMs: observedAt))
        for speaker in inspection.speakers { emit(speaker) }
    }
    Thread.sleep(forTimeInterval: pollIntervalSeconds)
}
