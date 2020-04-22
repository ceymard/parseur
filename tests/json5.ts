import { parser, test } from '../examples/json5'
import * as J5 from 'json5'

console.log(parser.parse(test))

import { benchmark, runBenchmarks } from './testsuite'

benchmark('Original JSON5', function Json5() {
  J5.parse(test)
})

benchmark('Parseur json5', function Json5Parseur() {
  parser.parse(test)
})

runBenchmarks()