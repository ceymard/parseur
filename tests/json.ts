import { Parseur, Seq, Either, Rule, Forward, SeparatedBy, Context } from '../index'

const TK = new class JsonTokenizer extends Parseur {
  // End with the regexps
  STR =   this.token(/"(?:\\"|[^"])*"/, '"') //.map(r => r.match[0].slice(1, -1)),
  NUM =   this.token(/-?\d+(?:\.\d+)?(?:[eE][+-]?)?/, '0123456789-') //.map(r => parseFloat(r.match[0])),
  WHITESPACE = this.token(/(\/\/[^\n]*|[\s\n\t\r])+/, ' \t\n\r').skip()
}

const T = TK.S

export namespace JsonWithResult {
  export const Json: Rule<any> = Either(
    TK.STR.then(r => r.str.slice(1, -1)),
    TK.NUM.then(r => parseFloat(r.str)),
    T`true`.then(() => true),
    T`false`.then(() => false),
    T`null`.then(() => null),
    Forward(() => Array),
    Forward(() => Obj)
  )

  const Array = T`[ ${SeparatedBy(T`,`, Json)} ]`

  const Prop = Seq(
    { key:     TK.STR.then(m => m.str.slice(1, -1)) },
             T`:`,
    { value:   Json }
  )

  const Obj = T`{ ${SeparatedBy(T`,`, Prop)} }`
  .then(function ObjRes(r) {
    var res = {} as any
    for (var i = 0, l = r.length; i < l; i++) {
      var item = r[i]
      res[item.key] = item.value
    }
    return res
  })
}

export namespace JsonNoRes {
  export const Json: Rule<any> = Either(
    TK.STR,
    TK.NUM,
    T`true`,
    T`false`,
    T`null`,
    Forward(() => Array),
    Forward(() => Obj)
  )

  const Array = T`[ ${SeparatedBy(T`,`, Json)} ]`

  const Prop = Seq(
    { key:     TK.STR },
             T`:`,
    { value:   Json }
  )

  const Obj = T`{ ${SeparatedBy(T`,`, Prop)} }`

}



const one = require('./1K_json').json_sample1k

var tokens = TK.tokenize(one)!
console.log(JsonWithResult.Json.parse(new Context(tokens)).res)


import { Suite } from 'benchmark'
import * as Benchmark from 'benchmark'

var s = new Suite()

s.add(function Json() {
  JSON.parse(one)
})

s.add(function JsonRes() {
  const tokens = TK.tokenize(one, { forget_skips: true })!
  JsonWithResult.Json.parse(new Context(tokens))
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
