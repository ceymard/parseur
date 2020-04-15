import { Parseur, Seq, Either, Rule, Forward, SeparatedBy } from '../index'

const TK = new class JsonTokenizer extends Parseur {
  // End with the regexps
  STR =   this.token(/"(?:\\"|[^"])*"/, '"') //.map(r => r.match[0].slice(1, -1)),
  NUM =   this.token(/-?\d+(?:\.\d+)?(?:[eE][+-]?)?/, '0123456789-') //.map(r => parseFloat(r.match[0])),
  WHITESPACE = this.token(/(\/\/[^\n]*|[\s\n\t\r])+/, ' \t\n\r').skip()
}

const T = TK.S

const Json: Rule<any> = Either(
  TK.STR.map(r => r.str.slice(1, -1)),
  TK.NUM.map(r => parseFloat(r.str)),
  T`true`.map(() => true),
  T`false`.map(() => false),
  T`null`.map(() => null),
  Forward(() => Array),
  Forward(() => Obj)
)

const Array = T`[ ${SeparatedBy(T`,`, Json)} ]`

const Prop = Seq(
  { key:     TK.STR.map(m => m.str.slice(1, -1)) },
           T`:`,
  { value:   Json }
)

const Obj = T`{ ${SeparatedBy(T`,`, Prop)} }`
.map(function ObjRes(r) {
  var res = {} as any
  for (var i = 0, l = r.length; i < l; i++) {
    var item = r[i]
    res[item.key] = item.value
  }
  return res
})


const one = require('./1K_json').json_sample1k

var tokens = tk.tokenize(one)!
console.log(Json.parse(tokens, 0).res)


import { Suite } from 'benchmark'
import * as Benchmark from 'benchmark'

var s = new Suite()

s.add(function Json() {
  JSON.parse(one)
})

s.add(function JsonParse() {
  tk.tokenize(one, { forget_skips: true })!
  Json.parse(tokens, 0)
})

s.run()

var benches = s.run({maxTime: 1 }) as unknown as Benchmark[]
for (var b = 0, l = benches.length; b < l; b++) {
  var bench = benches[b]
  var name = typeof bench.fn === 'function' ? bench.fn.name : bench.fn
  console.log(name, Math.round(bench.hz))

}
