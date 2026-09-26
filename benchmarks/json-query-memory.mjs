import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

const source = process.env.BENCH_ORM_SOURCE ?? '../dist/src/index.js'
const { Connection, Model } = await import(new URL(source, import.meta.url))
const connection = new Connection({ url: 'sqlite://:memory:' })
const rows = Array.from({ length: 500 }, (_, index) => ({
  id: index + 1,
  name: `User ${index + 1}`,
  active: index % 2,
  settings: { theme: index % 2 ? 'dark' : 'light', alerts: index % 3 === 0 },
}))
connection.query = async () => rows.map(row => ({ ...row }))

class User extends Model {
  static table = 'memory_json_users'
  static timestamps = false
  static casts = { active: 'boolean', settings: 'json' }
  static connection = connection
}

class AppendedUser extends User {
  static appends = ['theme']
  get theme() { return this.getAttribute('settings').theme }
}

class PlainAppendedUser extends Model {
  static table = 'memory_json_users'
  static timestamps = false
  static casts = { active: 'boolean' }
  static appends = ['upperName']
  static connection = connection
  get upperName() { return this.getAttribute('name').toUpperCase() }
}

const expected = rows.map(row => ({ ...row, active: Boolean(row.active) }))
const workloads = [
  ['plain', User, expected],
  ['appended', AppendedUser, expected.map(row => ({ ...row, theme: row.settings.theme }))],
  ['appendedWithoutJsonCast', PlainAppendedUser, expected.map(row => ({ ...row, upperName: row.name.toUpperCase() }))],
]
for (const [, model, output] of workloads) {
  assert.equal(JSON.stringify(await model.query().json()), JSON.stringify(output))
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const timing = {}
for (const [name, model] of workloads) {
  const run = async () => JSON.stringify(await model.query().json()).length
  for (let i = 0; i < 20; i++) await run()
  const samples = []
  for (let round = 0; round < 7; round++) {
    const start = performance.now()
    let consumed = 0
    for (let i = 0; i < 100; i++) consumed += await run()
    assert(consumed > 0)
    samples.push((performance.now() - start) / 100)
  }
  timing[name] = { medianMs: median(samples), minMs: Math.min(...samples), maxMs: Math.max(...samples) }
}
await connection.close()
console.log(JSON.stringify({ runtime: typeof Bun === 'undefined' ? process.version : `Bun ${Bun.version}`,
  source, rows: rows.length, timing }))
