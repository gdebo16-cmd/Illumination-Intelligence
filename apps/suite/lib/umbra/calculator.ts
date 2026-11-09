// lib/umbra/calculator.ts — exact math for bots, without running any code they send.
//
// Supports: numbers, + - * / % ^ (power), parentheses, and
// sqrt abs round floor ceil ln log sin cos tan, and the constants pi and e.
// Example: "sqrt(2) * (3 + 4)^2 / 5"

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export function calculate(expression: string): number {
  const src = expression.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').toLowerCase();
  if (!src) throw new Error('Empty expression');
  if (src.length > 500) throw new Error('Expression too long');
  let pos = 0;

  const peek = () => src[pos];
  const take = (ch: string) => {
    if (src[pos] === ch) {
      pos++;
      return true;
    }
    return false;
  };

  // expression := term (('+' | '-') term)*
  function expr(): number {
    let value = term();
    for (;;) {
      if (take('+')) value += term();
      else if (take('-')) value -= term();
      else return value;
    }
  }
  // term := unary (('*' | '/' | '%') unary)*
  function term(): number {
    let value = unary();
    for (;;) {
      if (take('*')) value *= unary();
      else if (take('/')) value /= unary();
      else if (take('%')) value %= unary();
      else return value;
    }
  }
  // unary := ('-' | '+') unary | power      (so -3^2 = -(3^2) = -9, as in math)
  function unary(): number {
    if (take('-')) return -unary();
    if (take('+')) return unary();
    return power();
  }
  // power := atom ('^' unary)?   (right-associative: 2^3^2 = 2^9; 2^-1 = 0.5)
  function power(): number {
    const base = atom();
    return take('^') ? base ** unary() : base;
  }
  // atom := number | name '(' expr ')' | constant | '(' expr ')'
  function atom(): number {
    if (take('(')) {
      const value = expr();
      if (!take(')')) throw new Error('Missing )');
      return value;
    }
    const number = /^\d+(\.\d+)?(e[+-]?\d+)?|^\.\d+/.exec(src.slice(pos));
    if (number) {
      pos += number[0].length;
      return parseFloat(number[0]);
    }
    const name = /^[a-z]+/.exec(src.slice(pos));
    if (name) {
      pos += name[0].length;
      if (name[0] in CONSTANTS) return CONSTANTS[name[0]];
      const fn = FUNCTIONS[name[0]];
      if (!fn) throw new Error(`Unknown name "${name[0]}"`);
      if (!take('(')) throw new Error(`${name[0]} needs parentheses`);
      const value = expr();
      if (!take(')')) throw new Error('Missing )');
      return fn(value);
    }
    throw new Error(peek() ? `Unexpected "${peek()}"` : 'Expression ended early');
  }

  const result = expr();
  if (pos < src.length) throw new Error(`Unexpected "${src[pos]}"`);
  if (!Number.isFinite(result)) throw new Error('The result is not a finite number');
  return result;
}
