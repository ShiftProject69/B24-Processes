import test from 'node:test';
import assert from 'node:assert/strict';

import { AddUtcDays, FormatDate, IsTodayDate } from '../src/utils.js';

test('FormatDate returns ISO date portion', () => {
	assert.equal(FormatDate(new Date('2026-07-06T18:45:00.000Z')), '2026-07-06');
});

test('AddUtcDays shifts date using UTC day boundaries', () => {
	assert.equal(
		FormatDate(AddUtcDays(new Date('2026-07-06T23:30:00.000Z'), 1)),
		'2026-07-07'
	);
});

test('IsTodayDate compares dates by formatted UTC day', () => {
	assert.equal(IsTodayDate(new Date()), true);
	assert.equal(IsTodayDate(AddUtcDays(new Date(), -1)), false);
});
