/* global LibreSpeedColors, LibreSpeedI18n */
/* exported LibreSpeedChart */
/**
 * Chart styles for the stability page
 *
 * Two styles on the same canvas:
 *   polished  smooth line with a gradient area, dashed grid, loss marks, pulsing last point and a tooltip
 *   bands     like polished, with green/yellow/red quality bands and a line colored by band
 *
 * LibreSpeedChart.draw(canvas, style, state) draws one frame, where state is
 *   { data: [{ t, ping, lost }, ...], threshold: alert threshold in ms (0 = off) }
 *
 * Colors come from the theme tokens (see colors.js). Text and spacing follow the root font size, so the chart
 * grows with the text size option.
 *
 * The helpers used by chart-uplot.js are exported too: view, rgba, colors, fmtTime, GUTTER.
 */
var LibreSpeedChart = (function () {
  "use strict";

  var VISIBLE_SECONDS = 60; // visible window in seconds
  var GUTTER = 28; // equal margin in px between the plot and the frame, on the four sides
  var STYLES = {};
  var palette = null;
  var hover = null; // pointer position as a fraction of the canvas width, while it is over the canvas
  var hoverBound = false;

  function fmtTime(seconds) {
    var minutes = Math.floor(seconds / 60);
    var rest = Math.floor(seconds % 60);
    return (minutes < 10 ? "0" : "") + minutes + ":" + (rest < 10 ? "0" : "") + rest;
  }

  function rgba(color, alpha) {
    return "rgba(" + color[0] + "," + color[1] + "," + color[2] + "," + alpha + ")";
  }

  // The palette comes from the theme tokens (see colors.js), so the theme, the brand color and high contrast all apply
  function colors() {
    if (palette) return palette;
    var read = LibreSpeedColors.read;
    var dark = !!(window.LibreSpeedTheme && window.LibreSpeedTheme.isDark());
    palette = {
      dark: dark,
      primary: read("--primary"),
      text: read("--muted"),
      fg: read("--text"),
      grid: read("--border"),
      surface: read("--surface"),
      good: read("--great"),
      warn: read("--poor"),
      bad: read("--bad")
    };
    return palette;
  }

  function invalidateColors() {
    palette = null;
  }

  window.addEventListener("themechange", invalidateColors);
  window.addEventListener("accessibilitychange", invalidateColors);

  // Visible window (the last 60 seconds) and the Y scale (at least 50 ms, plus 20%)
  function view(data) {
    var lastTime = data.length ? data[data.length - 1].t : 0;
    var end = Math.max(VISIBLE_SECONDS, lastTime);
    var start = end - VISIBLE_SECONDS;
    var low = 0;
    var high = data.length - 1;
    while (low <= high) {
      var middle = (low + high) >> 1;
      if (data[middle].t < start) low = middle + 1;
      else high = middle - 1;
    }
    var points = [];
    var max = 50;
    for (var i = low; i < data.length && data[i].t <= end; i++) {
      points.push(data[i]);
      if (!data[i].lost && data[i].ping > max) max = data[i].ping;
    }
    return { t0: start, t1: end, pts: points, yMax: Math.ceil((max * 1.2) / 10) * 10 };
  }

  // Continuous runs of points (a lost ping is a gap)
  function segments(points) {
    var runs = [];
    var current = [];
    points.forEach(function (point) {
      if (point.lost) {
        if (current.length) runs.push(current);
        current = [];
      } else {
        current.push(point);
      }
    });
    if (current.length) runs.push(current);
    return runs;
  }

  function getYSteps(yMax) {
    if (yMax <= 50) return [10, 20, 30, 40, 50];
    if (yMax <= 100) return [20, 40, 60, 80, 100];
    if (yMax <= 200) return [50, 100, 150, 200];
    if (yMax <= 500) return [100, 200, 300, 400, 500];
    var step = Math.ceil(yMax / 5 / 100) * 100;
    var steps = [];
    for (var value = step; value <= yMax; value += step) steps.push(value);
    return steps;
  }

  // Monotone cubic spline (Fritsch-Carlson) as Bezier curves. With "continue" the current path goes on
  function smoothPath(ctx, p, continuePath) {
    var n = p.length;
    if (!n) return;
    if (continuePath) ctx.lineTo(p[0][0], p[0][1]);
    else ctx.moveTo(p[0][0], p[0][1]);
    if (n === 1) return;
    var dx = [];
    var slope = [];
    var tangent = [];
    var i;
    for (i = 0; i < n - 1; i++) {
      dx[i] = p[i + 1][0] - p[i][0];
      slope[i] = dx[i] ? (p[i + 1][1] - p[i][1]) / dx[i] : 0;
    }
    tangent[0] = slope[0];
    tangent[n - 1] = slope[n - 2];
    for (i = 1; i < n - 1; i++) tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (slope[i] === 0) {
        tangent[i] = 0;
        tangent[i + 1] = 0;
        continue;
      }
      var a = tangent[i] / slope[i];
      var b = tangent[i + 1] / slope[i];
      var squares = a * a + b * b;
      if (squares > 9) {
        var scale = 3 / Math.sqrt(squares);
        tangent[i] = scale * a * slope[i];
        tangent[i + 1] = scale * b * slope[i];
      }
    }
    for (i = 0; i < n - 1; i++) {
      var h = dx[i] / 3;
      ctx.bezierCurveTo(
        p[i][0] + h,
        p[i][1] + tangent[i] * h,
        p[i + 1][0] - h,
        p[i + 1][1] - tangent[i + 1] * h,
        p[i + 1][0],
        p[i + 1][1]
      );
    }
  }

  // Sizes and scales shared by all the layers. dp is the device pixel ratio times the text size scale
  function makeLayout(ctx, box, v) {
    var W = box.W;
    var H = box.H;
    var dp = box.dp;
    ctx.font = 11 * dp + "px sans-serif";
    ctx.textBaseline = "middle";
    var gutter = GUTTER * dp;
    var left = Math.max(gutter, ctx.measureText(String(v.yMax)).width + 8 * dp);
    var plotWidth = W - left - gutter;
    var plotHeight = H - 2 * gutter;
    var win = v.t1 - v.t0;
    return {
      dp: dp,
      W: W,
      H: H,
      pl: left,
      pr: gutter,
      pt: gutter,
      pb: gutter,
      pw: plotWidth,
      ph: plotHeight,
      win: win,
      X: function (t) {
        return left + ((t - v.t0) / win) * plotWidth;
      },
      Y: function (value) {
        return gutter + plotHeight - (value / v.yMax) * plotHeight;
      }
    };
  }

  function pointsOf(L, run) {
    return run.map(function (d) {
      return [L.X(d.t), L.Y(d.ping)];
    });
  }

  function bandColor(C, ping) {
    return ping < 30 ? C.good : ping < 80 ? C.warn : C.bad;
  }

  // ---- layers: function (ctx, L, D, S), L = layout, D = data and colors, S = { state, style } ----

  function qualityBands(ctx, L, D) {
    var C = D.C;
    var yMax = D.v.yMax;
    [
      [0, 30, C.good],
      [30, 80, C.warn],
      [80, yMax, C.bad]
    ].forEach(function (band) {
      if (band[0] >= yMax) return;
      var top = L.Y(Math.min(band[1], yMax));
      var bottom = L.Y(band[0]);
      ctx.fillStyle = rgba(band[2], C.dark ? 0.07 : 0.08);
      ctx.fillRect(L.pl, top, L.pw, bottom - top);
    });
  }

  function gridDashedY(ctx, L, D) {
    var dp = L.dp;
    ctx.strokeStyle = rgba(D.C.grid, 1);
    ctx.lineWidth = dp;
    ctx.fillStyle = rgba(D.C.text, 1);
    ctx.textAlign = "right";
    getYSteps(D.v.yMax)
      .concat([0])
      .forEach(function (value) {
        if (value > D.v.yMax) return;
        var y = L.Y(value);
        ctx.beginPath();
        ctx.setLineDash([3 * dp, 4 * dp]);
        ctx.moveTo(L.pl, y);
        ctx.lineTo(L.pl + L.pw, y);
        ctx.stroke();
        ctx.fillText(String(value), L.pl - 6 * dp, y);
      });
  }

  function xLabels(ctx, L, D) {
    ctx.fillStyle = rgba(D.C.text, 1);
    ctx.setLineDash([]);
    ctx.textAlign = "center";
    var tick = L.win <= 60 ? 10 : L.win <= 120 ? 15 : 30;
    for (var t = Math.ceil(D.v.t0 / tick) * tick; t <= D.v.t1; t += tick) {
      ctx.fillText(fmtTime(t), L.X(t), L.pt + L.ph + 14 * L.dp);
    }
  }

  function msLabel(ctx, L, D) {
    ctx.fillStyle = rgba(D.C.text, 1);
    ctx.textAlign = "left";
    ctx.fillText("ms", L.pl + 4 * L.dp, L.pt - 6 * L.dp);
  }

  function clipOn(ctx, L) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.pl, L.pt - 2 * L.dp, L.pw, L.ph + 4 * L.dp);
    ctx.clip();
  }

  function clipOff(ctx) {
    ctx.restore();
  }

  function areaGradient(ctx, L, D, S) {
    D.segs.forEach(function (run) {
      if (run.length < 2) return;
      var p = pointsOf(L, run);
      var base = L.pt + L.ph;
      ctx.beginPath();
      ctx.moveTo(p[0][0], base);
      smoothPath(ctx, p, true);
      ctx.lineTo(p[p.length - 1][0], base);
      ctx.closePath();
      var gradient = ctx.createLinearGradient(0, L.pt, 0, base);
      gradient.addColorStop(0, rgba(D.C.primary, S.style.areaAlpha));
      gradient.addColorStop(1, rgba(D.C.primary, 0));
      ctx.fillStyle = gradient;
      ctx.fill();
    });
  }

  function avgLine(ctx, L, D) {
    if (!D.vals.length) return;
    ctx.setLineDash([6 * L.dp, 5 * L.dp]);
    ctx.strokeStyle = rgba(D.C.fg, 0.35);
    ctx.lineWidth = L.dp;
    ctx.beginPath();
    ctx.moveTo(L.pl, L.Y(D.avg));
    ctx.lineTo(L.pl + L.pw, L.Y(D.avg));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Vertical gradient that colors the line by quality band
  function bandGradient(ctx, L, D) {
    var C = D.C;
    var yMax = D.v.yMax;
    var clamp = function (x) {
      return Math.min(1, Math.max(0, x));
    };
    var at80 = 1 - 80 / yMax;
    var at30 = 1 - 30 / yMax;
    var edge = 0.02;
    var gradient = ctx.createLinearGradient(0, L.pt, 0, L.pt + L.ph);
    gradient.addColorStop(0, rgba(C.bad, 1));
    gradient.addColorStop(clamp(at80 - edge), rgba(C.bad, 1));
    gradient.addColorStop(clamp(at80 + edge), rgba(C.warn, 1));
    gradient.addColorStop(clamp(at30 - edge), rgba(C.warn, 1));
    gradient.addColorStop(clamp(at30 + edge), rgba(C.good, 1));
    gradient.addColorStop(1, rgba(C.good, 1));
    return gradient;
  }

  function lineSmooth(ctx, L, D, S) {
    ctx.lineWidth = 2.25 * L.dp;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = S.style.banded ? bandGradient(ctx, L, D) : rgba(D.C.primary, 1);
    D.segs.forEach(function (run) {
      ctx.beginPath();
      smoothPath(ctx, pointsOf(L, run));
      ctx.stroke();
    });
  }

  // Lost pings: small bars at the bottom or, in the bands style, vertical stripes
  function lossMarks(ctx, L, D, S) {
    D.v.pts.forEach(function (d) {
      if (!d.lost) return;
      var x = L.X(d.t);
      if (S.style.banded) {
        ctx.fillStyle = rgba(D.C.bad, 0.3);
        ctx.fillRect(x - L.dp, L.pt, 2 * L.dp, L.ph);
        return;
      }
      ctx.fillStyle = rgba(D.C.bad, 0.8);
      ctx.fillRect(x - 1.5 * L.dp, L.pt + L.ph - 14 * L.dp, 3 * L.dp, 14 * L.dp);
    });
  }

  // Alert threshold line
  function threshold(ctx, L, D, S) {
    var limit = S.state.threshold;
    if (!(limit > 0 && limit <= D.v.yMax)) return;
    var y = L.Y(limit);
    ctx.strokeStyle = rgba(D.C.bad, 0.6);
    ctx.lineWidth = 1.5 * L.dp;
    ctx.setLineDash([6 * L.dp, 4 * L.dp]);
    ctx.beginPath();
    ctx.moveTo(L.pl, y);
    ctx.lineTo(L.pl + L.pw, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Pulsing dot on the last value (in the band color in the bands style)
  function pulse(ctx, L, D, S) {
    if (!D.vals.length) return;
    var last = D.vals[D.vals.length - 1];
    var color = S.style.banded ? bandColor(D.C, last.ping) : D.C.primary;
    var dp = L.dp;
    var beat = (Math.sin(performance.now() / 260) + 1) / 2;
    var x = L.X(last.t);
    var y = L.Y(last.ping);
    ctx.fillStyle = rgba(color, 0.25 * (1 - beat));
    ctx.beginPath();
    ctx.arc(x, y, (5 + 7 * beat) * dp, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = rgba(color, 1);
    ctx.beginPath();
    ctx.arc(x, y, 3.5 * dp, 0, 6.3);
    ctx.fill();
    ctx.strokeStyle = rgba(D.C.surface, 1);
    ctx.lineWidth = 1.5 * dp;
    ctx.stroke();
  }

  function avgLabel(ctx, L, D) {
    if (!D.vals.length) return;
    ctx.fillStyle = rgba(D.C.fg, 0.55);
    ctx.textAlign = "right";
    ctx.fillText(
      LibreSpeedI18n.t("chart.avg", "avg") + " " + D.avg.toFixed(1) + " ms",
      L.pl + L.pw - 4 * L.dp,
      L.Y(D.avg) - 8 * L.dp
    );
  }

  function nearest(values, t) {
    var best = null;
    var distance = 1e9;
    values.forEach(function (d) {
      var gap = Math.abs(d.t - t);
      if (gap < distance) {
        distance = gap;
        best = d;
      }
    });
    return { best: best, dist: distance };
  }

  // Cursor line, dot and a tooltip with the time and ping of the point closest to the pointer
  function hoverTip(ctx, L, D) {
    if (!hover) return;
    var time = D.v.t0 + ((hover.x * L.W - L.pl) / L.pw) * L.win;
    var found = nearest(D.vals, time);
    if (!found.best || found.dist >= 3) return;
    var dp = L.dp;
    var C = D.C;
    var best = found.best;
    var x = L.X(best.t);
    var y = L.Y(best.ping);
    ctx.strokeStyle = rgba(C.fg, 0.3);
    ctx.lineWidth = dp;
    ctx.setLineDash([4 * dp, 3 * dp]);
    ctx.beginPath();
    ctx.moveTo(x, L.pt);
    ctx.lineTo(x, L.pt + L.ph);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(C.primary, 1);
    ctx.beginPath();
    ctx.arc(x, y, 4 * dp, 0, 6.3);
    ctx.fill();
    var label = fmtTime(best.t) + "  ·  " + best.ping.toFixed(1) + " ms";
    var width = ctx.measureText(label).width + 16 * dp;
    var boxX = Math.min(Math.max(x - width / 2, L.pl), L.pl + L.pw - width);
    ctx.fillStyle = rgba(C.surface, 0.96);
    ctx.strokeStyle = rgba(C.grid, 1);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(boxX, L.pt + 4 * dp, width, 22 * dp, 6 * dp);
    else ctx.rect(boxX, L.pt + 4 * dp, width, 22 * dp);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgba(C.fg, 1);
    ctx.textAlign = "left";
    ctx.fillText(label, boxX + 8 * dp, L.pt + 15 * dp);
  }

  STYLES.polished = {
    areaAlpha: 0.38,
    layers: [
      gridDashedY,
      xLabels,
      msLabel,
      clipOn,
      areaGradient,
      lineSmooth,
      clipOff,
      lossMarks,
      threshold,
      pulse,
      hoverTip
    ]
  };
  STYLES.bands = {
    areaAlpha: 0.26,
    banded: true,
    layers: [
      qualityBands,
      gridDashedY,
      xLabels,
      msLabel,
      clipOn,
      areaGradient,
      avgLine,
      lineSmooth,
      clipOff,
      lossMarks,
      threshold,
      pulse,
      avgLabel,
      hoverTip
    ]
  };

  // The pointer position (a fraction of the width) feeds the tooltip
  function bindHover(canvas) {
    if (hoverBound) return;
    hoverBound = true;
    canvas.addEventListener("pointermove", function (event) {
      var box = canvas.getBoundingClientRect();
      hover = { x: (event.clientX - box.left) / box.width };
    });
    canvas.addEventListener("pointerleave", function () {
      hover = null;
    });
  }

  // Root font size relative to 16px: the text size option scales the chart text and spacing
  function textScale() {
    return (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
  }

  function draw(canvas, styleName, state) {
    var style = STYLES[styleName];
    if (!style) return;
    bindHover(canvas);
    var ctx = canvas.getContext("2d");
    var ratio = window.devicePixelRatio || 1;
    var W = canvas.clientWidth * ratio;
    var H = canvas.clientHeight * ratio;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    if (!(W > 60 * ratio) || !(H > 60 * ratio)) return;
    var C = colors();
    var v = view(state.data);
    var values = v.pts.filter(function (d) {
      return !d.lost;
    });
    var average = values.length
      ? values.reduce(function (sum, d) {
          return sum + d.ping;
        }, 0) / values.length
      : 0;
    var D = { v: v, C: C, segs: segments(v.pts), vals: values, avg: average };
    var L = makeLayout(ctx, { W: W, H: H, dp: ratio * textScale() }, v);
    var S = { state: state, style: style };
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < style.layers.length; i++) {
      if (style.layers[i](ctx, L, D, S) === false) break;
    }
  }

  return {
    draw: draw,
    view: view,
    rgba: rgba,
    colors: colors,
    fmtTime: fmtTime,
    textScale: textScale,
    GUTTER: GUTTER
  };
})();
