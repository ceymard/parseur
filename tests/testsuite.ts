import { Suite } from 'benchmark'
import * as Benchmark from 'benchmark'

export var suite = new Suite()

export function benchmark(name: string, fn: (...a: any[]) => any) {
  var bench = new Benchmark(name, fn)
  suite.push(bench)
  bench.on('start', () => {
    process.stdout.write(name + ': ')
  })
  bench.on('complete', (b: { currentTarget: Benchmark }) => {
    var bench = b.currentTarget
    // console.log(b)
    console.log(Math.round(bench.hz), 'op/s')
  })
}

export function runBenchmarks() {
  suite.run()
}