import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

const url = process.env.MYSQL_TEST_URL
assert(url, 'Set MYSQL_TEST_URL to a disposable MySQL test database')
const source = process.env.BENCH_ORM_SOURCE ?? '../dist/src/index.js'
const { Connection } = await import(new URL(source, import.meta.url))
const connection = new Connection({ url, max: 10 })
const table = `bench_date_write_${process.pid}_${Date.now().toString(36)}`
const date = new Date('2026-09-26T12:34:56.789Z')
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

try {
  await connection.run(`CREATE TABLE \`${table}\` (id INT AUTO_INCREMENT PRIMARY KEY, occurred_at DATETIME(3) NOT NULL)`)
  await connection.run(`INSERT INTO \`${table}\` (occurred_at) VALUES (?)`, [date])
  const update = () => connection.run(`UPDATE \`${table}\` SET occurred_at = ? WHERE id = 1`, [date])
  for (let i = 0; i < 20; i++) await update()
  const samples = []
  for (let round = 0; round < 7; round++) {
    const start = performance.now()
    for (let i = 0; i < 100; i++) await update()
    samples.push(100_000 / (performance.now() - start))
  }
  const [{ count, stored_value }] = await connection.query(
    `SELECT COUNT(*) AS count, DATE_FORMAT(MAX(occurred_at), '%Y-%m-%d %H:%i:%s.%f') AS stored_value FROM \`${table}\``)
  assert.equal(Number(count), 1)
  assert.equal(stored_value, '2026-09-26 12:34:56.789000')
  console.log(JSON.stringify({ runtime: process.version, source, driver: 'mysql2',
    operation: 'UPDATE with a Date binding', rounds: 7, iterations: 100,
    medianOpsPerSecond: median(samples), min: Math.min(...samples), max: Math.max(...samples) }))
} finally {
  try { await connection.run(`DROP TABLE IF EXISTS \`${table}\``) }
  finally { await connection.close() }
}
