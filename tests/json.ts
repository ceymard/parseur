import { parser } from '../examples/json'
import { Parseur, Seq, Either, Rule, Forward, SeparatedBy, Context } from '../index'
import { parse as chevrotain_parse } from './chevrotain/json'

const TK = new class JsonTokenizer extends Parseur {
  // End with the regexps
  STR =   this.token(/"(?:\\"|[^"])*"/) //.map(r => r.match[0].slice(1, -1)),
  NUM =   this.token(/-?\d+(?:\.\d+)?(?:[eE][+-]?)?/) //.map(r => parseFloat(r.match[0])),
  WHITESPACE = this.token(/\s+/).skip()
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
console.log(parser.parse(one))

import { benchmark, runBenchmarks } from './testsuite'

benchmark('Original JSON', function Json() {
  JSON.parse(one)
})

benchmark('Json with productions', function JsonRes() {
  parser.parse(one)
})

benchmark('Json without object building', function JsonNoResult() {
  const tkres = TK.tokenize(one, { forget_skips: true })!
  if (tkres.status === 'ok')
    JsonNoRes.Json.parse(new Context(tkres.tokens))
})

benchmark('Chevrotain JSON without object', function () {
  chevrotain_parse(one)
})

runBenchmarks()