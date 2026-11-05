// Display settings. Paste the Apps Script web app URL (ends in /exec).
// You can also override it per device with ?url=<exec URL> on the page address.
window.ACC_CONFIG = {
  stateUrl: '',
  pollMs: 5000,          // how often to ask the server for changes
  staleAfterMs: 30000,   // show "offline" note after this long without an update
};
