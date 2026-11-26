import type { ReactNode } from 'react';

// The little markdown the developers' documentation is written in (docs/simulator.md, #355), as the app's own
// elements: headings (## with an id, for links), paragraphs, lists, tables, fenced code, and in a line `code` and
// **bold**. Nothing else is read: no HTML, no links, no images (the text is ours, and stays text).
const slug = (s: string) => s.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function inline(s: string): ReactNode[] {
  return s.split(/(`[^`]+`|\*\*[^*]+\*\*)/).filter(Boolean).map((t, i) =>
    t.startsWith('`') ? <code key={i} className="rounded bg-white/8 px-1 py-0.5 font-mono text-[0.9em] text-foreground">{t.slice(1, -1)}</code>
      : t.startsWith('**') ? <strong key={i} className="font-semibold text-foreground">{t.slice(2, -2)}</strong> : t);
}
const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());

export function Markdown({ text, skipTitle = false }: { text: string; skipTitle?: boolean }) {
  const L = text.replace(/\r/g, '').split('\n'), out: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < L.length) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) {
      const body: string[] = [];
      for (i++; i < L.length && !L[i].startsWith('```'); i++) body.push(L[i]);
      i++;
      out.push(<pre key={k++} tabIndex={0} className="panel my-5 overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const h = l.match(/^(#{1,3}) (.*)$/);
    if (h) {
      i++;
      if (h[1] === '#') { if (!skipTitle) out.push(<h1 key={k++} className="display text-4xl text-balance sm:text-6xl">{inline(h[2])}</h1>); }
      else if (h[1] === '##') out.push(<h2 key={k++} id={slug(h[2])} className="display mt-20 scroll-mt-24 text-3xl text-balance sm:text-5xl">{inline(h[2].replace(/^\d+\.\s*/, ''))}</h2>);
      else out.push(<h3 key={k++} id={slug(h[2])} className="heading mt-12 scroll-mt-24 text-xl sm:text-2xl">{inline(h[2])}</h3>);
      continue;
    }
    if (l.startsWith('|') && /^\|[\s:|-]+\|$/.test(L[i + 1] || '')) {
      const head = cells(l), rows: string[][] = [];
      for (i += 2; i < L.length && L[i].startsWith('|'); i++) rows.push(cells(L[i]));
      out.push(
        <div key={k++} className="panel my-5 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <thead><tr>{head.map((c, j) => <th key={j} scope="col" className="border-b border-white/10 px-4 py-2.5 font-medium text-muted-foreground">{inline(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, a) => <tr key={a} className="border-b border-white/6 last:border-0">{r.map((c, j) => <td key={j} className={`px-4 py-2.5 align-top ${j ? 'text-muted-foreground' : 'whitespace-nowrap'}`}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>);
      continue;
    }
    const li = /^(-|\d+\.) /;
    if (li.test(l)) {
      const ordered = /^\d/.test(l), items: string[] = [];
      for (; i < L.length && (li.test(L[i]) || (/^ {2,}\S/.test(L[i]) && items.length)); i++) { if (li.test(L[i])) items.push(L[i].replace(li, '')); else items[items.length - 1] += ' ' + L[i].trim(); }
      const cls = `my-4 max-w-3xl space-y-2 pl-5 text-pretty text-muted-foreground ${ordered ? 'list-decimal' : 'list-disc'}`;
      out.push(ordered ? <ol key={k++} className={cls}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol> : <ul key={k++} className={cls}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
      continue;
    }
    const para: string[] = [];
    for (; i < L.length && L[i].trim() && !/^(#{1,3} |```|\||(-|\d+\.) )/.test(L[i]); i++) para.push(L[i].trim());
    out.push(<p key={k++} className="my-4 max-w-3xl text-pretty text-muted-foreground">{inline(para.join(' '))}</p>);
  }
  return <>{out}</>;
}
