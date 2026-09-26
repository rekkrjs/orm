import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

const source = process.env.BENCH_ORM_SOURCE ?? '../dist/src/index.js'
const { Model } = await import(new URL(source, import.meta.url))
const rows = Array.from({ length: 500 }, (_, i) => ({
  id: i + 1, name: `User ${i + 1}`, email: `user${i + 1}@example.test`,
  active: i % 2, settings: { theme: i % 2 ? 'dark' : 'light', alerts: i % 3 === 0 },
}))

class User extends Model {
  static timestamps = false
  static casts = { active: 'boolean', settings: 'json' }
}
class AppendedUser extends User {
  static appends = ['theme']
  get theme() { return this.getAttribute('settings').theme }
}
class HiddenUser extends User {
  static hidden = ['email']
}
class VisibleUser extends User {
  static visible = ['id', 'name']
}

const plain = rows.map(row => ({ ...row, active: Boolean(row.active) }))
const workloads = [
  ['simple', User, plain],
  ['appended', AppendedUser, plain.map(row => ({ ...row, theme: row.settings.theme }))],
  ['hidden', HiddenUser, plain.map(({ email, ...row }) => row)],
  ['visible', VisibleUser, plain.map(row => ({ id: row.id, name: row.name }))],
]
const hidden = HiddenUser.hidden
HiddenUser.hidden[0] = 'name'
assert.equal(JSON.stringify(HiddenUser.hydrate(rows[0]).toJSON()),
  JSON.stringify({ id: 1, email: rows[0].email, active: false, settings: rows[0].settings }))
HiddenUser.hidden[0] = 'email'
const visible = VisibleUser.visible
VisibleUser.visible[1] = 'email'
assert.equal(JSON.stringify(VisibleUser.hydrate(rows[0]).toJSON()),
  JSON.stringify({ id: 1, email: rows[0].email }))
VisibleUser.visible[1] = 'name'
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const results = {}
for (const [name, model, expected] of workloads) {
  const hydrate = () => rows.map(row => model.hydrate(row))
  const serialize = models => models.map(item => item.toJSON())
  assert.equal(JSON.stringify(serialize(hydrate())), JSON.stringify(expected))
  for (let i = 0; i < 12; i++) serialize(hydrate())
  const samples = []
  let consumed = 0
  for (let round = 0; round < 5; round++) {
    let total = 0
    for (let iteration = 0; iteration < 60; iteration++) {
      const models = hydrate()
      const start = performance.now()
      const output = serialize(models)
      total += performance.now() - start
      consumed += output.length
    }
    samples.push(total / 60)
  }
  assert.equal(consumed, 5 * 60 * rows.length)
  results[name] = { medianMs: median(samples), minMs: Math.min(...samples), maxMs: Math.max(...samples) }
}
console.log(JSON.stringify({ runtime: typeof Bun === 'undefined' ? `Node ${process.version}` : `Bun ${Bun.version}`,
  source, rows: rows.length, results }))
