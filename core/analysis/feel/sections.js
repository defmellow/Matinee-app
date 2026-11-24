// Sorts a film's candidate "about" items into the rows the film page shows (design: docs/feel-section-guidelines.md). Pure.
//   subjects — specific topics the film deals with (Suicide, Vigilante, Time travel)
//   kind     — what sort of film: genre, form, source, art style (Neo-noir, Black-and-white, Based on a novel)
//   eras     — when it is set (1970s, 19th century): shown with the places under "Set in"
//   dropped  — metadata and noise, never shown (After-credits stinger, Woman director, controversies, mood adjectives)
// A theme the Themes row already shows, or a place the Set in row already shows, is dropped as a repeat.

const METADATA = /(^(fiction|works|films?) about |credits?\s?stinger|stinger|woman director|female director|male director|sequel|prequel|remake|reboot|franchise|spin.?off|controvers|termination of employment|rating|cult film|film series|female protagonist|male protagonist|villain|anti.?hero|ensemble cast|nonlinear timeline|flashback|montage|dream sequence|sequence$|fandom|television series|tv series|flash.forward|voice.?over|narrat(or|ion)$|title spoken|character name in title|breaking the fourth wall|fourth wall|plot twist|twist ending|based on a true|surprise ending|open ending|ambiguous ending)/i;
// Single-word feelings and judgements that TMDB/IMDb keyword lists mix in with real keywords (Bold, Amused, Complex). They describe the viewer or the quality, not the film's subject.
const JUDGEMENT = new Set(['bold', 'amused', 'admiring', 'audacious', 'complex', 'compassionate', 'ambiguous', 'dramatic', 'excited', 'cautionary', 'callous', 'antagonistic', 'sincere', 'mean spirited', 'playful', 'blunt', 'frightened', 'inspirational', 'suspenseful', 'tense', 'witty', 'sympathetic', 'enthusiastic', 'melodramatic', 'candid', 'disappointed', 'dark', 'cynical', 'defiant', 'romantic', 'sad', 'angry', 'hopeful', 'serious', 'gloomy', 'confused', 'earnest', 'intense', 'whimsical', 'sardonic', 'bleak', 'hilarious', 'critical', 'cruel', 'comic', 'comical', 'harsh', 'powerful', 'stylized', 'stylised', 'gentle', 'melancholy', 'nostalgic', 'unflinching', 'offbeat', 'quirky', 'suspicious', 'vengeful', 'joyful', 'lighthearted', 'reflective', 'rebellious', 'scary', 'shocking', 'sympathetic', 'tragic', 'wry', 'anxious', 'arrogant', 'aggressive', 'ironic', 'celebratory', 'empathetic', 'wistful', 'sentimental', 'subversive', 'grim', 'passionate', 'awestruck', 'indignant', 'horrified', 'ominous', 'sarcastic', 'exhilarated', 'harrowing', 'adoring', 'skeptical', 'sceptical', 'didactic', 'realistic', 'inspiring story', 'inspiring', 'thoughtful', 'bewildered', 'humorous', 'outraged', 'apprehensive', 'gritty', 'ruminative', 'vindictive', 'dreamlike', 'macabre', 'morose', 'detached', 'anguished', 'mischievous', 'grotesque', 'scathing', 'contemplative', 'pessimistic', 'poignant', 'solemn', 'zealous', 'jubilant', 'exuberant',
  // 12 Nov, on a real library: more viewer moods and verdicts that keyword lists carry (Cheerful was a "subject" of 10 films, Complicated of 12).
  'complicated', 'cheerful', 'questioning', 'baffled', 'assertive', 'curious', 'factual', 'disheartening', 'incredulous', 'appreciative', 'informative', 'ambivalent', 'loving', 'pretentious',
  'speculative', 'dignified', 'embarrassed', 'ridiculous', 'disgusted', 'urgent', 'subjective', 'malicious', 'imaginative', 'apathetic', 'forceful', 'frustrated', 'unassuming', 'clinical', 'doubtful',
  'nervous', 'apologetic', 'domineering', 'dubious', 'light-hearted', 'disapproving', 'disgusting', 'derogatory', 'derisive', 'schocking', 'mind-blowing', 'instructive', 'vexed', 'conceited', 'relaxed',
  'indifferent', 'demeaning', 'high octane', 'unexplained', 'unprecedented', 'reminiscent', 'breathless']);
const ERA = /^(\d{4}s|\d{1,2}(st|nd|rd|th) century|early modern|middle ages|ancient (rome|greece|egypt))$/i;
// Forms and genres. A label from a genre/style list is a kind of film; so are these words wherever they come from.
const KIND = /(animation|animated|black.and.white|documentary|silent|biograph|period (drama|piece)|noir|thriller|comedy|horror|drama\b|western|musical|anime|manga|mockumentary|based on|true story|actual events|semi.autobiograph|adaptation|avant.garde|experimental|epic$|satir|science fiction|sci.fi|fantasy|romance$|road movie|monster movie|superhero|slasher|heist|gangster|swashbuckl|kung fu|martial arts|cyberpunk|steampunk|space opera|sword.and|found footage|coming.of.age (drama|comedy)|new hollywood|new wave|neo.|b.movie|film noir|short film|stop.motion|live.action|anthology|feminist$|existentialist$|apocalyptic$|dystopian$|magical realism|southern gothic|gothic$|surreal$|arthouse|art house|cult$|parody|spoof|exploitation$|erotic|blaxploitation|giallo|pre.code|war film|disaster film|buddy|road trip film)/i;

