const path = require("node:path");
const { test, expect } = require("@playwright/test");

const MODULE = path.join(__dirname, "../../frontend/better/javascript/history-periods.js");

// The module is a pure script: it is put in an empty page, nothing else is loaded
async function load(page) {
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ path: MODULE });
}

// For each instant (ISO text), the key of the period of that kind in the time zone of the page
function keys(page, kind, instants) {
  return page.evaluate(
    ([k, list]) => list.map(iso => LibreSpeedPeriods.periodOf(k, Date.parse(iso)).key),
    [kind, instants]
  );
}

function labelOf(page, kind, iso) {
  return page.evaluate(
    ([k, text]) => LibreSpeedPeriods.label(LibreSpeedPeriods.periodOf(k, Date.parse(text))),
    [kind, iso]
  );
}

// The instant of 12:00 UTC of a date, so that the time zone cannot move it to another day when the zone is UTC
const noon = date => `${date}T12:00:00Z`;

test.describe("in São Paulo", () => {
  test.use({ timezoneId: "America/Sao_Paulo" });

  test("the day changes at local midnight, not at midnight UTC", async ({ page }) => {
    await load(page);
    // 23:59 and 00:00 of 9 and 10 October, in São Paulo
    const instants = ["2026-10-10T02:59:00Z", "2026-10-10T03:00:00Z"];
    expect(await keys(page, "day", instants)).toEqual(["2026-10-09", "2026-10-10"]);
    // Both are in the same week, fortnight, bimester, quarter and semester
    expect(await keys(page, "week", instants)).toEqual(["2026-W41", "2026-W41"]);
    expect(await keys(page, "fortnight", instants)).toEqual(["2026-10-F1", "2026-10-F1"]);
    expect(await keys(page, "bimester", instants)).toEqual(["2026-B5", "2026-B5"]);
    expect(await keys(page, "quarter", instants)).toEqual(["2026-Q4", "2026-Q4"]);
    expect(await keys(page, "semester", instants)).toEqual(["2026-S2", "2026-S2"]);
  });

  test("the last minute of the year is in 2026-W53 and in the second half of December", async ({ page }) => {
    await load(page);
    // 31/12/2026 23:59 in São Paulo
    const instant = "2027-01-01T02:59:00Z";
    expect(await keys(page, "day", [instant])).toEqual(["2026-12-31"]);
    expect(await keys(page, "week", [instant])).toEqual(["2026-W53"]);
    expect(await labelOf(page, "week", instant)).toBe("28/12/2026 – 03/01/2027");
    expect(await keys(page, "fortnight", [instant])).toEqual(["2026-12-F2"]);
    expect(await labelOf(page, "fortnight", instant)).toBe("16/12 – 31/12/2026");
    expect(await keys(page, "month", [instant])).toEqual(["2026-12"]);
    expect(await keys(page, "bimester", [instant])).toEqual(["2026-B6"]);
    expect(await keys(page, "quarter", [instant])).toEqual(["2026-Q4"]);
    expect(await keys(page, "semester", [instant])).toEqual(["2026-S2"]);
  });
});

test.describe("in New York", () => {
  test.use({ timezoneId: "America/New_York" });

  test("the day the clock jumps forward and the two 01:30 of the day it goes back", async ({ page }) => {
    await load(page);
    // 8 March 2026: the clock jumps from 02:00 to 03:00. 23:30 of that day is 03:30 UTC of the 9th
    expect(await keys(page, "day", ["2026-03-09T03:30:00Z"])).toEqual(["2026-03-08"]);
    expect(await keys(page, "week", ["2026-03-09T03:30:00Z"])).toEqual(["2026-W10"]);
    expect(await keys(page, "fortnight", ["2026-03-09T03:30:00Z"])).toEqual(["2026-03-F1"]);
    // 1 November 2026: 01:30 happens twice (05:30 and 06:30 UTC), and it is the same day and the same week
    expect(await keys(page, "day", ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"])).toEqual([
      "2026-11-01",
      "2026-11-01"
    ]);
    expect(await keys(page, "week", ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"])).toEqual([
      "2026-W44",
      "2026-W44"
    ]);
    // The day of 25 hours still ends at local midnight
    expect(await keys(page, "day", ["2026-11-02T04:59:00Z", "2026-11-02T05:00:00Z"])).toEqual([
      "2026-11-01",
      "2026-11-02"
    ]);
  });
});

test("the same instant is a different day in New York and in São Paulo", async ({ browser }) => {
  const instant = "2026-03-09T03:30:00Z";
  const result = {};
  for (const timezoneId of ["America/New_York", "America/Sao_Paulo"]) {
    const context = await browser.newContext({ timezoneId });
    const page = await context.newPage();
    await load(page);
    result[timezoneId] = {
      day: (await keys(page, "day", [instant]))[0],
      week: (await keys(page, "week", [instant]))[0]
    };
    await context.close();
  }
  expect(result["America/New_York"]).toEqual({ day: "2026-03-08", week: "2026-W10" });
  expect(result["America/Sao_Paulo"]).toEqual({ day: "2026-03-09", week: "2026-W11" });
});

