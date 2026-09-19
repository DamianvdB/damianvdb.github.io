const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4
};

export function normalizeContributionWeeks(allWeeks) {
  if (!Array.isArray(allWeeks) || allWeeks.length < 52) {
    throw new Error('GitHub did not return a complete contribution calendar');
  }

  return allWeeks.slice(-52).map(week => {
    const daysByWeekday = new Map();
    for (const day of week.contributionDays) {
      if (!Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6) {
        throw new Error(`Invalid GitHub contribution weekday: ${day.weekday}`);
      }
      if (daysByWeekday.has(day.weekday)) {
        throw new Error(`Duplicate GitHub contribution weekday: ${day.weekday}`);
      }
      daysByWeekday.set(day.weekday, {
        date: day.date,
        count: day.contributionCount,
        level: day.contributionLevel,
        weekday: day.weekday
      });
    }

    return {
      firstDay: week.firstDay,
      days: Array.from({ length: 7 }, (_, weekday) => daysByWeekday.get(weekday) || {
        date: null,
        count: 0,
        level: 'NONE',
        weekday
      })
    };
  });
}

export function contributionTotal(weeks) {
  return weeks.reduce(
    (total, week) => total + week.days.reduce((weekTotal, day) => weekTotal + day.count, 0),
    0
  );
}

export function renderContributionCells(weeks) {
  return weeks.flatMap(week => week.days).map(day => {
    const level = LEVELS[day.level];
    if (level === undefined) throw new Error(`Unknown GitHub contribution level: ${day.level}`);
    const noun = day.count === 1 ? 'contribution' : 'contributions';
    const title = day.date ? `${day.date}: ${day.count} ${noun}` : 'Outside the current contribution range';
    return `          <span class="contribution-day" data-level="${level}" title="${title}"></span>`;
  }).join('\n');
}
