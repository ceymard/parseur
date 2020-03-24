
export const NoMatch = Symbol('no-match')
export type TNoMatch = typeof NoMatch

// export type Rule<T> = { regexp: RegExp, action: (match: string, ...matches: string[]) => T }

export class ParseResult<T> {
  constructor(public res: T, public pos: number) { }
}


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

  constructor(public parse: (input: string, pos: number, skip: RegExp | undefined) => TNoMatch | ParseResult<T>) { }

  map<U>(fn: (res: T, input: string, pos: number, skip: RegExp | undefined, start: number) => U | TNoMatch | ParseResult<U> | Rule<U>): Rule<U> {
    return new Rule((input, pos, skip) => {
      var res = this.parse(input, pos, skip)
      if (res === NoMatch) return NoMatch
      var res2 = fn(res.res, input, res.pos, skip, pos)
      if (res2 === NoMatch) return NoMatch
      if (res2 instanceof ParseResult) return res2
      if (res2 instanceof Rule) return res2.parse(input, res.pos, skip)
      return Res(res2, res.pos)
    })
  }

  tap(fn: (res: T, input: string, pos: number, skip: RegExp | undefined, start: number) => any) {
    return this.map((res, input, pos, skip, start) => {
      fn(res, input, pos, skip, start)
      return res
    })
  }

  Repeat() { return Repeat(this) }
  Optional() { return Opt(this) }
  OneOrMore() { return OneOrMore(this) }
  SeparatedBy(rule: RawRule<any>): Rule<T[]> { return SeparatedBy(this, rule) }
}


/**
 *
 */
export type RawRule<T> = Rule<T> | RegExp | string


/**
 *
 */
export type Result<T> = T extends Rule<infer U> ? U : T extends RegExp ? RegExpMatchArray : T extends string ? string : never



export function Str(str: string): Rule<string> {
  var search = (input: string, pos: number) => {
    for (var i = 0, l = str.length; i < l; i++) {
      if (input[pos + i] !== str[i]) return NoMatch
    }
    return Res(str, pos + l)
  }
  return new Rule(function (input, pos, skip) {
    var res = search(input, pos)
    if (res !== NoMatch) return res
    if (!skip) return NoMatch
    skip.lastIndex = pos
    var mskip = skip.exec(input)
    if (!mskip) return NoMatch // can't skip, can't parse.
    return search(input, pos + mskip[0].length)
  })
}


export function Reg(reg: RegExp): Rule<RegExpMatchArray> {
  // make the regexp sticky
  reg = new RegExp(reg.source, reg.flags + 'y')
  const search = (input: string, pos: number) => {
    reg.lastIndex = pos
    var match = reg.exec(input)
    if (!match) return NoMatch
    return Res(match, pos + match[0].length)
  }

  return new Rule(function (input, pos, skip) {
    const res1 = search(input, pos)
    if (res1 !== NoMatch) return res1
    if (!skip) return NoMatch
    skip.lastIndex = pos
    var mskip = skip.exec(input)
    if (!mskip) return NoMatch // can't skip, can't parse.
    return search(input, pos + mskip[0].length)
  })
}

/**
 *
 */
export function R(exp: RegExp): Rule<RegExpMatchArray>
export function R(exp: string): Rule<string>
export function R<T>(exp: Rule<T>): Rule<T>
export function R<T>(exp: string | RegExp | Rule<T>): Rule<string | RegExpMatchArray | T>
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

  return new Rule<any>(function (input, pos, skip) {
    var res = {} as any
    for (var i = 0, l = entries.length; i < l; i++) {
      var key = entries[i][0]
      var match = entries[i][1].parse(input, pos, skip)
      if (match === NoMatch) return NoMatch
      pos = match.pos
      if (key != null) res[key] = match.res
    }
    return Res(res, pos)
  })
}


/**
 *
 */
export function Either<T extends RawRule<any>[]>(...rules: T): Rule<{[K in keyof T]: Result<T[K]>}[number]> {
  var _rules = rules.map(r => R(r))

  return new Rule(function (input, pos, skip) {
    for (var i = 0, l = _rules.length; i < l; i++) {
      var rule = _rules[i]
      var match = rule.parse(input, pos, skip)
      if (match !== NoMatch) {
        return match
      }
    }
    return NoMatch
  })
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
  return new Rule(function (input, pos, skip) {
    var res: Result<R>[] = []
    var rres: ParseResult<any> | TNoMatch
    while ((rres = rule.parse(input, pos, skip)) !== NoMatch) {
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
  return new Rule(function (input, pos, skip) {
    var res = rule.parse(input, pos, skip)
    if (res === NoMatch) return Res(null, pos)
    return res
  })
}


/**
 *
 */
export function Not<R extends RawRule<any>>(r: R): Rule<null> {
  var rule = R(r)
  return new Rule(function (input, pos, skip) {
    var res = rule.parse(input, pos, skip)
    if (res === NoMatch) return Res(null, pos)
    return NoMatch
  })
}


/**
 * If provided with a skip rule, any will return a string containing all characters
 * until the next skip.
 */
export const Any = new Rule((input, pos, skip) => {
  var mskip: RegExpMatchArray | null
  if (skip) {
    while ((skip.lastIndex = pos, mskip = skip.exec(input))) {
      pos += mskip[0].length
    }
    if (pos >= input.length) return NoMatch
    var res = [] as string[]
    // now we've skipped, we're on a potential match
    while ((skip.lastIndex = pos, mskip = skip.exec(input), pos < input.length && mskip === null)) {
      res.push(input[pos])
      pos++
    }
    return Res(res.join(''), pos)
  }
  if (pos >= input.length) return NoMatch
  return Res(input[pos], pos + 1)
})


export function Forward<T>(rulefn: () => Rule<T>) {
  return new Rule((input, pos, skip) => {
    return rulefn().parse(input, pos, skip)
  })
}


export function Parser<T>(rule: Rule<T>, skip?: RegExp) {
  skip = skip ? new RegExp(skip.source, skip.flags + 'y') : undefined
  return function (input: string) {
    Res.max_res = null
    var res = rule.parse(input, 0, skip)
    if (res === NoMatch) return NoMatch
    var pos = res.pos
    if (skip) {
      var msk: RegExpMatchArray | null
      while ((skip.lastIndex = pos, msk = skip.exec(input))) {
        pos += msk[0].length
      }
    }
    if (pos !== input.length) return NoMatch
    // I should check if there is a skip
    return res
  }
}


export function SeparatedBy<T>(rule: Rule<T>, sep: RawRule<any>): Rule<T[]> {
  return Seq({
    first: rule,
    others: Repeat(Seq(sep, { rule }).map(r => r.rule))
  }).map(r => [r.first, ...r.others])
}