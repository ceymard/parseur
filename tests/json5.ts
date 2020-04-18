import { parser, test } from '../examples/json5'
import * as J5 from 'json5'

console.log(parser.parse(test))

import { Suite } from 'benchmark'
import * as Benchmark from 'benchmark'

var s = new Suite()

s.add(function Json5() {
  J5.parse(test)
})

s.add(function Json5Parseur() {
  parser.parse(test)
})


s.run()

var benches = s.run({maxTime: 1 }) as unknown as Benchmark[]
for (var b = 0, l = benches.length; b < l; b++) {
  var bench = benches[b]
  var name = typeof bench.fn === 'function' ? bench.fn.name : bench.fn
  console.log(name, Math.round(bench.hz))

}
