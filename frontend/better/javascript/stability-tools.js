/* exported LibreSpeedStability */
/**
 * Helpers of the stability page: number format, rating, alert beep and CSV download
 *
 * LibreSpeedStability.format(value) formats a time in ms ("--" when there is none)
 * LibreSpeedStability.rating(average, jitter, loss) gives "great", "good", "poor", "bad" or "none"
 * LibreSpeedStability.ratingLabel(rating) is the text of a rating in the language of the page
 * LibreSpeedStability.beep() plays the alert sound (at most once a second)
 * LibreSpeedStability.downloadCsv(pings, suffix) saves the measurements as stability_test_<suffix>.csv
 */
var LibreSpeedStability = (function () {
  "use strict";

  var lastBeep = 0;
  var audioContext = null;

  function format(value) {
    value = Number(value);
    if (isNaN(value) || value <= 0) return "--";
    if (value < 10) return value.toFixed(2);
    if (value < 100) return value.toFixed(1);
    return value.toFixed(0);
  }

  function rating(average, jitter, loss) {
    if (average <= 0) return "none";
    if (average < 30 && jitter < 5 && loss < 0.5) return "great";
    if (average < 60 && jitter < 15 && loss < 2) return "good";
    if (average < 100 && jitter < 30 && loss < 5) return "poor";
    return "bad";
  }

  var RATING_TEXT = { great: "Great", good: "Good", poor: "Poor", bad: "Bad" };

  function ratingLabel(value) {
    if (!RATING_TEXT[value]) return "--";
    return window.LibreSpeedI18n.t("stability." + value, RATING_TEXT[value]);
  }

  function beep() {
    var now = new Date().getTime();
    if (now - lastBeep < 1000) return;
    lastBeep = now;
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();
      oscillator.frequency.value = 800;
      gain.gain.value = 0.3;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
      // No audio available: the alert is only missed
    }
  }

  function downloadCsv(pings, suffix) {
    if (!pings || pings.length === 0) return;
    var csv = "elapsed_s,ping_ms,failed\n";
    for (var i = 0; i < pings.length; i++) {
      csv += pings[i].t.toFixed(3) + "," + pings[i].ping.toFixed(2) + "," + (pings[i].lost ? "1" : "0") + "\n";
    }
    var url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    var link = document.createElement("a");
    link.href = url;
    link.download = "stability_test_" + suffix + ".csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return { format: format, rating: rating, ratingLabel: ratingLabel, beep: beep, downloadCsv: downloadCsv };
})();