const STYLE_WORD = /(film|movie|drama|comedy|thriller|horror|fantasy|romance|western|noir|animation|epic|adventure|musical|action|mystery|crime|documentary|erotic|fiction|opera|punk|satire|sci.?fi|black.and.white|realism|gothic|experimental|avant|existentialist|feminist|dystopi|apocalyptic|melodrama|farce|slapstick|biograph|historical|period|war$|sports?$|teen|children|family|spy|superhero|disaster)/i;
/** "Mother son relationship", "Mother–son relationships" and "Mother-son relationship" are one thing. */
const sameThing = l => norm(String(l).replace(/\(.*?\)/g, '').replace(/relationships?/i, '').replace(/ies\b/i, 'y')).replace(/s$/, '');

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * @param themes profile.themes in engine order
 * @param themeChips labels the Themes row shows, so they are not repeated
 * @param placeLabels labels the Set in row shows
 * @returns { subjects, kind, eras, dropped }, each an array of the original theme objects
 */
export function sectionsOf(themes = [], themeChips = [], placeLabels = [], feelingLabels = []) {
  const shown = new Set([...themeChips, ...feelingLabels].map(norm));
  // A theme chip is a phrase ("Revenge and retribution"): a subject made only of its words ("Revenge") says the same thing.
  const wordsOf = l => new Set(String(l).toLowerCase().replace(/\(.*?\)/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2).map(w => w.replace(/(ies|s)$/, '')));
  const chipWords = [...themeChips, ...feelingLabels].map(wordsOf);
  const insideChip = label => { const w = wordsOf(label); return w.size > 0 && chipWords.some(c => c.size > w.size && [...w].every(x => c.has(x))); };
  const places = placeLabels.map(norm).filter(p => p.length > 3);
  const out = { subjects: [], kind: [], eras: [], dropped: [] };
  for (const t of themes) {
    if (t.dup) { out.dropped.push(t); continue; }
    const label = String(t.label || '').trim();
    const n = norm(label);
    const src = t.sources || [];
    if (METADATA.test(label) || JUDGEMENT.has(label.toLowerCase())) { out.dropped.push(t); continue; }
    if (shown.has(n) || insideChip(label)) { out.dropped.push(t); continue; }
    if (ERA.test(label)) { out.eras.push(t); continue; }
    if (places.some(p => n === p || n.includes(p))) { out.dropped.push(t); continue; }
    // Category styles and source-material lines are kinds of film. The same word from a keyword list (Vigilante, Vampire) is a subject unless it is plainly a form.
    // A franchise or title that came in as a source note (Barbie, Kiki's Delivery Service) is not a kind of film; only "Based on …" lines are.
    if ((t.kind === 'adaptation' || src.includes('adaptation')) && !/^based on|adaptation/i.test(label)) { out.dropped.push(t); continue; }
    const fromSource = t.kind === 'adaptation' || src.includes('adaptation');
    const fromStyle = (t.kind === 'style' || src.includes('style')) && !src.includes('keyword') && STYLE_WORD.test(label);
    if (fromSource || fromStyle || KIND.test(label)) { out.kind.push(t); continue; }
    out.subjects.push(t);
  }
  // The same subject listed twice by different sources (Mother–son relationships / Mother son relationship / Cat / Cats) shows once.
  const seen = new Set();
  out.subjects = out.subjects.filter(t => { const k = sameThing(t.label); if (seen.has(k)) { out.dropped.push(t); return false; } seen.add(k); return true; });
  // "Twins" next to "Twin brothers", "Vampire" next to "Vampire hunter": the more specific one stays.
  const words = l => new Set(String(l).toLowerCase().replace(/\(.*?\)/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2).map(w => w.replace(/(ies|s)$/, '')));
  const subjectWords = out.subjects.map(t => words(t.label));
  out.subjects = out.subjects.filter((t, i) => {
    const mine = subjectWords[i];
    const coveredBy = subjectWords.some((other, j) => j !== i && other.size > mine.size && [...mine].every(w => [...other].some(o => o === w || o.startsWith(w) || w.startsWith(o))));
    if (coveredBy) { out.dropped.push(t); return false; }
    return true;
  });
  const years = [...out.eras.map(e => e.label), ...placeLabels].map(l => /^\d{4}$/.test(String(l).trim()) ? String(l).trim().slice(0, 3) : null).filter(Boolean);
  out.eras = out.eras.filter(e => !/^\d{4}s$/.test(e.label) || !years.includes(e.label.slice(0, 3)));
  return out;
}
