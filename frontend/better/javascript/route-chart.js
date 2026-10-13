/* global uPlot, LibreSpeedColors */
/* exported LibreSpeedRouteChart */
/**
 * Chart of the route: the time to each router, hop by hop
 *
 * Loaded by route.js only when the chart is chosen (with uPlot and colors.js), so nothing here runs before. It does not listen to
 * events and does not write texts of the page: route.js builds the data (LibreSpeedRouteView.chartData), the texts and calls render
 * again when the theme, the contrast, the size of the text or the language change.
 *
 * LibreSpeedRouteChart.render(host, data, options) draws the chart in host, in place of the one that was there:
 *   data    what LibreSpeedRouteView.chartData() gives
 *   options { xLabel, hint, readout, describe, other, describeOther } the text of the axis, the text of the line under the chart when
 *           nothing is pointed at, the element of that line, and describe(index) -> the text of a hop. other (what chartData() gives for
 *           the route of the other direction) is drawn under the first one, as a dashed line with empty marks, and describeOther(index) says
 *           its hop
 * LibreSpeedRouteChart.destroy() takes the chart away.
 * LibreSpeedRouteChart.info() is { builds, width, height, primary, xLabel, drops }: for the tests only.
 *
 * A router that is slow to answer is drawn as an empty circle, and the line goes under it (data.line): its time is not on the way.
 */
