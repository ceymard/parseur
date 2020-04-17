import { Parseur, Rule, Either, Forward, TdopOperator, Seq, Eof, Context } from '..'


// we just use this cheat to avoid writing this.P everywhere.
var P: Calc['P'] = undefined!

export class Calc extends Parseur {

  constructor() {
    super()
    this.nameRules() // convenience method to name the rules of this parser with their property names
  }

  NUM = this.token(/\d+(?:\.\d+)?(?:[eE][+-]?)?/, '0123456789') //.map(r => parseFloat(r.match[0])),

  // Whitespace is skippable and by default is ignored in the grammar
  WS = this.token(/[\s\n]+/).skip()

  __ = P = this.P

  Terminal: Rule<number> = Either(
    this.NUM.then(n => parseFloat(n.str)),
    P`( ${Forward(() => this.Expression)} )`,
  )

  // TdopOperator parses an expression with operators that have different levels of
  // precedence. This method is not the same as what is usually done with bnf-style grammars
  // where the different levels are different rules that call each other recursively.
  Expression = TdopOperator(this.Terminal)
    .prefix(P`-`, (_, left) => -left)
    .down
    .binary(P`**`, (_, left, right) => Math.pow(left, right))
    .down
    .binary(P`*`, (_, left, right) => left * right)
    .binary(P`/`, (_, left, right) => left / right)
    .down
    .binary(P`+`, (_, left, right) => left + right)
    .binary(P`-`, (_, left, right) => left - right)

  // We make a toplevel expression that ensures that we get to the end of the input
  // so that otherwise the parse will fail.
  // If we don't check for Eof, then the parse will just end at the end of an expression
  TopLevel = Seq({expr: this.Expression}, Eof).then(r => r.expr)

  // we make a convenience parse() function for this parser, as Parseur only defines
  // the parseRule() since it can't make assumptions on how the grammar will work.
  parse(input: string) {
    return this.parseRule(input, this.TopLevel, input => new Context(input))
  }

}

const calc = new Calc()
console.log(calc.parse('2 + 2 ** 3'))
console.log(calc.parse('3 * (2 + 4) / 2 ** 2'))