import { Tokenizer, Seq, Either, Rule, Forward, SeparatedBy, NoMatch } from '../index'

var tk = new Tokenizer()

const T = {
  CTRL: tk.token(/\{|\}|:|\[|\]|,/),
  STR: tk.token(/"(\\"|[^"])*"/).map(r => r.match[0].slice(1, -1)),
  NUM: tk.token(/-?\d+(\.\d+)?([eE][+-]?)?/).map(r => parseFloat(r.match[0])),
  CONST: tk.token(/\b(true|false|null)\b/).map(r => {
    var s = r.match[1]
    return s === 'true' ? true :
           s === 'false' ? false :
           null
  }),
  WHITESPACE: tk.token(/(\/\/[^\n]*|[\s\n\t\r])+/).skip()
}

const Json: Rule<any> = Either(
  T.STR,
  T.CONST,
  T.NUM,
  Forward(() => Array),
  Forward(() => Obj)
)

const Array = Seq(
  '[',
  { res:      SeparatedBy(Json, ',') },
  ']'
).map(r => null)

const Prop = Seq(
  {key:     T.STR},
  ':',
  {value:       Json}
).map(r => null)

const Obj = Seq(
  '{',
  { props:      SeparatedBy(Prop, ',') },
  '}'
).map(r => null)


const one = require('./1K_json').json_sample1k

var now = Date.now()
var ITER = 10000
for (var i = 0; i < ITER; i++) {
  var tokens = tk.tokenize(one, true)
  var result = Json.parse(tokens, 0)
}
var elapsed = Date.now() - now
console.log(`Elapsed: ${elapsed}ms, ${ITER / (elapsed / 1000)} ops/s`)
// console.log(result !== NoMatch ? result.res : 'No-Match')