var LibreSpeedRouteChart = (function () {
  "use strict";

  var chart = null;
  var host = null;
  var observer = null;
  var onResize = null;
  var state = { builds: 0, width: 0, height: 0, primary: "", xLabel: "", drops: 0, other: false };

  function destroy() {
    if (observer) observer.disconnect();
    if (onResize) window.removeEventListener("resize", onResize);
    observer = null;
    onResize = null;
    if (chart) chart.destroy();
    chart = null;
    if (host) host.textContent = "";
    host = null;
  }

  function render(target, data, options) {
    destroy();
    host = target;
    // The colors are read again every time: they change with the theme and the contrast, and the cache of colors.js can be old
    // because the listener that clears it was added after the one of the page
    LibreSpeedColors.invalidate();
    var colors = LibreSpeedColors;
    var primary = colors.read("--primary");
    var subtle = colors.read("--primary-subtle");
    var muted = colors.read("--muted");
    var text = colors.read("--text");
    var border = colors.read("--border");
    var surface = colors.read("--surface");

    var scale = (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
    var px = (window.devicePixelRatio || 1) * scale;
    var font = Math.round(12 * scale) + "px system-ui, sans-serif";
    var width = host.clientWidth;
    var height = Math.round(Math.min(360, 240 * scale));
    if (width < 60) return;

    function drawJump(u) {
      if (!data.jump) return;
      var ctx = u.ctx;
      var x0 = u.valToPos(data.jump.from, "x", true);
      var x1 = u.valToPos(data.jump.to, "x", true);
      ctx.save();
      ctx.fillStyle = colors.css(subtle, 1);
      ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
      ctx.fillStyle = colors.css(text, 1);
      ctx.font = Math.round(11 * px) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("+" + data.jump.ms + " ms", (x0 + x1) / 2, u.bbox.top + 3 * px);
      ctx.restore();
    }

    function drawMarks(u) {
      var ctx = u.ctx;
      var bottom = u.bbox.top + u.bbox.height;
      ctx.save();
      data.drops.forEach(function (drop) {
        var x = u.valToPos(drop.x, "x", true);
        ctx.strokeStyle = colors.css(muted, 1);
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash([5 * px, 4 * px]);
        ctx.beginPath();
        ctx.moveTo(x, u.bbox.top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = colors.css(muted, 1);
        ctx.font = Math.round(11 * px) + "px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("MTU " + drop.to, x + 4 * px, u.bbox.top + 18 * px);
      });
      for (var i = 0; i < data.x.length; i++) {
        var x = u.valToPos(data.x[i], "x", true);
        if (data.y[i] === null) {
          // A hop with no answer: a cross on the base line, and a gap in the line
          ctx.strokeStyle = colors.css(muted, 1);
          ctx.lineWidth = 1.5 * px;
          ctx.beginPath();
          ctx.moveTo(x - 4 * px, bottom - 8 * px);
          ctx.lineTo(x + 4 * px, bottom);
          ctx.moveTo(x + 4 * px, bottom - 8 * px);
          ctx.lineTo(x - 4 * px, bottom);
          ctx.stroke();
          continue;
        }
        var y = u.valToPos(data.y[i], "y", true);
        ctx.beginPath();
        ctx.arc(x, y, 4 * px, 0, Math.PI * 2);
        if (data.slow[i]) {
          ctx.fillStyle = colors.css(surface, 1);
          ctx.fill();
          ctx.strokeStyle = colors.css(muted, 1);
          ctx.lineWidth = 1.5 * px;
          ctx.stroke();
        } else {
          ctx.fillStyle = colors.css(data.internal[i] ? muted : primary, 1);
          ctx.fill();
        }
        if (data.target === data.x[i]) {
          ctx.beginPath();
          ctx.arc(x, y, 8 * px, 0, Math.PI * 2);
          ctx.strokeStyle = colors.css(text, 1);
          ctx.lineWidth = 1.5 * px;
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    var lineColor = colors.css(primary, 1);
    // The other direction, when it is drawn too: its line is dashed in the second colour, and the axes have room for the longer of the two
    var other = options.other || null;
    var secondary = colors.read("--secondary");
    var count = other ? Math.max(data.x.length, other.x.length) : data.x.length;
    var yMax = other ? Math.max(data.yMax, other.yMax) : data.yMax;
    function pad(list) {
      var copy = list.slice();
      while (copy.length < count) copy.push(null);
      return copy;
    }
    var xs = data.x;
    if (other) {
      xs = [];
      for (var n = 1; n <= count; n++) xs.push(n);
    }

    function drawOther(u) {
      if (!other) return;
      var ctx = u.ctx;
      ctx.save();
      for (var i = 0; i < other.x.length; i++) {
        if (other.y[i] === null) continue;
        var x = u.valToPos(other.x[i], "x", true);
        var y = u.valToPos(other.y[i], "y", true);
        ctx.beginPath();
        ctx.arc(x, y, 3.2 * px, 0, Math.PI * 2);
        ctx.fillStyle = colors.css(surface, 1);
        ctx.fill();
        ctx.strokeStyle = colors.css(secondary, 1);
        ctx.lineWidth = 1.5 * px;
        ctx.stroke();
      }
      ctx.restore();
    }

    chart = new uPlot(
      {
        width: width,
        height: height,
        legend: { show: false },
        padding: [12, 12, 0, 0],
        cursor: { drag: { x: false, y: false }, points: { show: false }, y: false },
        scales: {
          x: { time: false, range: [0.5, count + 0.5] },
          y: { range: [0, yMax] }
        },
        axes: [
          {
            stroke: colors.css(muted, 1),
            grid: { show: false },
            ticks: { show: false },
            space: 22,
            incrs: [1, 2, 5, 10, 20],
            label: options.xLabel,
            labelSize: 16 * scale,
            labelFont: font,
            font: font,
            size: 22 * scale,
            gap: 4
          },
          {
            stroke: colors.css(muted, 1),
            grid: { stroke: colors.css(border, 1), width: 1, dash: [3, 4] },
            ticks: { show: false },
            font: font,
            size: 40 * scale,
            gap: 4
          }
        ],
        series: [
          {},
          { stroke: lineColor, width: 2.5, spanGaps: false, points: { show: false }, paths: uPlot.paths.linear() }
        ].concat(
          other
            ? [
                {
                  stroke: colors.css(secondary, 1),
                  width: 2,
                  dash: [6, 4],
                  spanGaps: false,
                  points: { show: false },
                  paths: uPlot.paths.linear()
                }
              ]
            : []
        ),
        hooks: {
          // Behind the line: the largest rise. On top of it: the marks of the hops and of the MTU
          drawAxes: [drawJump],
          draw: [drawOther, drawMarks],
          setCursor: [
            function (u) {
              var index = u.cursor.idx;
              if (index === null || index === undefined) {
                options.readout.textContent = options.hint;
                return;
              }
              // Each direction says its hop, if it has one at that place
              var parts = [];
              if (index < data.x.length) parts.push(options.describe(index));
              if (other && options.describeOther && index < other.x.length) parts.push(options.describeOther(index));
              options.readout.textContent = parts.length ? parts.join("  |  ") : options.hint;
            }
          ]
        }
      },
      other ? [xs, pad(data.line), pad(other.line)] : [xs, data.line],
      host
    );
    options.readout.textContent = options.hint;

    function fit() {
      var next = host.clientWidth;
      if (chart && next >= 60 && Math.abs(next - chart.width) >= 1) chart.setSize({ width: next, height: height });
      state.width = chart ? chart.width : 0;
    }
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(fit);
      observer.observe(host);
    } else {
      onResize = fit;
      window.addEventListener("resize", onResize);
    }

    state = {
      builds: state.builds + 1,
      width: width,
      height: height,
      primary: lineColor,
      xLabel: options.xLabel,
      drops: data.drops.length,
      other: !!other
    };
  }

  function info() {
    return state;
  }

  return { render: render, destroy: destroy, info: info };
})();
