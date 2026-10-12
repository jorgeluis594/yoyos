import Foundation

/** Rejects duplicate object keys and JSON extensions accepted by Foundation parsers. */
enum StrictStateJSON {
  static func check(_ text: String) throws {
    var parser = Parser(Array(text.unicodeScalars))
    try parser.value()
    parser.space()
    guard parser.position == parser.characters.count else { throw StateStoreError.invalid }
  }

  private struct Parser {
    let characters: [Unicode.Scalar]
    var position = 0
    private var depth = 0
    init(_ characters: [Unicode.Scalar]) { self.characters = characters }
    mutating func space() {
      while let c = peek(), c == " " || c == "\n" || c == "\r" || c == "\t" { position += 1 }
    }
    private func peek() -> Unicode.Scalar? { position < characters.count ? characters[position] : nil }
    private mutating func take(_ c: Unicode.Scalar) throws {
      guard peek() == c else { throw StateStoreError.invalid }; position += 1
    }
    mutating func value() throws {
      depth += 1
      guard depth <= 64 else { throw StateStoreError.invalid }
      defer { depth -= 1 }
      space()
      guard let c = peek() else { throw StateStoreError.invalid }
      switch c {
      case "{": try object()
      case "[": try array()
      case "\"": _ = try string()
      case "t": try literal("true")
      case "f": try literal("false")
      case "n": try literal("null")
      default: try number()
      }
    }
    private mutating func object() throws {
      try take("{"); space()
      if peek() == "}" { position += 1; return }
      var keys = Set<String>()
      while true {
        let key = try string()
        guard keys.insert(key).inserted else { throw StateStoreError.invalid }
        space(); try take(":"); try value(); space()
        if peek() == "}" { position += 1; return }
        try take(","); space()
      }
    }
    private mutating func array() throws {
      try take("["); space()
      if peek() == "]" { position += 1; return }
      while true {
        try value(); space()
        if peek() == "]" { position += 1; return }
        try take(",")
      }
    }
    private mutating func string() throws -> String {
      let start = position
      try take("\"")
      while let c = peek() {
        position += 1
        if c == "\"" {
          let fragment = String(String.UnicodeScalarView(characters[start..<position]))
          guard let data = fragment.data(using: .utf8), let decoded = try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) as? String else { throw StateStoreError.invalid }
          return decoded
        }
        if c == "\\" {
          guard let escaped = peek() else { throw StateStoreError.invalid }; position += 1
          if escaped == "u" {
            for _ in 0..<4 {
              guard let hex = peek(), ("0"..."9").contains(String(hex)) || ("a"..."f").contains(String(hex)) || ("A"..."F").contains(String(hex)) else { throw StateStoreError.invalid }
              position += 1
            }
          } else if !"\"\\/bfnrt".unicodeScalars.contains(escaped) { throw StateStoreError.invalid }
        } else if c.value < 32 { throw StateStoreError.invalid }
      }
      throw StateStoreError.invalid
    }
    private mutating func number() throws {
      if peek() == "-" { position += 1 }
      if peek() == "0" { position += 1 } else {
        guard let c = peek(), ("1"..."9").contains(String(c)) else { throw StateStoreError.invalid }
        while let c = peek(), ("0"..."9").contains(String(c)) { position += 1 }
      }
      if peek() == "." {
        position += 1
        guard let c = peek(), ("0"..."9").contains(String(c)) else { throw StateStoreError.invalid }
        while let c = peek(), ("0"..."9").contains(String(c)) { position += 1 }
      }
      if peek() == "e" || peek() == "E" {
        position += 1
        if peek() == "+" || peek() == "-" { position += 1 }
        guard let c = peek(), ("0"..."9").contains(String(c)) else { throw StateStoreError.invalid }
        while let c = peek(), ("0"..."9").contains(String(c)) { position += 1 }
      }
    }
    private mutating func literal(_ text: String) throws {
      for c in text.unicodeScalars { try take(c) }
    }
  }
}
