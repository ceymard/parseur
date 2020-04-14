// FIXME: Still missing ; a way of handling errors gracefully

var DEBUG = false
// A debug map that will hold which rules mapped the tokens
// export var DEBUG_MAP = new WeakMap<Token, string[]>()
export var DEBUG_STACK: string[] = []

export function setDebug(debug: boolean = true) {
  DEBUG = debug
}

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
    public str: string,
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

  token_defs = [] as TokenDef[]

  // Accelerator for characters
  token_table: (TokenDef[] | null)[] = new Array(256).fill(null)

  nameRules() {
    for (var key of Object.getOwnPropertyNames(this)) {
      var p = (this as any)[key]
      if (p instanceof Rule) {
        p.name(key)
      }
    }
  }

  token(def: RegExp | string, accel?: string) {
    // All the regexp we handle are sticky ones.

    var reg = typeof def === 'string' ? def : new RegExp(def.source, (def.flags ?? '').replace('y', '') + 'y')
    var tdef = new TokenDef(this, reg, false)
    var added: boolean = false

    const add_to_ttable = (code: number) => {
      added = true;
      (this.token_table[code] = this.token_table[code] ?? []).push(tdef)
    }

    if (accel) {
      for (var i = 0, l = accel.length; i < l; i++) {
        ccode = accel[i].charCodeAt(0)
        add_to_ttable(ccode)
      }
    }

    if (typeof def === 'string') {
      add_to_ttable(def.charCodeAt(0))
      var ccode = def.charCodeAt(0)
    }

    if (!added) this.token_defs.push(tdef)
    return tdef
  }

  tokenize(input: string, opts?: { enable_line_counts?: boolean, forget_skips?: boolean }) {
    var res: Token[] = []
    var pos = 0
    var enable_line_counts = !!opts?.enable_line_counts
    var forget_skips = !!opts?.forget_skips
    var tkdefs = this.token_defs
    var tokendefs = this.token_defs
    var l = tokendefs.length
    var tktbl = this.token_table
    var il = input.length
    var line = 1
    var col = 1

    tks: while (true) {
      if (pos >= il) break

      var accel = tktbl[input[pos].charCodeAt(0)]
      if (accel) {
        l = accel.length
        tokendefs = accel
      } else {
        l = tkdefs.length
        tokendefs = tkdefs
      }

      for (var i = 0; i < l; i++) {
        var tkd = tokendefs[i]
        var reg = tkd._regex
        var match: string | undefined
        if (typeof reg === 'string') {
          var tomatch = input.slice(pos, pos + reg.length)
          match = reg === tomatch ? reg : undefined
        } else {
          reg.lastIndex = pos
          var m = reg.exec(input)
          if (!m) continue
          match = m[0]
        }

        if (match == undefined) continue
        // console.log(`'${match[0]}'`, reg, typeof match[0])

        if (enable_line_counts) {
          var txt = match
          for (var j = 0, lj = txt.length; j < lj; j++) {
            if (txt[j] === '\n') {
              line++
              col = 1
            } else {
              col++
            }
          }
        }
        if (!forget_skips || !tkd._skip) {
          res.push(new Token(
            tkd,
            match,
            tkd._skip,
            line,
            col,
            pos
          ))
        }
        pos += match.length // advancing the position
        continue tks
      }
      // Getting here is an error
      break
    }
    // console.log(pos, input.length)
    if (pos !== input.length) {
      // console.log(res.map(r => `${r.match[0]}`))
      // FIXME: report error differently
      console.log(`Tokenization failed `, '"' + input.slice(pos, pos + 100) + '"...')
      return null
    }
    return res
  }

  parse(input: string, rule: Rule<any>) {
    var tokens = this.tokenize(input, { enable_line_counts: true, forget_skips: true })
    Res.max_res = null
    // console.log('??')
    if (tokens) {
      var res = rule.parse(tokens, 0)

      var failed = true
      if (res !== NoMatch) {
        var pos = res.pos
        var _tk: Token | undefined
        while ((_tk = tokens[pos], _tk && _tk.is_skip)) { pos++ }
        failed = !!_tk
      }

      if (res === NoMatch || failed) {
        // console.log('Match failed')
        return { status: 'nok', max_res: Res.max_res, tokens }
        // console.log(Res.max_res)
      } else {
        return { status: 'ok', result: res.res }
        // console.log(inspect(res.res, {depth: null}))
      }
    }
    return { status: 'nok' }
  }

}


/**
 * An object representing an actual match to a rule.
 */
export class ParseResult<T> {
  debug?: string[]
  constructor(public res: T, public pos: number) { }
}


