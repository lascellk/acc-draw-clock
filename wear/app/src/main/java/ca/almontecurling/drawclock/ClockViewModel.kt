package ca.almontecurling.drawclock

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

enum class Screen { Loading, Pin, Clock }

/**
 * Same flow as the phone control page: load the config, check the saved PIN, then poll the state every
 * 5 s while the app is on screen (MainActivity runs poll() only while started, to save battery).
 */
class ClockViewModel(app: Application) : AndroidViewModel(app) {
    private val pins = PinStore(app)
    private var pin = ""
    private val prefs = app.getSharedPreferences("custom", android.content.Context.MODE_PRIVATE)

    /** The Custom countdown's minutes, remembered from last time (like the phone page). */
    var customMinutes by mutableStateOf(prefs.getInt("minutes", 30)); private set

    var screen by mutableStateOf(Screen.Loading); private set
    var config by mutableStateOf<Config?>(null); private set
    var state by mutableStateOf<ClockState?>(null); private set
    /** Server clock minus watch clock, so the countdown matches the TV. */
    var offsetMs by mutableStateOf(0L); private set
    var busy by mutableStateOf(false); private set
    /** One-off message for the screen (MainActivity shows it as a toast and clears it). */
    var message by mutableStateOf<String?>(null)
    var pinError by mutableStateOf<String?>(null); private set
    var offline by mutableStateOf(false); private set

    init {
        start()
    }

    private fun start() {
        viewModelScope.launch {
            while (true) {
                try {
                    val cfg = Api.config()
                    config = cfg
                    if (!cfg.pinRequired) return@launch unlock("")
                    val saved = pins.load()
                    if (saved.isNotEmpty() && verify(saved)) return@launch unlock(saved)
                    screen = Screen.Pin
                    return@launch
                } catch (e: Exception) {
                    offline = true
                    message = "Can't reach the clock server"
                    delay(5000)
                }
            }
        }
    }

    /** true = accepted, false = wrong PIN; network trouble throws. */
    private suspend fun verify(p: String): Boolean = try {
        applyState(Api.send(p, "verify"))
        true
    } catch (e: Api.ServerError) {
        if (e.message == "Wrong PIN") false else throw e
    }

    private fun unlock(p: String) {
        pin = p
        pins.save(p)
        pinError = null
        screen = Screen.Clock
    }

    fun submitPin(p: String) {
        if (p.isEmpty() || busy) return
        viewModelScope.launch {
            busy = true
            try {
                if (verify(p)) unlock(p) else pinError = "Wrong PIN"
            } catch (e: Exception) {
                pinError = "Can't reach the server"
            } finally {
                busy = false
            }
        }
    }

    fun lock(reason: String? = null) {
        pin = ""
        pins.save("")
        pinError = reason
        screen = Screen.Pin
    }

    /** Polls while the caller's coroutine runs (MainActivity: only while the app is on screen). */
    suspend fun poll() {
        while (true) {
            if (screen == Screen.Clock) refresh()
            delay(5000)
        }
    }

    private suspend fun refresh() {
        try {
            applyState(Api.state())
        } catch (e: Exception) {
            offline = true // keep counting from the last state
        }
    }

    private fun applyState(s: ClockState) {
        state = s
        offsetMs = s.serverNow - System.currentTimeMillis()
        offline = false
    }

    /** A one-off countdown; no warningMin, so the server picks the automatic warning (a quarter, up to the usual). */
    fun startCustom(minutes: Int) {
        customMinutes = minutes
        prefs.edit().putInt("minutes", minutes).apply()
        send("start", JSONObject().put("presetId", "custom").put("minutes", minutes).put("delayMin", 0))
    }

    fun startPreset(p: Preset) = send("start", JSONObject().put("presetId", p.id).put("minutes", p.minutes).put("delayMin", 0))
    fun pauseOrResume() = send(if (state?.status == "paused") "resume" else "pause")
    fun adjust(minutes: Int) = send("adjust", JSONObject().put("minutes", minutes))
    fun stop() = send("stop")
    fun setBuzzer(on: Boolean) = send("buzzer", JSONObject().put("on", on))

    private fun send(cmd: String, arg: JSONObject = JSONObject()) {
        if (busy) return
        viewModelScope.launch {
            busy = true
            try {
                applyState(Api.send(pin, cmd, arg))
                message = "Done"
            } catch (e: Api.ServerError) {
                // The PIN was set or changed since the watch unlocked.
                if (e.message == "Wrong PIN") lock("The club PIN has changed") else message = e.message
            } catch (e: Exception) {
                message = "Can't reach the clock server"
            } finally {
                busy = false
            }
        }
    }
}
