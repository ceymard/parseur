// FIXME: Still missing ; a way of handling errors gracefully

/**
 * NoMatch is both a type and a value and is used as the result
 * for a rule parse when the rule did not match the input.
 */
export const NoMatch = Symbol('no-match')
export type NoMatch = typeof NoMatch


/**
 * The result of a string processing by [[Tokenizer.tokenize]]
 */
export class Token {
  public constructor(
    public def: TokenDef,
    public match: RegExpExecArray,
    public is_skip: boolean,
    public line: number,
    public column: number,
    public offset: number
  ) { }

}

// A rule always execs on the first token to be checked

export type TokenDefRet = {
  def: TokenDef,
  skip: boolean
}

// The tokenizer should be able to operate on a stream to create a token stream
// Also, the rules should be able to use next() or anext() depending on whether they
// want to parse synchronously or asynchronously
export class Tokenizer {

  defs = [] as TokenDef[]
  deftable = [] as [number, TokenDef[]][]

  token(def: RegExp | string, name = '') {
    // All the regexp we handle are sticky ones.
    var reg = typeof def === 'string' ? def : new RegExp(def.source, (def.flags ?? '').replace('y', '') + 'y')
    var tdef = new TokenDef(name, reg, false)
    this.defs.push(tdef)
    return tdef
  }

  tokenize(input: string, enable_line_counts = false) {
    var res: Token[] = []
    var pos = 0
    var tokendefs = this.defs
    var l = tokendefs.length
    var il = input.length
    var line = 1
    var col = 1

    tks: while (true) {
      if (pos >= il) break
      for (var i = 0; i < l; i++) {
        var tkd = tokendefs[i]
        var reg = tkd._regex
        var match: RegExpExecArray | null
        if (typeof reg === 'string') {
          var tomatch = input.slice(pos, pos + reg.length)
          if (reg === tomatch) {
            match = [reg] as RegExpExecArray
            match!.input = input
            match!.groups = {}
            match!.index = pos
          } else {
            match = null
          }
        } else {
          reg.lastIndex = pos
          match = reg.exec(input)
        }
        if (!match) continue

        if (enable_line_counts) {
          var txt = match[0]
          for (var j = 0, lj = txt.length; j < lj; j++) {
            if (txt[j] === '\n') {
              line++
              col = 1
            } else {
              col++
            }
          }
        }
        res.push(new Token(
          tkd,
          match,
          tkd._skip,
          line,
          col,
          pos
        ))
        pos += match[0].length // advancing the position
        continue tks
      }
      // Getting here is an error
      break
    }
    // console.log(pos, input.length)
    if (pos !== input.length) {
      console.log(`Tokenization failed `, '"' + input.slice(pos, pos + 100) + '"...')
      return null
    }
    return res
  }
}


/**
 * An object representing an actual match to a rule.
 */
export class ParseResult<T> {
  constructor(public res: T, public pos: number) { }
}


/**
 * Escape `str` to make it suitable to build a `RegExp`
 */
export function escape(str: string) {
  return str.replace(/[?.\[\]\(\)*+$]/g, m => '\\' + m)
}


export function Res<T>(res: T, pos: number) {
  var r = new ParseResult(res, pos)
  var max = Res.max_res
  if (!max) Res.max_res = r
  else if (max && max.pos -1 < r.pos)
    Res.max_res = r
  return r
}

export namespace Res {
  export var max_res: ParseResult<any> | null = null
}


export class Rule<T> {

  constructor(public parse: (input: Token[], pos: number) => NoMatch | ParseResult<T>) { }
  _name = ''

  map<U>(fn: (res: T, input: Token[], pos: number, start: number) => U | NoMatch | ParseResult<U> | Rule<U>): Rule<U> {
    return new Rule((input, pos) => {
      var res = this.parse(input, pos)
      if (res === NoMatch) return NoMatch
      var res2 = fn(res.res, input, res.pos, pos)
      if (res2 === NoMatch) return NoMatch
      if (res2 instanceof ParseResult) return res2
      if (res2 instanceof Rule) return res2.parse(input, res.pos)
      return Res(res2, res.pos)
    })
  }

  tap(fn: (res: T, input: Token[], pos: number, start: number) => any) {
    return this.map((res, input, pos, start) => {
      fn(res, input, pos, start)
      return res
    })
  }

  Repeat() { return Repeat(this) }
  Optional() { return Opt(this) }
  OneOrMore() { return OneOrMore(this) }
  SeparatedBy(rule: RawRule<any>): Rule<T[]> { return SeparatedBy(rule, this) }

  name(n: string): this {
    this._name = n
    return this
  }

}


export class MappedRule<T> extends Rule<T> {
  constructor(
    public parent: Rule<T>,
    fn: (input: Token[], pos: number) => NoMatch | ParseResult<T>
  ) { super(fn) }

  name(n: string): this {
    this.parent.name(n)
    return this
  }
}


export class TokenDef extends Rule<Token> {
  constructor(
    public _name: string,
    public _regex: RegExp | string,
    public _skip: boolean,
  ) {
    super((input, pos) => {
      var next: Token | undefined
      while ((next = input[pos++])) {
        if (next.def === this) return Res(next, pos)
        if (!next.is_skip) return NoMatch
      }
      return NoMatch
    })
  }

  skip(): this {
    this._skip = true
    return this
  }
}


/**
 *
 */
export type RawRule<T> = Rule<T> | RegExp | string


/**
 *
 */
export type Result<T> = T extends Rule<infer U> ? U : T extends RegExp ? RegExpExecArray : T extends string ? string : never



