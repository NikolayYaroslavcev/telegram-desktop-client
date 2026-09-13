const test = require('node:test')
const assert = require('node:assert/strict')

test('foundation build output exists', () => {
  const path = require('node:path')
  const fs = require('node:fs')

  const root = path.join(__dirname, '..')
  assert.ok(fs.existsSync(path.join(root, 'src/main/index.ts')), 'src/main/index.ts should exist')
  assert.ok(
    fs.existsSync(path.join(root, 'src/preload/index.ts')),
    'src/preload/index.ts should exist',
  )
  assert.ok(
    fs.existsSync(path.join(root, 'src/renderer/App.tsx')),
    'src/renderer/App.tsx should exist',
  )
})
