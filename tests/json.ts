import { Tokenizer, Seq, Either, Rule, Forward } from '../index'

var tk = new Tokenizer()

const T = {
  // LBRACE: tk.token('{'),
  // RBRACE: tk.token('}'),
  // COLON: tk.token(':'),
  // LBRACKET: tk.token('['),
  // RBRACKET: tk.token(']'),
  // COMMA: tk.token(','),

  // LBRACE: tk.token(/{/),
  // RBRACE: tk.token(/}/),
  // COLON: tk.token(/:/),
  // LBRACKET: tk.token(/\[/),
  // RBRACKET: tk.token(/\]/),
  // COMMA: tk.token(/,/),

  CTRL:  tk.token(/\{|\}|:|\[|\]|,/),
  STR:   tk.token(/"(?:\\"|[^"])*"/).map(r => r.match[0].slice(1, -1)),
  NUM:   tk.token(/-?\d+(?:\.\d+)?(?:[eE][+-]?)?/).map(r => parseFloat(r.match[0])),
  CONST: tk.token(/true|false|null/).map(r => {
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
  { res:      Json.SeparatedBy(',') },
              ']'
).map(r => r.res)// .map(r => null)

const Prop = Seq(
  { key:     T.STR },
             ':',
  { value:   Json }
).map(r => { return { [r.key]: r.value } })

const Obj = Seq(
                '{',
  { props:      Prop.SeparatedBy(',') },
                '}'
).map(r => Object.assign({}, ...r.props))// .map(r => null)


const one = require('./1K_json').json_sample1k

var tokens = tk.tokenize(one)!
// console.log(Json.parse(tokens, 0))


var ITER = 1000

var now = Date.now()
for (var i = 0; i < ITER; i++) {
  JSON.parse(one)
}
var elapsed = Date.now() - now
console.log(`JSON Elapsed: ${elapsed}ms, ${ITER / (elapsed / 1000)} ops/s`)


var now = Date.now()
for (var i = 0; i < ITER; i++) {
  tk.tokenize(one)!
  Json.parse(tokens, 0)
}
var elapsed = Date.now() - now
console.log(`Elapsed: ${elapsed}ms, ${ITER / (elapsed / 1000)} ops/s`)

// console.log(result !== NoMatch ? result.res : 'No-Match')
