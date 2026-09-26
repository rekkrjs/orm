import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

const source = typeof Bun === 'undefined' ? '../dist/src/index.js' : '../src/index.ts'
const { Builder, Connection, ConnectionManager, Model, Schema } = await import(source)
const url = process.env.POSTGRES_TEST_URL
assert(url, 'Set POSTGRES_TEST_URL')
const table = `bench_create_cost_${process.pid}_${Date.now().toString(36)}`
const connection = new Connection({ url, max: 1 })
ConnectionManager.setDefault(connection)
Schema.setConnection(connection)
class Write extends Model {
  static table = table
  static timestamps = false
  static fillable = ['name', 'email', 'active', 'settings']
  static casts = { active: 'boolean', settings: 'json' }
}
class NoOuter extends Write {
  async save(options = {}) { return this.saveRecord(options) }
}
const qualified = Write.getQualifiedTable(connection)
const sql = `INSERT INTO ${connection.getGrammar().wrap(qualified)} ("name", "email", "active", "settings") VALUES ($1, $2, $3, $4) RETURNING "id"`
let sequence = 0
const data = () => ({ name: `User ${++sequence}`, email: `user-${sequence}@example.test`, active: true, settings: { theme: 'light' } })
const model = async () => (await Write.create(data())).id
const noOuter = async () => (await NoOuter.create(data())).id
const builder = async () => new Builder(connection, qualified).insertGetId({ ...data(), settings: JSON.stringify({ theme: 'light' }) })
const raw = async () => {
  const row = data()
  return (await connection.query(sql, [row.name, row.email, row.active, JSON.stringify(row.settings)]))[0].id
}
const variants = { model, noOuter, builder, raw }
const names = Object.keys(variants)
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1]
async function measure(methods, iterations) {
  const values = Object.fromEntries(Object.keys(methods).map(name => [name, []]))
  const keys = Object.keys(methods)
  for (let i = 0; i < 12; i++) for (const name of keys) assert((await methods[name]()) != null)
  for (let round = 0; round < 7; round++) {
    for (const name of keys.slice(round % keys.length).concat(keys.slice(0, round % keys.length))) {
      const start = performance.now()
      for (let i = 0; i < iterations; i++) assert((await methods[name]()) != null)
      values[name].push((performance.now() - start) * 1000 / iterations)
    }
  }
  return Object.fromEntries(keys.map(name => [name, +median(values[name]).toFixed(2)]))
}

try {
  await Schema.create(table, t => {
    t.increments('id'); t.string('name', 80); t.string('email', 120); t.boolean('active'); t.json('settings')
  })
  const databaseUs = await measure(variants, 100)
  const rows = await connection.query(`SELECT COUNT(*) AS n FROM "${table}"`)
  assert.equal(Number(rows[0].n), names.length * (12 + 7 * 100))

  const realQuery = connection.query
  let fakeId = 0
  connection.query = async () => [{ id: ++fakeId }]
  let noDbUs
  try { noDbUs = await measure(variants, 1000) }
  finally { connection.query = realQuery }

  const noop = async () => 1
  const scopes = {
    direct: noop,
    use: () => connection.use(noop),
    nestedUse: () => connection.use(() => connection.use(noop)),
  }
  const scopeUs = await measure(scopes, 1000)

  console.log(JSON.stringify({ runtime: typeof Bun === 'undefined' ? process.version : `Bun ${Bun.version}`, rows: Number(rows[0].n), microsecondsPerInsertLowerBetter: { database: databaseUs, noDatabase: noDbUs }, microsecondsPerNoopLowerBetter: scopeUs }))
} finally {
  await Schema.dropIfExists(table)
  await connection.close()
}
