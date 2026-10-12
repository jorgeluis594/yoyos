package expo.modules.whatsapp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StrictJsonTest {
  // Keys exactly as Go's json.Marshal writes them, including characters org.json escapes differently.
  @Test fun acceptsKeysAsGoWritesThem() {
    listOf(
      """["abc"]""",
      """["a/b+c==","name"]""",
      """["<x>","a&b"]""",
      """["with space","tab\there"]""",
      """["quote\"inside","back\\slash"]""",
      """["日本語"]""",
    ).forEach { assertTrue(it, StrictJson.isCompactArray(it)) }
  }

  @Test fun rejectsInsignificantWhitespace() {
    listOf("""[ "abc"]""", """["a", "b"]""", """["a"] """, "[\n\"a\"]", """["a" ]""").forEach { assertFalse(it, StrictJson.isCompactArray(it)) }
  }

  @Test fun rejectsNonArraysAndUnterminatedStrings() {
    listOf("""{"a":"b"}""", """"abc"""", """["abc]""", "").forEach { assertFalse(it, StrictJson.isCompactArray(it)) }
  }

  @Test fun anEscapedQuoteDoesNotEndTheString() {
    assertTrue(StrictJson.isCompactArray("""["a\" b"]"""))
  }
}
