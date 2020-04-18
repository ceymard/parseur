import { Parseur, Seq, Either, Rule, Forward, SeparatedBy, Context } from '../index'

var P: JsonParser['P']
class JsonParser extends Parseur {
  // P will make your life easier.
  // It will create tokens on the fly for this parser, without even having to define them
  // first, although you can if you really want to.
  __ = P = this.P

  STR =   this.token(/"(?:\\"|[^"])*"/, '"') //.map(r => r.match[0].slice(1, -1)),
  NUM =   this.token(/-?\d+(?:\.\d+)?(?:[eE][+-]?)?/, '0123456789-') //.map(r => parseFloat(r.match[0])),
  WHITESPACE = this.token(/[\s\n\t\r]+/, ' \t\n\r').skip()

  Json: Rule<any> = Either(
    this.STR.then(r => r.str.slice(1, -1)),
    this.NUM.then(r => parseFloat(r.str)),
    P`true`.then(() => true),
    P`false`.then(() => false),
    P`null`.then(() => null),
    Forward(() => this.Array),
    Forward(() => this.Obj)
  )

  Array = P`[ ${SeparatedBy(P`,`, this.Json)} ]`

  Prop = Seq(
    { key:     this.STR.then(m => m.str.slice(1, -1)) },
             P`:`,
    { value:   this.Json }
  )

  Obj = P`{ ${SeparatedBy(P`,`, this.Prop)} }`
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

const parser = new JsonParser()

import { inspect } from 'util'
function log(expr: string) {
  var res = parser.parse(expr)
  if (res.status === 'ok') {
    console.log(inspect(res.result, { colors: true, depth: null }))
  } else {

  }
}
log(`{ "a": 23, "b": { "asdf": [1, 2, 3, null]}, "C": "some string" }`)
