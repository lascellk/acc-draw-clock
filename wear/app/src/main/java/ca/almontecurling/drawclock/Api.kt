package ca.almontecurling.drawclock

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The Apps Script /exec JSON API, the same one the phone control page (control/index.html) uses:
 *   GET  ?mode=config | ?mode=state
 *   POST text/plain {pin, cmd, arg}  ->  {ok, state} or {ok: false, error}
 * Apps Script answers every call with a 302 to script.googleusercontent.com, where the result is
 * fetched with a GET. Redirects are followed by hand so a POST is never re-sent or dropped.
 */
object Api {
    private const val EXEC_URL =
        "https://script.google.com/macros/s/AKfycbwU_wM84nwdgzD-wbVRGAq7vwXXuVEgfHiOFh1I4ZcPjYek5JcBRp7nkUwduYVeRo8T/exec"

    class ServerError(message: String) : Exception(message)

    suspend fun config(): Config = Config.from(get("$EXEC_URL?mode=config&_=${System.currentTimeMillis()}"))

    suspend fun state(): ClockState = ClockState.from(get("$EXEC_URL?mode=state&_=${System.currentTimeMillis()}"))

    /** Sends a command; returns the new state or throws ServerError with the server's message ("Wrong PIN", ...). */
    suspend fun send(pin: String, cmd: String, arg: JSONObject = JSONObject()): ClockState {
        val body = JSONObject().put("pin", pin).put("cmd", cmd).put("arg", arg).toString()
        val res = request(EXEC_URL, body)
        if (!res.optBoolean("ok")) throw ServerError(res.optString("error").ifBlank { "Something went wrong" })
        return ClockState.from(res.getJSONObject("state"))
    }

    private suspend fun get(url: String): JSONObject = request(url, null)

    private suspend fun request(url: String, postBody: String?): JSONObject = withContext(Dispatchers.IO) {
        var next = url
        var body = postBody
        repeat(5) {
            val c = (URL(next).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15000
                readTimeout = 30000
                useCaches = false
                if (body != null) {
                    requestMethod = "POST"
                    doOutput = true
                    setRequestProperty("Content-Type", "text/plain;charset=utf-8")
                }
            }
            try {
                body?.let { b -> c.outputStream.use { it.write(b.toByteArray(Charsets.UTF_8)) } }
                val code = c.responseCode
                if (code in 300..399) {
                    next = c.getHeaderField("Location") ?: throw ServerError("Server error $code")
                    body = null // the result is at the redirect address, fetched with a GET
                    return@repeat
                }
                if (code !in 200..299) throw ServerError("Server error $code")
                val text = c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                return@withContext JSONObject(text)
            } finally {
                c.disconnect()
            }
        }
        throw ServerError("Too many redirects")
    }
}

data class Preset(val id: String, val label: String, val minutes: Int)

data class Config(val presets: List<Preset>, val pinRequired: Boolean) {
    companion object {
        fun from(j: JSONObject): Config {
            val arr = j.optJSONArray("presets")
            val presets = (0 until (arr?.length() ?: 0)).map { i ->
                val p = arr!!.getJSONObject(i)
                Preset(p.getString("id"), p.getString("label"), p.getInt("minutes"))
            }
            return Config(presets, j.optBoolean("pinRequired"))
        }
    }
}

/** The server's public state (publicState_ in apps-script/Code.gs). Times are epoch ms on the server clock. */
data class ClockState(
    val status: String, // idle | running | paused
    val label: String,
    val startsAt: Long?,
    val endsAt: Long?,
    val remainingMsWhenPaused: Long?,
    val startDelayMsWhenPaused: Long?,
    val warningMin: Double,
    val buzzer: Boolean,
    val clearAfterMin: Double,
    val source: String,
    val serverNow: Long,
) {
    companion object {
        private fun JSONObject.long(k: String): Long? = if (isNull(k)) null else optDouble(k).takeIf { !it.isNaN() }?.toLong()

        fun from(j: JSONObject) = ClockState(
            status = j.optString("status", "idle"),
            label = if (j.isNull("label")) "" else j.optString("label"),
            startsAt = j.long("startsAt"),
            endsAt = j.long("endsAt"),
            remainingMsWhenPaused = j.long("remainingMsWhenPaused"),
            startDelayMsWhenPaused = j.long("startDelayMsWhenPaused"),
            warningMin = j.optDouble("warningMin", 15.0),
            buzzer = j.optBoolean("buzzer", true),
            clearAfterMin = j.optDouble("clearAfterMin", 25.0),
            source = if (j.isNull("source")) "" else j.optString("source"),
            serverNow = j.long("serverNow") ?: System.currentTimeMillis(),
        )
    }
}