/**
 * Escape `str` to make it suitable to build a `RegExp`
 */
export function escape(str: string) {
  return str.replace(/[?.\$\^\{\}\[\]\(\)*+$\|]/g, m => '\\' + m)
}


export function Res<T>(res: T, pos: number) {
  var r = new ParseResult(res, pos)
  var max = Res.max_res
  if (!max) Res.max_res = r
  else if (max && r.pos > max.pos) {
    Res.max_res = r
    if (DEBUG) r.debug = DEBUG_STACK
  }
  return r
}

export namespace Res {
  export var max_res: ParseResult<any> | null = null
}


export type MapFn<T, U> = (res: T, input: Token[], pos: number, start: number) => U | NoMatch | ParseResult<U> | Rule<U>


export function map<T, U>(rule: Rule<T>, fn: MapFn<T, U>) {
  return (input: Token[], pos: number) => {
    var res = rule.parse(input, pos)
    if (res === NoMatch) return NoMatch
    var res2 = fn(res.res, input, res.pos, pos)
    if (res2 === NoMatch) return NoMatch
    if (res2 instanceof ParseResult) return res2
    if (res2 instanceof Rule) return res2.parse(input, res.pos)
    return Res(res2, res.pos)
  }
}


/**
 * A rule is given a chance to init before it parses.
 */
export class Rule<T> {

  constructor(public parse: (this: Rule<any>, input: Token[], pos: number) => NoMatch | ParseResult<T>) {
    if (DEBUG) {
      this.parse = (input: Token[], pos: number) => {
        // if (!input[pos]) return NoMatch
        DEBUG_STACK.push(this.Name)
        var res = parse.call(this, input, pos)
        // console.log(input[pos].str, ' - ', DEBUG_STACK.join('::'), res !== NoMatch)
        DEBUG_STACK.pop()
        return res
      }
    }
  }

  _name = ''
  _build_name: null | (() => string) = null

  map<U>(fn: MapFn<T, U>): Rule<U> {
    var r = new Rule(map(this, fn))
    r._name = this.Name
    return r
  }

  tap(fn: (res: T, input: Token[], pos: number, start: number) => any) {
    return this.map((res, input, pos, start) => {
      fn(res, input, pos, start)
      return res
    })
  }

  name(n: string): this {
    this._name = n
    return this
  }

  nameBuild(fn: () => string): this {
    this._build_name = fn
    return this
  }

  get Name() {
    return this._name || this._build_name?.() || this.parse.name
  }

}


