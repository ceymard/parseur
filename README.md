# Parseur, easy, fast and small typescript parsing

Parseur is a tiny (1.7k uglified + gziped) parsing library meant to be used with Typescript.

It is fairly fast, and was designed so that writing grammars would be concise and neatly typed.

It functions by *combining* parsers and executing them on an array of tokens.

# Basic parsers

```typescript
Seq(silent_rule1, { named: rule2, other: rule3 }, ...)
  // A sequence of rules.
  // Unless put in objects, rules matched are not part of the result, which
  // is an object.

Either(rule1, rule2, ...)
  // Returns the first match

Repeat(rule) /* or */ rule.Repeat
  // Repeat a rule zero or more times, like *

OneOrMore(rule) /* or */ rule.OneOrMore
  // Repeat a rule one or more times, like +

SeparatedBy(rule, sep) /* or */ rule.SeparatedBy(sep)
  // A Helper to repeat a rule one or more times with each match separated
  // by a separator.

Opt(rule)
  // Match a rule and return its result if found or return `null` if not.

Not(rule)
  // Negative look-ahead
```