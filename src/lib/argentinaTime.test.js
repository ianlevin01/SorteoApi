import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arCalendarDay, argentinaWallClockToUtc, formatArgentinaDateTime } from './argentinaTime.js';

test('arCalendarDay - mismo día ART aunque cruce medianoche UTC', () => {
  // 21:52 hora Argentina del 18/09 -> 00:52 UTC del 19/09.
  const day1 = arCalendarDay(new Date('2026-09-19T00:52:00.000Z'));
  // Cualquier otro instante del mismo día ART (ej: 23:00 UTC del 18/09 = 20:00 ART del 18/09).
  const day2 = arCalendarDay(new Date('2026-09-18T23:00:00.000Z'));
  assert.equal(day1, day2);
});

test('arCalendarDay - distingue días distintos en ART', () => {
  const day1 = arCalendarDay(new Date('2026-09-19T00:52:00.000Z')); // 18/09 ART
  const day2 = arCalendarDay(new Date('2026-09-19T03:01:00.000Z')); // ya 00:01 ART del 19/09
  assert.ok(day2 > day1);
});

test('argentinaWallClockToUtc - interpreta el string como hora Argentina, no la del proceso', () => {
  // "20:00" cargado en un <input type="datetime-local"> significa 20:00 ART
  // -> tiene que dar 23:00 UTC del mismo día, sin importar el TZ del proceso.
  const d = argentinaWallClockToUtc('2026-09-25T20:00');
  assert.equal(d.toISOString(), '2026-09-25T23:00:00.000Z');
});

test('argentinaWallClockToUtc - null/vacío/formato raro -> null', () => {
  assert.equal(argentinaWallClockToUtc(null), null);
  assert.equal(argentinaWallClockToUtc(''), null);
  assert.equal(argentinaWallClockToUtc('no es una fecha'), null);
});

test('formatArgentinaDateTime - muestra la hora en ART, no en UTC', () => {
  // 23:00 UTC del 25/09 es 20:00 ART del mismo día.
  assert.equal(formatArgentinaDateTime('2026-09-25T23:00:00.000Z'), '20:00hs del 25/09');
  // Caso límite: 00:30 UTC del 19/09 es 21:30 ART del 18/09 (día anterior).
  assert.equal(formatArgentinaDateTime('2026-09-19T00:30:00.000Z'), '21:30hs del 18/09');
});
