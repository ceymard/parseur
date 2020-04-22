import { Parseur, Seq, Opt, Either, Repeat, Forward, Rule, SeparatedBy, Context, Any, AnyTokenBut, Not } from './index'

export interface Union {
  type: 'union'
  sequences: (Sequence | Atom)[]
}

export interface Sequence {
  type: 'sequence'
  atoms: Atom[]
}

export interface Quantifier {
  at_least?: number
  at_most?: number
  greedy?: boolean
}

export interface AtomBase {
  quantifier?: Quantifier
}

export interface Group extends AtomBase {
  type: 'group'
  value: RegExpNode
  modifier?: 'look-ahead' | 'negative-lookahead' | 'anonymous'
  index?: number
  name?: string
}

export interface CharacterValues extends AtomBase {
  type: 'chars'
  values: Set<number>
  complement?: boolean
}

export interface NameReference extends AtomBase {
  type: 'name-reference'
  name: string
}

export interface BackReference extends AtomBase {
  type: 'back-reference'
  index: number
}

export type Atom = Group | BackReference | NameReference | CharacterValues

export type RegExpNode = Union | Atom | Sequence

export class RegExpContext extends Context {
  group_count = 0
  ignore_case = false
}

function O<T>(a: T): T { return a }

function cc(s: string) { return s.charCodeAt(0) }
function ccrange(ss: string, se: string) {
  var s = ss.charCodeAt(0)
  var e = se.charCodeAt(0)
  if (e < s) throw new Error(`...`)
  var res = new Array<number>(e - s)
  for (var i = 0; i <= e - s; i++)
    res[i] = s + i
  return res
}

function single_char(s: string): CharacterValues {
  return {
    type: 'chars',
    values: new Set([cc(s)])
  }
}

var P: RegExpParser['P']
type R<T> = Rule<T, RegExpContext>
export class RegExpParser extends Parseur<RegExpContext> {

  // Thank you MDN for these.
  static dot = [cc('\n'), cc('\r'), cc('\u2028'), cc('\u2029')] // this has to be exclusive, not inclusive.
  static d = ccrange('0', '9')
  static s = ' \f\n\r\t\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'.split('').map(v => cc(v))
  static w = [cc('_'), ...ccrange('a', 'z'), ...ccrange('A', 'Z'), ...RegExpParser.d]

  // @ts-ignore
  private _____ = P = this.P

  derive_string_tokens_from_regexps = false

  // Gobble anything that was not defined in our strings
  NUM = this.token(/\d+/, false)
  ANY = this.token(/[^]/, false)

  Quantifier: R<Quantifier> = Seq(
    { quanti: Either(
      P`*`.then(r => O<Quantifier>({ at_least: 0 })),
      P`+`.then(r => O<Quantifier>({ at_least: 1 })),
      P`?`.then(r => O<Quantifier>({ at_least: 0, at_most: 1 })),
      Seq(
        P`{`,
        { at_least: Opt(this.NUM.then(n => parseInt(n.str))) },
        Opt(P`,`),
        { at_most: Opt(this.NUM.then(n => parseInt(n.str))) },
        P`}`
      ).then(r => O<Quantifier>({ at_least: r.at_least, at_most: r.at_most }))
    ) },
    { not_greedy: Opt(P`?`) }
  ).then(r => {
    if (r.not_greedy)
      r.quanti.greedy = false
    return r.quanti
  })

  Escape = P`\\ ${this.Any}`.then((r): CharacterValues | BackReference => {
    var s = r.str
    if (s === 'w' || s === 'd' || s === 's')
      return { type: 'chars', values: new Set(RegExpParser[s]) }
    if (s === 'W' || s === 'D' || s === 'S')
      return { type: 'chars', values: new Set((RegExpParser as any)[s.toLowerCase()]), complement: true }
    if (s === 'n')
      return single_char('\n')
    if (s === 't')
      return single_char('\t')
    if (s === 'v')
      return single_char('\v')
    if (s === 'r')
      return single_char('\r')

    if (r.def === this.NUM)
      return { type: 'back-reference', index: parseInt(s) }
    return single_char(s)
    // throw new Error('not implemented: ' + r.str)
  })

  NameGroupReference = P`\\ k < ${Repeat(AnyTokenBut(P`>`)).then(r => r.map(tk => tk.str).join(''))} >`
    .then<NameReference>(r => {
      return { type: 'name-reference', name: r }
    })

  CharacterRange = Seq(
    { s: this.ANY }, P`-`, { e: this.ANY }
  ).then<CharacterValues>(r => { return { type: 'chars', values: new Set(ccrange(r.s.str, r.e.str)) }})

  CharacterClass = Seq(
    P`[`,
      { chars: Repeat(Either(
        this.Escape,
        this.CharacterRange,
        AnyTokenBut(P`]`).then<CharacterValues>(e => {
          return { type: 'chars', values: new Set([cc(e.str)]) }
        })
      )) },
    P`]`
  ).then<CharacterValues>(r => {
    return {
      type: 'chars',
      values: r.chars.reduce((acc, item) => {
        for (var e of item.values) acc.add(e)
        return acc
      }, new Set<number>())
    }
  })

  Group: R<Group> = Seq(
    P`(`,
      { mod: Opt(Either(
        Seq(P`?`, P`!`).then(r => 'negative-lookahead' as const),
        Seq(P`?`, P`=`).then(r => 'look-ahead' as const),
        Seq(P`?`, P`:`).then(r => 'anonymous' as const),
        Seq(P`?`, P`<`, { name: Repeat(AnyTokenBut(P`>`)) }, P`>`).then(r => { return { group: r.name.map(t => t.str).join('') } })
      )) }, // FIXME named groups !
      { seq: Forward(() => this.Union) },
    P`)`,
  ).then((r, ctx) => {
    var res: Group = {
      type: 'group',
      value: r.seq
    }
    if (typeof r.mod === 'string')
      res.modifier = r.mod
    else if (r.mod)
      res.name = r.mod.group

    if (r.mod == undefined) {
      res.index = ++ctx.group_count
    }
    return res
  })

  Atom: R<Atom> = Seq(
    { atom: Either(
      this.Group,
      this.CharacterClass,
      this.NameGroupReference,
      this.Escape,
      Seq(Not(Either(P`)`, P`|`)), { res: Any() }).then<CharacterValues>((a, ctx) => {
        return a.res.str === '.' ? { type: 'chars', values: new Set(RegExpParser.dot), complement: true }
          :
            {
              type: 'chars',
              values: new Set(a.res.str.split('').map(s => cc(s)))
            }
      }),
    ) },
    { quanti: Opt(this.Quantifier) }
  ).then(r => {
    var atom = r.atom
    if (r.quanti) {
      atom.quantifier = r.quanti
    }
    return atom
  })

  Sequence: R<Sequence | Atom> = Repeat(this.Atom).then(r => r.length === 1 ? r[0] : {
    type: 'sequence',
    atoms: r
  })

  Union: R<Union | Sequence | Atom> = SeparatedBy(P`|`, this.Sequence).then(r => r.length === 1 ? r[0] as Sequence | Atom : {
    type: 'union',
    sequences: r
  })

  // TopLevel = Seq({ res: this.Union }, Eof<RegExpContext>())
  TopLevel = Seq({ res: this.Union }, this.Eof)

  parse(reg: RegExp) {
    var tks = this.tokenize(reg.source)!
    var ctx = new RegExpContext(tks)
    ctx.ignore_case = reg.ignoreCase
    return this.TopLevel.parse(ctx)
  }
}
