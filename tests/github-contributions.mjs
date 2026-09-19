import assert from 'node:assert/strict';
import {
  contributionTotal,
  normalizeContributionWeeks,
  renderContributionCells
} from '../scripts/github-contributions-lib.mjs';

function day(weekday, count = 1) {
  return {
    date: `2026-09-${String(weekday + 1).padStart(2, '0')}`,
    contributionCount: count,
    contributionLevel: count ? 'FIRST_QUARTILE' : 'NONE',
    weekday
  };
}

function fullWeek(index) {
  return {
    firstDay: `week-${index}`,
    contributionDays: Array.from({ length: 7 }, (_, weekday) => day(weekday))
  };
}

for (let finalWeekday = 0; finalWeekday <= 6; finalWeekday += 1) {
  const fixture = Array.from({ length: 51 }, (_, index) => fullWeek(index));
  fixture.push({
    firstDay: 'partial-week',
    contributionDays: Array.from({ length: finalWeekday + 1 }, (_, weekday) => day(weekday, 2))
  });

  const weeks = normalizeContributionWeeks(fixture);
  assert.equal(weeks.length, 52);
  assert.ok(weeks.every(week => week.days.length === 7));
  assert.equal(weeks.at(-1).days.filter(item => item.date).length, finalWeekday + 1);
  assert.equal(contributionTotal(weeks), (51 * 7) + ((finalWeekday + 1) * 2));
  assert.equal((renderContributionCells(weeks).match(/class="contribution-day"/g) || []).length, 364);
}

assert.throws(
  () => normalizeContributionWeeks(Array.from({ length: 51 }, (_, index) => fullWeek(index))),
  /complete contribution calendar/
);
assert.throws(
  () => normalizeContributionWeeks([
    ...Array.from({ length: 51 }, (_, index) => fullWeek(index)),
    { firstDay: 'duplicate', contributionDays: [day(0), day(0)] }
  ]),
  /Duplicate GitHub contribution weekday/
);

console.log('PASS GitHub contribution calendar fixtures for every weekday.');
