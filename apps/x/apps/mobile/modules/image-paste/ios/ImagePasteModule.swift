import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

// React Native's text field takes only text from the clipboard: with an image
// copied, Paste never shows in its menu and ⌘V does nothing (2026-11-04). This
// teaches RN's multiline field (RCTUITextView) to take images, but only a field
// whose nativeID is `image-paste-target`, so no other field offers a Paste it
// can't use. The images land on disk and reach JS as `onPaste`.

private let targetNativeID = "image-paste-target"
/// Kept as is; anything else (HEIC, TIFF, …) is re-encoded as PNG so every viewer shows it.
private let passThrough: [UTType] = [.png, .jpeg, .gif]

public class ImagePasteModule: Module {
  fileprivate static weak var current: ImagePasteModule?

  public func definition() -> ModuleDefinition {
    Name("ImagePaste")

    Events("onPaste")

    OnCreate {
      ImagePasteModule.current = self
      DispatchQueue.main.async(execute: installPasteHook)
    }
  }

  /// Runs inside the paste action the person started, so iOS reads the
  /// clipboard without asking. Disk writes and re-encoding leave the main thread.
  fileprivate func paste() {
    let board = UIPasteboard.general
    var found: [(Data, UTType)] = []
    for index in 0..<board.numberOfItems {
      let item = IndexSet(integer: index)
      let types = (board.types(forItemSet: item)?.first ?? []).compactMap { UTType($0) }
      guard
        let type = passThrough.first(where: types.contains) ?? types.first(where: { $0.conforms(to: .image) }),
        let data = board.data(forPasteboardType: type.identifier, inItemSet: item)?.first as? Data
      else { continue }
      found.append((data, type))
    }
    // An image put there as a UIImage object can have no readable data type.
    let fallback = found.isEmpty ? board.images ?? [] : []

    DispatchQueue.global(qos: .userInitiated).async {
      let images = found.compactMap { save($0.0, $0.1) } + fallback.compactMap { $0.pngData().flatMap { save($0, .png) } }
      if !images.isEmpty {
        self.sendEvent("onPaste", ["images": images])
      }
    }
  }
}

private func save(_ data: Data, _ type: UTType) -> [String: String]? {
  var data = data
  var type = type
  if !passThrough.contains(type) {
    guard let png = UIImage(data: data)?.pngData() else { return nil }
    data = png
    type = .png
  }
  let ext = type.preferredFilenameExtension ?? "png"
  // Caches, not tmp: an unsent draft keeps pointing at this file across launches.
  let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
  let url = dir.appendingPathComponent("pasted-\(UUID().uuidString).\(ext)")
  do {
    try data.write(to: url)
  } catch {
    return nil
  }
  return ["uri": url.absoluteString, "mime": type.preferredMIMEType ?? "image/png", "name": "pasted-image.\(ext)"]
}

/// Fabric hosts the text view directly in the component view that carries the nativeID.
private func acceptsImages(_ view: UIView) -> Bool {
  guard let host = view.superview, host.responds(to: NSSelectorFromString("nativeId")) else { return false }
  return host.value(forKey: "nativeId") as? String == targetNativeID
}

private var hookInstalled = false

private func installPasteHook() {
  guard !hookInstalled, let textView = NSClassFromString("RCTUITextView") else { return }
  hookInstalled = true
  let pasteSel = #selector(UIResponderStandardEditActions.paste(_:))
  let canSel = #selector(UIResponder.canPerformAction(_:withSender:))

  // Offer Paste when the clipboard holds only an image.
  if let method = class_getInstanceMethod(textView, canSel) {
    typealias CanPerform = @convention(c) (UITextView, Selector, Selector, Any?) -> Bool
    let original = unsafeBitCast(method_getImplementation(method), to: CanPerform.self)
    let hook: @convention(block) (UITextView, Selector, Any?) -> Bool = { view, action, sender in
      if action == pasteSel, view.isEditable, acceptsImages(view), UIPasteboard.general.hasImages {
        return true
      }
      return original(view, canSel, action, sender)
    }
    class_replaceMethod(textView, canSel, imp_implementationWithBlock(hook), method_getTypeEncoding(method))
  }

  // An image on the clipboard wins over text: copying an image in Safari also copies its URL.
  if let method = class_getInstanceMethod(textView, pasteSel) {
    typealias Paste = @convention(c) (UITextView, Selector, Any?) -> Void
    let original = unsafeBitCast(method_getImplementation(method), to: Paste.self)
    let hook: @convention(block) (UITextView, Any?) -> Void = { view, sender in
      if acceptsImages(view), UIPasteboard.general.hasImages, let module = ImagePasteModule.current {
        module.paste()
        return
      }
      original(view, pasteSel, sender)
    }
    class_replaceMethod(textView, pasteSel, imp_implementationWithBlock(hook), method_getTypeEncoding(method))
  }
}
