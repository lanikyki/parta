// Безопасный разбор выражений для графиков: «y = x^2 - 4», «2sin(x)», «|x| - 1», «sqrt(x+4)».
type Node = (x: number) => number;
type Tok = { t: 'num'; v: number } | { t: 'x' } | { t: 'fn'; v: string } | { t: 'op'; v: string };

const FN: Record<string, (a: number) => number> = {
  arcsin: Math.asin,
  arccos: Math.acos,
  arctg: Math.atan,
  arctan: Math.atan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  tg: Math.tan,
  ctg: (a) => 1 / Math.tan(a),
  cot: (a) => 1 / Math.tan(a),
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  lg: Math.log10,
  log: Math.log10,
  sign: Math.sign,
};
const FN_NAMES = Object.keys(FN).sort((a, b) => b.length - a.length);

function tokenize(input: string): Tok[] {
  const src = input
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^(y|f\(x\))=/, '')
    .replace(/,/g, '.')
    .replace(/[−–]/g, '-')
    .replace(/[·×]/g, '*')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√/g, 'sqrt')
    .replace(/π/g, 'pi');
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (Number.isNaN(v)) throw new Error('Неверное число');
      out.push({ t: 'num', v });
      i = j;
    } else if (/[a-z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-z]/.test(src[j])) j++;
      let w = src.slice(i, j);
      while (w) {
        const f = FN_NAMES.find((k) => w.startsWith(k));
        if (f) {
          out.push({ t: 'fn', v: f });
          w = w.slice(f.length);
        } else if (w.startsWith('pi')) {
          out.push({ t: 'num', v: Math.PI });
          w = w.slice(2);
        } else if (w[0] === 'e') {
          out.push({ t: 'num', v: Math.E });
          w = w.slice(1);
        } else if (w[0] === 'x') {
          out.push({ t: 'x' });
          w = w.slice(1);
        } else throw new Error(`Не понимаю «${w}»`);
      }
      i = j;
    } else if ('+-*/^()|'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else throw new Error(`Лишний символ «${c}»`);
  }
  // Неявное умножение: 2x, 3(x+1), x(x-1), (x+1)(x-1), 2sin(x)
  const res: Tok[] = [];
  for (const tok of out) {
    const prev = res[res.length - 1];
    const prevEnds = prev && (prev.t === 'num' || prev.t === 'x' || (prev.t === 'op' && prev.v === ')'));
    const curStarts = tok.t === 'num' || tok.t === 'x' || tok.t === 'fn' || (tok.t === 'op' && tok.v === '(');
    if (prevEnds && curStarts) res.push({ t: 'op', v: '*' });
    res.push(tok);
  }
  return res;
}

export function compile(input: string): Node {
  const toks = tokenize(input);
  if (!toks.length) throw new Error('Пустое выражение');
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => {
    const t = peek();
    return t && t.t === 'op' && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Ожидалось «${v}»`);
    pos++;
  };

  const expr = (): Node => {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = (toks[pos++] as { v: string }).v;
      const a = left;
      const b = term();
      left = op === '+' ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
    }
    return left;
  };
  const term = (): Node => {
    let left = unary();
    while (isOp('*') || isOp('/')) {
      const op = (toks[pos++] as { v: string }).v;
      const a = left;
      const b = unary();
      left = op === '*' ? (x) => a(x) * b(x) : (x) => a(x) / b(x);
    }
    return left;
  };
  const unary = (): Node => {
    if (isOp('-')) {
      pos++;
      const a = unary();
      return (x) => -a(x);
    }
    if (isOp('+')) {
      pos++;
      return unary();
    }
    return power();
  };
  const power = (): Node => {
    const base = atom();
    if (isOp('^')) {
      pos++;
      const ex = unary();
      return (x) => Math.pow(base(x), ex(x));
    }
    return base;
  };
  const atom = (): Node => {
    const t = peek();
    if (!t) throw new Error('Выражение оборвалось');
    pos++;
    if (t.t === 'num') return () => t.v;
    if (t.t === 'x') return (x) => x;
    if (t.t === 'fn') {
      const f = FN[t.v];
      const arg = isOp('(') ? atom() : power();
      return (x) => f(arg(x));
    }
    if (t.v === '(') {
      const e = expr();
      expect(')');
      return e;
    }
    if (t.v === '|') {
      const e = expr();
      expect('|');
      return (x) => Math.abs(e(x));
    }
    throw new Error(`Неожиданный «${t.v}»`);
  };

  const fn = expr();
  if (pos < toks.length) throw new Error('Лишние символы в конце');
  return fn;
}

export function tryCompile(input: string): { fn?: Node; error?: string } {
  try {
    const fn = compile(input);
    fn(1.2345);
    return { fn };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
