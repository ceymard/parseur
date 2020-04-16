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


// The tokenizer should be able to operate on a stream to create a token stream
// Also, the rules should be able to use next() or anext() depending on whether they
// want to parse synchronously or asynchronously
export class Parseur {

  noaccel_token_defs = [] as TokenDef[]
  token_defs: TokenDef[] = []
  str_tokens = new Map<string, TokenDef>()

  // Accelerator for characters
  token_table: (TokenDef[] | null)[] = new Array(256).fill(null)

  constructor() {
    this.S = this.S.bind(this)
  }

  nameRules() {
    for (var key of Object.getOwnPropertyNames(this)) {
      var p = (this as any)[key]
      if (p instanceof Rule) {
        p.setName(key)
      }
    }
  }

  token(def: RegExp | string, accel?: string) {
    // All the regexp we handle are sticky ones.

    var reg = typeof def === 'string' ? def : new RegExp(def.source, (def.flags ?? '').replace('y', '') + 'y')
    var tdef = new TokenDef(reg, false)
    var added: boolean = false

    const add_to_ttable = (code: number) => {
      added = true;
      var tbl = (this.token_table[code] = this.token_table[code] ?? [])
      tbl.push(tdef)
      tbl.sort((a, b) => a._regex < b._regex ? 1 : a._regex > b._regex ? -1 : 0)
      // console.log(String.fromCharCode(code), tbl.map(t => t._regex))
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
      this.str_tokens.set(def, tdef)
    }

    if (!added) this.noaccel_token_defs.push(tdef)
    this.token_defs.push(tdef)
    return tdef
  }

