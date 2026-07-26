'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatLocalIso, formatLocalDate, timestampForPath } = require('../src/utils/time');

function localDate(parts, timezoneOffset) {
  return {
    getFullYear: () => parts.year,
    getMonth: () => parts.month - 1,
    getDate: () => parts.day,
    getHours: () => parts.hour,
    getMinutes: () => parts.minute,
    getSeconds: () => parts.second,
    getMilliseconds: () => parts.millisecond,
    getTimezoneOffset: () => timezoneOffset
  };
}

test('formats local timestamps with a positive UTC offset', () => {
  const date = localDate({
    year: 2026,
    month: 7,
    day: 26,
    hour: 22,
    minute: 2,
    second: 7,
    millisecond: 56
  }, -480);

  assert.equal(formatLocalIso(date), '2026-07-26T22:02:07.056+08:00');
  assert.equal(formatLocalDate(date), '2026-07-26');
  assert.equal(timestampForPath(date), '2026-07-26T22-02-07-056+08-00');
});

test('formats negative and zero UTC offsets', () => {
  const parts = {
    year: 2026,
    month: 1,
    day: 2,
    hour: 3,
    minute: 4,
    second: 5,
    millisecond: 6
  };

  assert.equal(formatLocalIso(localDate(parts, 330)), '2026-01-02T03:04:05.006-05:30');
  assert.equal(formatLocalIso(localDate(parts, 0)), '2026-01-02T03:04:05.006+00:00');
});