export function Str(str: string): Rule<string> {
  return new Rule(function StrRule(input, pos) {
    // start by skipping until we get a non-skip token.
    var tk: Token | undefined
    while ((tk = input[pos], tk?.def._skip)) { pos ++ }

    if (tk?.match[0] !== str) return NoMatch
    return Res(str, pos + 1)
  }).name(`"${str}"`)
}


export function Reg(reg: RegExp): Rule<RegExpExecArray> {
  return new Rule(function RegexpRule(input, pos) {
    // start by skipping until we get a non-skip token.
    var tk: Token | undefined
    while ((tk = input[pos], tk?.is_skip)) { pos++ }

    var inp = tk?.match[0]
    if (!inp) return NoMatch
    var match = reg.exec(inp)
    if (!match) return NoMatch
    return Res(match, pos + 1)
  }).name(`/${reg.source}/`)
}

/**
 *
 */
export function R(exp: RegExp): Rule<RegExpExecArray>
export function R(exp: string): Rule<string>
export function R<T>(exp: Rule<T>): Rule<T>
export function R<T>(exp: string | RegExp | Rule<T>): Rule<string | RegExpExecArray | T>
export function R(exp: any) {
  if (exp instanceof Rule) return exp
  if (typeof exp === 'string') return Str(exp)
  return Reg(exp)
}


export type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

export function Seq<T extends (RawRule<any> | {[name: string]: RawRule<any>})[]>(...seq: T): Rule<UnionToIntersection<
  {[K in keyof T]: T[K] extends {[name: string]: RawRule<any>} ?
    {[K2 in keyof T[K]]: Result<T[K][K2]>}
    : never
  }[number]
>> {
  var entries = [] as [null | string, Rule<any>][]
  for (var _r of seq) {
    if (_r instanceof RegExp || typeof _r === 'string' || _r instanceof Rule) {
      entries.push([null, R(_r)])
    } else {
      // This is a named rule object.
      entries.push(...Object.entries(_r).map(([key, _r]) => [key, R(_r)] as [string, Rule<any>]))
    }
  }

  return new Rule<any>(function SeqRule(input, pos) {
    var res = {} as any
    for (var i = 0, l = entries.length; i < l; i++) {
      var key = entries[i][0]
      var match = entries[i][1].parse(input, pos)
      // console.log(key, match, entries[i][1])
      if (match === NoMatch) return NoMatch
      pos = match.pos
      if (key !== null) res[key] = match.res
    }
    return Res(res, pos)
  }).name(`Seq<${entries.map(e => e[1]._name).join(', ')}>`)
}


/**
 *
 */
export function Either<T extends RawRule<any>[]>(...rules: T): Rule<{[K in keyof T]: Result<T[K]>}[number]> {
  var _rules = rules.map(r => R(r))

  return new Rule(function EitherRule(input, pos) {
    for (var i = 0, l = _rules.length; i < l; i++) {
      var rule = _rules[i]
      var match = rule.parse(input, pos)
      if (match !== NoMatch) {
        return match
      }
    }
    return NoMatch
  }).name(`Either<${_rules.map(r => r._name).join(' | ')}>`)
}


/**
 *
 */
export function OneOrMore<R extends RawRule<any>>(r: R) {
  return Repeat(r).map(r => r.length === 0 ? NoMatch : r)
}


/**
 *
 */
export function Repeat<R extends RawRule<any>>(r: R): Rule<Result<R>[]> {
  var rule = R(r)
  return new Rule(function RepeatRule(input, pos) {
    var res: Result<R>[] = []
    var rres: ParseResult<any> | NoMatch
    while ((rres = rule.parse(input, pos)) !== NoMatch) {
      res.push(rres.res)
      pos = rres.pos
    }
    return Res(res, pos)
  })
}


/**
 *
 */
export function Opt<R extends RawRule<any>>(r: R): Rule<Result<R> | null> {
  var rule = R(r)
  return new Rule(function OptRule(input, pos) {
    var res = rule.parse(input, pos)
    if (res === NoMatch) return Res(null, pos)
    return res
  })
}


/**
 *
 */
export function Not<R extends RawRule<any>>(r: R): Rule<null> {
  var rule = R(r)
  return new Rule(function NotRule(input, pos) {
    var res = rule.parse(input, pos)
    if (res === NoMatch) return Res(null, pos)
    return NoMatch
  })
}


export const Any = new Rule(function AnyRule(input, pos) {
  var tok: Token | undefined
  while ((tok = input[pos], tok && tok.is_skip)) { pos++ }
  return tok ? Res(tok, pos) : NoMatch
})


export function Forward<T>(rulefn: () => Rule<T>) {
  return new Rule(function ForwardRule(input, pos) {
    return rulefn().parse(input, pos)
  })
}


export function Parser<T>(rule: Rule<T>) {
  return function (input: Token[]) {
    Res.max_res = null
    var res = rule.parse(input, 0)
    if (res === NoMatch) return NoMatch
    var pos = res.pos
    var skip: Token | undefined
    while ((skip = input[pos], skip && skip.is_skip)) { pos ++ }
    if (pos !== input.length) return NoMatch
    // I should check if there is a skip
    return res
  }
}


export function SeparatedBy<T>(sep: RawRule<any>, rule: Rule<T>): Rule<T[]> {
  return Seq({
    first: rule,
    others: Repeat(Seq(sep, { rule }).map(r => r.rule))
  }).map(r => [r.first, ...r.others])
}