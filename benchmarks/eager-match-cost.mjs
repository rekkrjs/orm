import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

const source = typeof Bun === 'undefined' ? '../dist/src/index.js' : '../src/index.ts'
const { Model, Collection, HasMany } = await import(source)
class Parent extends Model { static table = 'bench_match_parents'; static timestamps = false }
class Child extends Model { static table = 'bench_match_children'; static timestamps = false }
const parents = Array.from({ length: 500 }, (_, i) => Parent.hydrate({ id: i + 1 }))
const children = new Collection(Array.from({ length: 1000 }, (_, i) => Child.hydrate({ id: i + 1, parentId: (i >> 1) + 1 })))
const relation = { foreignKey: 'parentId', localKey: 'id' }
const groups = () => {
  const dictionary = {}
  for (const child of children) {
    const key = child.$attributes.parentId
    if (!dictionary[key]) dictionary[key] = []
    dictionary[key].push(child)
  }
  return dictionary
}
const pregrouped = groups()
const variants = {
  match: () => { HasMany.prototype.match.call(relation, parents, children, 'children'); return parents[0].getRelation('children').length },
  matchPush: () => {
    const dictionary = groups()
    for (const model of parents) {
      const collection = new Collection()
      collection.push(...(dictionary[String(model.getAttribute('id'))] || []))
      model.setRelation('children', collection)
    }
    return parents[0].getRelation('children').length
  },
  group: () => Object.keys(groups()).length,
  assignArrays: () => {
    for (const model of parents) model.setRelation('children', pregrouped[String(model.getAttribute('id'))] || [])
    return parents[0].getRelation('children').length
  },
  assignCollections: () => {
    for (const model of parents) model.setRelation('children', new Collection(pregrouped[String(model.getAttribute('id'))] || []))
    return parents[0].getRelation('children').length
  },
  collectionsOnly: () => {
    let total = 0
    for (const model of parents) total += new Collection(pregrouped[String(model.$attributes.id)]).length
    return total
  },
  collectionsPush: () => {
    let total = 0
    for (const model of parents) {
      const bucket = pregrouped[String(model.$attributes.id)]
      const collection = new Collection()
      collection.push(...bucket)
      total += collection.length
    }
    return total
  },
}
for (const [name, fn] of Object.entries(variants)) {
  const expected = name === 'group' ? 500 : name.startsWith('collections') ? 1000 : 2
  assert.equal(fn(), expected, name)
}
variants.match()
assert(children.every((child, i) => child === parents[(i >> 1)].getRelation('children')[i % 2]))
const expectedJson = JSON.stringify(parents.map(parent => parent.toJSON()))
variants.matchPush()
assert(parents.every(parent => parent.getRelation('children') instanceof Collection))
assert(children.every((child, i) => child === parents[(i >> 1)].getRelation('children')[i % 2]))
assert.equal(JSON.stringify(parents.map(parent => parent.toJSON())), expectedJson)

const names = Object.keys(variants)
const observations = Object.fromEntries(names.map(name => [name, []]))
let sink = 0
for (let i = 0; i < 30; i++) for (const name of names) sink += variants[name]()
for (let round = 0; round < 7; round++) {
  for (const name of names.slice(round % names.length).concat(names.slice(0, round % names.length))) {
    const start = performance.now()
    for (let i = 0; i < 100; i++) sink += variants[name]()
    observations[name].push((performance.now() - start) * 10) // µs per batch
  }
}
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1]
console.log(JSON.stringify({ runtime: typeof Bun === 'undefined' ? process.version : `Bun ${Bun.version}`, parents: 500, children: 1000, microsecondsPerBatchLowerBetter: Object.fromEntries(names.map(name => [name, +median(observations[name]).toFixed(2)])), sink }))
