// Read the text off a screenshot, with the position of every line.
//
//   swiftc -O script/read_annotations.swift -o /tmp/read_annotations
//   /tmp/read_annotations "screenshot.png"
//
// script/read_annotations builds it on demand; call that rather than this.
//
// ── why this exists ──────────────────────────────────────────────────────────
//
// The client reviews the shop by screenshotting it, drawing boxes, and writing
// what is wrong beside them. Those notes are the specification: on 17 Aug six
// screenshots carried seventeen of them, and three were missed on the first pass
// because he re-annotated four of the six and only the first set had been read.
//
// Reading them by eye does not scale and does not survive a session ending. This
// uses the OCR already in macOS, so there is nothing to install and nothing to
// pay for.
//
// ── what it can and cannot do ────────────────────────────────────────────────
//
// It reads TEXT. It does not see arrows, boxes or which element a note points at,
// so the x and y of each line are printed and the mapping from note to element is
// a judgement to state out loud and have the client confirm. Saying "this note is
// at x37 y78, I read it as pointing at the shipping notice" is checkable. Saying
// "he wants the notice in a box" is not.
//
// Coordinates are percentages of the image, origin top left, so they are
// comparable across screenshots of different sizes.
import AppKit
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count > 1,
      let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
    FileHandle.standardError.write("usage: read_annotations <image>\n".data(using: .utf8)!)
    exit(1)
}

print("size \(cg.width)x\(cg.height)")

let request = VNRecognizeTextRequest { result, _ in
    guard let observations = result.results as? [VNRecognizedTextObservation] else { return }
    // Reading order: top to bottom, then left to right. Lines within 2% of the
    // same height count as the same row, otherwise a two column screenshot comes
    // back interleaved and unreadable.
    let ordered = observations.sorted { a, b in
        abs(a.boundingBox.midY - b.boundingBox.midY) > 0.02
            ? a.boundingBox.midY > b.boundingBox.midY
            : a.boundingBox.minX < b.boundingBox.minX
    }
    for o in ordered {
        guard let candidate = o.topCandidates(1).first, candidate.confidence > 0.3 else { continue }
        let x = Int(o.boundingBox.minX * 100)
        let y = Int((1 - o.boundingBox.maxY) * 100)
        print(String(format: "x%02d y%02d  %@", x, y, candidate.string))
    }
}
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