  tokenize(input: string, opts?: { enable_line_counts?: boolean, forget_skips?: boolean }) {
    var res: Token[] = []
    var pos = 0
    var enable_line_counts = !!opts?.enable_line_counts
    var forget_skips = !!opts?.forget_skips
    var tkdefs = this.noaccel_token_defs
    var tokendefs = this.noaccel_token_defs
    var l = tokendefs.length
    var tktbl = this.token_table
    var il = input.length
    var line = 1
    var col = 1

    tks: while (true) {
      if (pos >= il) break

      var accel = tktbl[input[pos].charCodeAt(0)]
      // console.log(input[pos], accel, input[pos].charCodeAt(0))
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
          if (tkd.derive_map) {
            var tkd2 = tkd.derive_map.get(match)
            if (tkd2) tkd = tkd2
          }
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

  auto_create_tokens = true

  S(tpl: TemplateStringsArray): Rule<string>
  S<T>(tpl: TemplateStringsArray, rule: Rule<T>): Rule<T>
  S<R extends Rule<any>[]>(tpl: TemplateStringsArray, ...rules: R): Rule<{[K in keyof R]: Result<R[K]>}>
  S<R extends Rule<any>[]>(tpl: TemplateStringsArray, ...rules: R): Rule<any> {
    const get_tkdef = (token: string) => {
      var def = this.str_tokens.get(token)
      if (!def && !this.auto_create_tokens) throw new Error(`No token defined for '${token}'`)
      if (!def) {
        // First try to see if one of our defined regexp would match and derive it.
        for (var tkdef of this.token_defs) {
          var sdef = tkdef._regex
          if (sdef instanceof RegExp && ((sdef.lastIndex = 0), sdef.test(token))) {
            return tkdef.derive(token, this)
          }
        }

        // If there is still nothing, we create a new token
        def = this.token(token)
      }
      return def
    }

    if (tpl.length === 1 && rules.length === 0 && !tpl[0].match(/[\s\n]/)) {
      return get_tkdef(tpl[0]).map(tk => tk.str)
    }

    var seq: Rule<any>[] = []
    var in_res: boolean[] = []
    var single_res = rules.length === 1

    for (var i = 0, l = tpl.length; i < l; i++) {
      var strs = tpl[i].split(/\s+/g).filter(t => t !== '')
      for (var s of strs) {
        seq.push(get_tkdef(s))
        in_res.push(false)
      }
      var r = rules[i]
      if (r) {
        seq.push(r)
        in_res.push(true)
      }
    }

    class SRule extends Rule<any> {

      parse(input: Token[], pos: number) {
        var res: any[] = []

        for (var i = 0, l = seq.length; i < l; i++) {
          var match = seq[i].parse(input, pos)
          if (match === NoMatch) return NoMatch
          if (in_res[i]) res.push(match.res)
          pos = match.pos
        }

        if (single_res) return Res(res[0], pos)
        return Res(res, pos)
      }
    }

    return new SRule()
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


/**
 *
 */
export type Result<T> = T extends Rule<infer U> ? U : never


/**
 * A rule is given a chance to init before it parses.
 */
export abstract class Rule<T> {

  start_tokens = new Set<TokenDef>()
  get startTokenDebug() { return [...this.start_tokens].map(t => t._regex) }

  _inited = false
  abstract parse(input: Token[], pos: number): NoMatch | ParseResult<T>

  _name = ''
  _build_name: null | (() => string) = null

  map<U>(fn: MapFn<T, U>): Rule<U> {
    return new MapRule(this, fn)
  }

  tap(fn: (res: T, input: Token[], pos: number, start: number) => any) {
    return this.map((res, input, pos, start) => {
      fn(res, input, pos, start)
      return res
    })
  }

  setName(n: string): this {
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


export class MapRule<T, U> extends Rule<U> {
  constructor(public rule: Rule<T>, public fn: MapFn<T, U>) { super() }

  parse(input: Token[], pos: number) {
    var res = this.rule.parse(input, pos)
    if (res === NoMatch) return NoMatch
    var res2 = this.fn(res.res, input, res.pos, pos)
    if (res2 === NoMatch) return NoMatch
    if (res2 instanceof ParseResult) return res2
    if (res2 instanceof Rule) return res2.parse(input, res.pos)
    return Res(res2, res.pos)
  }
}


export class TokenDef extends Rule<Token> {

  constructor(
    public _regex: RegExp | string,
    public _skip: boolean,
  ) {
    super()
  }

  derive_map?: Map<string, TokenDef>
  derive(derived: string, tokenizer: Parseur): TokenDef {
    if (!this.derive_map) this.derive_map = new Map()
    var tkd = new TokenDef(derived, this._skip)
    this.derive_map.set(derived, tkd)
    tokenizer.str_tokens.set(derived, tkd)
    return tkd
  }

  parse(input: Token[], pos: number) {
    var next: Token | undefined
    while ((next = input[pos++])) {
      if (next.def === this) return Res(next, pos)
      if (!next.is_skip) return NoMatch
    }
    return NoMatch
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


export class OptRule<T> extends Rule<T | undefined> {

  constructor(public rule: Rule<T>) { super() }

  parse(input: Token[], pos: number) {
    var res = this.rule.parse(input, pos)
    if (res === NoMatch) return Res(undefined, pos)
    return res
  }

}


export class EitherRule<Rules extends Rule<any>[]> extends Rule<{[K in keyof Rules]: Result<Rules[K]>}[number]> {

  constructor(public rules: Rules) { super() }

  rulemap = new Map<TokenDef, Rule<any>[]>()
  can_optimize = false
  can_skip = false

  // parse(input: Token[], pos: number) {
  //   throw new Error('STUFF')
  //   this.parse = this.doParse
  //   return this.doParse(input, pos)
  // }

  parse(input: Token[], pos: number) {
    var tk: Token | undefined

    if (this.can_skip) {
      while ((tk = input[pos], tk && tk.is_skip)) { pos++ }
    }

    if (this.can_optimize) {
      while ((tk = input[pos])) {
        var _rules = this.rulemap.get(tk.def)

        if (_rules) {
          for (var i = 0, l = _rules.length; i < l; i++) {
            var rule = _rules[i]
            var res = rule.parse(input, pos)
            if (res !== NoMatch) return res
          }
        }

        if (!tk.is_skip) return NoMatch
        pos++
      }
    }

    for (var rules = this.rules, i = 0, l = rules.length; i < l; i++) {
      var rule = rules[i]
      var res = rule.parse(input, pos)
      if (res !== NoMatch) return res
    }
    return NoMatch
  }

}


export type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

export class SeqRule<Rules extends (Rule<any> | {[name: string]: Rule<any>})[]> extends Rule<UnionToIntersection<
  {[K in keyof Rules]: [Rules[K]] extends [{[name: string]: Rule<any>}] ?
    {[K2 in keyof Rules[K]]: Result<Rules[K][K2]>}
    : never
  }[number]
  > & {}> {

  real_rules: Rule<any>[] = []
  names: (string | null)[] = []

  constructor(public rules: Rules) {
    super()
    for (let r of rules) {
      // This is a named rule object.
      if (r instanceof Rule) {
        this.real_rules.push(r)
        this.names.push(null)
      }
      else {
        for (var [k, rul] of Object.entries(r)) {
          this.names.push(k)
          this.real_rules.push(rul)
        }
      }
    }
  }

  parse(input: Token[], pos: number) {
    var res = {} as any
    var rules = this.real_rules
    var names = this.names
    for (var i = 0, l = rules.length; i < l; i++) {
      var rule = rules[i]
      var key = names[i]
      var match = rule.parse(input, pos)
      // console.log(key, match, entries[i][1])
      if (match === NoMatch) return NoMatch
      pos = match.pos
      if (key !== null) res[key] = match.res
    }
    return Res(res, pos)
  }

}


export class RepeatRule<T> extends Rule<T[]> {
  public constructor(public rule: Rule<T>, public min?: number, public max?: number) { super() }

  parse(input: Token[], pos: number) {
    var res: T[] = []
    var rres: ParseResult<any> | NoMatch
    var rule = this.rule
    var min = this.min
    var max = this.max
    while ((rres = rule.parse(input, pos)) !== NoMatch) {
      res.push(rres.res)
      pos = rres.pos
      if (max != null && res.length >= max) break
    }
    if (min != null && res.length < min) return NoMatch
    return Res(res, pos)
  }
}


export class NotRule extends Rule<null> {
  constructor(public rule: Rule<any>) { super() }

  parse(input: Token[], pos: number) {
    var res = this.rule.parse(input, pos)
    if (res === NoMatch) return Res(null, pos)
    return NoMatch
  }
}


export class ForwardRule<T> extends Rule<T> {
  constructor(public rulefn: () => Rule<T>) { super() }

  rule?: Rule<T>

  parse(input: Token[], pos: number): ParseResult<T> | NoMatch {
    this.init()
    return this.parse(input, pos)
  }

  init() {
    if (this.rule) return
    var rule = this.rule = this.rulefn()
    this.parse = rule.parse.bind(rule)
  }
}


export class SeparatedByRule<T> extends Rule<T[]> {
  leading = false
  trailing = false

  constructor(public sep: Rule<any>, public rule: Rule<T>, opts?: { leading?: boolean, trailing?: boolean}) {
    super()
    this.leading = !!opts?.leading
    this.trailing = !!opts?.trailing
  }

  parse(input: Token[], pos: number) {
    const sep = this.sep
    const rule = this.rule
    const res: T[] = []

    if (this.leading) {
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

    if (!at_sep && !this.trailing) return NoMatch
    return Res(res, pos)
  }
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


export class TdopOperatorRule<T> extends Rule<T> {
  rules: any[] = []
  _nuds: Rule<any>[] = []
  nuds!: Rule<TdopResult<T>>
  _leds: Rule<any>[] = []
  leds!: Rule<TdopResult<T>>

  current_build_level = 1000

  get down() {
    this.current_build_level -= 10
    return this
  }

  constructor(public terminal: Rule<T>) { super() }

  init() {
    if (this.nuds) return
    this.nuds = new EitherRule([...this._nuds, this.terminal.map(t => TdopResult.create({value: t}))])
    this.leds = new EitherRule(this._leds)
  }

  parse(input: Token[], pos: number) {
    this.init()
    this.parse = this.doParse
    return this.doParse(input, pos)
  }

  doParse(input: Token[], pos: number) {
    const nuds = this.nuds
    const leds = this.leds

    // var cached_op: TdopResult<T> | undefined

    function expression(rbp: number): T | NoMatch {
      var leftp = nuds.parse(input, pos)
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

      var op = leds.parse(input, pos)
      if (op === NoMatch) return left
      var opm = op.res
      // cached_op = opm

      while (rbp < opm.lbp!) {
        pos = op.pos
        // only advance if the operator matched the current level
        // pos = op.pos
        // if (!opm.led) return NoMatch
        var opres = opm.led!(left, expression)
        if (opres === NoMatch) {
          return left
        }
        // FIXME there should probably be a way of caching the operator that was matched
        // to recheck it here and avoid reparsing it.
        left = opres

        // first try to get the cached value.

        var op = leds.parse(input, pos)
        if (op === NoMatch) {
          return left
        }
        opm = op.res
      }

      return left
    }

    var res = expression(0)
    if (res === NoMatch) return NoMatch
    return Res(res, pos)
  }

  prefix<R>(rule: Rule<R>, fn: (op: R, right: T) => T | NoMatch) {
    var power = this.current_build_level
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

  suffix<R>(rule: Rule<R>, fn: (op: R, left: T) => T | NoMatch) {
    var power = this.current_build_level
    var lr = rule.map(r => TdopResult.create<T>({
      lbp: power,
      led(left, expr) {
        return fn(r, left)
      }
    }))
    this._leds.push(lr)
    return this
  }

  binary<R>(rule: Rule<R>, fn: (op: R, left: T, right: T) => T | NoMatch) {
    var power = this.current_build_level
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

  binaryRight<R>(rule: Rule<R>, fn: (op: R, left: T, right: T) => T | NoMatch) {
    var power = this.current_build_level
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


export class RecOperatorRule<T> extends Rule<T> {
  build_expr: ((upper_level: Rule<T>) => Rule<T>)[] = []
  public constructor(public terminal: Rule<T>) { super() }
  expr: Rule<T> | undefined

  init() {
    if (this.expr) return
    var expr = this.expr = this.build_expr.reduce((acc, item) => item(acc), this.terminal)
    this.start_tokens = expr.start_tokens
    this.parse = expr.parse.bind(expr)
  }

  parse(input: Token[], pos: number) {
    this.init()
    return this.expr!.parse(input, pos)
  }

  Binary<R>(op: Rule<R>, fn: (op: R, left: T, right: T) => T) {
    this.build_expr.push(upper => Seq(
      { upper },
      { rest: Repeat(Seq({ op, upper })) }
    ).map(r => r.rest.reduce((acc, item) => fn(item.op, acc, item.upper), r.upper) ))
    return this
  }

  BinaryRight<R>(op: Rule<R>, fn: (op: R, left: T, right: T) => T) {
    this.build_expr.push(upper => Seq(
      { rest: Repeat(Seq({ upper, op })) },
      { upper },
    ).map(r => r.rest.reduceRight((acc, item) => fn(item.op, item.upper, acc), r.upper) ))
    return this
  }

  Prefix<R>(op: Rule<R>, fn: (op: R, right: T) => T) {
    this.build_expr.push(upper => Seq({ op: Opt(op) }, { upper }).map(r => r.op != undefined ? fn(r.op, r.upper) : r.upper))
    return this
  }

  Suffix<R>(op: Rule<R>, fn: (op: R, left: T) => T) {
    this.build_expr.push(upper => Seq({ upper }, { op: Opt(op) }).map(r => r.op != undefined ? fn(r.op, r.upper) : r.upper))
    return this
  }
}

/////////////////////////////

export function Seq<T extends (Rule<any> | {[name: string]: Rule<any>})[]>(...seq: T): Rule<UnionToIntersection<
  {[K in keyof T]: [T[K]] extends [{[name: string]: Rule<any>}] ?
    {[K2 in keyof T[K]]: Result<T[K][K2]>}
    : never
  }[number]
> & {}> {
  return new SeqRule(seq)
}


/**
 * FIXME: either should have a map to tokendefs of the first tokens of its child rules
 *    to avoid checking for useless match arms.
 *
 * Most rules should be able to be run once before calling their actual parse methods.
 */
export function Either<T extends Rule<any>[]>(...rules: T): Rule<{[K in keyof T]: Result<T[K]>}[number]> {
  return new EitherRule(rules)
}


/**
 *
 */
export function Repeat<R extends Rule<any>>(rule: R, opts?: { min?: number, max?: number }): Rule<Result<R>[]> {
  return new RepeatRule(rule, opts?.min, opts?.max)
}


/**
 *
 */
export function Opt<T>(rule: Rule<T>): Rule<T | undefined> {
  return new OptRule(rule)
}


/**
 *
 */
export function Not(rule: Rule<any>): Rule<null> {
  return new NotRule(rule)
}


export const Any = new class AnyRule extends TokenDef {

  constructor() { super('!any!', false) }

  _init() {
    this.start_tokens.add(this)
  }

  doParse(input: Token[], pos: number) {
    var tok: Token | undefined
    while ((tok = input[pos], tok && tok.is_skip)) { pos++ }
    return tok ? Res(tok, pos + 1) : NoMatch
  }
}


export const Eof = new class EOF extends Rule<null> {
  parse(input: Token[], pos: number) {
    if (pos >= input.length) return Res(null, pos)
    return NoMatch
  }
}


export function Forward<T>(rulefn: () => Rule<T>) {
  return new ForwardRule(rulefn)
}


export function SeparatedBy<T>(sep: Rule<any>, rule: Rule<T>, opts?: {trailing?: boolean, leading?: boolean}) {
  return new SeparatedByRule(sep, rule, opts)
}


export function TdopOperator<T>(terminal: Rule<T>) {
  return new TdopOperatorRule(terminal)
}


export function RecOperator<T>(terminal: Rule<T>) {
  return new RecOperatorRule(terminal)
}