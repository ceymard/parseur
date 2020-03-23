
export const NoMatch = Symbol('no-match')
export type TNoMatch = typeof NoMatch

// export type Rule<T> = { regexp: RegExp, action: (match: string, ...matches: string[]) => T }

export class ParseResult<T> {
  constructor(public res: T, public pos: number) { }
}


export function escape(str: string) {
  return str.replace(/[?.\[\]\(\)*+]/g, m => '\\' + m)
}


export function Res<T>(res: T, pos: number) {
  return new ParseResult(res, pos)
}


export class Rule<T> {

  constructor(public parse: (input: string, pos: number, skip: RegExp | undefined) => TNoMatch | ParseResult<T>) { }

  map<U>(fn: (res: T, input: string, pos: number, skip: RegExp | undefined, start: number) => U | TNoMatch | ParseResult<U>): Rule<U> {
    return new Rule((input, pos, skip) => {
      var res = this.parse(input, pos, skip)
      if (res === NoMatch) return NoMatch
      var res2 = fn(res.res, input, res.pos, skip, pos)
      if (res2 === NoMatch) return NoMatch
      if (res2 instanceof ParseResult) return res2
      return Res(res2, res.pos)
    })
  }

  tap(fn: (res: T, input: string, pos: number, skip: RegExp | undefined, start: number) => any) {
    return this.map((res, input, pos, skip, start) => {
      fn(res, input, pos, skip, start)
      return res
    })
  }
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
export function _(exp: RegExp): Rule<RegExpMatchArray>
export function _(exp: string): Rule<string>
export function _<T>(exp: Rule<T>): Rule<T>
export function _<T>(exp: string | RegExp | Rule<T>): Rule<string | RegExpMatchArray | T>
export function _(exp: any) {
  if (exp instanceof Rule) return exp
  if (typeof exp === 'string') return Str(exp)
  return Reg(exp)
}


/**
 *
 */
export function Seq<T extends {[name: string]: RawRule<any>}>(obj: T): Rule<{[K in keyof T]: Result<T[K]>}> {
  var entries = Object.entries(obj)
    .map(obj => [obj[0], _(obj[1])] as [keyof T, Rule<any>])

  return new Rule(function (input, pos, skip) {
    var res = {} as {[K in keyof T]: Result<T[K]>}
    for (var i = 0, l = entries.length; i < l; i++) {
      var key = entries[i][0]
      var match = entries[i][1].parse(input, pos, skip)
      if (match === NoMatch) return NoMatch
      pos = match.pos
      res[key] = match.res
    }
    return Res(res, pos)
  })
}

export function SeqArray<T extends RawRule<any>[]>(..._rules: T): Rule<{[K in keyof T]: Result<T[K]>}> {
  var rules = _rules.map(r => _(r))
  return new Rule(function (input, pos, skip) {
    var res = [] as unknown as {[K in keyof T]: Result<T[K]>}
    for (var i = 0, l = rules.length; i < l; i++) {
      const rule = rules[i]
      const match = rule.parse(input, pos, skip)
      if (match === NoMatch) return NoMatch
      res.push(match.res)
      pos = match.pos
    }
    return Res(res, pos)
  })
}


/**
 *
 */
export function Either<T extends RawRule<any>[]>(...rules: T): Rule<{[K in keyof T]: Result<T[K]>}[number]> {
  var _rules = rules.map(r => _(r))

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
  var rule = _(r)
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
  var rule = _(r)
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
  var rule = _(r)
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


export function Until(reg: RawRule<any>) {
  var rule = _(reg)
  return Repeat(
    Seq({_1: Not(rule), char: Any}).map(r => r.char)
  )
}


export function Parser<T>(rule: Rule<T>, skip?: RegExp) {
  return function (input: string) {
    return rule.parse(input, 0, skip ? new RegExp(skip.source, skip.flags + 'y') : undefined)
  }
}


/**
 *
 */
export function S<Rules extends RawRule<any>[]>(tpl: TemplateStringsArray, ...rules: Rules): Rule<Rules extends [] ? null : Rules extends [RawRule<infer T>] ? T : {[K in keyof Rules]: Result<Rules[K]>}> {
  var match_rules = [] as Rule<any>[]
  var indexes = [] as (number | null)[]

  for (var i = 0, l = tpl.length; i < l; i++) {
    var str = tpl[i].trim().split(/\s+/g)
    for (var k = 0, lk = str.length; k < lk; k++) {
      if (!str[k]) continue
      indexes.push(null)
      match_rules.push(Str(str[k]))
    }
    // match_rules.push(Reg(tpl[i].replace))
    if (rules[i]) {
      indexes.push(match_rules.length)
      match_rules.push(_(rules[i]))
    }
  }

  return new Rule((input, pos, skip) => {
    var res = [] as any[] // just being lazy

    for (var i = 0, l = match_rules.length; i < l; i++) {
      var mr = match_rules[i]
      var match = mr.parse(input, pos, skip)
      if (match === NoMatch) return NoMatch
      if (indexes[i]) res.push(match.res)
      pos = match.pos
    }

    if (res.length === 0) return Res(null, pos)
    if (res.length === 1) return Res(res[0], pos)
    return Res(res, pos)
  })
}


export const SeparatedBy = <T extends RawRule<any>>(rule: T, sep: RawRule<any>): Rule<Result<T>[]> =>
Seq({
  first: rule,
  others: Repeat(Seq({ sep, rule }).map(r => r.rule))
}).map(r => [r.first, ...r.others])
