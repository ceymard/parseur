import { parser } from '../examples/json'
import { Parseur, Seq, Either, Rule, Forward, SeparatedBy, Context } from '../index'

const TK = new class JsonTokenizer extends Parseur {
  // End with the regexps
  STR =   this.token(/"(?:\\"|[^"])*"/, '"') //.map(r => r.match[0].slice(1, -1)),
  NUM =   this.token(/-?\d+(?:\.\d+)?(?:[eE][+-]?)?/, '0123456789-') //.map(r => parseFloat(r.match[0])),
  WHITESPACE = this.token(/[\s\n\t\r]+/, ' \t\n\r').skip()
}

const P = TK.P


export namespace JsonNoRes {
  export const Json: Rule<any> = Either(
    TK.STR,
    TK.NUM,
    P`true`,
    P`false`,
    P`null`,
    Forward(() => Array),
    Forward(() => Obj)
  )

  const Array = P`[ ${SeparatedBy(P`,`, Json)} ]`

  const Prop = Seq(
    { key:     TK.STR },
             P`:`,
    { value:   Json }
  )

  const Obj = P`{ ${SeparatedBy(P`,`, Prop)} }`

}



const one = require('./1K_json').json_sample1k

// var tokens = TK.tokenize(one)!
console.log(parser.parse(one).result)


import { Suite } from 'benchmark'
import * as Benchmark from 'benchmark'

var s = new Suite()

s.add(function Json() {
  JSON.parse(one)
})

s.add(function JsonRes() {
  parser.parse(one)
})

s.add(function JsonNoResult() {
  const tokens = TK.tokenize(one, { forget_skips: true })!
  JsonNoRes.Json.parse(new Context(tokens))
})

s.run()

var benches = s.run({maxTime: 1 }) as unknown as Benchmark[]
for (var b = 0, l = benches.length; b < l; b++) {
  var bench = benches[b]
  var name = typeof bench.fn === 'function' ? bench.fn.name : bench.fn
  console.log(name, Math.round(bench.hz))

}
