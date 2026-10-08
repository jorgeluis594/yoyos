package expo.modules.whatsapp

/** Checks lexical JSON rules that org.json silently accepts, especially duplicate keys. */
internal object StrictJson {
  fun check(value: String) {
    val parser = Parser(value)
    parser.space(); parser.value(); parser.space()
    if (parser.position != value.length) throw StateFailure("SESSION_STATE_INVALID")
  }

  private class Parser(private val source: String) {
    var position = 0
    private var depth = 0
    fun space() { while (position < source.length && source[position] in " \n\r\t") position++ }
    private fun take(character: Char) {
      if (position >= source.length || source[position++] != character) throw StateFailure("SESSION_STATE_INVALID")
    }
    fun value() {
      if (++depth > 64) throw StateFailure("SESSION_STATE_INVALID")
      try {
        if (position >= source.length) throw StateFailure("SESSION_STATE_INVALID")
        when (source[position]) {
          '{' -> objectValue()
          '[' -> arrayValue()
          '"' -> string()
          't' -> literal("true")
          'f' -> literal("false")
          'n' -> literal("null")
          else -> number()
        }
      } finally { depth-- }
    }
    private fun objectValue() {
      take('{'); space()
      if (source.getOrNull(position) == '}') { position++; return }
      val keys = mutableSetOf<String>()
      while (true) {
        val key = string()
        if (!keys.add(key)) throw StateFailure("SESSION_STATE_INVALID")
        space(); take(':'); space(); value(); space()
        when (source.getOrNull(position++)) {
          '}' -> return
          ',' -> space()
          else -> throw StateFailure("SESSION_STATE_INVALID")
        }
      }
    }
    private fun arrayValue() {
      take('['); space()
      if (source.getOrNull(position) == ']') { position++; return }
      while (true) {
        value(); space()
        when (source.getOrNull(position++)) {
          ']' -> return
          ',' -> space()
          else -> throw StateFailure("SESSION_STATE_INVALID")
        }
      }
    }
    private fun string(): String {
      val start = position
      take('"')
      while (position < source.length) {
        when (val char = source[position++]) {
          '"' -> {
            val decoded = org.json.JSONTokener(source.substring(start, position)).nextValue() as String
            var index = 0
            while (index < decoded.length) {
              val current = decoded[index]
              if (Character.isHighSurrogate(current)) {
                if (index + 1 >= decoded.length || !Character.isLowSurrogate(decoded[index + 1])) throw StateFailure("SESSION_STATE_INVALID")
                index += 2
              } else {
                if (Character.isLowSurrogate(current)) throw StateFailure("SESSION_STATE_INVALID")
                index++
              }
            }
            return decoded
          }
          '\\' -> {
            val escaped = source.getOrNull(position++) ?: throw StateFailure("SESSION_STATE_INVALID")
            if (escaped == 'u') {
              repeat(4) { if (source.getOrNull(position++)?.let { it in "0123456789abcdefABCDEF" } != true) throw StateFailure("SESSION_STATE_INVALID") }
            } else if (escaped !in "\"\\/bfnrt") throw StateFailure("SESSION_STATE_INVALID")
          }
          else -> if (char.code < 32) throw StateFailure("SESSION_STATE_INVALID")
        }
      }
      throw StateFailure("SESSION_STATE_INVALID")
    }
    private fun number() {
      val start = position
      if (source.getOrNull(position) == '-') position++
      if (source.getOrNull(position) == '0') position++ else {
        if (source.getOrNull(position)?.let { it in '1'..'9' } != true) throw StateFailure("SESSION_STATE_INVALID")
        while (source.getOrNull(position)?.let { it in '0'..'9' } == true) position++
      }
      if (source.getOrNull(position) == '.') {
        position++
        if (source.getOrNull(position)?.let { it in '0'..'9' } != true) throw StateFailure("SESSION_STATE_INVALID")
        while (source.getOrNull(position)?.let { it in '0'..'9' } == true) position++
      }
      if (source.getOrNull(position) in listOf('e', 'E')) {
        position++
        if (source.getOrNull(position) in listOf('+', '-')) position++
        if (source.getOrNull(position)?.let { it in '0'..'9' } != true) throw StateFailure("SESSION_STATE_INVALID")
        while (source.getOrNull(position)?.let { it in '0'..'9' } == true) position++
      }
      if (position == start) throw StateFailure("SESSION_STATE_INVALID")
    }
    private fun literal(word: String) {
      if (!source.startsWith(word, position)) throw StateFailure("SESSION_STATE_INVALID")
      position += word.length
    }
  }
}
