// FIXME: Still missing ; a way of handling errors gracefully

import { inspect } from 'util'

/**
 * NoMatch is both a type and a value and is used as the result
 * for a rule parse when the rule did not match the input.
 */
export const NoMatch = Symbol('no-match')
export type NoMatch = typeof NoMatch


export const AnyToken = Symbol('any-token')
export type AnyToken = typeof AnyToken


export interface ResNoMatch {
  value: NoMatch
  pos: number
  isNoMatch(): this is ResNoMatch
}

export interface ParseResult<T> {
  value: T
  pos: number
  isNoMatch(): this is ResNoMatch
}

export class ParseResult<T> {
  constructor(public value: T, public pos: number) { }

  isNoMatch(): this is ResNoMatch {
    return (this.value as any) === NoMatch
  }
}


export function Res(value: NoMatch, pos: number): ResNoMatch
export function Res<T>(value: T, pos: number): ParseResult<T>
export function Res<T>(value: T, pos: number): ParseResult<T> {
  return new ParseResult(value, pos)
}

// export function Res<T>(res: T, pos: number) {
//   return new ParseResult(res, pos)
// }


export class Context {
  errors: any[] = []
  // input: Token[] = []

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


export type TokenizerOptions = {
  forget_skips?: boolean
  enable_line_counts?: boolean
}


// The tokenizer should be able to operate on a stream to create a token stream
// Also, the rules should be able to use next() or anext() depending on whether they
// want to parse synchronously or asynchronously
export class Parseur<C extends Context = Context> {

  noaccel_token_defs = [] as TokenDef<C>[]
  token_defs: TokenDef<C>[] = []
  str_tokens = new Map<string, TokenDef<C>>()

  // Accelerator for characters
  token_table: (TokenDef<C>[] | undefined)[] = new Array(256).fill(undefined)
  // Accelerator for characters whose code is > 256.
  // The technique was stolen from chevrotain ; characters are put into "buckets" of 256 elements
  // to reduce memory usage
  higher_order_token_table: ((TokenDef<C>[] | undefined)[] | undefined)[] = new Array(256).fill(undefined)

  derive_string_tokens_from_regexps = true

  constructor() {
    this.P = this.P.bind(this)
  }

  nameRules() {
    for (var key of Object.getOwnPropertyNames(this) as (keyof this & string)[]) {
      var p = this[key]
      if (p instanceof Rule && !p._name) {
        p.setName(key)
      }
    }
  }

  token(def: RegExp | string, accel?: boolean) {
    // All the regexp we handle are sticky ones.

    var starting_chars: CharacterValues[] = []

    const handle_regexp = (node: RegExpNode) => {
      if (node.type === 'group') {
        handle_regexp(node.value)
      } else if (node.type === 'chars') {
        starting_chars.push(node)
        // ADD THE CHARACTERS !
      } else if (node.type === 'sequence') {
        for (var a of node.atoms) {
          handle_regexp(a)
          if (a.quantifier?.at_least !== 0) break
        }
      } else if (node.type === 'union') {
        for (var v of node.sequences) {
          handle_regexp(v)
        }
      }
    }

    var reg = typeof def === 'string' ? def : new RegExp(def.source, (def.flags ?? '').replace('y', '') + 'y')
    var tdef = new TokenDef<C>(reg, false)
    var added: boolean = false

    const add_to_ttable = (code: number) => {
      added = true;
      if (code < 256) {
        var tbl = (this.token_table[code] = this.token_table[code] ?? [])
      } else {
        var idx = ~~(code / 256)
        var rest = code % 256
        var higher = this.higher_order_token_table[idx] = this.higher_order_token_table[idx] ?? new Array(256).fill(null)
        tbl = higher[rest] = higher[rest] ?? []
      }
      tbl.push(tdef)
      tbl.sort((a, b) => a._regex < b._regex ? 1 : a._regex > b._regex ? -1 : 0)
      // console.log(String.fromCharCode(code), tbl.map(t => t._regex))
    }

    if (typeof def === 'string') {
      add_to_ttable(def.charCodeAt(0))
      this.str_tokens.set(def, tdef)
    } else if (accel !== false) {
      var preg = reg_parser.parse(def)
      if (!preg.isNoMatch()) {
        handle_regexp(preg.value.res)
        var s = new Set<number>()
        for (var st of starting_chars) {
          if (st.complement) throw new Error(`Parseur does not handle complements for now`)
          for (var _s of st.values)
            s.add(_s)
        }
        for (var _s of s)
          add_to_ttable(_s)
        // console.log(def, starting_chars)
      } else {
        throw new Error(`regexp failed...?`)
      }
    }

    if (!added) this.noaccel_token_defs.push(tdef)
    this.token_defs.push(tdef)
    return tdef
  }

