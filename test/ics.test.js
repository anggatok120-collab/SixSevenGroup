process.env.TZ_OFFSET = '7';
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { buildIcs } = require('../src/ics');
const { parseLocal } = require('../src/time');

test('kalender .ics mengikuti semester dan hari libur', () => {
  const db = openDb(':memory:');
  db.addKelas({ hari: 1, mulai: '08:00', selesai: '09:40', matkul: 'Kalkulus', ruang: null, dosen: null }); // Senin
  db.setSetting('semester', { mulai: '2026-09-01', selesai: '2026-12-31', nasional: true, libur: [{ dari: '2026-11-30', sampai: '2026-11-30', nama: 'Dies' }] });
  const ics = buildIcs(db, { now: parseLocal('2026-11-22 10:00') });
  assert.match(ics, /RRULE:FREQ=WEEKLY;UNTIL=20261231T165900Z/);
  assert.match(ics, /EXDATE:20261130T010000Z/); // libur kampus
  // Semester sudah selesai: kelas rutin tidak muncul lagi
  db.setSetting('semester', { mulai: '2026-02-01', selesai: '2026-06-30', nasional: true, libur: [] });
  assert.doesNotMatch(buildIcs(db, { now: parseLocal('2026-11-22 10:00') }), /UID:kelas-1@/);
  // Libur nasional bertanggal tetap (1 Jun 2026 hari Senin) dikecualikan
  db.setSetting('semester', { mulai: null, selesai: null, nasional: true, libur: [] });
  assert.match(buildIcs(db, { now: parseLocal('2026-05-01 10:00') }), /EXDATE:20260601T010000Z/);
});
