package expo.modules.brotherprinter

import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Log
import com.brother.sdk.lmprinter.Channel
import com.brother.sdk.lmprinter.NetworkSearchOption
import com.brother.sdk.lmprinter.OpenChannelError
import com.brother.sdk.lmprinter.PrinterDriverGenerator
import com.brother.sdk.lmprinter.PrinterModel
import com.brother.sdk.lmprinter.PrinterSearcher
import com.brother.sdk.lmprinter.setting.QLPrintSettings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

class ResolveInput : Record {
  @Field var model: String = ""
  @Field var identityKind: String = ""
  @Field var identityValue: String = ""
  @Field var lastKnownIp: String = ""
}

class PrintInput : Record {
  @Field var model: String = ""
  @Field var labelSize: String = ""
  @Field var ip: String = ""
  @Field var identityKind: String = ""
  @Field var identityValue: String = ""
  @Field var uri: String = ""
  @Field var copies: Int = 0
}

class BrotherPrinterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BrotherPrinter")

    AsyncFunction("discoverPrinters") { timeoutMs: Int -> discoverDevices(timeoutMs) }
    AsyncFunction("resolvePrinter") { input: ResolveInput -> resolvePrinter(input) }
    AsyncFunction("printImage") { input: PrintInput -> printImage(input) }
  }

  private fun discoverDevices(timeoutMs: Int): Map<String, Any> {
    val context = appContext.reactContext ?: return failure("DISCOVERY_FAILED", "App context unavailable")
    return try {
      val devices = CopyOnWriteArrayList<Map<String, String>>()
      val result = PrinterSearcher.startNetworkSearch(context, NetworkSearchOption(timeoutMs.coerceIn(1000, 15000) / 1000.0, false)) { channel ->
        device(channel)?.let { devices.add(it) }
      }
      if (result.error.code.toString() != "NoError") failure("DISCOVERY_FAILED", result.error.code.toString())
      else success(devices.distinctBy { it["serial"] ?: it["mac"] })
    } catch (error: SecurityException) {
      failure("PERMISSION_DENIED", error.message ?: "Network permission denied")
    } catch (error: Exception) {
      failure("DISCOVERY_FAILED", error.message ?: "Network search failed")
    }
  }

  private fun resolvePrinter(input: ResolveInput): Map<String, Any> {
    if (input.model != "QL-810W" || !validIp(input.lastKnownIp) || input.identityKind !in setOf("serial", "mac") || input.identityValue.isBlank())
      return failure("PRINTER_IDENTITY_MISMATCH", "Invalid printer identity")
    val found = discoverDevices(5000)
    if (found["status"] != "ok") return found
    @Suppress("UNCHECKED_CAST")
    val devices = found["data"] as List<Map<String, String>>
    val key = input.identityKind
    val match = devices.find { it["model"] == input.model && it[key]?.equals(input.identityValue, ignoreCase = key == "mac") == true }
    if (match != null) return success(match)
    return failure(
      if (devices.any { it["model"] == input.model && it["ip"] == input.lastKnownIp }) "PRINTER_IDENTITY_MISMATCH" else "PRINTER_NOT_FOUND",
      "Selected printer could not be verified",
    )
  }

  private fun device(channel: Channel): Map<String, String>? {
    if (channel.extraInfo[Channel.ExtraInfoKey.ModelName] != "QL-810W") return null
    val ip = channel.channelInfo
    if (!validIp(ip)) return null
    val data = mutableMapOf("model" to "QL-810W", "ip" to ip)
    channel.extraInfo[Channel.ExtraInfoKey.SerialNumber]?.takeIf { it.isNotBlank() }?.let { data["serial"] = it }
    channel.extraInfo[Channel.ExtraInfoKey.MACAddress]?.takeIf { it.isNotBlank() }?.let { data["mac"] = it }
    return data
  }

  private fun printImage(input: PrintInput): Map<String, Any> {
    if (input.copies !in 1..99) return sendFailure("INVALID_COPIES", "Copies must be between 1 and 99", "not-sent")
    if (input.model != "QL-810W" || input.labelSize != "DK-1209")
      return sendFailure("PRINTER_REJECTED", "Unsupported printer or label size", "not-sent")
    if (!validIp(input.ip) || input.identityKind !in setOf("serial", "mac") || input.identityValue.isBlank())
      return sendFailure("PRINTER_REJECTED", "Invalid printer identity", "not-sent")
    val context = appContext.reactContext ?: return sendFailure("DEVICE_ERROR", "App context unavailable", "not-sent")
    val file = try {
      val uri = Uri.parse(input.uri)
      if (uri.scheme != "file") return sendFailure("PRINTER_REJECTED", "Invalid image URI", "not-sent")
      File(uri.path ?: "").canonicalFile
    } catch (_: Exception) { return sendFailure("PRINTER_REJECTED", "Invalid image URI", "not-sent") }
    val cache = context.cacheDir.canonicalFile
    if (file.parentFile != cache || !file.name.matches(Regex("yoyos-label-[a-zA-Z0-9-]+\\.png")) || !file.isFile)
      return sendFailure("PRINTER_REJECTED", "Image is outside the print cache", "not-sent")
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, options)
    if (options.outWidth != 696 || options.outHeight != 271)
      return sendFailure("PRINTER_REJECTED", "Image has the wrong dimensions", "not-sent")

    var sendStarted = false
    try {
      val search = PrinterSearcher.startNetworkSearch(context, NetworkSearchOption(5.0, false), input.ip)
      if (search.error.code.toString() != "NoError")
        return sendFailure("CONNECTION_FAILED", search.error.code.toString(), "not-sent")
      val match = search.channels.any { channel ->
        val found = device(channel) ?: return@any false
        val key = if (input.identityKind == "serial") "serial" else "mac"
        found["ip"] == input.ip && found[key]?.equals(input.identityValue, ignoreCase = key == "mac") == true
      }
      if (!match) return sendFailure("PRINTER_REJECTED", "Printer identity changed", "not-sent")

      val opened = PrinterDriverGenerator.openChannel(Channel.newWifiChannel(input.ip))
      if (opened.error.code != OpenChannelError.ErrorCode.NoError)
        return sendFailure("CONNECTION_FAILED", opened.error.code.toString(), "not-sent")
      val driver = opened.driver
      try {
        val settings = QLPrintSettings(PrinterModel.QL_810W).apply {
          labelSize = QLPrintSettings.LabelSize.DieCutW62H29
          numCopies = input.copies
          isAutoCut = true
          autoCutForEachPageCount = 1
        }
        sendStarted = true
        val result = driver.printImage(file.path, settings)
        if (result.code.toString() == "NoError") return success(mapOf("confirmation" to "sdk"))
        val name = result.code.toString()
        val code = when {
          name.contains("PaperEmpty", true) -> "PAPER_EMPTY"
          name.contains("LabelSize", true) || name.contains("PaperSize", true) -> "PAPER_MISMATCH"
          name.contains("CoverOpen", true) -> "COVER_OPEN"
          name.contains("Communication", true) || name.contains("Timeout", true) -> "COMMUNICATION_FAILED"
          else -> "DEVICE_ERROR"
        }
        return sendFailure(code, name, "unknown")
      } finally {
        try { driver.closeChannel() }
        catch (error: Exception) { Log.w("BrotherPrinter", "Could not close printer channel", error) }
      }
    } catch (error: SecurityException) {
      return sendFailure("CONNECTION_FAILED", error.message ?: "Network permission denied", if (sendStarted) "unknown" else "not-sent")
    } catch (error: Exception) {
      return sendFailure("COMMUNICATION_FAILED", error.message ?: "Printer communication failed", if (sendStarted) "unknown" else "not-sent")
    }
  }

  private fun validIp(ip: String): Boolean = ip.split('.').let { parts ->
    parts.size == 4 && parts.all { it.isNotEmpty() && it.length <= 3 && it.all(Char::isDigit) && it.toIntOrNull()?.let { value -> value in 0..255 } == true }
  }

  private fun success(data: Any): Map<String, Any> = mapOf("status" to "ok", "data" to data)

  private fun failure(code: String, message: String): Map<String, Any> =
    mapOf("status" to "error", "code" to code, "message" to message)

  private fun sendFailure(code: String, message: String, outcome: String): Map<String, Any> =
    mapOf("status" to "error", "code" to code, "message" to message, "outcome" to outcome)
}
