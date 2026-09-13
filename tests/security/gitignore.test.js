'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('.gitignore excludes secrets and build/runtime artifacts', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '..', '.gitignore'), 'utf8')
  for (const pattern of ['.env', '.env.*', 'node_modules/', 'dist/', 'out/', 'release/']) {
    assert.ok(gitignore.includes(pattern), `.gitignore should contain "${pattern}"`)
  }
})

test('.env.example contains only empty placeholders, no real secret values', () => {
  const envExample = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8')
  for (const line of envExample.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [, ...rest] = trimmed.split('=')
    const value = rest.join('=').trim()
    assert.equal(value, '', `expected an empty placeholder value in .env.example, got: "${trimmed}"`)
  }
})
