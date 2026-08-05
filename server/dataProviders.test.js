// dataProviders.test.js — the pure mapping half of the data layer.
//
// The fetch itself is network and is not tested here; the shape-handling is,
// because a provider that quietly returns [] is how 21 rows came back
// "not observable" without anything appearing to fail.

import test from "node:test";
import assert from "node:assert/strict";

import { mapYahooBars } from "./dataProviders.js";

// 2026-07-02 and 2026-07-06 as UTC midnights.
const OK = {
  chart: {
    result: [
      {
        timestamp: [1782000000, 1782345600],
        indicators: { quote: [{ close: [100.5, 105.25] }] }
      }
    ]
  }
};

test("Yahoo timestamps and closes map to dated bars", () => {
  const bars = mapYahooBars(OK);
  assert.equal(bars.length, 2);
  assert.match(bars[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(bars[0].close, 100.5);
  assert.equal(bars[1].close, 105.25);
});

test("bars with a null close are dropped rather than zero-filled", () => {
  const withGap = {
    chart: {
      result: [
        {
          timestamp: [1782000000, 1782086400, 1782345600],
          indicators: { quote: [{ close: [100.5, null, 105.25] }] }
        }
      ]
    }
  };
  const bars = mapYahooBars(withGap);
  assert.equal(bars.length, 2);
  assert.ok(bars.every((b) => typeof b.close === "number"));
});

test("an error payload maps to no bars rather than throwing", () => {
  assert.deepEqual(mapYahooBars({ chart: { result: null, error: "Not Found" } }), []);
  assert.deepEqual(mapYahooBars({}), []);
  assert.deepEqual(mapYahooBars(null), []);
});

test("a result with no quote block maps to no bars", () => {
  assert.deepEqual(mapYahooBars({ chart: { result: [{ timestamp: [1782000000], indicators: {} }] } }), []);
});
