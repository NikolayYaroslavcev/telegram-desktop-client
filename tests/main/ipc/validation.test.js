'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  requireString,
  requireNonEmptyString,
  requireFiniteNumber,
  optionalFiniteNumber,
  optionalBoolean,
} = require(path.join(__dirname, '..', '..', '..', 'out', 'main', 'ipc', 'validation.js'))

function assertInvalidArgument(fn) {
  assert.throws(fn, (err) => err.code === 'INVALID_ARGUMENT')
}

test('requireString accepts a string and returns it unchanged', () => {
  assert.equal(requireString('hello', 'field'), 'hello')
  assert.equal(requireString('', 'field'), '')
})

test('requireString rejects non-strings', () => {
  for (const value of [123, null, undefined, {}, [], true]) {
    assertInvalidArgument(() => requireString(value, 'field'))
  }
})

test('requireFiniteNumber accepts a finite number and returns it unchanged', () => {
  assert.equal(requireFiniteNumber(42, 'field'), 42)
  assert.equal(requireFiniteNumber(0, 'field'), 0)
  assert.equal(requireFiniteNumber(-5, 'field'), -5)
})

test('requireFiniteNumber rejects non-numbers, NaN, and Infinity', () => {
  for (const value of ['42', null, undefined, NaN, Infinity, -Infinity, {}]) {
    assertInvalidArgument(() => requireFiniteNumber(value, 'field'))
  }
})

test('optionalFiniteNumber allows undefined through', () => {
  assert.equal(optionalFiniteNumber(undefined, 'field'), undefined)
})

test('optionalFiniteNumber validates a defined value like requireFiniteNumber', () => {
  assert.equal(optionalFiniteNumber(7, 'field'), 7)
  assertInvalidArgument(() => optionalFiniteNumber('7', 'field'))
  assertInvalidArgument(() => optionalFiniteNumber(null, 'field'))
})

test('requireNonEmptyString accepts non-blank text and returns it exactly as given', () => {
  assert.equal(requireNonEmptyString('hello', 'field'), 'hello')
  assert.equal(requireNonEmptyString('  hello  ', 'field'), '  hello  ') // never trimmed/mutated
})

test('requireNonEmptyString rejects an empty string', () => {
  assertInvalidArgument(() => requireNonEmptyString('', 'field'))
})

test('requireNonEmptyString rejects whitespace-only strings', () => {
  for (const value of [' ', '   ', '\t', '\n', '\t\n  ']) {
    assertInvalidArgument(() => requireNonEmptyString(value, 'field'))
  }
})

test('requireNonEmptyString rejects non-strings, same as requireString', () => {
  for (const value of [123, null, undefined, {}, [], true]) {
    assertInvalidArgument(() => requireNonEmptyString(value, 'field'))
  }
})

test('optionalBoolean allows undefined through', () => {
  assert.equal(optionalBoolean(undefined, 'field'), undefined)
})

test('optionalBoolean accepts true/false and returns them unchanged', () => {
  assert.equal(optionalBoolean(true, 'field'), true)
  assert.equal(optionalBoolean(false, 'field'), false)
})

test('optionalBoolean rejects truthy/falsy non-boolean stand-ins', () => {
  for (const value of [1, 0, 'true', 'false', null, {}, []]) {
    assertInvalidArgument(() => optionalBoolean(value, 'field'))
  }
})
