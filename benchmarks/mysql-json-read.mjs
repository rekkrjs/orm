import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

const url = process.env.MYSQL_TEST_URL
assert(url?.startsWith('mysql://'), 'Set MYSQL_TEST_URL to a disposable MySQL test database')
assert(typeof Bun !== 'undefined', 'Run this benchmark with Bun')
const source = process.env.BENCH_ORM_SOURCE ?? '../dist/src/index.js'
const { Connection, ConnectionManager, DB, Model, Schema } = await import(new URL(source, import.meta.url))
const readConnection = new Connection({ url, max: 10 })
const setupConnection = new Connection({ url, max: 1 })
ConnectionManager.setDefault(setupConnection)
const table = `bench_json_read_${process.pid}_${Date.now().toString(36)}`
const count = 500
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const round = value => Math.round(value * 100) / 100

class User extends Model {
  static table = table
  static timestamps = false
  static casts = { active: 'boolean', settings: 'json' }
  static connection = readConnection
}

try {
  await Schema.create(table, schema => {
    schema.increments('id')
    schema.string('name', 80)
    schema.string('email', 120)
    schema.boolean('active')
    schema.json('settings')
  })
  const seed = Array.from({ length: count }, (_, index) => ({
    name: `User ${index + 1}`,
    email: `user${index + 1}@example.test`,
    active: index % 2 === 0,
    settings: JSON.stringify({ theme: index % 2 ? 'dark' : 'light', alerts: index % 3 === 0 }),
  }))
  await DB.table(table).insert(seed)
  const expected = JSON.stringify(seed.map((row, index) => ({
    id: index + 1, name: row.name, email: row.email, active: row.active,
    settings: JSON.parse(row.settings),
  })))
  const lanes = [
    ['model', async () => JSON.stringify(await User.orderBy('id').json())],
    ['raw', async () => JSON.stringify(await User.orderBy('id').rawJson())],
  ]
  for (const [, run] of lanes) assert.equal(await run(), expected)
  const samples = Object.fromEntries(lanes.map(([name]) => [name, []]))
  for (const [, run] of lanes) for (let i = 0; i < 10; i++) await run()
  for (let cycle = 0; cycle < 7; cycle++) {
    for (let offset = 0; offset < lanes.length; offset++) {
      const [name, run] = lanes[(cycle + offset) % lanes.length]
      const start = performance.now()
      for (let i = 0; i < 100; i++) await run()
      samples[name].push(100_000 / (performance.now() - start))
    }
  }
  assert.equal(await DB.table(table).count(), count)
  console.log(JSON.stringify({ runtime: `Bun ${Bun.version}`, driver: 'bun:sql', dialect: 'mysql',
    source, rows: count, rounds: 7, iterations: 100,
    results: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, {
      medianOpsPerSecond: round(median(values)), min: round(Math.min(...values)),
      max: round(Math.max(...values)), samples: values.map(round),
    }])) }, null, 2))
} finally {
  try { await Schema.dropIfExists(table) }
  finally { await Promise.all([readConnection.close(), setupConnection.close()]) }
}