  tokenize(input: string, opts?: TokenizerOptions) {
    var res: Token[] = []
    var pos = 0
    var enable_line_counts = !!opts?.enable_line_counts
    var forget_skips = !!opts?.forget_skips
    var tkdefs = this.noaccel_token_defs
    var tokendefs = this.noaccel_token_defs
    var l = tokendefs.length
    var tktbl = this.token_table
    var htktbl = this.higher_order_token_table
    var il = input.length
    var line = 1
    var col = 1

    tks: while (true) {
      if (pos >= il) break

      var char = input[pos].charCodeAt(0)
      // var accel = char < 256 ? tktbl[char] : htktbl[~~(char / 256)]?.[char % 256]
      var accel = tktbl[char]
      // console.log(input[pos], accel, input[pos].charCodeAt(0))
      if (accel) {
        l = accel.length
        tokendefs = accel
      } else {
        if (char > 255) {
          accel = htktbl[~~(char / 256)]?.[char % 256]
        }
        if (accel) {
          l = accel.length
          tokendefs = accel
        } else {
          l = tkdefs.length
          tokendefs = tkdefs
        }
      }
      // console.log(tokendefs, accel, input[pos])

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
        if (match === '') throw new Error(`Token definition '${tkd._regex}' produced an empty match`)
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

  parseRule(input: string, rule: Rule<any, C>, getctx: (input: Token[]) => C, opts?: TokenizerOptions) {
    var tokens = this.tokenize(input, opts)
    // console.log('??')
    if (tokens) {
      const ctx = getctx(tokens)
      var res = rule.parse(ctx, 0) // FIXME

      if (res.isNoMatch()) {
        // console.log('Match failed')
        return { status: 'nok' as const, res, tokens }
        // console.log(Res.max_res)
      } else {
        return { status: 'ok' as const, result: res.value, pos: res.pos }
        // console.log(inspect(res.res, {depth: null}))
      }
    }
    return { status: 'nok' as const, }
  }

  auto_create_tokens = true

  /**
   * Return a TokenDef matching the provided string.
   *
   * First, it searches the already known string tokens and returns the matching TokenDef if found.
   * Second, it searches the regexp tokens.
   *  If this.auto_create_tokens is true, it auto creates a `derived` based on the regexp token.
   *  Otherwise, it returns the original TokenDef which is `.then` where it performs a comparison.
   * If no TokenDef was found and `this.auto_create_tokens` is true, it creates a new string token.
   *
   * Beware that no space checking is done, so putting space like in P`if then` will result in the creation
   * of the `if then` token as is.
   */
  P(tpl: TemplateStringsArray): TokenDef<C>
  /**
   * When given a single rule in `${template args}`, produces the production of this rule.
   * The text around the rule is trimmed and splitted by whitespace, and each bit of text is then
   * mapped to TokenDefs following the rules stipulated in the string-only version of this method.
   *
   * ```typescript
   * // there is no need to .then here, the production of ParenthesizedExpression just ignores
   * // the ( and ) tokens in the result and directly gets the result of Expression.
   * ParenthesizedExpression = this.P`( ${Expression} )`
   * ```
   */
  P<T>(tpl: TemplateStringsArray, rule: Rule<T, C>): Rule<T, C>
  /**
   * Produces the production of all the rules in `${template args}`, ignoring the result of the
   * tokens that come before, between and after them.
   *
   * Tokens are returned/created after trimming the splitted by whitespace values of the strings
   * just like for the one rule version and string only version of this method.
   */
  P<R extends Rule<any, C>[]>(tpl: TemplateStringsArray, ...rules: R): Rule<{[K in keyof R]: Result<R[K]>}, C>
  P<R extends Rule<any, C>[]>(tpl: TemplateStringsArray, ...rules: R): Rule<any, C> {
    const get_tkdef = (token: string) => {
      var def = this.str_tokens.get(token)
      if (def) return def
      if (!def && !this.auto_create_tokens) throw new Error(`No token defined for '${token}'`)
      if (!def && this.derive_string_tokens_from_regexps) {
        // First try to see if one of our defined regexp would match and derive it.
        for (var tkdef of this.token_defs) {
          var sdef = tkdef._regex
          if (sdef instanceof RegExp && ((sdef.lastIndex = 0), sdef.test(token))) {
            if (this.auto_create_tokens)
              return tkdef.derive(token, this)
            else {
              return tkdef.as(token)
            }
          }
        }

        // If there is still nothing, we create a new token
      }
      return this.token(token)
    }

    if (tpl.length === 1 && rules.length === 0 && !tpl[0].match(/\s/)) {
      var tpz = tpl[0].trim()
      if (tpz.trim().match(/\s/)) throw new Error(`Do not include spaces in P single string calls`)
      return get_tkdef(tpz)
    }

    var seq: Rule<any, any>[] = []
    var in_res: boolean[] = []
    var single_res = rules.length === 1

    for (var i = 0, l = tpl.length; i < l; i++) {
      var strs = tpl[i].split(/\s+/g).filter(t => t !== '')
      for (var s of strs) {
        // console.log(s)
        seq.push(get_tkdef(s))
        in_res.push(false)
      }
      var r = rules[i]
      if (r) {
        seq.push(r)
        in_res.push(true)
      }
    }

    // console.log(seq)

    class SRule extends Rule<any, any> {

      firstTokensImpl(rset: RuleSet): FirstTokenSet<any> {
        var rs = rset.extend(this)
        var res = new FirstTokenSet<any>()
        for (var r of seq) {
          res.addOther(r.firstTokens(rs))
          // Optionals should be added
          if (!(r instanceof OptRule || r instanceof NotRule)) break
        }
        return res
      }

      parse(ctx: C, pos: number = 0) {
        var res: any[] = []

        for (var i = 0, l = seq.length; i < l; i++) {
          var match = seq[i].parse(ctx, pos)
          if (match.isNoMatch()) return match
          if (in_res[i]) res.push(match.value)
          pos = match.pos
        }

        if (single_res) return Res(res[0], pos)
        return Res(res, pos)
      }
    }

    return new SRule()
  }

  Eof = Eof<C>()
  Any = Any<C>()

}


/**
 * Escape `str` to make it suitable to build a `RegExp`
 */
export function escape(str: string) {
  return str.replace(/[?.\$\^\{\}\[\]\(\)*+$\|]/g, m => '\\' + m)
}


export type ThenFn<T, U, C extends Context> = (res: T, ctx: C, pos: number, start: number, original_rule: Rule<T, C>) => U | NoMatch
export type ThenResFn<T, U, C extends Context> = (res: T, ctx: C, pos: number, start: number, original_rule: Rule<T, C>) => ParseResult<U>


/**
 *
 */
export type Result<T> = T extends Rule<infer U, any> ? U : never


export class RuleSet extends Set<Rule<any, any>> {
  extend(r: Rule<any, any>): this {
    return new (this.constructor as any)(this).add(r)
  }
}


export class FirstTokenSet<C extends Context> extends Set<TokenDef<C>> {

  has_any = false

  static fromTokenDef<C extends Context>(tk: TokenDef<C>) {
    var r = new FirstTokenSet<C>()
    r.add(tk)
    return r
  }

  static asAny<C extends Context = any>() {
    var r = new FirstTokenSet<C>()
    r.has_any = true
    return r
  }

  addOther(other: FirstTokenSet<C>): this {
    if (other.has_any) {
      this.clear()
      this.has_any = true
    } else {
      for (var t of other)
        this.add(t)
    }
    return this
  }

}

/**
 * A rule is given a chance to init before it parses.
 */
export abstract class Rule<T, C extends Context = Context> {

  first_tokens?: FirstTokenSet<C>
  // get startTokenDebug(): (string | RegExp)[] { return [...this.first_tokens].map(t => t._regex) }

  firstTokensImpl(rset: RuleSet): FirstTokenSet<C> {
    return FirstTokenSet.asAny()
  }

  firstTokens(rset: RuleSet) {
    if (rset.has(this)) throw new Error(`Recursive rule detected`)
    if (!this.first_tokens)
      this.first_tokens = this.firstTokensImpl(rset.extend(this))
    return this.first_tokens
  }

  abstract parse(ctx: C, pos?: number): ParseResult<T> | ResNoMatch

  _name = ''
  _build_name: null | (() => string) = null

  then<U>(fn: ThenFn<T, U, C>): Rule<U, C> {
    return new ThenRule(this, fn)
  }

  thenRes<U>(fn: ThenResFn<T, U, C>): Rule<U, C> {
    return new ThenResRule(this, fn)
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

  firstTokensImpl(rset: RuleSet) {
    return this.rule.firstTokens(rset.extend(this))
  }

  parse(ctx: C, pos: number = 0) {
    var res = this.rule.parse(ctx, pos)
    if (res.isNoMatch()) return res
    var res2 = this.fn(res.value, ctx, res.pos, pos, this.rule)
    if (res2 === NoMatch) return Res(NoMatch, pos)
    return Res(res2, res.pos)
  }
}


export class ThenResRule<T, U, C extends Context = Context> extends Rule<U, C> {
  constructor(public rule: Rule<T, C>, public fn: ThenResFn<T, U, C>) { super() }

  firstTokensImpl(rset: RuleSet) {
    return this.rule.firstTokens(rset.extend(this))
  }

  parse(ctx: C, pos: number = 0) {
    var res = this.rule.parse(ctx, pos)
    if (res.isNoMatch()) return res
    return this.fn(res.value, ctx, res.pos, pos, this.rule)
  }
}


export class TokenDef<C extends Context> extends Rule<Token, C> {

  first_tokens = new FirstTokenSet<C>().add(this)

  constructor(
    public _regex: RegExp | string,
    public _skip: boolean,
  ) {
    super()
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
        return Res(next, pos)
      }
      if (!next.is_skip) return Res(NoMatch, pos)
    }
    return Res(NoMatch, pos)
  }

  [inspect.custom]() {
    return `TokenDef<${this._name || this._regex}>`
  }

  as(str: RegExp): Rule<RegExpExecArray, C>
  as(str: string): Rule<string, C>
  as(str: string | RegExp): Rule<string | RegExpExecArray, C> {
    return this.then((res, _, pos) => {
      var match = res.str
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


export class OptRule<R extends Rule<any, any>> extends Rule<Result<R> | undefined, ContextOf<R>> {

  constructor(public rule: R) { super() }

  firstTokensImpl(rset: RuleSet): FirstTokenSet<ContextOf<R>>  {
    return this.rule.firstTokens(rset.extend(this))
  }

  parse(ctx: ContextOf<R>, pos: number = 0) {
    var res = this.rule.parse(ctx, pos)
    if (res.isNoMatch()) return Res(undefined, pos)
    return res
  }

}


export class EitherRule<Rules extends Rule<any, any>[]> extends Rule<{[K in keyof Rules]: Result<Rules[K]>}[number], ContextOf<Rules>> {

  constructor(public rules: Rules) { super() }

  rulemap = new Map<TokenDef<ContextOf<Rules>>, Rule<any, any>[]>()
  can_skip = true
  can_optimize = true

  firstTokensImpl(rset: RuleSet): FirstTokenSet<ContextOf<Rules>> {
    var res = new FirstTokenSet<ContextOf<Rules>>()
    var rs = rset.extend(this)
    for (var r of this.rules) {
      res.addOther(r.firstTokens(rs))
    }
    return res
  }

  parse(ctx: ContextOf<Rules>, pos: number = 0): any {
    var rs = new RuleSet([this])

    rules: for (var r of this.rules) {
      var rtokens = r.firstTokens(rs)
      if (rtokens.has_any) {
        // HANDLE ANY TOKENS
        this.can_skip = false // can't skip if any token might pop up.
        this.can_optimize = false
        continue
      }
      for (var t of rtokens) {
        if (t._skip) this.can_skip = false
        var table = this.rulemap.get(t) ?? this.rulemap.set(t, []).get(t)!
        table.push(r)
      }
    }

    if (this.can_optimize) {
      this.parse = this.doParseOptimized
    } else {
      this.parse = this.doParse
    }
    return this.parse(ctx, pos)
  }

  doParseOptimized(ctx: ContextOf<Rules>, pos: number = 0) {
    var tk: Token | undefined

    const input = ctx.input
    if (this.can_skip) {
      while ((tk = input[pos], tk && tk.is_skip)) { pos++ }
    }

    while ((tk = input[pos])) {
      var _rules = this.rulemap.get(tk.def)

      if (_rules) {
        for (var i = 0, l = _rules.length; i < l; i++) {
          var rule = _rules[i]
          var res = rule.parse(ctx, pos)
          if (!res.isNoMatch()) return res
        }
      }

      if (!tk.is_skip) return Res(NoMatch, pos)
      pos++
    }
    return Res(NoMatch, pos)
  }

  doParse(ctx: ContextOf<Rules>, pos: number = 0) {
    var tk: Token | undefined

    const input = ctx.input
    if (this.can_skip) {
      while ((tk = input[pos], tk && tk.is_skip)) { pos++ }
    }

    for (var rules = this.rules, i = 0, l = rules.length; i < l; i++) {
      var rule = rules[i]
      var res = rule.parse(ctx, pos)
      if (!res.isNoMatch()) return res
    }
    return Res(NoMatch, pos)
  }

}


export type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;


export type SeqResult<T extends any[]> = {[K in keyof T]:
  [T[K]] extends [{[name: string]: Rule<any, any>}] ?
    {[K2 in keyof T[K]]: Result<T[K][K2]>}
  : never
}[number]

export type ContextOf<T extends any[] | any> =
  T extends Rule<any, infer C> ? C :
  {[K in keyof T]:
  [T[K]] extends [{[name: string]: Rule<any, infer C>}] ?
    C
  : [T[K]] extends [Rule<any, infer C>] ?
    C
  : never
}[number]


export class SeqRule<Rules extends (Rule<any, any> | {[name: string]: Rule<any, any>})[]> extends Rule<UnionToIntersection<SeqResult<Rules>> & {}, ContextOf<Rules>> {

  real_rules: Rule<any, ContextOf<Rules>>[] = []
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

  firstTokensImpl(rset: RuleSet): FirstTokenSet<ContextOf<Rules>> {
    var rs = rset.extend(this)
    var res = new FirstTokenSet<ContextOf<Rules>>()
    for (var r of this.real_rules) {
      if (r instanceof NotRule) continue
      res.addOther(r.firstTokens(rs))
      if (!(r instanceof OptRule)) break
    }
    return res
  }

  parse(ctx: ContextOf<Rules>, pos: number = 0) {
    var res = {} as any
    var rules = this.real_rules
    var names = this.names
    for (var i = 0, l = rules.length; i < l; i++) {
      var rule = rules[i]
      var key = names[i]
      var match = rule.parse(ctx, pos)
      // console.log(key, match, entries[i][1])
      if (match.isNoMatch()) return match
      pos = match.pos
      if (key !== null) res[key] = match.value
    }
    return Res(res, pos)
  }

}


export class RepeatRule<T, C extends Context> extends Rule<T[], C> {
  public constructor(public rule: Rule<T, C>, public min?: number, public max?: number, public times?: number) {
    super()
    if (times != undefined && (max != undefined || min != undefined)) {
      throw new Error(`RepeatRule may not specify times with max or min`)
    }
  }

  firstTokensImpl(rset: RuleSet): FirstTokenSet<C> {
    return this.rule.firstTokens(rset.extend(this))
  }

  parse(ctx: C, pos: number = 0) {
    var res: T[] = []
    var rres: ParseResult<any>
    var rule = this.rule
    var min = this.min
    var max = this.max
    var times = this.times
    while ((rres = rule.parse(ctx, pos)), rres.value !== NoMatch) {
      res.push(rres.value)
      pos = rres.pos
      if (max != null && res.length >= max) break
    }
    if (min != null && res.length < min) return Res(NoMatch, pos)
    if (times != null && res.length !== times) return Res(NoMatch, pos)
    return Res(res, pos)
  }
}


export class NotRule<C extends Context> extends Rule<null, C> {
  constructor(public rule: Rule<any, C>) { super() }

  parse(ctx: C, pos: number = 0) {
    var res = this.rule.parse(ctx, pos)
    if (res.isNoMatch()) return Res(null, pos)
    return Res(NoMatch, pos)
  }
}


export class ForwardRule<T, C extends Context> extends Rule<T, C> {
  constructor(public rulefn: () => Rule<T, C>) { super() }

  rule?: Rule<T, C>

  firstTokensImpl(rset: RuleSet): FirstTokenSet<C> {
    this.init()
    return this.rule!.firstTokens(rset.extend(this))
  }

  parse(ctx: C, pos: number = 0): ParseResult<T> | ResNoMatch {
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

  firstTokensImpl(rset: RuleSet): FirstTokenSet<C> {
    var res = new FirstTokenSet<C>()
    if (this.leading)
      res.addOther(this.sep.firstTokens(rset.extend(this)))
    res.addOther(this.rule.firstTokens(rset.extend(this)))
    return res
  }

  parse(ctx: C, pos: number = 0) {
    const sep = this.sep
    const rule = this.rule
    const res: T[] = []

    if (this.leading) {
      var lres = sep.parse(ctx, pos)
      if (!lres.isNoMatch()) pos = lres.pos
    }

    var at_sep = false
    while (true) {
      var rres = rule.parse(ctx, pos)
      if (rres.isNoMatch()) { at_sep = false; break }
      res.push(rres.value)
      pos = rres.pos

      var sres = sep.parse(ctx, pos)
      if (sres.isNoMatch()) { at_sep = true; break }
      pos = sres.pos
    }

    if (!at_sep && !this.trailing) return Res(NoMatch, pos)
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


export class TdopOperatorRule<R extends Rule<any, any>> extends Rule<Result<R>, ContextOf<R>> {
  rules: any[] = []
  _nuds: Rule<TdopResult<Result<R>>, ContextOf<R>>[] = []
  nuds!: Rule<TdopResult<Result<R>>, ContextOf<R>>
  _leds: Rule<TdopResult<Result<R>>, ContextOf<R>>[] = []
  leds!: Rule<TdopResult<Result<R>>, ContextOf<R>>

  current_build_level = 100000

  get down() {
    this.current_build_level -= 10
    return this
  }

  constructor(public terminal: R) { super() }

  firstTokens(rset: RuleSet): FirstTokenSet<ContextOf<R>> {
    this.init()
    return this.nuds.firstTokens(rset.extend(this))
  }

  init() {
    if (this.nuds) return
    this.nuds = new EitherRule([...this._nuds, this.terminal.then(t => TdopResult.create({value: t}))]).setName('Nuds')
    this.leds = new EitherRule(this._leds).setName('Leds')
  }

  parse(ctx: ContextOf<R>, pos: number = 0) {
    this.init()
    this.parse = this.doParse
    return this.doParse(ctx, pos)
  }

  doParse(ctx: ContextOf<R>, pos: number = 0) {
    const nuds = this.nuds
    const leds = this.leds

    // var cached_op: TdopResult<T> | undefined

    const expression = (rbp: number): Result<R> | NoMatch => {
      var leftp = nuds.parse(ctx, pos)
      if (leftp.isNoMatch()) return NoMatch
      var leftm = leftp.value
      pos = leftp.pos

      var left: Result<R> | NoMatch
      if (leftm.value != undefined) {
        left = leftm.value
      } else {
        if (!leftm.nud) return NoMatch
        left = leftm.nud((n: number) => expression(n))
      }
      if (left === NoMatch) return NoMatch

      var op = leds.parse(ctx, pos)
      if (op.isNoMatch()) return left
      var opm = op.value
      // cached_op = opm

      while (rbp < opm.lbp!) {
        pos = op.pos
        // only advance if the operator matched the current level
        // pos = op.pos
        // if (!opm.led) return NoMatch
        var opres = opm.led!(left as Result<R>, expression)
        if (opres === NoMatch) {
          return left
        }
        // FIXME there should probably be a way of caching the operator that was matched
        // to recheck it here and avoid reparsing it.
        left = opres

        // first try to get the cached value.

        var op = leds.parse(ctx, pos)
        if (op.isNoMatch()) {
          return left
        }
        opm = op.value
      }

      return left
    }

    var res = expression(0)
    if (res === NoMatch) return Res(NoMatch, pos)
    return Res(res, pos)
  }

  Prefix<R2>(rule: Rule<R2, ContextOf<R>>, fn: (op: R2, right: Result<R>) => Result<R> | NoMatch) {
    var power = this.current_build_level
    var nr = rule.then(r => TdopResult.create<Result<R>>({
      nud: expr => {
        var e = expr(power)
        if (e === NoMatch) return e
        return fn(r, e)
      }
    }))
    this._nuds.push(nr)
    return this
  }

  Suffix<R2>(rule: Rule<R2, ContextOf<R>>, fn: (op: R2, left: Result<R>) => Result<R> | NoMatch) {
    var power = this.current_build_level
    var lr = rule.then(r => TdopResult.create<Result<R>>({
      lbp: power,
      led(left, expr) {
        return fn(r, left)
      }
    }))
    this._leds.push(lr)
    return this
  }

  Binary<R2>(rule: Rule<R2, ContextOf<R>>, fn: (op: R2, left: Result<R>, right: Result<R>) => Result<R> | NoMatch) {
    var power = this.current_build_level
    var lr = rule.then(r => TdopResult.create<Result<R>>({
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

  BinaryRight<R2>(rule: Rule<R2, ContextOf<R>>, fn: (op: R2, left: Result<R>, right: Result<R>) => Result<R> | NoMatch) {
    var power = this.current_build_level
    var lr = rule.then(r => TdopResult.create<Result<R>>({
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

  firstTokensImpl(rset: RuleSet): FirstTokenSet<C> {
    this.init()
    return this.expr!.firstTokens(rset.extend(this))
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

/**
 * Matches a sequence of rules in order. If any of its rules fail, then it fails.
 *
 * By default, the results of the subrules are not stored in the result of the sequence. To
 * have them available, they must be passed in objects ; their property names becomes the property
 * in which the result will be available.
 *
 * ```typescript
 * Seq(Rule1, Rule2, { prop: Rule3 }, Rule4, { prop2: Rule5 }).then(res =>
 *    // res.prop and res.prop2 contain the results.
 * )
 * ```
 */
export function Seq<Rules extends (Rule<any, any> | {[name: string]: Rule<any, any>})[]>(...seq: Rules): Rule<UnionToIntersection<SeqResult<Rules>> & {}, ContextOf<Rules>> {
  return new SeqRule(seq)
}


/**
 * Matches any rule provided to it, returning the result of the first one that does.
 */
export function Either<Rules extends Rule<any, any>[]>(...rules: Rules): Rule<{[K in keyof Rules]: Result<Rules[K]>}[number], ContextOf<Rules>> {
  return new EitherRule(rules)
}


/**
 * Tries to match the rule as many times as it can, returning an array of the results
 * once it cannot anymore.
 */
export function Repeat<R extends Rule<any, any>>(rule: R, opts?: { min?: number, max?: number, times?: number }): Rule<Result<R>[], ContextOf<R>> {
  return new RepeatRule(rule, opts?.min, opts?.max, opts?.times)
}


/**
 * Matches if the provided `rule` matches. If it does not, still match but returns `undefined`.
 */
export function Opt<R extends Rule<any, any>>(rule: R): Rule<Result<R> | undefined, ContextOf<R>> {
  return new OptRule(rule)
}


/**
 * Matches only if the provided `rule` does not match.
 */
export function Not<R extends Rule<any, any>>(rule: R): Rule<null, ContextOf<R>> {
  return new NotRule(rule)
}


/**
 * Matches any token, even tokens that can be skipped
 */
export class AnyRule<C extends Context> extends Rule<Token, C> {

  parse(ctx: C, pos: number) {
    var tok: Token | undefined = ctx.input[pos]
    return tok ? Res(tok, pos + 1) : Res(NoMatch, pos)
  }
}

export function Any<C extends Context>(): AnyRule<C> {
  return new AnyRule()
}


export class AnyTokenButRule<C extends Context> extends AnyRule<C> {
  constructor(public tk: Rule<any, C>, public include_skip?: boolean) {
    super()
  }

  parse(ctx: C, pos: number): any {
    var tk: Token | undefined
    var looking_for = this.tk
    const input = ctx.input
    if (!this.include_skip) {
      while ((tk = input[pos], tk && tk.is_skip)) { pos++ }
    } else {
      tk = input[pos]
    }

    if (looking_for.parse(ctx, pos).isNoMatch()) return Res(tk, pos + 1)
    // if (!tk || tk.def === looking_for) return Res(NoMatch, pos)
    return Res(NoMatch, pos)
  }
}

export function AnyTokenBut<C extends Context>(t: Rule<any, C>, include_skip?: boolean) {
  return new AnyTokenButRule(t, include_skip)
}


/**
 * Matches any token that is not a skippable token.
 */
export const AnyNoSkip = new class AnyNoSkipRule extends TokenDef<Context> {

  constructor() { super('!any!', false) }

  parse(ctx: Context, pos: number) {
    var tok: Token | undefined
    const input = ctx.input
    while ((tok = input[pos], tok.is_skip)) { pos++ }
    return tok ? Res(tok, pos + 1) : Res(NoMatch, pos)
  }
}


/**
 * Matches the end of the input. Will skip skippable tokens.
 */
class EOF extends Rule<null, Context> {

  parse(ctx: Context, pos: number) {
    var tk: Token | undefined
    var input = ctx.input
    while ((tk = input[pos], tk && tk.is_skip)) { pos++ }
    if (tk == undefined) return Res(null, pos)
    return Res(NoMatch, pos)
  }
}

export function Eof<C extends Context>() {
  return new EOF
}

/**
 * Acts as a "forward declaration" for the rule. This is particularly useful in recursive grammars.
 *
 *
 * ```typescript
 * // The following example does not really compile as is, but it is just to give the gist of the idea.
 * Terminal = Either(
 *   NUMBER,
 *   // It would be an error to give Expression without forward here since it is not yet defined.
 *   Seq(LPAREN, Forward(() => Expression), RPAREN),
 * )
 *
 * Expression = SeparatedBy(PLUS, Terminal)
 * ```
 */
export function Forward<R extends Rule<any, any>>(rulefn: () => R): Rule<Result<R>, ContextOf<R>> {
  return new ForwardRule(rulefn)
}


/**
 * Does like `Repeat`, but where the rules are separated by another defined by `sep`.
 *
 * The separator may appear before the start of the sequence if `opts.leading` is `true`, and
 * after the last matched rule if `opts.trailing` is `true`.
 */
export function SeparatedBy<R extends Rule<any, any>>(sep: Rule<any, ContextOf<R>>, rule: R, opts?: {trailing?: boolean, leading?: boolean}): Rule<Result<R>[], ContextOf<R>> {
  return new SeparatedByRule(sep, rule, opts)
}


/**
 * Parse an expression with operators which have a precedence.
 * Internally, the method used is the "Top Down Operator Precedence" method of parsing, although
 * instead of tokens that have `nud` and `led` methods, we use the rules' results.
 * This method is usually quite faster than the recursive approach ; the simple `calc.ts` example sees
 * a parse speed gain of around 50%.
 *
 * The argument is the terminal expression. You can then chain the result with
 * `.Prefix` for prefix operators, `.Suffix` for suffixes, `.Binary` for binary
 * operators and `.BinaryRight` for binary operators that are right associative.
 *
 * All these methods take a rule as the operator and a callback that will run
 * on the result. The callback return type must be the same as the terminal expression.
 *
 * Use `.down` to lower the precedence level.
 *
 * ```typescript
 * ```
 */
export function TdopOperator<R extends Rule<any, any>>(terminal: R) {
  return new TdopOperatorRule(terminal)
}


/**
 * Does the same as `TdopOperator`, except using the recursive approach traditionally
 * found in BNF grammar definitions, where each predecence level calls the next one as
 * its operands.
 */
export function RecOperator<R extends Rule<any, any>>(terminal: R): RecOperatorRule<Result<R>, ContextOf<R>> {
  return new RecOperatorRule(terminal)
}


import { RegExpParser, RegExpNode, CharacterValues } from './regexp'
const reg_parser = new RegExpParser()