test.describe("in UTC", () => {
  test.use({ timezoneId: "UTC" });

  test("ISO weeks at the turn of the year", async ({ page }) => {
    await load(page);
    const cases = [
      ["2026-01-01", "2026-W01", "29/12/2025 – 04/01/2026"],
      ["2027-01-01", "2026-W53", "28/12/2026 – 03/01/2027"],
      ["2027-01-03", "2026-W53", "28/12/2026 – 03/01/2027"],
      ["2027-01-04", "2027-W01", "04/01 – 10/01/2027"],
      ["2024-12-30", "2025-W01", "30/12/2024 – 05/01/2025"],
      ["2021-01-03", "2020-W53", "28/12/2020 – 03/01/2021"],
      ["2026-10-09", "2026-W41", "05/10 – 11/10/2026"]
    ];
    for (const [date, key, label] of cases) {
      expect(await keys(page, "week", [noon(date)]), date).toEqual([key]);
      expect(await labelOf(page, "week", noon(date)), date).toBe(label);
    }
  });

  test("fortnights split on the 15th, including 29 February", async ({ page }) => {
    await load(page);
    expect(await keys(page, "fortnight", [noon("2026-02-15"), noon("2026-02-16"), noon("2028-02-29")])).toEqual([
      "2026-02-F1",
      "2026-02-F2",
      "2028-02-F2"
    ]);
    expect(await labelOf(page, "fortnight", noon("2026-02-15"))).toBe("01/02 – 15/02/2026");
    expect(await labelOf(page, "fortnight", noon("2026-02-16"))).toBe("16/02 – 28/02/2026");
    expect(await labelOf(page, "fortnight", noon("2028-02-29"))).toBe("16/02 – 29/02/2028");
    // The weeks of those days, and the bimester that ends on 29 February of a leap year
    expect(await keys(page, "week", [noon("2026-02-15"), noon("2026-02-16"), noon("2028-02-29")])).toEqual([
      "2026-W07",
      "2026-W08",
      "2028-W09"
    ]);
    expect(await keys(page, "bimester", [noon("2026-02-15"), noon("2028-02-29")])).toEqual(["2026-B1", "2028-B1"]);
    expect(await labelOf(page, "bimester", noon("2028-02-29"))).toBe("01/01 – 29/02/2028");
    expect(await labelOf(page, "day", noon("2028-02-29"))).toBe("29/02/2028");
  });

  test("bimesters, quarters and semesters change between 30 June and 1 July", async ({ page }) => {
    await load(page);
    const june = noon("2026-06-30");
    const july = noon("2026-07-01");
    expect(await keys(page, "bimester", [june, july])).toEqual(["2026-B3", "2026-B4"]);
    expect(await keys(page, "quarter", [june, july])).toEqual(["2026-Q2", "2026-Q3"]);
    expect(await keys(page, "semester", [june, july])).toEqual(["2026-S1", "2026-S2"]);
    expect(await keys(page, "fortnight", [june, july])).toEqual(["2026-06-F2", "2026-07-F1"]);
    // A week can cross a month, a semester and, as here, both: 2026-W27 has 30 June and 1 July
    expect(await keys(page, "week", [june, july])).toEqual(["2026-W27", "2026-W27"]);
    expect(await labelOf(page, "semester", june)).toBe("01/01 – 30/06/2026");
    expect(await labelOf(page, "quarter", july)).toBe("01/07 – 30/09/2026");
  });

  test("group puts the rows of a period together, the most recent period first", async ({ page }) => {
    await load(page);
    const result = await page.evaluate(() => {
      const t = iso => Date.parse(iso);
      // Not in order, to show that the order of the groups does not depend on the order of the rows
      const rows = [
        { t: t("2026-10-05T12:00:00Z"), name: "c" },
        { t: t("2026-10-09T18:00:00Z"), name: "a" },
        { t: t("2026-10-02T12:00:00Z"), name: "d" },
        { t: t("2026-10-09T08:00:00Z"), name: "b" }
      ];
      const shape = groups => groups.map(g => [g.period.key, g.rows.map(r => r.name).join("")]);
      return {
        week: shape(LibreSpeedPeriods.group(rows, "week")),
        day: shape(LibreSpeedPeriods.group(rows, "day")),
        none: LibreSpeedPeriods.group([], "day")
      };
    });
    expect(result.week).toEqual([
      ["2026-W41", "cab"],
      ["2026-W40", "d"]
    ]);
    expect(result.day).toEqual([
      ["2026-10-09", "ab"],
      ["2026-10-05", "c"],
      ["2026-10-02", "d"]
    ]);
    expect(result.none).toEqual([]);
  });

  test("median, mean and values", async ({ page }) => {
    await load(page);
    const result = await page.evaluate(() => ({
      odd: LibreSpeedPeriods.median([3, 1, 2]),
      even: LibreSpeedPeriods.median([4, 1, 2, 3]),
      none: LibreSpeedPeriods.median([]),
      untouched: (() => {
        const list = [3, 1, 2];
        LibreSpeedPeriods.median(list);
        return list;
      })(),
      mean: LibreSpeedPeriods.mean([0, 0, 3]),
      meanNone: LibreSpeedPeriods.mean([]),
      values: LibreSpeedPeriods.values(
        [{ x: 1 }, { x: null }, { x: "2" }, { x: NaN }, { x: Infinity }, { y: 5 }, { x: 0 }],
        "x"
      )
    }));
    expect(result.odd).toBe(2);
    expect(result.even).toBe(2.5);
    expect(result.none).toBeNull();
    // The list given is not sorted in place
    expect(result.untouched).toEqual([3, 1, 2]);
    expect(result.mean).toBe(1);
    expect(result.meanNone).toBeNull();
    // Only real numbers: text, null, NaN and Infinity are left out, and zero is a value
    expect(result.values).toEqual([1, 0]);
  });

  test("an unknown period throws", async ({ page }) => {
    await load(page);
    const message = await page.evaluate(() => {
      try {
        LibreSpeedPeriods.periodOf("year", 0);
      } catch (error) {
        return error.message;
      }
      return null;
    });
    expect(message).toBe("Unknown period: year");
  });
});
