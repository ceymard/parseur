import { RegExpParser } from '../regexp'
import { inspect } from 'util'
import { benchmark, runBenchmarks } from './testsuite'
import { RegExpParser as RtaParser } from 'regexp-to-ast'

function log(v: any) { console.log(inspect(v, { colors: true, depth: null, compact: true })) }
function test(v: RegExp) {
  console.log(v, inspect(p.parse(v), { colors: true, depth: null, compact: true }))
  // console.log(v, inspect(competition.pattern(v.toString()), { colors: true, depth: null, compact: true }))
}

var p = new RegExpParser()
var competition = new RtaParser()

// test(/abc/i)
// test(/\w?\d|\s\S\12/)
test(/(?<sdf>a)\k<sdf>/)
// test(/[-.]./)
// test(/.*?/)

var patterns = [
  /\w?\d|\s\S\12/
]

var patterns_str = patterns.map(p => p.toString())

// benchmark('Parseur', () => {
//   for (var i = 0, l = patterns.length; i < l; i++) {
//     p.parse(patterns[i])
//   }
// })

// benchmark('Regexp-to-ast', () => {
//   for (var i = 0, l = patterns_str.length; i < l; i++) {
//     competition.pattern(patterns_str[i])
//   }
// })

// runBenchmarks()
