/* exported LibreSpeedPeriods */
/**
 * Calendar periods of the history of the better pages
 *
 * Pure functions, no page and no storage. The time zone of the browser is only used by localDate: the rest works on
 * civil dates turned into day numbers with Date.UTC, so a day of 23 or 25 hours (summer time) changes nothing.
 *
 * LibreSpeedPeriods.KINDS                    the periods: day, week (ISO, Monday to Sunday), fortnight (1-15 and 16 to the
 *                                            end of the month), month, bimester, quarter, semester
 * LibreSpeedPeriods.periodOf(kind, time)     { kind, key, start, end } of the instant time (ms); start and end are day
 *                                            numbers, both included. Keys: 2026-10-09, 2026-W41, 2026-10-F1, 2026-10,
 *                                            2026-B5, 2026-Q4, 2026-S2
 * LibreSpeedPeriods.label(period)            "09/10/2026" for a day, "05/10 – 11/10/2026" for the others
 * LibreSpeedPeriods.group(rows, kind)        [{ period, rows }] of rows ({ t, ... }), the most recent period first
 * LibreSpeedPeriods.values(rows, field)      the finite numbers of a field
 * LibreSpeedPeriods.median(list) / mean(list)   null for an empty list
 */
var LibreSpeedPeriods = (function () {
  "use strict";

  var DAY_MS = 86400000;
  var KINDS = ["day", "week", "fortnight", "month", "bimester", "quarter", "semester"];

  function pad(number) {
    return (number < 10 ? "0" : "") + number;
  }

  // Days since 1970-01-01 of a civil date. Date.UTC has no time zone and no summer time, so the arithmetic is exact
  function dayNumber(y, m, d) {
    return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
  }

  // The civil date of a day number
  function fromDayNumber(n) {
    var date = new Date(n * DAY_MS);
    return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
  }

  // The civil date of an instant in the time zone of the browser (the only place the time zone is used)
  function localDate(timestamp) {
    var date = new Date(timestamp);
    return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
  }

  function lastDay(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  // 1 = Monday ... 7 = Sunday (1970-01-01 was a Thursday)
  function isoWeekday(n) {
    return ((((n + 3) % 7) + 7) % 7) + 1;
  }

  function isoWeek(date) {
    var n = dayNumber(date.y, date.m, date.d);
    var monday = n - isoWeekday(n) + 1;
    var thursday = monday + 3;
    var year = fromDayNumber(thursday).y;
    var week = Math.floor((thursday - dayNumber(year, 1, 1)) / 7) + 1;
    return { year: year, week: week, start: monday, end: monday + 6 };
  }

  // A block of months: size 1 (month), 2 (bimester), 3 (quarter) or 6 (semester)
  function months(date, size) {
    var index = Math.floor((date.m - 1) / size); // 0-based
    var first = index * size + 1;
    var last = first + size - 1;
    return {
      index: index + 1,
      start: dayNumber(date.y, first, 1),
      end: dayNumber(date.y, last, lastDay(date.y, last))
    };
  }

  // { kind, key, start, end }: start and end are day numbers, both included
  function periodOf(kind, timestamp) {
    var date = localDate(timestamp);
    var n = dayNumber(date.y, date.m, date.d);
    var block;
    if (kind === "day") return { kind: kind, key: date.y + "-" + pad(date.m) + "-" + pad(date.d), start: n, end: n };
    if (kind === "week") {
      var week = isoWeek(date);
      return { kind: kind, key: week.year + "-W" + pad(week.week), start: week.start, end: week.end };
    }
    if (kind === "fortnight") {
      var first = date.d <= 15;
      return {
        kind: kind,
        key: date.y + "-" + pad(date.m) + (first ? "-F1" : "-F2"),
        start: dayNumber(date.y, date.m, first ? 1 : 16),
        end: dayNumber(date.y, date.m, first ? 15 : lastDay(date.y, date.m))
      };
    }
    if (kind === "month") {
      block = months(date, 1);
      return { kind: kind, key: date.y + "-" + pad(date.m), start: block.start, end: block.end };
    }
    var size = { bimester: 2, quarter: 3, semester: 6 }[kind];
    if (!size) throw new Error("Unknown period: " + kind);
    block = months(date, size);
    var letter = { bimester: "B", quarter: "Q", semester: "S" }[kind];
    return { kind: kind, key: date.y + "-" + letter + block.index, start: block.start, end: block.end };
  }

  // "09/10/2026" for a day, "05/10 – 11/10/2026" for the others, with both years when they differ
  function label(period) {
    var a = fromDayNumber(period.start);
    var b = fromDayNumber(period.end);
    var end = pad(b.d) + "/" + pad(b.m) + "/" + b.y;
    if (period.start === period.end) return end;
    var start = pad(a.d) + "/" + pad(a.m) + (a.y !== b.y ? "/" + a.y : "");
    return start + " – " + end;
  }

  // Rows ({ t, ... }) in groups of a period, the most recent first: [{ period, rows }]
  function group(rows, kind) {
    var byKey = {};
    var list = [];
    for (var i = 0; i < rows.length; i++) {
      var period = periodOf(kind, rows[i].t);
      if (!byKey[period.key]) {
        byKey[period.key] = { period: period, rows: [] };
        list.push(byKey[period.key]);
      }
      byKey[period.key].rows.push(rows[i]);
    }
    list.sort(function (a, b) {
      return b.period.start - a.period.start;
    });
    return list;
  }

  // The numbers of a field that are real (null, "", "Fail" and NaN are left out)
  function values(rows, field) {
    var list = [];
    for (var i = 0; i < rows.length; i++) {
      var value = rows[i][field];
      if (typeof value === "number" && isFinite(value)) list.push(value);
    }
    return list;
  }

  function median(list) {
    if (!list.length) return null;
    var sorted = list.slice().sort(function (a, b) {
      return a - b;
    });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function mean(list) {
    if (!list.length) return null;
    var sum = 0;
    for (var i = 0; i < list.length; i++) sum += list[i];
    return sum / list.length;
  }

  return {
    KINDS: KINDS,
    dayNumber: dayNumber,
    localDate: localDate,
    isoWeek: isoWeek,
    periodOf: periodOf,
    label: label,
    group: group,
    values: values,
    median: median,
    mean: mean
  };
})();
