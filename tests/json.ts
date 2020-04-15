import { Tokenizer, Seq, Either, Rule, Forward, SeparatedBy } from '../index'

// setDebug()
var tk = new Tokenizer()

const T = {
  LBRACE: tk.token('{'),
  RBRACE: tk.token('}'),
  COLON: tk.token(':'),
  LBRACKET: tk.token('['),
  RBRACKET: tk.token(']'),
  COMMA: tk.token(','),

  // LBRACE: tk.token(/{/),
  // RBRACE: tk.token(/}/),
  // COLON: tk.token(/:/),
  // LBRACKET: tk.token(/\[/),
  // RBRACKET: tk.token(/\]/),
  // COMMA: tk.token(/,/),

  TRUE: tk.token('true'),
  FALSE: tk.token('false'),
  NULL: tk.token('null'),

  // CTRL:  tk.token(/\{|\}|:|\[|\]|,/),

  // End with the regexps
  STR:   tk.token(/"(?:\\"|[^"])*"/, '"'), //.map(r => r.match[0].slice(1, -1)),
  NUM:   tk.token(/-?\d+(?:\.\d+)?(?:[eE][+-]?)?/, '0123456789-'), //.map(r => parseFloat(r.match[0])),
  WHITESPACE: tk.token(/(\/\/[^\n]*|[\s\n\t\r])+/, ' \t\n\r').skip()
}

const S = tk.S.bind(tk)

const Json: Rule<any> = Either(
  T.STR.map(r => r.str.slice(1, -1)),
  T.TRUE.map(() => true),
  T.FALSE.map(() => false),
  T.NULL.map(() => null),
  T.NUM.map(r => parseFloat(r.str)),
  Forward(() => Array),
  Forward(() => Obj)
)

const Array = S`[ ${SeparatedBy(S`,`, Json)} ]`

const Prop = Seq(
  { key:     T.STR.map(m => m.str.slice(1, -1)) },
           S`:`,
  { value:   Json }
)

const Obj = S`{ ${SeparatedBy(S`,`, Prop)} }`
.map(function ObjRes(r) {
  var res = {} as any
  for (var i = 0, l = r.length; i < l; i++) {
    var item = r[i]
    res[item.key] = item.value
  }
  return res
})// .map(r => null)


const one = require('./1K_json').json_sample1k

var tokens = tk.tokenize(one)!
console.log(Json.parse(tokens, 0).res)


import { Suite } from 'benchmark'
import * as Benchmark from 'benchmark'

var s = new Suite()

// s.add(function Json() {
//   JSON.parse(one)
// })

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
