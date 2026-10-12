import Foundation
import Vision

guard CommandLine.arguments.count == 2 else { exit(2) }
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
do {
  try VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1])).perform([request])
  let text = request.results?.compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ") ?? ""
  if text.contains("bridge-ok") { exit(0) }
  fputs("WhatsApp bridge probe did not appear: \(text)\n", stderr)
  exit(1)
} catch {
  fputs("Could not inspect probe screenshot\n", stderr)
  exit(1)
}
