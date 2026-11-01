import katex from 'katex';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;

function tex(src: string, display: boolean) {
  try {
    return katex.renderToString(src, { throwOnError: false, displayMode: display, output: 'html', strict: 'ignore' });
  } catch {
    return escapeHtml(src);
  }
}

/** Текст с формулами между $...$ → безопасный HTML (для доски). */
export function renderMathText(text: string) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(MATH)) {
    out += escapeHtml(text.slice(last, m.index)).replace(/\n/g, '<br>');
    const block = m[1] ?? m[2];
    out += block != null ? tex(block, true) : tex((m[3] ?? m[4])!, false);
    last = m.index! + m[0].length;
  }
  return out + escapeHtml(text.slice(last)).replace(/\n/g, '<br>');
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Ссылки http(s) в уже экранированном тексте → кликабельные (открываются в новой вкладке). */
function linkify(t: string) {
  return t.replace(/\bhttps?:\/\/[^\s<`\u0000]+/g, (url) => {
    const tail = url.match(/(?:[.,;:!?)\]]|&quot;|&#39;)+$/)?.[0] ?? '';
    const href = tail ? url.slice(0, -tail.length) : url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>${tail}`;
  });
}

/** Небольшой Markdown (заголовки, списки, таблицы, цитаты, жирный, код) + формулы → безопасный HTML. */
export function renderMarkdown(src: string) {
  const math: string[] = [];
  const code: string[] = [];
  let s = src.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, c: string) => {
    code.push(`<pre><code>${escapeHtml(c.trimEnd())}</code></pre>`);
    return `\u0000C${code.length - 1}\u0000`;
  });
  s = s.replace(MATH, (_all, d1?: string, d2?: string, i1?: string, i2?: string) => {
    const block = d1 ?? d2;
    math.push(block != null ? `<div class="math-block">${tex(block, true)}</div>` : tex((i1 ?? i2)!, false));
    return `\u0000M${math.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  const inline = (t: string) =>
    linkify(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');

  let html = '';
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (para.length) html += `<p>${inline(para.join('<br>'))}</p>`;
    para = [];
    if (quote.length) html += `<blockquote>${inline(quote.join('<br>'))}</blockquote>`;
    quote = [];
  };
  const close = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  const lines = s.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      flush();
      close();
    } else if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      // Таблица в стиле GitHub: | a | b | + строка-разделитель |---|---|
      flush();
      close();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      const cell = (tag: 'th' | 'td', c: string, j: number) => `<${tag}${align[j] ? ` style="text-align:${align[j]}"` : ''}>${inline(c)}</${tag}>`;
      let t = `<div class="table-wrap"><table><thead><tr>${head.map((c, j) => cell('th', c, j)).join('')}</tr></thead><tbody>`;
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const row = splitRow(lines[i]);
        t += `<tr>${head.map((_, j) => cell('td', row[j] ?? '', j)).join('')}</tr>`;
        i++;
      }
      i--;
      html += t + '</tbody></table></div>';
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      close();
      html += `<h4>${inline(m[2])}</h4>`;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      close();
      html += '<hr>';
    } else if ((m = line.match(/^\s*&gt;\s?(.*)$/))) {
      close();
      if (para.length) {
        html += `<p>${inline(para.join('<br>'))}</p>`;
        para = [];
      }
      quote.push(m[1]);
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flush();
      if (list !== 'ul') {
        close();
        html += '<ul>';
        list = 'ul';
      }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
      flush();
      if (list !== 'ol') {
        close();
        html += '<ol>';
        list = 'ol';
      }
      html += `<li>${inline(m[2])}</li>`;
    } else {
      close();
      if (quote.length) flush();
      para.push(line);
    }
  }
  flush();
  close();
  return html
    .replace(/\u0000M(\d+)\u0000/g, (_, n: string) => math[+n])
    .replace(/\u0000C(\d+)\u0000/g, (_, n: string) => code[+n]);
}
