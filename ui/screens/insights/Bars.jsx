// Column chart in plain HTML/CSS so text never stretches. data: [{ label, sub?, value, title, hot?, note?, href? }].
// Every bar shows its count above and its label below; `note` is a second quiet line under the label (an average, say).
// A bar with an `href` is a link to the films it stands for (only when it has any).
export default function Bars({ data, height = 120, unit = 'films' }) {
  const max = Math.max(1, ...data.map(d => d.value));
  const notes = data.some(d => d.note);
  const linked = data.some(d => d.href && d.value); // bars that are links stay reachable: a group, not one picture
  return (
    <div class="ins-bars" style={{ '--n': data.length }} role={linked ? 'group' : 'img'} aria-label={data.map(d => `${d.label}: ${d.value}`).join(', ')}>
      {data.map((d, i) => {
        const Tag = d.href && d.value ? 'a' : 'div';
        return (
        <Tag class={'ins-bar' + (d.hot ? ' hot' : '')} key={i} style={{ '--i': i }} title={d.title || `${d.label}: ${d.value} ${unit}`} href={Tag === 'a' ? d.href : undefined} aria-label={Tag === 'a' ? d.title || `${d.label}: ${d.value} ${unit}` : undefined}>
          <span class="ins-bar-n num">{d.value}</span>
          <div class="ins-bar-track" style={{ height }}>
            <i class={d.hot ? 'hot' : ''} style={{ height: d.value ? Math.max(3, (d.value / max) * 100) + '%' : '0' }} />
          </div>
          <span class="ins-bar-l">{d.label}</span>
          {notes ? <span class="ins-bar-s faint num">{d.note || '\u00a0'}</span> : <span class="ins-bar-s faint">{d.sub || '\u00a0'}</span>}
        </Tag>
        );
      })}
    </div>
  );
}
