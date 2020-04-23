// An example JSON5 parser written with Parseur.
// Although I have some ideas as to why, it surprisingly outperforms `json5`'s parser,
// which is handcrafted, by a 4x factor.
// There might be some part of the spec that is not implemented here that json5 handles, but I doubt
// this would lead to a dramatic slowdown of the Parseur implementation.
import { Parseur, Seq, Either, Rule, Forward, SeparatedBy, Context } from '../index'

var P: Json5Parser['P']
class Json5Parser extends Parseur {
  // P will make your life easier.
  // It will create tokens on the fly for this parser, without even having to define them
  // first, although you can if you really want to.
  // you may also set `auto_create_tokens = false` to prevent P from creating its own tokens.
  __ = P = this.P

  IDENTIFIER = this.token(/[a-zA-Z$_]\w+/)
  STR =   this.token(/(["'])(?:\\\1|(?!\1)[^])*\1/) //.map(r => r.match[0].slice(1, -1)),
  HEXA = this.token(/\+?-?0x[0-9a-f]+/i)
  NUM =   this.token(/-?\+?\.?(?:\d+\.?(?:\d+)?|\.\d+)(?:[eE][+-]?\d+)?/) //.map(r => parseFloat(r.match[0])),
  WHITESPACE = this.token(/(?:\s*\/\/[^\n]*\n?)+|\s*\/\*(?:(?!\*\/)[^])*\*\/\s*|\s+/).skip()

  Json: Rule<any> = Either(
    this.STR.then(r => r.str.slice(1, -1).replace(/\\(?:u[\da-fA-F]{4}|x[\da-fA-F]{2}|\r\n|[^])/g, m => {
      // console.log(`--> ${m}`)
      return m[1] === 'u' ? String.fromCodePoint(parseInt(m.slice(2), 16)) :
      m[1] === 'x' ? String.fromCharCode(parseInt(m.slice(2), 16)) :
      m[1] === 'n' ? '\n' :
      m[1] === 'b' ? '\b' :
      m[1] === 'r' ? '\r' :
      m[1] === 't' ? '\t' :
      m[1] === 'f' ? '\f' :
      m[1] === 't' ? '\t' :
      m[1] === 'v' ? '\v' :
      m[1] === '0' ? String.fromCharCode(0) :
      m[1] === '\n' || m[1] === '\r' && m[2] === '\n' || m[1] === '\u2028' || m[1] === '\u2029' ? '' : m[1]
    })),
    this.NUM.then(r => parseFloat(r.str)),
    this.HEXA.then(r => parseInt(r.str)),
    P`Infinity`.then(() => Infinity),
    P`+Infinity`.then(() => Infinity),
    P`-Infinity`.then(() => -Infinity),
    P`NaN`.then(() => NaN),
    P`+NaN`.then(() => NaN),
    P`-NaN`.then(() => NaN),
    P`true`.then(() => true),
    P`false`.then(() => false),
    P`null`.then(() => null),
    Forward(() => this.Array),
    Forward(() => this.Obj)
  )

  Array = P`[ ${SeparatedBy(P`,`, this.Json, { trailing: true })} ]`

  Prop = Seq(
    { key:     Either(this.STR.then(m => m.str.slice(1, -1)), this.IDENTIFIER.then(i => i.str)) },
             P`:`,
    { value:   this.Json }
  )

  Obj = P`{ ${SeparatedBy(P`,`, this.Prop, { trailing: true })} }`
  .then(function ObjRes(r) {
    var res = {} as any
    for (var i = 0, l = r.length; i < l; i++) {
      var item = r[i]
      res[item.key] = item.value
    }
    return res
  })

  parse(input: string) {
    return this.parseRule(input, this.Json, input => new Context(input))
  }

}

export const parser = new Json5Parser()
// console.log(parser.str_tokens)

import { inspect } from 'util'
function log(expr: string) {
  var res = parser.parse(expr)
  if (res.status === 'ok') {
    console.log(inspect(res.result, { colors: true, depth: null }))
  } else {
    console.log(`Parse failed`, res.pos, res.tokens?.map((t, i) => `<${i}:${t.str.replace(/\n/g, '\\n')}>`).join(' '))
  }
}

export const test = `
{\u200a
  // comments
  unquoted: 'and you can quote me on that',
  singleQuotes: 'I can use "double quotes" here',
  lineBreaks: "Look, Mom! \
No \\n's!",
/* Some
   Multiline-comment */
  hexadecimal: 0xdecaf,
  leadingDecimalPoint: .8675309, andTrailing: 8675309.,
  positiveSign: +1,
  inf: Infinity,
  inf2: -Infinity,
  inf3: +Infinity,
  nan: NaN,
  nan2: +NaN,
  nan3: -NaN,
  strescapes: '\\uD83C\\uDFBC',
  inttest: {
    integer: 123,
    withFractionPart: 123.456,
    onlyFractionPart: .456,
    withExponent: 123e-456,
  },
  trailingComma: {prop: 'in objects',}, andIn: ['arrays',],
  "backwardsCompatible": "with JSON",
}
`

if (process.mainModule === module) {
  const J = require('json5')
  console.log(test)
  console.log(J.parse(test))
  log(test)
}
