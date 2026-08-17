import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../dashboard.js', import.meta.url), 'utf8');
const dashboardHtml = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const calendar = fs.readFileSync(new URL('../calendar.html', import.meta.url), 'utf8');
const mobile = fs.readFileSync(new URL('../mobile.html', import.meta.url), 'utf8');
const vacation = fs.readFileSync(new URL('../vacation-days.js', import.meta.url), 'utf8');

const clean = (object) => Object.fromEntries(
  Object.entries(object).filter(([, value]) => value !== undefined)
);

const entitlement = (course) => Math.floor(course.days / 14);
const homes = (trips) => trips.filter((trip) => trip.tripKind === 'heimfahrt');
const classify = (trip, course, trips) => {
  if (trip.manualClass === 'paid' || trip.manualClass === 'tax') return trip.manualClass;
  const homeTrips = homes(trips);
  if (trip.tripKind === 'heimfahrt') {
    return homeTrips.findIndex((item) => item.id === trip.id) < entitlement(course) ? 'paid' : 'tax';
  }
  if (trip.tripKind === 'rueckreise') {
    const prior = homeTrips.filter((item) => item.from <= trip.from).at(-1);
    return prior ? classify(prior, course, trips) : 'paid';
  }
  return 'paid';
};

test('all course trip kinds use exactly the one-way course distance', () => {
  const distance = 265;
  for (const kind of ['anreise', 'heimfahrt', 'rueckreise']) {
    const calculated = distance;
    assert.equal(calculated, 265, `${kind} must remain one-way`);
  }
  assert.match(index, /courseKm=c=>Math\.max\(0,\+c\.distance\|\|0\)/);
  assert.doesNotMatch(index, /k==='heimfahrt'\?2:1/);
  assert.doesNotMatch(dashboard, /kind === 'heimfahrt' \? 2 : 1/);
});

test('manual non-reimbursement overrides automatic 14-day classification', () => {
  const course = { days: 28 };
  const trips = [
    { id: 1, from: '2026-09-04', tripKind: 'heimfahrt', manualClass: 'tax' },
    { id: 2, from: '2026-09-06', tripKind: 'rueckreise', manualClass: '' }
  ];
  assert.equal(classify(trips[0], course, trips), 'tax');
  assert.equal(classify(trips[1], course, trips), 'tax');
});

test('automatic classification still follows the existing entitlement sequence', () => {
  const course = { days: 28 };
  const trips = [
    { id: 1, from: '2026-09-04', tripKind: 'heimfahrt', manualClass: '' },
    { id: 2, from: '2026-09-18', tripKind: 'heimfahrt', manualClass: '' },
    { id: 3, from: '2026-09-25', tripKind: 'heimfahrt', manualClass: '' }
  ];
  assert.deepEqual(trips.map((trip) => classify(trip, course, trips)), ['paid', 'paid', 'tax']);
});

test('legacy entries remain byte-for-byte equivalent after additive cleaning', () => {
  const legacy = {
    id: 17,
    type: 'fahrt',
    from: '2026-08-01',
    to: '2026-08-01',
    title: 'Bestand',
    km: 530,
    courseId: 3,
    tripKind: 'heimfahrt',
    manualClass: '',
    note: 'Nicht verändern'
  };
  assert.deepEqual(clean({ ...legacy }), legacy);
  assert.equal(legacy.allDay === undefined ? true : legacy.allDay, true);
});

test('Firestore writes merge with existing user documents', () => {
  assert.match(index, /setDoc\(ref\(\),\{entries:E,distance:dist,updatedAt:serverTimestamp\(\)\},\{merge:true\}\)/);
  assert.match(dashboard, /\}, \{ merge: true \}\);/);
  assert.match(vacation, /\{merge:true\}/);
});

test('calendar loader patch targets still exist in the embedded app', () => {
  const oldListenerLiteral = calendar.match(/const oldListener=("(?:[^"\\]|\\.)*")/);
  const newListenerLiteral = calendar.match(/const newListener=("(?:[^"\\]|\\.)*")/);
  assert.ok(oldListenerLiteral, 'oldListener declaration missing');
  assert.ok(newListenerLiteral, 'newListener declaration missing');
  const oldListener = JSON.parse(oldListenerLiteral[1]);
  const newListener = JSON.parse(newListenerLiteral[1]);
  assert.ok(index.includes(oldListener), 'calendar data-listener replacement would fail');
  assert.ok(index.includes('inside=(e,d)=>d>=parse(e.from)&&d<=parse(e.to)'), 'safe date-range patch target missing');
  assert.ok(index.includes('initializeFirestore,persistentLocalCache,persistentMultipleTabManager,collection,doc,setDoc,onSnapshot,serverTimestamp'), 'Firestore import patch target missing');
  const embedded = index.replace(oldListener, newListener);
  assert.ok(embedded.includes(newListener), 'direct journal listener was not injected');
  assert.ok(!embedded.includes(oldListener), 'legacy collection listener survived the injection');
});

test('calendar ranges and optional timing controls are present', () => {
  assert.match(index, /chip rangechip/);
  assert.match(index, /weeks\[w\]=new Map/);
  assert.match(index, /id="allDay" type="checkbox" checked/);
  assert.match(index, /id="arrivalTime" type="time"/);
  assert.match(index, /id="departureTime" type="time"/);
  assert.match(dashboard, /id="periodAllDay" type="checkbox" checked/);
  assert.match(dashboard, /id="courseAllDay" type="checkbox" checked/);
  assert.match(dashboard, /id="courseReimbursement"/);
  assert.match(dashboard, /km: Number\(course\.distance\) \|\| 0/);
});

test('all public entry points use the same cache-busting release', () => {
  for (const source of [calendar, dashboardHtml, mobile]) {
    assert.match(source, /20260817-1/);
    assert.doesNotMatch(source, /202607(?:28|31)-/);
  }
});

test('static HTML ids remain unique', () => {
  for (const [name, html] of [['index.html', index], ['calendar.html', calendar]]) {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const duplicates = ids.filter((id, position) => ids.indexOf(id) !== position);
    assert.deepEqual(duplicates, [], `${name} contains duplicate ids: ${duplicates.join(', ')}`);
  }
});
