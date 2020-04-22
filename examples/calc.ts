// A simple calculator implementation using Parseur.
import { Parseur, Rule, Either, Forward, TdopOperator, Seq, Eof, Context } from '..'


// we just use this cheat to avoid writing this.P everywhere, since P is a Parseur method.
var P: Calc['P'] = undefined!

export class Calc extends Parseur {

  constructor() {
    super()
    this.nameRules() // convenience method to name the rules of this parser with their property names
  }

  // The only tokens we need to define beforehand are number and whitespace.
  // The operators, being simple string, are defined where used using the magical `P` rule.
  NUM = this.token(/\d+(?:\.\d+)?(?:[eE][+-]?)?/) //.map(r => parseFloat(r.match[0])),

  // Whitespace is skippable and by default is ignored in the grammar
  WS = this.token(/\s+/).skip()

  __ = P = this.P

  Terminal: Rule<number> = Either(
    this.NUM.then(n => parseFloat(n.str)),
    P`( ${Forward(() => this.Expression)} )`,
  )

  // TdopOperator parses an expression with operators that have different levels of
  // precedence. This method is not the same as what is usually done with bnf-style grammars
  // where the different levels are different rules that call each other recursively.
  //
  // This is a convenience parser provided by Parseur because expression parsing is such
  // a common task.
  //
  // With the "Top Down Operator Precedence" method, matching operator rules and operands get
  // a "binding power" to their left and right, which is then used to determine what gets
  // bound by who. See https://tdop.github.io/ for the paper describing the algorithm and
  // https://eli.thegreenplace.net/2010/01/02/top-down-operator-precedence-parsing for an actually
  // readable explanation of how it operates.
  //
  // This method is actually about 50% faster than using recursive rules.
  Expression = TdopOperator(this.Terminal)
    .Prefix(P`-`, (_, left) => -left)
    .down
    .Binary(P`**`, (_, left, right) => Math.pow(left, right))
    .down
    .Binary(P`*`, (_, left, right) => left * right)
    .Binary(P`/`, (_, left, right) => left / right)
    .down
    .Binary(P`+`, (_, left, right) => left + right)
    .Binary(P`-`, (_, left, right) => left - right)

  // We make a toplevel expression that ensures that we get to the end of the input
  // so that otherwise the parse will fail.
  // If we don't check for Eof, then the parse will just end at the end of an expression
  TopLevel = Seq({expr: this.Expression}, Eof()).then(r => r.expr)

  // we make a convenience parse() function for this parser, as Parseur only defines
  // the parseRule() since it can't make assumptions on how the grammar will work.
  parse(input: string) {
    return this.parseRule(input, this.TopLevel, input => new Context(input))
  }

}

const calc = new Calc()

if (process.mainModule === module) {
  console.log(calc.parse('2 + 2 ** 3'))
  console.log(calc.parse('3 * (2 + 4) / 2 ** 2'))
}