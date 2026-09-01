const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TODO_STATUS,
  isRecordPendingTodo,
  isRecordUpcomingSchedule,
  isRecordVisibleUpcoming,
  compareUpcomingRecords,
  transitionRecordTodo
} = require('../dashboard.js');

const now = new Date('2026-09-01T12:00:00+08:00').getTime();

test('distinguishes scheduled records from explicitly added todos', () => {
  const scheduled = { scheduleAt: '2026-09-02T10:00' };
  assert.equal(isRecordPendingTodo(scheduled), false);
  assert.equal(isRecordUpcomingSchedule(scheduled, now), true);
  assert.equal(isRecordVisibleUpcoming(scheduled, now), true);
});

test('includes an explicitly added todo without a schedule', () => {
  assert.equal(isRecordPendingTodo({ todoStatus: 'pending', todoCreatedAt: now }, now), true);
});

test('keeps a future interview visible after its todo is cancelled or completed', () => {
  const scheduled = { scheduleAt: '2026-09-02T10:00' };
  assert.equal(isRecordVisibleUpcoming({ ...scheduled, todoStatus: 'cancelled' }, now), true);
  assert.equal(isRecordVisibleUpcoming({ ...scheduled, todoStatus: 'completed' }, now), true);
});

test('sorts the most recently added todos first so a new todo stays visible in the five-item rail', () => {
  const records = [
    { id: 'schedule', scheduleAt: '2026-09-02T10:00' },
    { id: 'todo-1', todoStatus: 'pending', todoCreatedAt: now - 5000, scheduleAt: '2026-09-01T13:00' },
    { id: 'todo-2', todoStatus: 'pending', todoCreatedAt: now - 4000 },
    { id: 'todo-3', todoStatus: 'pending', todoCreatedAt: now - 3000 },
    { id: 'todo-4', todoStatus: 'pending', todoCreatedAt: now - 2000 },
    { id: 'todo-5', todoStatus: 'pending', todoCreatedAt: now - 1000 },
    { id: 'new-todo', todoStatus: 'pending', todoCreatedAt: now }
  ];
  const visibleIds = records.sort(compareUpcomingRecords).slice(0, 5).map(record => record.id);
  assert.equal(visibleIds[0], 'new-todo');
  assert.equal(visibleIds.includes('new-todo'), true);
  assert.equal(visibleIds.includes('schedule'), false);
});

test('add, cancel, and complete transitions preserve the record and update timestamps', () => {
  const record = { id: 'record-1', company: '示例公司', scheduleAt: '' };
  const pending = transitionRecordTodo(record, TODO_STATUS.PENDING, now);
  assert.equal(pending.todoStatus, 'pending');
  assert.equal(pending.todoCreatedAt, now);
  assert.equal(isRecordVisibleUpcoming(pending, now), true);

  const cancelled = transitionRecordTodo(pending, TODO_STATUS.CANCELLED, now + 1);
  assert.equal(cancelled.todoStatus, 'cancelled');
  assert.equal(cancelled.todoCancelledAt, now + 1);
  assert.equal(isRecordVisibleUpcoming(cancelled, now), false);

  const readded = transitionRecordTodo(cancelled, TODO_STATUS.PENDING, now + 2);
  assert.equal(readded.todoCreatedAt, now + 2);
  assert.equal(readded.todoCancelledAt, undefined);

  const completed = transitionRecordTodo(readded, TODO_STATUS.COMPLETED, now + 3);
  assert.equal(completed.todoStatus, 'completed');
  assert.equal(completed.todoCompletedAt, now + 3);
  assert.equal(isRecordVisibleUpcoming(completed, now), false);
});
