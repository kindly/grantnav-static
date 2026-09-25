// The grid's scroll arithmetic, without a browser.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SPACER_MAX, isScaled, spacerHeight, firstRowAt, scrollTopForRow, visibleRange, wheelRows,
} from "../src/lib/gridMath.ts";

const geom = (total) => ({ total, rowH: 30, poolLen: 22, headH: 30, slack: 10, viewportH: 700 });

test("small results map one pixel to one pixel", () => {
  const g = geom(5_533);
  assert.equal(isScaled(g), false);
  assert.equal(spacerHeight(g), 30 + 5_533 * 30 + 10);
  assert.equal(firstRowAt(g, 300), 10);
  assert.equal(scrollTopForRow(g, 10), 300);
});

test("the full dataset is capped and still reaches both ends", () => {
  const g = geom(1_520_378);
  assert.equal(isScaled(g), true);
  assert.equal(spacerHeight(g), SPACER_MAX);
  assert.equal(firstRowAt(g, 0), 0);
  assert.equal(firstRowAt(g, SPACER_MAX - g.viewportH), g.total - g.poolLen);
  for (const row of [0, 1, 777_777, g.total - g.poolLen]) {
    assert.equal(firstRowAt(g, scrollTopForRow(g, row)), row);
  }
});

test("painting is clamped to what is loaded", () => {
  const g = geom(1_520_378);
  // nothing loaded: leave the screen alone
  assert.deepEqual(visibleRange(g, 0, 0, -1), { first: 0, last: -1 });
  // scrolled far past the loaded run: show its tail, never blanks
  const { first, last } = visibleRange(g, scrollTopForRow(g, 900_000), 0, 399);
  assert.equal(last, 399);
  assert.equal(first, 399 - g.poolLen + 1);
});

test("a small trackpad delta still moves a row", () => {
  const g = geom(1_520_378);
  assert.equal(wheelRows(4, 0, g), 1);
  assert.equal(wheelRows(-4, 0, g), -1);
  assert.equal(wheelRows(3, 1, g), 3);
  assert.equal(wheelRows(1, 2, g), g.poolLen);
});