export class TokenDef extends Rule<Token> {
  constructor(
    public tokenizer: Tokenizer,
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

  as(str: RegExp): Rule<RegExpExecArray>
  as(str: string): Rule<string>
  as(str: string | RegExp): Rule<string | RegExpExecArray> {
    return this.map(res => {
      var match = res.str[0]
      if (typeof str === 'string') {
        return match === str ? match : NoMatch
      }
      var m2 = str.exec(match)
      if (!m2) return NoMatch
      return m2
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
export type Result<T> = T extends Rule<infer U> ? U : never



export function Str(...strs: string[]): Rule<string> {
  if (!strs[0]) throw new Error('No patterns')
  return new Rule(function StrRule(input, pos) {
    // start by skipping until we get a non-skip token.
    var tk: Token | undefined
    while ((tk = input[pos], tk?.def._skip)) { pos ++ }
    if (!tk) return NoMatch

    var matched = tk.str
    for (var i = 0, l = strs.length; i < l; i++) {
      var str = strs[i]
      if (matched !== str) continue
      return Res(str, pos + 1)
    }
    return NoMatch
  }).name(`"${strs.join(', ')}"`)
}

export function S(tpl: TemplateStringsArray): Rule<string>
export function S<T>(tpl: TemplateStringsArray, rule: Rule<T>): Rule<T>
export function S<Rules extends Rule<any>[]>(tpl: TemplateStringsArray, ...values: Rules): Rule<{[K in keyof Rules]: Result<Rules[K]>}>
export function S<Rules extends Rule<any>[]>(tpl: TemplateStringsArray, ...values: Rules): Rule<any> {
  if (tpl.length === 1 && !tpl[0].match(/[\s\n]/)) return Str(tpl[0])

  var rules: Rule<any>[] = []
  var add_to_result: boolean[] = []
  var nb_rules = 0
  for (var i = 0, l = tpl.length; i < l; i++) {
    for (var all = tpl[i].split(/[\s\n]+/g), is = 0, il = all.length; is < il; is++) {
      var str = all[is]
      if (!str?.trim()) continue
      rules.push(Str(str))
      add_to_result.push(false)
    }
    if (values[i] != null) {
      rules.push(values[i])
      add_to_result.push(true)
      nb_rules++
    }
  }

  return new Rule(function SRule(input, pos) {
    var res: any[] = []
    for (var i = 0, l = rules.length; i < l; i++) {
      var rule = rules[i]
      var pres = rule.parse(input, pos)
      if (pres === NoMatch) return NoMatch
      pos = pres.pos
      if (add_to_result[i]) res.push(pres.res)
    }
    return Res(nb_rules === 1 ? res[0] : res, pos)
  })
}


export type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

export function Seq<T extends (Rule<any> | {[name: string]: Rule<any>})[]>(...seq: T): Rule<UnionToIntersection<
  {[K in keyof T]: [T[K]] extends [{[name: string]: Rule<any>}] ?
    {[K2 in keyof T[K]]: Result<T[K][K2]>}
    : never
  }[number]
> & {}> {
  var entries = [] as [null | string, Rule<any>][]
  for (let r of seq) {
      // This is a named rule object.
    if (r instanceof Rule)
      entries.push([null, r])
    else
      entries.push(...Object.entries(r).map(([key, _r]) => [key, _r] as [string, Rule<any>]))
  }

  return new Rule<any>(function SeqRule(input, pos) {
    var res = {} as any
    for (var i = 0, l = entries.length; i < l; i++) {
      var entry = entries[i]
      var key = entry[0]
      var match = entry[1].parse(input, pos)
      // console.log(key, match, entries[i][1])
      if (match === NoMatch) return NoMatch
      pos = match.pos
      if (key !== null) res[key] = match.res
    }
    return Res(res, pos)
  }).nameBuild(() => `Seq<${entries.map(e => e[1].Name).join(', ')}>`)
}


/**
 * FIXME: either should have a map to tokendefs of the first tokens of its child rules
 *    to avoid checking for useless match arms.
 *
 * Most rules should be able to be run once before calling their actual parse methods.
 */
export function Either<T extends Rule<any>[]>(...rules: T): Rule<{[K in keyof T]: Result<T[K]>}[number]> {
  return new Rule(function EitherRule(input, pos) {
    for (var i = 0, l = rules.length; i < l; i++) {
      var rule = rules[i]
      var match = rule.parse(input, pos)
      if (match !== NoMatch) {
        return match
      }
    }
    return NoMatch
  }).nameBuild(() => `Either<${rules.map(r => r.Name).join(' | ')}>`)
}


/**
 *
 */
export function Repeat<R extends Rule<any>>(rule: R, opts?: { min?: number, max?: number }): Rule<Result<R>[]> {
  return new Rule(function RepeatRule(input, pos) {
    var res: Result<R>[] = []
    var rres: ParseResult<any> | NoMatch
    while ((rres = rule.parse(input, pos)) !== NoMatch) {
      res.push(rres.res)
      pos = rres.pos
    }
    return Res(res, pos)
  }).nameBuild(() => `Repeat(${rule.Name})`)
}


/**
 *
 */
export function Opt<T>(rule: Rule<T>): Rule<T | undefined> {
  return new Rule(function OptRule(input, pos) {
    var res = rule.parse(input, pos)
    if (res === NoMatch) return Res(undefined, pos)
    return res
  }).nameBuild(() => `Opt(${rule.Name})`)
}


/**
 *
 */
export function Not(rule: Rule<any>): Rule<null> {
  return new Rule(function NotRule(input, pos) {
    var res = rule.parse(input, pos)
    if (res === NoMatch) return Res(null, pos)
    return NoMatch
  }).nameBuild(() => `Not(${rule.Name})`)
}


export const Any = new Rule(function AnyRule(input, pos) {
  var tok: Token | undefined
  while ((tok = input[pos], tok && tok.is_skip)) { pos++ }
  return tok ? Res(tok, pos) : NoMatch
}).name('Any')


export const Eof = new Rule(function EOF(input, pos) {
  if (pos >= input.length) return Res('!EOF!', pos)
  return NoMatch
})


export function Forward<T>(rulefn: () => Rule<T>) {
  var res = new Rule(function ForwardRule(input, pos) {
    var rule = rulefn()
    res.parse = rule.parse.bind(rule)
    res.name(rule._name)
    return rule.parse(input, pos)
  })
  return res
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


export function SeparatedBy<T>(sep: Rule<any>, rule: Rule<T>, opts?: {trailing?: boolean, leading?: boolean}) {
  return new Rule(function SeparatedBy(input, pos) {
    var res: T[] = []
    if (opts?.leading) {
      var lres = sep.parse(input, pos)
      if (lres !== NoMatch) pos = lres.pos
    }

    var at_sep = false
    while (true) {
      var rres = rule.parse(input, pos)
      if (rres === NoMatch) { at_sep = false; break }
      res.push(rres.res)
      pos = rres.pos

      var sres = sep.parse(input, pos)
      if (sres === NoMatch) { at_sep = true; break }
      pos = sres.pos
    }

    if (!at_sep && !opts?.trailing) return NoMatch
    return Res(res, pos)
  }).nameBuild(() => `SeparatedBy(${sep.Name}, ${rule.Name})`)
}


export interface TdopResult<T> {
  value?: T
  lbp?: number
  nud?: (expression: (n: number) => T | NoMatch) => T | NoMatch
  led?: (left: T, expression: (n: number) => T | NoMatch) => T | NoMatch
}

export namespace TdopResult {
  export function create<T>(v: TdopResult<T>): TdopResult<T> { return v }
}


export class TDopBuilder<T> extends Rule<T> {
  rules: any[] = []
  _nuds: Rule<any>[] = []
  nuds!: Rule<TdopResult<T>>
  _leds: Rule<any>[] = []
  leds!: Rule<TdopResult<T>>

  constructor(terminal: Rule<T>) {
    super((input, pos) => {
      const top = this.nuds ?? (this.nuds = Either(...[...this._nuds, terminal.map(r => TdopResult.create<T>({value: r}))]))
      const bos = this.leds ?? (this.leds = Either(...this._leds))

      var cached_op: TdopResult<T> | undefined

      function expression(rbp: number): T | NoMatch {
        var leftp = top.parse(input, pos)
        if (leftp === NoMatch) return NoMatch
        var leftm = leftp.res
        pos = leftp.pos
        var left: T | NoMatch
        if (leftm.value != undefined) {
          left = leftm.value
        } else {
          if (!leftm.nud) return NoMatch
          left = leftm.nud((n: number) => expression(n))
        }
        if (left === NoMatch) return NoMatch

        var op = bos.parse(input, pos)
        if (op === NoMatch) return left
        var opm = op.res
        cached_op = opm
        pos = op.pos

        while (rbp < opm.lbp!) {
          // only advance if the operator matched the current level
          // pos = op.pos
          // if (!opm.led) return NoMatch
          var opres = opm.led!(left, expression)
          if (opres === NoMatch) return left
          // FIXME there should probably be a way of caching the operator that was matched
          // to recheck it here and avoid reparsing it.
          left = opres

          // first try to get the cached value.

          if (cached_op != undefined) {
            opm = cached_op
            cached_op = undefined
          } else {
            var op = bos.parse(input, pos)
            if (op === NoMatch) return left
            opm = op.res
            pos = op.pos
            cached_op = opm
          }
        }

        // If we get here, it means we didn't return abruptly because there was no match,
        // so we can keep the operator result for another expression evaluation ?
        // cached_op = op.res

        return left
      }

      var res = expression(0)
      if (res === NoMatch) return NoMatch
      return Res(res, pos)
    })
  }

  prefix<R>(power: number, rule: Rule<R>, fn: (op: R, right: T) => T | NoMatch) {
    // var power = this.current_build_level
    var nr = rule.map(r => TdopResult.create<T>({
      nud: expr => {
        var e = expr(power)
        if (e === NoMatch) return e
        return fn(r, e)
      }
    }))
    this._nuds.push(nr)
    return this
  }

  suffix<R>(power: number, rule: Rule<R>, fn: (op: R, left: T) => T | NoMatch) {
    // var power = this.current_build_level
    var lr = rule.map(r => TdopResult.create<T>({
      lbp: power,
      led(left, expr) {
        return fn(r, left)
      }
    }))
    this._leds.push(lr)
    return this
  }

  binary<R>(power: number, rule: Rule<R>, fn: (op: R, left: T, right: T) => T | NoMatch) {
    var lr = rule.map(r => TdopResult.create<T>({
      lbp: power,
      led(left, expr) {
        var right = expr(power)
        if (right === NoMatch) return NoMatch
        return fn(r, left, right)
      }
    }))
    this._leds.push(lr)
    return this
  }

  binaryRight<R>(power: number, rule: Rule<R>, fn: (op: R, left: T, right: T) => T | NoMatch) {
    var lr = rule.map(r => TdopResult.create<T>({
      lbp: power,
      led(left, expr) {
        var right = expr(power - 0.5)
        if (right === NoMatch) return NoMatch
        return fn(r, left, right)
      }
    }))
    this._leds.push(lr)
    return this
  }

}


export function Operator<T>(terminal: Rule<T>) {
  return new TDopBuilder(terminal)
}
