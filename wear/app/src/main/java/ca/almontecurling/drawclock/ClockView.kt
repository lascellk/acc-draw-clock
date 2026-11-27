package ca.almontecurling.drawclock

import java.text.DateFormat
import java.util.Date
import kotlin.math.ceil

enum class Tone { Normal, Pre, Warn, Over }

/** What the clock shows, by the same rules as the display and the phone page (render() in control/index.html). */
data class ClockView(
    val label: String,
    val clock: String,
    val sub: String,
    val tone: Tone,
    /** A draw is on the clock (paused, waiting or counting): Pause, ±1 and Stop are on. */
    val live: Boolean,
    val paused: Boolean,
    val bonspiel: Boolean,
)

fun clockView(s: ClockState, now: Long, endsText: (Long) -> String = ::shortTime): ClockView {
    // A draw left on "Time's up" clears itself; shown as idle until the next poll brings the server's idle state.
    val cleared = s.status == "running" && s.clearAfterMin > 0 && s.endsAt != null && now - s.endsAt >= s.clearAfterMin * 60000
    val status = if (cleared) "idle" else s.status
    val warnMs = s.warningMin * 60000
    var tone = Tone.Normal
    var clock = "--:--"
    val sub: String
    when {
        status == "idle" -> sub = "No draw on the clock"
        status == "paused" -> {
            val pre = (s.startDelayMsWhenPaused ?: 0) > 0
            val ms = if (pre) s.startDelayMsWhenPaused ?: 0 else s.remainingMsWhenPaused ?: 0
            clock = fmt(ms)
            sub = if (pre) "Paused (before start)" else "Paused"
            tone = if (pre) Tone.Pre else if (ms <= warnMs) Tone.Warn else Tone.Normal
        }
        s.startsAt != null && now < s.startsAt -> {
            clock = fmt(s.startsAt - now); sub = "Starts in"; tone = Tone.Pre
        }
        (s.endsAt ?: now) - now <= 0 -> {
            clock = "00:00"; sub = "Time's up · +" + fmt(now - (s.endsAt ?: now)).removePrefix("0"); tone = Tone.Over
        }
        else -> {
            val ms = s.endsAt!! - now
            clock = fmt(ms)
            if (ms <= warnMs) { tone = Tone.Warn; sub = "Warning" } else sub = "Ends " + endsText(s.endsAt)
        }
    }
    return ClockView(
        label = if (status == "idle") "" else s.label,
        clock = clock, sub = sub, tone = tone,
        live = status != "idle",
        paused = status == "paused",
        bonspiel = status != "idle" && s.source == "bonspiel",
    )
}

/** mm:ss, rounded up like the TV, so 00:00 only shows at zero. */
fun fmt(ms: Long): String {
    val total = ceil(maxOf(0L, ms) / 1000.0).toLong()
    return "%02d:%02d".format(total / 60, total % 60)
}

private fun shortTime(ms: Long): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(ms))
