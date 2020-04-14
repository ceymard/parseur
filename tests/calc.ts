import { Tokenizer, Either, S, Forward, Operator, Rule, Str, Token, Repeat } from '../index'

const tk = new Tokenizer()
const PLUS = tk.token('+')
const MINUS = tk.token('-')
const POW = tk.token('**')
const MUL = tk.token('*')
const DIV = tk.token('/')
const LPAREN = tk.token('(')
const RPAREN = tk.token(')')
const NUM =   tk.token(/\d+(?:\.\d+)?(?:[eE][+-]?)?/, '0123456789') //.map(r => parseFloat(r.match[0])),
const WS = tk.token(/[\s\n]+/).skip()

export namespace CalcOp {

  const Terminal = Either(
    S`( ${Forward(() => Expression)} )`,
    NUM.map(n => parseFloat(n.str))
  )

  export const Expression: Rule<number> = Operator(Terminal)
    .binary(10, Str('+'), (_, left, right) => left + right)
    .binary(10, Str('-'), (_, left, right) => left - right)
    .binary(20, Str('*'), (_, left, right) => left * right)
    .binary(20, Str('/'), (_, left, right) => left / right)
    .binary(30, Str('**'), (_, left, right) => Math.pow(left, right))
}

export namespace CalcRec {

  const Terminal = Either(
    S`( ${Forward(() => Expression)} )`,
    S`- ${NUM}`.map(n => -parseFloat(n.str)),
    NUM.map(n => parseFloat(n.str))
  )

  export const PwrExpr =
    S`${Terminal} ${Repeat(S`${Str('**')} ${Terminal}`)}`
    .map(([r, rest]) => rest.reduce((acc, item) => Math.pow(acc, item[1]), r))

  export const MulExpr: Rule<number> =
    S`${PwrExpr} ${Repeat(S`${Str('*', '/')} ${PwrExpr}`)}`
    .map(([r, rest]) => rest.reduce((acc, item) => item[0] === '*' ? acc * item[1] : acc / item[1], r))

  export const Expression: Rule<number> =
    S`${MulExpr} ${Repeat(S`${Str('+', '-')} ${MulExpr}`)}`
    .map(([r, rest]) => rest.reduce((acc, item) => item[0] === '+' ? acc + item[1] : acc - item[1], r))
}

function parse(r: Rule<number>, input: string) {
  var tokens = tk.tokenize(input, { forget_skips: true, enable_line_counts: false })
  if (!tokens) throw new Error('could not parse')
  // console.log(tokens?.map(t => t.str).join(' '))
  return r.parse(tokens, 0)
}


console.log(parse(CalcOp.Expression, '2 + 4'))
console.log(parse(CalcOp.Expression, '2 + 5 * 2 - 2'))
console.log(parse(CalcOp.Expression, '2 + 5 * (2 - 2)'))
console.log(parse(CalcOp.Expression, '2 + 8 / 2 + 10 * 5 ** 2 - 3'))
console.log('--')
console.log(parse(CalcRec.Expression, '2 + 4'))
console.log(parse(CalcRec.Expression, '2 + 5 * 2 - 2'))
console.log(parse(CalcRec.Expression, '2 + 5 * (2 - 2)'))
console.log(parse(CalcRec.Expression, '2 + 8 / 2 + 10 * 5 ** 2 - 3'))

// process.exit(0)

import { Suite } from 'benchmark'
import * as Benchmark from 'benchmark'

var s = new Suite()

// s.add(function Json() {
//   JSON.parse(one)
// })

s.add(function ParseOp() {
  parse(CalcOp.Expression, '2 + 4')
  parse(CalcOp.Expression, '2 + 5 * 2 - 2')
  parse(CalcOp.Expression, '2 + 5 * (2 - 2)')
  parse(CalcOp.Expression, '2 + 8 / 2 + 10 * 5 ** 2 - 3')
})

s.add(function ParseRec() {
  parse(CalcOp.Expression, '2 + 4')
  parse(CalcOp.Expression, '2 + 5 * 2 - 2')
  parse(CalcOp.Expression, '2 + 5 * (2 - 2)')
  parse(CalcOp.Expression, '2 + 8 / 2 + 10 * 5 ** 2 - 3')
})


s.run()

var benches = s.run({maxTime: 1 }) as unknown as Benchmark[]
for (var b = 0, l = benches.length; b < l; b++) {
  var bench = benches[b]
  var name = typeof bench.fn === 'function' ? bench.fn.name : bench.fn
  console.log(name, Math.round(bench.hz))

}
