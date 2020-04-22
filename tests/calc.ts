import { Parseur, Either, Forward, TdopOperator, Rule, Seq, RecOperator, Eof, Context } from '../index'

const tk = new Parseur()
const NUM =   tk.token(/\d+(?:\.\d+)?(?:[eE][+-]?)?/, '0123456789') //.map(r => parseFloat(r.match[0])),
// const WS =
tk.token(/[\s\n]+/).skip()
const P = tk.P

export namespace CalcOp {

  const Terminal: Rule<number> = Either(
    NUM.then(n => parseFloat(n.str)),
    P`( ${Forward(() => Expression)} )`,
  ).setName('Op Terminal')

  export const Expression: Rule<number> = TdopOperator(Terminal)
    .Prefix(P`-`, (_, left) => -left)
    .down
    .Binary(P`**`, (_, left, right) => Math.pow(left, right))
    .down
    .Binary(P`*`, (_, left, right) => left * right)
    .Binary(P`/`, (_, left, right) => left / right)
    .down
    .Binary(P`+`, (_, left, right) => left + right)
    .Binary(P`-`, (_, left, right) => left - right)

  export const TopLevel = Seq({expr: Expression}, Eof).then(r => r.expr)
}

// console.log(CalcOp.Expression._inited)

export namespace CalcRec {

  const Terminal = Either(
    NUM.then(n => parseFloat(n.str)),
    P`( ${Forward(() => Expression)} )`,
  ).setName('Rec Terminal')

  export const Expression: Rule<number> = RecOperator(Terminal)
    .Prefix(P`-`, (_, right) => -right)
    .Binary(P`**`, (_, left, right) => Math.pow(left, right))
    .Binary(Either(P`*`, P`/`).setName('Rec * /'), (op, left, right) => op.str === '*' ? left * right : left / right)
    .Binary(Either(P`+`, P`-`).setName('Rec + -'), (op, left, right) => op.str === '+' ? left + right : left - right)

  export const TopLevel = Seq({expr: Expression}, Eof).then(r => r.expr)
}

function parse(r: Rule<number>, input: string) {
  var tokens = tk.tokenize(input, { forget_skips: true, enable_line_counts: false })
  if (!tokens) throw new Error('could not parse')
  // console.log(tokens?.map(t => t.str).join(' '))
  var ctx = new Context(tokens)
  var res = r.parse(ctx)
  // console.log(res, ctx.furthest_pos, ctx.input.length, ctx.furthest_token)
  return res
}

console.log(parse(CalcOp.TopLevel, '2 + 4'))
console.log(parse(CalcOp.TopLevel, '2 + 5 * 2 - 2'))
console.log(parse(CalcOp.TopLevel, '- 2 + 5 * (2 - 2)'))
console.log(parse(CalcOp.TopLevel, '2 + 8 / 2 + 10 * 5 ** 2 - 3'))
console.log('>>>>')
console.log(parse(CalcRec.TopLevel, '2 + 4'))
console.log(parse(CalcRec.TopLevel, '2 + 5 * 2 - 2'))
console.log(parse(CalcRec.TopLevel, '- 2 + 5 * (2 - 2)'))
console.log(parse(CalcRec.TopLevel, '2 + 8 / 2 + 10 * 5 ** 2 - 3'))

// process.exit(0)

import { benchmark, runBenchmarks } from './testsuite'

benchmark('With TdopOperator', function ParseOp() {
  parse(CalcOp.Expression, '2 + 4')
  parse(CalcOp.Expression, '2 + 5 * 2 - 2')
  parse(CalcOp.Expression, '2 + 5 * (2 - 2)')
  parse(CalcOp.Expression, '2 + 8 / 2 + 10 * 5 ** 2 - 3')
})

benchmark('With Recursive rule', function ParseRec() {
  parse(CalcRec.Expression, '2 + 4')
  parse(CalcRec.Expression, '2 + 5 * 2 - 2')
  parse(CalcRec.Expression, '2 + 5 * (2 - 2)')
  parse(CalcRec.Expression, '2 + 8 / 2 + 10 * 5 ** 2 - 3')
})

runBenchmarks()
