/* global LibreSpeedChart, uPlot */
/* exported LibreSpeedUplot */
/**
 * uPlot chart for the stability page
 *
 * Adds the "uplot" chart style. The page loads frontend/vendor/uPlot.iife.min.js and this file only when that
 * style is chosen, so nothing here runs otherwise. It needs chart-styles.js (LibreSpeedChart) and the uPlot global.
 *
 * LibreSpeedUplot.draw(canvas, container, getState) shows the chart in place of the canvas, where getState()
 *   returns { data, threshold } and is read on every call (the uPlot hooks run later)
 * LibreSpeedUplot.hide() hides it (another style was chosen)
 * LibreSpeedUplot.invalidate() rebuilds it on the next draw (colors or text size changed)
 */
var LibreSpeedUplot = (function () {
  "use strict";

  var chart = null;
  var host = null;
  var signature = "";
  var dirty = true;

  function view(getState) {
    return LibreSpeedChart.view(getState().data);
  }

  function arrays(getState) {
    var v = view(getState);
    return {
      v: v,
      data: [
        v.pts.map(function (d) {
          return d.t;
        }),
        v.pts.map(function (d) {
          return d.lost ? null : d.ping;
        })
      ]
    };
  }

  // Text size option: the margins and the axis font scale with the root font size
  function scale() {
    return LibreSpeedChart.textScale();
  }

  function gutter() {
    return Math.round((LibreSpeedChart.GUTTER - 1) * scale());
  }

  // The font is only set when the text size is not the default, otherwise the uPlot default stays
  function withFont(axis) {
    if (scale() !== 1) axis.font = Math.round(12 * scale()) + "px system-ui, sans-serif";
    return axis;
  }

  function axisX(getState, text, grid) {
    return {
      stroke: text,
      size: gutter(),
      gap: 8,
      grid: { stroke: grid, width: 1, dash: [3, 4] },
      ticks: { show: false },
      values: function (u, splits) {
        return splits.map(LibreSpeedChart.fmtTime);
      },
      splits: function () {
        var v = view(getState);
        var win = v.t1 - v.t0;
        var step = win <= 60 ? 10 : win <= 120 ? 15 : 30;
        var splits = [];
        for (var t = Math.ceil(v.t0 / step) * step; t <= v.t1; t += step) splits.push(t);
        return splits;
      }
    };
  }

  function axisY(text, grid) {
    return {
      stroke: text,
      grid: { stroke: grid, width: 1, dash: [3, 4] },
      ticks: { show: false },
      gap: 3,
      size: function (u, values) {
        var digits = 0;
        (values || []).forEach(function (value) {
          digits = Math.max(digits, String(value).length);
        });
        return Math.round((digits <= 3 ? LibreSpeedChart.GUTTER - 1 : digits * 7 + 8) * scale());
      }
    };
  }

  function areaFill(primary) {
    return function (u) {
      var box = u.bbox;
      if (!box || !isFinite(box.top) || !isFinite(box.height) || box.height <= 0)
        return LibreSpeedChart.rgba(primary, 0.2);
      var gradient = u.ctx.createLinearGradient(0, box.top, 0, box.top + box.height);
      gradient.addColorStop(0, LibreSpeedChart.rgba(primary, 0.34));
      gradient.addColorStop(1, LibreSpeedChart.rgba(primary, 0));
      return gradient;
    };
  }

  function series(primary) {
    return [
      {},
      {
        stroke: LibreSpeedChart.rgba(primary, 1),
        width: 2.25,
        spanGaps: false,
        paths: uPlot.paths.spline(),
        points: { show: false },
        fill: areaFill(primary)
      }
    ];
  }

  function rootFontSize() {
    return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }

  // Tooltip shown while the pointer is over the plot
  function tooltipHooks(C, grid) {
    var tooltip = null;
    return {
      ready: [
        function (u) {
          tooltip = document.createElement("div");
          tooltip.style.cssText =
            "position:absolute;display:none;pointer-events:none;font:0.75rem sans-serif;padding:0.1875rem 0.5rem;" +
            "border-radius:0.375rem;white-space:nowrap;z-index:5;border:1px solid " +
            grid +
            ";background:" +
            LibreSpeedChart.rgba(C.surface, 0.96) +
            ";color:" +
            LibreSpeedChart.rgba(C.fg, 1);
          u.over.appendChild(tooltip);
        }
      ],
      setCursor: [
        function (u) {
          var index = u.cursor.idx;
          var ping = index == null ? null : u.data[1][index];
          if (!tooltip) return;
          if (ping == null) {
            tooltip.style.display = "none";
            return;
          }
          tooltip.textContent = LibreSpeedChart.fmtTime(u.data[0][index]) + "  ·  " + ping.toFixed(1) + " ms";
          tooltip.style.display = "block";
          // cursor and clientWidth are in CSS px, the root font size turns them into rem
          tooltip.style.left =
            Math.min(Math.max(u.cursor.left - 40, 0), u.over.clientWidth - 110) / rootFontSize() + "rem";
          tooltip.style.top = "0.25rem";
        }
      ]
    };
  }

  function devicePixels() {
    return (window.devicePixelRatio || 1) * scale();
  }

  function drawLossBars(u, C, getState) {
    var ctx = u.ctx;
    var box = u.bbox;
    var dp = devicePixels();
    view(getState).pts.forEach(function (point) {
      if (!point.lost) return;
      var x = u.valToPos(point.t, "x", true);
      ctx.fillStyle = LibreSpeedChart.rgba(C.bad, 0.8);
      ctx.fillRect(x - 1.5 * dp, box.top + box.height - 14 * dp, 3 * dp, 14 * dp);
    });
  }

  function drawThreshold(u, C, getState) {
    var ctx = u.ctx;
    var box = u.bbox;
    var dp = devicePixels();
    var limit = getState().threshold;
    if (!(limit > 0 && limit <= view(getState).yMax)) return;
    var y = u.valToPos(limit, "y", true);
    ctx.strokeStyle = LibreSpeedChart.rgba(C.bad, 0.6);
    ctx.lineWidth = 1.5 * dp;
    ctx.setLineDash([6 * dp, 4 * dp]);
    ctx.beginPath();
    ctx.moveTo(box.left, y);
    ctx.lineTo(box.left + box.width, y);
    ctx.stroke();
  }

  function build(width, height, getState) {
    var C = LibreSpeedChart.colors();
    var grid = LibreSpeedChart.rgba(C.grid, 1);
    var text = LibreSpeedChart.rgba(C.text, 1);
    if (chart) {
      chart.destroy();
      chart = null;
    }
    host.innerHTML = "";
    var hooks = tooltipHooks(C, grid);
    hooks.draw = [
      function (u) {
        u.ctx.save();
        drawLossBars(u, C, getState);
        drawThreshold(u, C, getState);
        u.ctx.restore();
      }
    ];
    chart = new uPlot(
      {
        width: width,
        height: height,
        pxAlign: false,
        legend: { show: false },
        padding: [gutter(), gutter(), 0, 0],
        cursor: { drag: { x: false, y: false }, points: { size: 7 } },
        scales: {
          x: {
            time: false,
            range: function () {
              var v = view(getState);
              return [v.t0, v.t1];
            }
          },
          y: {
            range: function () {
              return [0, view(getState).yMax];
            }
          }
        },
        axes: [withFont(axisX(getState, text, grid)), withFont(axisY(text, grid))],
        series: series(C.primary),
        hooks: hooks
      },
      arrays(getState).data,
      host
    );
    signature = "";
    dirty = false;
  }

  function draw(canvas, container, getState) {
    if (!host) {
      host = document.createElement("div");
      host.id = "uplotHost";
      canvas.parentNode.insertBefore(host, canvas.nextSibling);
    }
    // The uPlot height is the total (axes included), so it takes the height of the canvas minus the frame
    var width = container.clientWidth - 2;
    var height = Math.max(110, parseFloat(getComputedStyle(canvas).height) || 280) - 2;
    if (!(width > 60)) return;
    canvas.style.display = "none";
    host.style.display = "";
    if (!chart || dirty) build(width, height, getState);
    else if (chart.width !== width || chart.height !== height) chart.setSize({ width: width, height: height });
    var state = getState();
    var data = state.data;
    var current = data.length + ":" + (data.length ? data[data.length - 1].t : 0) + ":" + state.threshold;
    if (current !== signature) {
      signature = current;
      chart.setData(arrays(getState).data);
    }
  }

  function hide() {
    if (host) host.style.display = "none";
  }

  function invalidate() {
    dirty = true;
  }

  return { draw: draw, hide: hide, invalidate: invalidate };
})();
