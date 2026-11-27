package ca.almontecurling.drawclock

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.AlertDialog
import androidx.wear.compose.material3.AlertDialogDefaults
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.OutlinedButton
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SwitchButton
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val vm: ClockViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Poll only while the app is on screen (battery).
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.STARTED) { vm.poll() } }
        setContent {
            MaterialTheme {
                AppScaffold {
                    val msg = vm.message
                    LaunchedEffect(msg) {
                        if (msg != null) {
                            Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show()
                            vm.message = null
                        }
                    }
                    when (vm.screen) {
                        Screen.Loading -> Loading()
                        Screen.Pin -> PinScreen(vm)
                        Screen.Clock -> ClockScreen(vm)
                    }
                }
            }
        }
    }
}

// Same colours as the TV display: yellow at the warning, red at time's up, blue before a delayed start.
private val Yellow = Color(0xFFF2C25B)
private val Red = Color(0xFFE5484D)
private val Blue = Color(0xFF7FB2FF)

@Composable
private fun Loading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(Modifier.size(40.dp))
    }
}

/** Club PIN, typed once: a number pad, then kept encrypted on the watch. */
@Composable
private fun PinScreen(vm: ClockViewModel) {
    var pin by remember { mutableStateOf("") }
    val listState = rememberScalingLazyListState()
    ScreenScaffold(scrollState = listState) {
        ScalingLazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
            item {
                Text(
                    vm.pinError ?: "Club PIN",
                    color = if (vm.pinError != null) Red else MaterialTheme.colorScheme.onSurface,
                    textAlign = TextAlign.Center,
                )
            }
            item {
                Text(
                    if (pin.isEmpty()) "–" else "•".repeat(pin.length),
                    fontSize = 26.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
                )
            }
            listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("⌫", "0", "OK")).forEach { row ->
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { key ->
                            FilledTonalButton(
                                onClick = {
                                    when (key) {
                                        "⌫" -> pin = pin.dropLast(1)
                                        "OK" -> vm.submitPin(pin)
                                        else -> if (pin.length < 12) pin += key
                                    }
                                },
                                enabled = !vm.busy,
                                modifier = Modifier.size(width = 52.dp, height = 44.dp),
                                contentPadding = ButtonDefaults.CompactButtonContentPadding,
                            ) {
                                Text(key, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** A confirmation waiting for Yes: its question and what Yes does. */
private data class Ask(val title: String, val text: String, val yes: () -> Unit)

@Composable
private fun ClockScreen(vm: ClockViewModel) {
    val s = vm.state
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(250)
        }
    }
    var ask by remember { mutableStateOf<Ask?>(null) }
    val v = s?.let { clockView(it, now + vm.offsetMs) }
    // A bonspiel draw is run from the Bonspiel Manager scoreboard; changing it here only changes the TV.
    fun guarded(action: String, run: () -> Unit) {
        if (v?.bonspiel == true) {
            ask = Ask("Bonspiel draw", "$action here only changes the rink TV, not the scoreboard. Go ahead?", run)
        } else run()
    }

    val listState = rememberScalingLazyListState()
    ScreenScaffold(scrollState = listState) {
        ScalingLazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
            item {
                Text(
                    v?.label?.ifEmpty { "ACC Draw Clock" } ?: "ACC Draw Clock",
                    style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center,
                )
            }
            item {
                Text(
                    v?.clock ?: "--:--",
                    fontSize = 40.sp, fontWeight = FontWeight.Bold,
                    color = when (v?.tone) {
                        Tone.Warn -> Yellow
                        Tone.Over -> Red
                        Tone.Pre -> Blue
                        else -> MaterialTheme.colorScheme.onSurface
                    },
                )
            }
            item {
                Text(
                    (v?.sub ?: "Loading…") + if (vm.offline) " · offline" else "",
                    style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (v?.live == true) {
                item {
                    Button(
                        onClick = { guarded(if (v.paused) "Resuming it" else "Pausing it") { vm.pauseOrResume() } },
                        enabled = !vm.busy, modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (v.paused) "Resume" else "Pause") }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(-1, 1).forEach { m ->
                            FilledTonalButton(
                                onClick = { guarded("Changing the time") { vm.adjust(m) } },
                                enabled = !vm.busy,
                                modifier = Modifier.size(width = 70.dp, height = 44.dp),
                            ) { Text(if (m < 0) "−1 min" else "+1 min", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) }
                        }
                    }
                }
                item {
                    OutlinedButton(
                        onClick = {
                            if (v.bonspiel) guarded("Stopping it") { vm.stop() }
                            else ask = Ask("Stop the clock?", "The TV goes back to the logo.") { vm.stop() }
                        },
                        enabled = !vm.busy, modifier = Modifier.fillMaxWidth(),
                    ) { Text("Stop") }
                }
            }
            item {
                SwitchButton(
                    checked = s?.buzzer != false,
                    onCheckedChange = { vm.setBuzzer(it) },
                    enabled = !vm.busy && s != null, modifier = Modifier.fillMaxWidth(),
                ) { Text("Buzzer") }
            }
            vm.config?.presets?.forEach { p ->
                item {
                    FilledTonalButton(
                        onClick = {
                            val replace = "Replacing it with \"${p.label}\""
                            when {
                                v?.bonspiel == true -> guarded(replace) { vm.startPreset(p) }
                                v?.live == true -> ask = Ask("Replace the draw?", "Start \"${p.label}\" instead?") { vm.startPreset(p) }
                                else -> vm.startPreset(p)
                            }
                        },
                        enabled = !vm.busy, modifier = Modifier.fillMaxWidth(),
                        secondaryLabel = { Text("${p.minutes} min") },
                    ) { Text("Start ${p.label}") }
                }
            }
            item {
                OutlinedButton(onClick = { vm.lock() }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Text("Lock (forget PIN)", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }

    val a = ask
    AlertDialog(
        visible = a != null,
        onDismissRequest = { ask = null },
        title = { Text(a?.title ?: "", textAlign = TextAlign.Center) },
        text = { Text(a?.text ?: "", textAlign = TextAlign.Center) },
        confirmButton = { AlertDialogDefaults.ConfirmButton(onClick = { a?.yes?.invoke(); ask = null }) },
        dismissButton = { AlertDialogDefaults.DismissButton(onClick = { ask = null }) },
    )
}
