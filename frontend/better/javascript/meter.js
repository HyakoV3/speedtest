/* global LibreSpeedColors */
/* exported LibreSpeedMeter */
/**
 * Semicircular speed meter drawn on a canvas
 *
 * LibreSpeedMeter.draw(canvas, amount, { token, progress }) draws the track, the arc up to amount (0 to 1) in the color of
 * the theme token (for example "--primary"), four ticks and, when progress (0 to 1) is given, a thin progress ring.
 * LibreSpeedMeter.amount(mbps) turns a speed in Mbit/s into the position (0 to 1) on the logarithmic scale of the meter.
 * Needs colors.js. The canvas size comes from its CSS size, so the meter grows with the text size option.
 */
var LibreSpeedMeter = (function () {
  "use strict";

  // Decades of Mbit/s that get a tick (no numbers: they crowd the meter)
  var TICKS = [1, 10, 100, 1000];

  function amount(mbps) {
    return 1 - 1 / Math.pow(1.3, Math.sqrt(mbps));
  }

  function fontFamily() {
    return window.LibreSpeedFont ? window.LibreSpeedFont.family("body", "Arial, sans-serif") : "Arial, sans-serif";
  }

  // Geometry of the meter, and the resize and clear of the canvas. Null while the canvas is hidden (it has no size)
  function geometry(canvas) {
    var context = canvas.getContext("2d");
    var ratio = window.devicePixelRatio || 1;
    var width = canvas.clientWidth * ratio;
    var height = canvas.clientHeight * ratio;
    if (canvas.width === width && canvas.height === height) {
      context.clearRect(0, 0, width, height);
    } else {
      canvas.width = width;
      canvas.height = height;
    }
    if (!width || !height) return null;
    var scale = height * 0.0055;
    return {
      context: context,
      ratio: ratio,
      height: height,
      scale: scale,
      x: width / 2,
      y: height - 58 * scale,
      radius: height / 1.8 - 12 * scale
    };
  }

  function arc(g, color, end) {
    g.context.beginPath();
    g.context.strokeStyle = color;
    g.context.lineWidth = 12 * g.scale;
    g.context.arc(g.x, g.y, g.height / 1.8 - g.context.lineWidth, -Math.PI * 1.1, end);
    g.context.stroke();
  }

  function ticks(g, color) {
    var context = g.context;
    context.save();
    context.strokeStyle = color;
    context.globalAlpha = 0.45;
    context.lineWidth = Math.max(1, 1.3 * g.scale);
    for (var i = 0; i < TICKS.length; i++) {
      var angle = amount(TICKS[i]) * Math.PI * 1.2 - Math.PI * 1.1;
      context.beginPath();
      context.moveTo(
        g.x + (g.radius - 7 * g.scale) * Math.cos(angle),
        g.y + (g.radius - 7 * g.scale) * Math.sin(angle)
      );
      context.lineTo(
        g.x + (g.radius - 11 * g.scale) * Math.cos(angle),
        g.y + (g.radius - 11 * g.scale) * Math.sin(angle)
      );
      context.stroke();
    }
    context.restore();
  }

  // A thin ring inside the arc (outside it would meet the title), with the percentage small at the bottom
  function progressRing(g, progress, track, color, text) {
    var context = g.context;
    var radius = g.radius - 15 * g.scale;
    context.save();
    context.lineWidth = 2.5 * g.scale;
    context.lineCap = "round";
    context.beginPath();
    context.strokeStyle = track;
    context.arc(g.x, g.y, radius, -Math.PI * 1.1, Math.PI * 0.1);
    context.stroke();
    if (progress > 0) {
      context.beginPath();
      context.strokeStyle = color;
      context.arc(g.x, g.y, radius, -Math.PI * 1.1, progress * Math.PI * 1.2 - Math.PI * 1.1);
      context.stroke();
      context.fillStyle = text;
      context.globalAlpha = 0.7;
      context.font = Math.max(8 * g.ratio, 8.5 * g.scale) + "px " + fontFamily();
      context.textAlign = "center";
      context.textBaseline = "alphabetic";
      context.fillText(Math.round(progress * 100) + "%", g.x, g.height - 1 * g.scale);
    }
    context.restore();
  }

  function draw(canvas, value, options) {
    var g = geometry(canvas);
    if (!g) return;
    var track = LibreSpeedColors.css(LibreSpeedColors.read("--meter-track"));
    var color = LibreSpeedColors.css(LibreSpeedColors.read(options.token));
    var text = LibreSpeedColors.css(LibreSpeedColors.read("--text"));
    arc(g, track, Math.PI * 0.1);
    arc(g, color, value * Math.PI * 1.2 - Math.PI * 1.1);
    ticks(g, text);
    if (typeof options.progress !== "undefined") progressRing(g, options.progress, track, color, text);
  }

  return { draw: draw, amount: amount };
})();
