import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

const source = typeof Bun === 'undefined' ? '../dist/src/index.js' : '../src/index.ts'
const { Connection } = await import(source)
const grammar = new Connection({ url: 'postgres://localhost/unused' }).getGrammar()
const table = 'bench_create_cost'
const record = { name: 'User', email: 'user@example.test', active: true, settings: '{"theme":"light"}' }
const compile = columns => `INSERT INTO ${grammar.wrap(table)} (${columns.map(column => grammar.wrap(column)).join(', ')}) VALUES (${columns.map((_, i) => grammar.placeholder(i + 1)).join(', ')}) RETURNING ${grammar.wrap('id')}`
const cache = new Map()
const cached = columns => {
  const key = `${table}\0${columns.join('\0')}`
  let sql = cache.get(key)
  if (!sql) { sql = compile(columns); cache.set(key, sql) }
  return sql
}
const expected = compile(Object.keys(record))
assert.equal(cached(Object.keys(record)), expected)
const variants = { compile: () => compile(Object.keys(record)), cacheLookup: () => cached(Object.keys(record)) }
let sink = 0
for (let i = 0; i < 20_000; i++) for (const fn of Object.values(variants)) sink += fn().length
const values = { compile: [], cacheLookup: [] }
for (let round = 0; round < 7; round++) {
  for (const name of round % 2 ? ['cacheLookup', 'compile'] : ['compile', 'cacheLookup']) {
    const start = performance.now()
    for (let i = 0; i < 100_000; i++) sink += variants[name]().length
    values[name].push((performance.now() - start) * 1000 / 100_000)
  }
}
const median = samples => [...samples].sort((a, b) => a - b)[samples.length >> 1]
console.log(JSON.stringify({ runtime: typeof Bun === 'undefined' ? process.version : `Bun ${Bun.version}`, columns: Object.keys(record).length, microsecondsPerCallLowerBetter: Object.fromEntries(Object.entries(values).map(([key, samples]) => [key, +median(samples).toFixed(3)])), sink }))
