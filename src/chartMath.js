(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChartMath = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // The standard "nice numbers for graph labels" algorithm (Paul Heckbert,
  // Graphics Gems I) — picks a tick spacing that's always 1, 2, or 5 times a
  // power of 10, so axis labels read like $10/$20/$30 or $100/$200/$300,
  // never something like $37/$74/$111. Pure math, no rendering dependency,
  // so this is fully unit-testable independent of whether the chart itself
  // can be visually verified.
  function niceNumber(value, round) {
    if (value === 0) return 0;
    const exponent = Math.floor(Math.log10(Math.abs(value)));
    const fraction = Math.abs(value) / Math.pow(10, exponent);
    let niceFraction;
    if (round) {
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 3) niceFraction = 2;
      else if (fraction < 7) niceFraction = 5;
      else niceFraction = 10;
    } else {
      if (fraction <= 1) niceFraction = 1;
      else if (fraction <= 2) niceFraction = 2;
      else if (fraction <= 5) niceFraction = 5;
      else niceFraction = 10;
    }
    return Math.sign(value) * niceFraction * Math.pow(10, exponent);
  }

  /**
   * Computes a set of "nice" evenly-spaced tick values spanning at least
   * [min, max], aiming for roughly targetCount ticks and guaranteed to
   * produce at least minCount (defaults to targetCount) — the initial nice-
   * number step can sometimes land on fewer ticks than requested depending
   * on rounding, so this retries with a smaller step until the guarantee is
   * met, rather than leaving the caller to discover a too-sparse axis only
   * by looking at it.
   */
  function computeNiceTicks(min, max, targetCount, minCount) {
    targetCount = targetCount || 5;
    minCount = minCount || targetCount;
    if (min > max) { const t = min; min = max; max = t; }
    if (min === max) {
      min -= 1;
      max += 1;
    }

    let ticks = [];
    let attemptCount = targetCount;
    let guard = 0;
    do {
      const range = niceNumber(max - min, false);
      const step = niceNumber(range / Math.max(1, attemptCount - 1), true) || 1;
      const niceMin = Math.floor(min / step) * step;
      const niceMax = Math.ceil(max / step) * step;
      ticks = [];
      // Round each tick to a sane number of decimal places to avoid
      // floating point noise (e.g. 0.30000000000000004) leaking into labels.
      const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
      const factor = Math.pow(10, decimals + 2);
      for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
        ticks.push(Math.round(v * factor) / factor);
      }
      attemptCount++;
      guard++;
    } while (ticks.length < minCount && guard < 30);
    return ticks;
  }

  /**
   * Picks up to targetCount evenly-spaced indices from [0, length-1],
   * always including the first and last index. Used for x-axis labels on a
   * discrete, index-based series (one entry per date-with-data, not evenly
   * spaced by calendar time) where a calendar-aware tick algorithm would be
   * more complexity than the data shape actually calls for.
   */
  function pickEvenIndices(length, targetCount) {
    targetCount = targetCount || 6;
    if (length <= 0) return [];
    if (length <= targetCount) {
      const all = [];
      for (let i = 0; i < length; i++) all.push(i);
      return all;
    }
    const seen = new Set();
    const indices = [];
    for (let i = 0; i < targetCount; i++) {
      const idx = Math.round((i / (targetCount - 1)) * (length - 1));
      if (!seen.has(idx)) {
        seen.add(idx);
        indices.push(idx);
      }
    }
    return indices;
  }

  return { niceNumber, computeNiceTicks, pickEvenIndices };
});
