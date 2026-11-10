import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreJob } from '../src/score.mjs';

const profile = {
  skills: { react: 10, typescript: 8, graphql: 5 },
  roleKeywords: { engineer: 8, developer: 6 },
  seniorityPenalty: { staff: -25, principal: -25, intern: -40 },
};

test('a skill in the title counts twice a skill buried in the body', () => {
  const titled = scoreJob({ title: 'React Engineer', description: '' }, profile);
  const buried = scoreJob({ title: 'Engineer', description: 'We use react daily' }, profile);

  assert.equal(titled.matched.includes('react'), true);
  assert.equal(buried.matched.includes('react'), true);
  assert.ok(titled.score > buried.score, 'title match should outrank body match');
});

test('department matches count once, like body matches', () => {
  const department = scoreJob({ title: 'Engineer', department: 'react' }, profile);
  const body = scoreJob({ title: 'Engineer', description: 'react' }, profile);

  assert.equal(department.score, body.score);
});

test('remote postings receive the remote bonus', () => {
  const onsite = scoreJob({ title: 'React Engineer' }, profile);
  const remote = scoreJob({ title: 'React Engineer', remote: true }, profile);

  assert.equal(remote.score - onsite.score, 6);
});

test('seniority penalties reduce the score and never fall below zero', () => {
  const plain = scoreJob({ title: 'React Engineer' }, profile);
  const senior = scoreJob({ title: 'Principal Staff React Engineer' }, profile);
  const hopeless = scoreJob({ title: 'Principal Staff Intern' }, profile);

  assert.ok(senior.score < plain.score);
  assert.equal(hopeless.score, 0);
  assert.ok(hopeless.score >= 0);
});

test('the score is capped at one hundred', () => {
  const heavy = {
    skills: { react: 50, typescript: 50, graphql: 50 },
    roleKeywords: { engineer: 50 },
    seniorityPenalty: {},
  };

  assert.equal(scoreJob({ title: 'React TypeScript GraphQL Engineer' }, heavy).score, 100);
});

test('matched terms are unique and limited to twelve', () => {
  const wide = {
    skills: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`skill${index}`, 1])),
    roleKeywords: {},
    seniorityPenalty: {},
  };
  const result = scoreJob({ title: Array.from({ length: 20 }, (_, index) => `skill${index}`).join(' ') }, wide);

  assert.equal(result.matched.length, 12);
  assert.equal(new Set(result.matched).size, result.matched.length);
});

test('missing or unexpected job fields do not throw', () => {
  assert.deepEqual(scoreJob({}, profile), { score: 0, matched: [] });
  assert.equal(scoreJob({ title: null, description: undefined }, profile).score, 0);
});
