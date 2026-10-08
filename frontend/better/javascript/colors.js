/* exported LibreSpeedColors */
/**
 * Colors of the theme tokens for what the pages paint on a canvas
 *
 * The tokens (see styling/tokens.css) are written in OKLCH and can be changed by the theme, so the canvas cannot use
 * them directly. LibreSpeedColors.read("--primary") gives the color as [r, g, b, a], and LibreSpeedColors.css(color, alpha)
 * a CSS color for a canvas. The colors are read again after a theme or an accessibility change.
 */
var LibreSpeedColors = (function () {
  "use strict";

  var cache = {};
  var probe = null;
  var context = null;

  function resolve(token) {
    if (!probe) {
      probe = document.createElement("span");
      probe.style.display = "none";
      document.body.appendChild(probe);
      context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    }
    probe.style.color = "var(" + token + ")";
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000000";
    context.fillStyle = getComputedStyle(probe).color;
    context.fillRect(0, 0, 1, 1);
    var pixel = context.getImageData(0, 0, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
  }

  function read(token) {
    if (!cache[token]) cache[token] = resolve(token);
    return cache[token];
  }

  function css(color, alpha) {
    var opacity = color[3] * (alpha === undefined ? 1 : alpha);
    return "rgba(" + color[0] + "," + color[1] + "," + color[2] + "," + opacity + ")";
  }

  function invalidate() {
    cache = {};
  }

  window.addEventListener("themechange", invalidate);
  window.addEventListener("accessibilitychange", invalidate);

  return { read: read, css: css, invalidate: invalidate };
})();
