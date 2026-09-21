// macmic: listen for a single right Command tap, without recording key contents.
import Foundation
import CoreGraphics

struct CommandGesture {
    var pressedAt: Double?
    var eligible = false
    mutating func reset() { pressedAt = nil; eligible = false }
    mutating func update(down: Bool, interrupted: Bool, time: Double) -> Bool {
        if down {
            if pressedAt == nil { pressedAt = time; eligible = !interrupted }
            if interrupted { eligible = false }
            return false
        }
        let trigger = pressedAt.map { eligible && !interrupted && time - $0 < 0.8 && time >= $0 } ?? false
        reset()
        return trigger
    }
}

if CommandLine.arguments.contains("--self-test") {
    var gesture = CommandGesture()
    assert(!gesture.update(down: true, interrupted: false, time: 1))
    assert(gesture.update(down: false, interrupted: false, time: 1.1))
    assert(!gesture.update(down: false, interrupted: false, time: 1.2))
    _ = gesture.update(down: true, interrupted: false, time: 2)
    _ = gesture.update(down: true, interrupted: true, time: 2.1)
    assert(!gesture.update(down: false, interrupted: false, time: 2.2))
    _ = gesture.update(down: true, interrupted: true, time: 3)
    assert(!gesture.update(down: false, interrupted: false, time: 3.1))
    _ = gesture.update(down: true, interrupted: false, time: 4)
    assert(!gesture.update(down: false, interrupted: false, time: 5))
    _ = gesture.update(down: true, interrupted: false, time: 6)
    gesture.reset()
    assert(!gesture.update(down: false, interrupted: false, time: 6.1))
    print("PASS: single tap, duplicate release, key/mouse chords, other modifiers, long hold and wake reset")
    exit(0)
}

func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}
var gesture = CommandGesture()
var tap: CFMachPort?
// Never open a system permission prompt during background startup.
guard CGPreflightListenEventAccess() else {
    emit(["type": "status", "ready": false])
    exit(2)
}
let mask = [CGEventType.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown]
    .reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                       eventsOfInterest: mask, callback: { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        gesture.reset()
        if let tap = tap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    let down = CGEventSource.keyState(.combinedSessionState, key: 54)
    let otherModifier = !event.flags.intersection([.maskShift, .maskControl, .maskAlternate, .maskSecondaryFn]).isEmpty
        || CGEventSource.keyState(.combinedSessionState, key: 55)
    let interrupted = type != .flagsChanged || otherModifier
    if gesture.update(down: down, interrupted: interrupted, time: ProcessInfo.processInfo.systemUptime) {
        emit(["type": "trigger"])
    }
    return Unmanaged.passUnretained(event)
}, userInfo: nil)
guard let eventTap = tap, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0) else {
    emit(["type": "status", "ready": false])
    exit(2)
}
CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
emit(["type": "status", "ready": true])
Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
    let enabled = CGEvent.tapIsEnabled(tap: eventTap)
    if !enabled { gesture.reset(); CGEvent.tapEnable(tap: eventTap, enable: true) }
    emit(["type": "status", "ready": CGEvent.tapIsEnabled(tap: eventTap)])
}
CFRunLoopRun()
