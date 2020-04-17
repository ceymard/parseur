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
 * An object representing an actual match to a rule.
 */
export class ParseResult<T> {
  debug?: string[]
  constructor(public res: T, public pos: number) { }
}


export function Res<T>(res: T, pos: number) {
  return new ParseResult(res, pos)
}


export class Context {
  errors: any[] = []
  // input: Token[] = []

  furthest_token: Token | undefined
  furthest_pos: number | undefined

  constructor(public input: Token[]) { }
}


/**
 * The result of a string processing by [[Tokenizer.tokenize]]
 */
export class Token {
  public constructor(
    public def: TokenDef<any>,
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
export class Parseur<C extends Context = Context> {

  noaccel_token_defs = [] as TokenDef<C>[]
  token_defs: TokenDef<C>[] = []
  str_tokens = new Map<string, TokenDef<C>>()

  // Accelerator for characters
  token_table: (TokenDef<C>[] | null)[] = new Array(256).fill(null)

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
    var tdef = new TokenDef<C>(reg, false)
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

  parse(input: string, rule: Rule<any, C>) {
    var tokens = this.tokenize(input, { enable_line_counts: true, forget_skips: true })
    // console.log('??')
    if (tokens) {
      const ctx = new Context(tokens)
      var res = rule.parse(ctx, 0) // FIXME

      var failed = true
      if (res !== NoMatch) {
        var pos = res.pos
        var _tk: Token | undefined
        while ((_tk = tokens[pos], _tk && _tk.is_skip)) { pos++ }
        failed = !!_tk
      }

      if (res === NoMatch || failed) {
        // console.log('Match failed')
        return { status: 'nok', max_token: ctx.furthest_token, max_pos: ctx.furthest_pos, tokens }
        // console.log(Res.max_res)
      } else {
        return { status: 'ok', result: res.res }
        // console.log(inspect(res.res, {depth: null}))
      }
    }
    return { status: 'nok' }
  }

  auto_create_tokens = true

  S(tpl: TemplateStringsArray): Rule<string, C>
  S<T>(tpl: TemplateStringsArray, rule: Rule<T, C>): Rule<T, C>
  S<R extends Rule<any, C>[]>(tpl: TemplateStringsArray, ...rules: R): Rule<{[K in keyof R]: Result<R[K]>}, C>
  S<R extends Rule<any, C>[]>(tpl: TemplateStringsArray, ...rules: R): Rule<any, C> {
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
      return get_tkdef(tpl[0]).then(tk => tk.str)
    }

    var seq: Rule<any, any>[] = []
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

    class SRule extends Rule<any, any> {

      firstTokens(rset: RuleSet) {
        for (var r of seq) {
          r.firstTokens(rset.extend(this))
          // Optionals should be added
          if (!(r instanceof OptRule || r instanceof NotRule)) break
        }
      }

      parse(ctx: C, pos: number = 0) {
        var res: any[] = []

        for (var i = 0, l = seq.length; i < l; i++) {
          var match = seq[i].parse(ctx, pos)
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
 * Escape `str` to make it suitable to build a `RegExp`
 */
export function escape(str: string) {
  return str.replace(/[?.\$\^\{\}\[\]\(\)*+$\|]/g, m => '\\' + m)
}


export type ThenFn<T, U, C extends Context> = (res: T, ctx: C, pos: number, start: number) => U | NoMatch | ParseResult<U> | Rule<U, C>


/**
 *
 */
export type Result<T> = T extends Rule<infer U, any> ? U : never


export class RuleSet extends Set<Rule<any, any>> {
  extend(r: Rule<any, any>): this {
    if (this.has(r)) throw new Error(`Recursive rule`)
    return new (this.constructor as any)(this).add(r)
  }

  addToken(t: TokenDef<any>) {
    for (var s of this) {
      s.first_tokens.add(t)
    }
  }
}

/**
 * A rule is given a chance to init before it parses.
 */
export abstract class Rule<T, C extends Context = Context> {

  first_tokens = new Set<TokenDef<C>>()
  get startTokenDebug(): (string | RegExp)[] { return [...this.first_tokens].map(t => t._regex) }

  firstTokens(rset: RuleSet) {
    throw new Error(`No first tokens`)
  }

  abstract parse(ctx: C, pos?: number): NoMatch | ParseResult<T>

  _name = ''
  _build_name: null | (() => string) = null

  then<U>(fn: ThenFn<T, U, C>): Rule<U, C> {
    return new ThenRule(this, fn)
  }

  tap(fn: (res: T, ctx: C, pos: number, start: number) => any) {
    return this.then((res, ctx, pos, start) => {
      fn(res, ctx, pos, start)
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


export class ThenRule<T, U, C extends Context = Context> extends Rule<U, C> {
  constructor(public rule: Rule<T, C>, public fn: ThenFn<T, U, C>) { super() }

  firstTokens(rset: RuleSet) {
    this.rule.firstTokens(rset.extend(this))
  }

  parse(ctx: C, pos: number = 0) {
    var res = this.rule.parse(ctx, pos)
    if (res === NoMatch) return NoMatch
    var res2 = this.fn(res.res, ctx, res.pos, pos)
    if (res2 === NoMatch) return NoMatch
    if (res2 instanceof ParseResult) return res2
    if (res2 instanceof Rule) return res2.parse(ctx, res.pos)
    return Res(res2, res.pos)
  }
}


export class TokenDef<C extends Context> extends Rule<Token, C> {

  first_tokens = new Set<TokenDef<C>>().add(this)

  constructor(
    public _regex: RegExp | string,
    public _skip: boolean,
  ) {
    super()
  }

  firstTokens(rset: RuleSet) {
    rset.addToken(this)
  }

  derive_map?: Map<string, TokenDef<C>>
  derive(derived: string, tokenizer: Parseur<C>): TokenDef<C> {
    if (!this.derive_map) this.derive_map = new Map()
    var tkd = new TokenDef<C>(derived, this._skip)
    this.derive_map.set(derived, tkd)
    tokenizer.str_tokens.set(derived, tkd)
    return tkd
  }

  parse(ctx: C, pos: number = 0) {
    var next: Token | undefined
    var input = ctx.input
    while ((next = input[pos++])) {
      if (next.def === this) {
        var r = Res(next, pos)
        var max_pos = ctx.furthest_pos
        if (max_pos == undefined || max_pos < pos) {
          ctx.furthest_pos = pos
          ctx.furthest_token = next
        }
        return  r
      }
      if (!next.is_skip) return NoMatch
    }
    return NoMatch
  }

  as(str: RegExp): Rule<RegExpExecArray, C>
  as(str: string): Rule<string, C>
  as(str: string | RegExp): Rule<string | RegExpExecArray, C> {
    return this.then(res => {
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


export class OptRule<T, C extends Context> extends Rule<T | undefined, C> {

  constructor(public rule: Rule<T, C>) { super() }

  firstTokens(rset: RuleSet) {
    this.rule.firstTokens(rset.extend(this))
  }

  parse(ctx: C, pos: number = 0) {
    var res = this.rule.parse(ctx, pos)
    if (res === NoMatch) return Res(undefined, pos)
    return res
  }

}


export class EitherRule<Rules extends Rule<any, any>[]> extends Rule<{[K in keyof Rules]: Result<Rules[K]>}[number], SeqContext<Rules>> {

  constructor(public rules: Rules) { super() }

  rulemap = new Map<TokenDef<SeqContext<Rules>>, Rule<any, any>[]>()
  can_optimize = true
  can_skip = true

  firstTokens(rset: RuleSet) {
    for (var r of this.rules) {
      r.firstTokens(rset.extend(this))
    }
  }

  parse(ctx: SeqContext<Rules>, pos: number = 0) {
    this.parse = this.doParse
    var rs = new RuleSet()
    this.firstTokens(rs)

    rules: for (var r of this.rules) {
      for (var t of r.first_tokens) {
        if (t._skip) this.can_skip = false
        if (t === Any as TokenDef<any>) {
          this.can_optimize = false
          // break rules
        }
        (this.rulemap.get(t) ?? this.rulemap.set(t, []).get(t)!).push(r)
      }
    }

    return this.doParse(ctx, pos)
  }

  doParse(ctx: SeqContext<Rules>, pos: number = 0) {
    var tk: Token | undefined

    const input = ctx.input
    if (this.can_skip) {
      while ((tk = input[pos], tk && tk.is_skip)) { pos++ }
    }

    if (this.can_optimize) {
      while ((tk = input[pos])) {
        var _rules = this.rulemap.get(tk.def)

        if (_rules) {
          for (var i = 0, l = _rules.length; i < l; i++) {
            var rule = _rules[i]
            var res = rule.parse(ctx, pos)
            if (res !== NoMatch) return res
          }
        }

        if (!tk.is_skip) return NoMatch
        pos++
      }
    }

    for (var rules = this.rules, i = 0, l = rules.length; i < l; i++) {
      var rule = rules[i]
      var res = rule.parse(ctx, pos)
      if (res !== NoMatch) return res
    }
    return NoMatch
  }

}


export type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;


export type SeqResult<T extends any[]> = {[K in keyof T]:
  [T[K]] extends [{[name: string]: Rule<any, any>}] ?
    {[K2 in keyof T[K]]: Result<T[K][K2]>}
  : never
}[number]

export type SeqContext<T extends any[]> = {[K in keyof T]:
  [T[K]] extends [{[name: string]: Rule<any, infer C>}] ?
    C
  : [T[K]] extends [Rule<any, infer C>] ?
    C
  : never
}[number]

export class SeqRule<Rules extends (Rule<any, any> | {[name: string]: Rule<any, any>})[]> extends Rule<UnionToIntersection<SeqResult<Rules>> & {}, SeqContext<Rules>> {

  real_rules: Rule<any, SeqContext<Rules>>[] = []
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

  firstTokens(rset: RuleSet) {
    for (var r of this.real_rules) {
      r.firstTokens(rset.extend(this))
      if (!(r instanceof OptRule) && !(r instanceof NotRule)) break
    }
  }

  parse(ctx: SeqContext<Rules>, pos: number = 0) {
    var res = {} as any
    var rules = this.real_rules
    var names = this.names
    for (var i = 0, l = rules.length; i < l; i++) {
      var rule = rules[i]
      var key = names[i]
      var match = rule.parse(ctx, pos)
      // console.log(key, match, entries[i][1])
      if (match === NoMatch) return NoMatch
      pos = match.pos
      if (key !== null) res[key] = match.res
    }
    return Res(res, pos)
  }

}


export class RepeatRule<T, C extends Context> extends Rule<T[], C> {
  public constructor(public rule: Rule<T, C>, public min?: number, public max?: number) { super() }

  firstTokens(rset: RuleSet) {
    this.rule.firstTokens(rset.extend(this))
  }

  parse(ctx: C, pos: number = 0) {
    var res: T[] = []
    var rres: ParseResult<any> | NoMatch
    var rule = this.rule
    var min = this.min
    var max = this.max
    while ((rres = rule.parse(ctx, pos)) !== NoMatch) {
      res.push(rres.res)
      pos = rres.pos
      if (max != null && res.length >= max) break
    }
    if (min != null && res.length < min) return NoMatch
    return Res(res, pos)
  }
}


export class NotRule<C extends Context> extends Rule<null, C> {
  constructor(public rule: Rule<any, C>) { super() }

  firstTokens() {
    // Does nothing, because it *does not* want
  }

  parse(ctx: C, pos: number = 0) {
    var res = this.rule.parse(ctx, pos)
    if (res === NoMatch) return Res(null, pos)
    return NoMatch
  }
}


export class ForwardRule<T, C extends Context> extends Rule<T, C> {
  constructor(public rulefn: () => Rule<T, C>) { super() }

  rule?: Rule<T, C>

  firstTokens(rset: RuleSet) {
    this.init()
    this.rule!.firstTokens(rset.extend(this))
  }

  parse(ctx: C, pos: number = 0): ParseResult<T> | NoMatch {
    this.init()
    return this.parse(ctx, pos)
  }

  init() {
    if (this.rule) return
    var rule = this.rule = this.rulefn()
    this.parse = rule.parse.bind(rule)
  }
}


export class SeparatedByRule<T, C extends Context> extends Rule<T[], C> {
  leading = false
  trailing = false

  constructor(public sep: Rule<any, C>, public rule: Rule<T, C>, opts?: { leading?: boolean, trailing?: boolean}) {
    super()
    this.leading = !!opts?.leading
    this.trailing = !!opts?.trailing
  }

  firstTokens(rset: RuleSet) {
    if (this.leading)
      this.sep.firstTokens(rset.extend(this))
    this.rule.firstTokens(rset.extend(this))
  }

  parse(ctx: C, pos: number = 0) {
    const sep = this.sep
    const rule = this.rule
    const res: T[] = []

    if (this.leading) {
      var lres = sep.parse(ctx, pos)
      if (lres !== NoMatch) pos = lres.pos
    }

    var at_sep = false
    while (true) {
      var rres = rule.parse(ctx, pos)
      if (rres === NoMatch) { at_sep = false; break }
      res.push(rres.res)
      pos = rres.pos

      var sres = sep.parse(ctx, pos)
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


export class TdopOperatorRule<T, C extends Context> extends Rule<T, C> {
  rules: any[] = []
  _nuds: Rule<any, C>[] = []
  nuds!: Rule<TdopResult<T>, C>
  _leds: Rule<any, C>[] = []
  leds!: Rule<TdopResult<T>, C>

  current_build_level = 1000

  get down() {
    this.current_build_level -= 10
    return this
  }

  constructor(public terminal: Rule<T, C>) { super() }

  firstTokens(rset: RuleSet) {
    this.init()
    this.nuds.firstTokens(rset.extend(this))
  }

  init() {
    if (this.nuds) return
    this.nuds = new EitherRule([...this._nuds, this.terminal.then(t => TdopResult.create({value: t}))]).setName('Nuds')
    this.leds = new EitherRule(this._leds).setName('Leds')
  }

  parse(ctx: C, pos: number = 0) {
    this.init()
    this.parse = this.doParse
    return this.doParse(ctx, pos)
  }

  doParse(ctx: C, pos: number = 0) {
    const nuds = this.nuds
    const leds = this.leds

    // var cached_op: TdopResult<T> | undefined

    function expression(rbp: number): T | NoMatch {
      var leftp = nuds.parse(ctx, pos)
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

      var op = leds.parse(ctx, pos)
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

        var op = leds.parse(ctx, pos)
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

  prefix<R>(rule: Rule<R, C>, fn: (op: R, right: T) => T | NoMatch) {
    var power = this.current_build_level
    var nr = rule.then(r => TdopResult.create<T>({
      nud: expr => {
        var e = expr(power)
        if (e === NoMatch) return e
        return fn(r, e)
      }
    }))
    this._nuds.push(nr)
    return this
  }

  suffix<R>(rule: Rule<R, C>, fn: (op: R, left: T) => T | NoMatch) {
    var power = this.current_build_level
    var lr = rule.then(r => TdopResult.create<T>({
      lbp: power,
      led(left, expr) {
        return fn(r, left)
      }
    }))
    this._leds.push(lr)
    return this
  }

  binary<R>(rule: Rule<R, C>, fn: (op: R, left: T, right: T) => T | NoMatch) {
    var power = this.current_build_level
    var lr = rule.then(r => TdopResult.create<T>({
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

  binaryRight<R>(rule: Rule<R, C>, fn: (op: R, left: T, right: T) => T | NoMatch) {
    var power = this.current_build_level
    var lr = rule.then(r => TdopResult.create<T>({
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


export class RecOperatorRule<T, C extends Context> extends Rule<T, C> {
  build_expr: ((upper_level: Rule<T, C>) => Rule<T, C>)[] = []
  public constructor(public terminal: Rule<T, C>) { super() }
  expr: Rule<T, C> | undefined

  firstTokens(rset: RuleSet) {
    this.init()
    this.expr!.firstTokens(rset.extend(this))
  }

  init() {
    if (this.expr) return
    var expr = this.expr = this.build_expr.reduce((acc, item) => item(acc), this.terminal)
    this.parse = expr.parse.bind(expr)
  }

  parse(ctx: C, pos: number = 0) {
    this.init()
    return this.expr!.parse(ctx, pos)
  }

  Binary<R>(op: Rule<R, C>, fn: (op: R, left: T, right: T) => T) {
    this.build_expr.push(upper => Seq(
      { upper },
      { rest: Repeat(Seq({ op, upper })) }
    ).then(r => r.rest.reduce((acc, item) => fn(item.op, acc, item.upper), r.upper) ))
    return this
  }

  BinaryRight<R>(op: Rule<R, C>, fn: (op: R, left: T, right: T) => T) {
    this.build_expr.push(upper => Seq(
      { rest: Repeat(Seq({ upper, op })) },
      { upper },
    ).then(r => r.rest.reduceRight((acc, item) => fn(item.op, item.upper, acc), r.upper) ))
    return this
  }

  Prefix<R>(op: Rule<R, C>, fn: (op: R, right: T) => T) {
    this.build_expr.push(upper => {
      var res = Seq({ op: Opt(op) }, { upper }).then(r => r.op != undefined ? fn(r.op, r.upper) : r.upper)
      return res
    })
    return this
  }

  Suffix<R>(op: Rule<R, C>, fn: (op: R, left: T) => T) {
    this.build_expr.push(upper => Seq({ upper }, { op: Opt(op) }).then(r => r.op != undefined ? fn(r.op, r.upper) : r.upper))
    return this
  }
}

/////////////////////////////

export function Seq<T extends (Rule<any, any> | {[name: string]: Rule<any, any>})[]>(...seq: T)
  : Rule<UnionToIntersection<SeqResult<T>> & {}, SeqContext<T>> {
  return new SeqRule(seq)
}


/**
 * FIXME: either should have a map to tokendefs of the first tokens of its child rules
 *    to avoid checking for useless match arms.
 *
 * Most rules should be able to be run once before calling their actual parse methods.
 */
export function Either<T extends Rule<any, any>[]>(...rules: T): Rule<{[K in keyof T]: Result<T[K]>}[number], SeqContext<T>> {
  return new EitherRule(rules)
}


/**
 *
 */
export function Repeat<R extends Rule<any, C>, C extends Context>(rule: R, opts?: { min?: number, max?: number }): Rule<Result<R>[], C> {
  return new RepeatRule(rule, opts?.min, opts?.max)
}


/**
 *
 */
export function Opt<T, C extends Context>(rule: Rule<T, C>): Rule<T | undefined, C> {
  return new OptRule(rule)
}


/**
 *
 */
export function Not<C extends Context>(rule: Rule<any, C>): Rule<null, C> {
  return new NotRule(rule)
}


export const Any = new class AnyRule extends TokenDef<any> {

  constructor() { super('!any!', false) }

  parse(input: Token[], pos: number) {
    var tok: Token | undefined
    while ((tok = input[pos], tok && tok.is_skip)) { pos++ }
    return tok ? Res(tok, pos + 1) : NoMatch
  }
}


export const Eof = new class EOF extends Rule<null, any> {
  firstTokens() {
    // do nothing
  }

  parse(input: Token[], pos: number) {
    if (pos >= input.length) return Res(null, pos)
    return NoMatch
  }
}


export function Forward<T, C extends Context>(rulefn: () => Rule<T, C>) {
  return new ForwardRule(rulefn)
}


export function SeparatedBy<T, C extends Context>(sep: Rule<any, C>, rule: Rule<T, C>, opts?: {trailing?: boolean, leading?: boolean}) {
  return new SeparatedByRule(sep, rule, opts)
}


export function TdopOperator<T, C extends Context>(terminal: Rule<T, C>) {
  return new TdopOperatorRule(terminal)
}


export function RecOperator<T, C extends Context>(terminal: Rule<T, C>) {
  return new RecOperatorRule(terminal)
}