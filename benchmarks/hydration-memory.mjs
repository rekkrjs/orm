import assert from 'node:assert/strict'
import { PerformanceObserver, performance } from 'node:perf_hooks'
const source = process.env.BENCH_ORM_SOURCE ?? '../dist/src/index.js'
const { Model, Collection } = await import(new URL(source, import.meta.url))

const isBun = typeof Bun !== 'undefined'
const rowCount = Number(process.env.BENCH_ROWS ?? 500)
const memoryRows = Number(process.env.BENCH_MEMORY_ROWS ?? 10_000)
assert(Number.isSafeInteger(rowCount) && rowCount > 0)
assert(Number.isSafeInteger(memoryRows) && memoryRows >= rowCount)
assert(isBun || typeof global.gc === 'function', 'Run Node with --expose-gc')

const heapBytes = () => process.memoryUsage().heapUsed
const collect = isBun ? () => Bun.gc(true) : () => global.gc()
let gcEvents = 0
const observer = isBun ? null : new PerformanceObserver(list => { gcEvents += list.getEntries().length })
observer?.observe({ entryTypes: ['gc'] })

class BenchUser extends Model {
  static table = 'memory_benchmark_users'
  static timestamps = false
  static casts = { active: 'boolean', settings: 'json' }
}

const rows = Array.from({ length: rowCount }, (_, i) => ({
  id: i + 1,
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.test`,
  active: i % 2 === 0 ? 1 : 0,
  settings: { theme: i % 2 ? 'dark' : 'light', alerts: i % 3 === 0 },
}))
const hydrate = source => new Collection(source.map(row => BenchUser.hydrate(row)))
const expected = rows.map(row => ({ ...row, active: Boolean(row.active) }))
assert.equal(JSON.stringify(hydrate(rows).toJSON()), JSON.stringify(expected))

let consumed = 0
function measureBatch() {
  let start = performance.now()
  const models = hydrate(rows)
  const hydrateMs = performance.now() - start
  start = performance.now()
  const json = models.toJSON()
  const toJsonMs = performance.now() - start
  start = performance.now()
  consumed += JSON.stringify(json).length
  const stringifyMs = performance.now() - start
  return { hydrateMs, toJsonMs, stringifyMs }
}

for (let i = 0; i < 12; i++) measureBatch()
const rounds = []
const beforeTimingGc = gcEvents
for (let round = 0; round < 5; round++) {
  const totals = { hydrateMs: 0, toJsonMs: 0, stringifyMs: 0 }
  for (let i = 0; i < 60; i++) {
    const sample = measureBatch()
    for (const key of Object.keys(totals)) totals[key] += sample[key]
  }
  rounds.push(Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value / 60])))
}
await new Promise(resolve => setImmediate(resolve))
const timingGcEvents = isBun ? null : gcEvents - beforeTimingGc

collect()
await new Promise(resolve => setImmediate(resolve))
const beforeHydrateGc = gcEvents
const heapBefore = heapBytes()
const memoryModels = hydrate(Array.from({ length: memoryRows }, (_, i) => rows[i % rowCount]))
const heapAfterHydrate = heapBytes()
await new Promise(resolve => setImmediate(resolve))
const hydrateGcEvents = gcEvents - beforeHydrateGc
collect()
const retainedHydrate = heapBytes()
await new Promise(resolve => setImmediate(resolve))
const beforeToJsonGc = gcEvents
const memoryJson = memoryModels.toJSON()
const heapAfterToJson = heapBytes()
await new Promise(resolve => setImmediate(resolve))
const toJsonGcEvents = gcEvents - beforeToJsonGc
collect()
const retainedToJson = heapBytes()
assert.equal(memoryModels.length, memoryRows)
assert.deepEqual(memoryJson[0], expected[0])
assert.deepEqual(memoryJson.at(-1), expected[(memoryRows - 1) % rowCount])
assert(consumed > 0)
observer?.disconnect()

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const timing = Object.fromEntries(Object.keys(rounds[0]).map(key => {
  const values = rounds.map(round => round[key])
  return [key, { median: median(values), min: Math.min(...values), max: Math.max(...values) }]
}))
console.log(JSON.stringify({
  runtime: isBun ? `Bun ${Bun.version}` : `Node ${process.version}`,
  source,
  rowsPerBatch: rowCount, memoryModels: memoryRows,
  timingMsPerBatch: timing, automaticGcEventsDuringTiming: timingGcEvents,
  memory: {
    heapGrowthBeforeGcBytesPerModel: {
      hydrate: isBun || hydrateGcEvents ? null : (heapAfterHydrate - heapBefore) / memoryRows,
      toJson: isBun || toJsonGcEvents ? null : (heapAfterToJson - retainedHydrate) / memoryRows,
    },
    retainedHeapBytesPerModel: {
      hydrate: (retainedHydrate - heapBefore) / memoryRows,
      toJson: (retainedToJson - retainedHydrate) / memoryRows,
    },
    automaticGcEvents: isBun ? null : { hydrate: hydrateGcEvents, toJson: toJsonGcEvents },
  },
}))
