// Wikipedia categories provider (no key). Gives every film with an English Wikipedia article the article's visible
// categories ("Films about atonement", "Films set in Texas" …) as raw labels; classification happens in analysis.
// Primary: Wikipedia action API, 50 titles per request. Fallback: DBpedia SPARQL (dct:subject), 20 titles per request,
// used when Wikipedia refuses the batch (429/403/…) or returns no categories for a title.

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const DBPEDIA = 'https://dbpedia.org/sparql';
const WIKI_BATCH = 50;
const DB_BATCH = 20;
const MAX_CATEGORIES = 80;
const MAX_CONTINUES = 30;   // safety stop for clcontinue paging

const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });

const MAINTENANCE = /^(Articles |Pages |All articles|Wikipedia |CS1 |Webarchive|Use dmy dates|Use mdy dates|Short description|Commons category|Good articles|Featured articles)/i;

/** The article title as plain text (spaces, no underscores). Accepts a pasted article link too. */
export function plainTitle(enwiki) {
  let t = String(enwiki ?? '').trim();
  const link = /^https?:\/\/[^/]*wikipedia\.org\/wiki\/(.+)$/i.exec(t);
  if (link) { try { t = decodeURIComponent(link[1]); } catch { t = link[1]; } }
  return t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Category:Films_about_atonement" → "Films about atonement"; maintenance categories → null. */
export function cleanCategory(raw) {
  const label = String(raw ?? '').replace(/^Category:/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return label && !MAINTENANCE.test(label) ? label : null;
}

const uniqueLabels = labels => {
  const out = [], seen = new Set();
  for (const l of labels) {
    const c = cleanCategory(l);
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
};

/**
 * DBpedia resource IRI for an article title. DBpedia matches the raw IRI (colons, accents, "/" and so on as they are):
 * percent-encoding them finds nothing. Only characters that can't appear inside a SPARQL <IRI> are escaped.
 */
export function dbpediaUri(title) {
  const t = plainTitle(title).replace(/ /g, '_');
  return 'http://dbpedia.org/resource/' + t.replace(/[\u0000- <>"{}|\\^`]/g, ch => encodeURIComponent(ch));
}

export function dbpediaQuery(uris) {
  return 'PREFIX dct: <http://purl.org/dc/terms/> SELECT ?t ?c WHERE { VALUES ?t { '
    + uris.map(u => `<${u}>`).join(' ') + ' } ?t dct:subject ?c }';
}

export function wikiBatchUrl(titles, cont) {
  let url = `${WIKI_API}?action=query&format=json&formatversion=2&prop=categories&cllimit=max&clshow=!hidden&redirects=1&titles=`
    + titles.map(encodeURIComponent).join('|');
  if (cont) for (const [k, v] of Object.entries(cont)) url += `&${k}=${encodeURIComponent(v)}`;
  return url;
}

/** Follow normalized/redirects maps from the title we asked for to the page title it ended up as. */
function resolver(responses) {
  const hop = new Map();
  for (const r of responses) {
    for (const x of r?.query?.normalized ?? []) hop.set(x.from, x.to);
    for (const x of r?.query?.redirects ?? []) hop.set(x.from, x.to);
  }
  return title => {
    let t = title;
    for (let i = 0; i < 5 && hop.has(t); i++) t = hop.get(t);
    return t;
  };
}

/** Run a Wikipedia batch (all clcontinue pages). Returns Map<pageTitle, string[]> and the resolver. */
async function wikiBatch(titles, ctx) {
  const responses = [];
  let cont = null;
  for (let i = 0; i < MAX_CONTINUES; i++) {
    if (ctx.signal?.aborted) throw abortError();
    const r = await ctx.http.json(wikiBatchUrl(titles, cont), { signal: ctx.signal });
    responses.push(r);
    if (!r?.continue?.clcontinue) break;
    cont = r.continue;
  }
  const cats = new Map();
  for (const r of responses) {
    for (const p of r?.query?.pages ?? []) {
      if (p.missing) continue;
      const list = cats.get(p.title) ?? [];
      for (const c of p.categories ?? []) list.push(c.title);
      cats.set(p.title, list);
    }
  }
  return { cats, resolve: resolver(responses) };
}

async function dbpediaBatch(items, ctx) {
  const byUri = new Map(items.map(it => [it.uri, it]));
  const url = `${DBPEDIA}?format=${encodeURIComponent('application/sparql-results+json')}&query=${encodeURIComponent(dbpediaQuery([...byUri.keys()]))}`;
  const r = await ctx.http.json(url, { signal: ctx.signal });
  const found = new Map();
  for (const b of r?.results?.bindings ?? []) {
    const uri = b?.t?.value, c = b?.c?.value;
    if (!uri || !c) continue;
    const m = /\/resource\/(.+)$/.exec(c);
    if (!m) continue;
    let label = m[1];
    try { label = decodeURIComponent(label); } catch { /* keep as is */ }
    (found.get(uri) ?? found.set(uri, []).get(uri)).push(label);
  }
  return found;
}

export default {
  id: 'wikicats',
  label: 'Wikipedia categories',
  gives: ['themes and subjects'],
  needsKey: false,
  requires: film => !!film.ids?.enwiki,
  needsIds: ['enwiki'],
  refreshDays: 120,
  retryMissDays: 30,

  async enrich(films, ctx) {
    let finished = 0;
    const settle = (film, data) => { ctx.done(film, data); ctx.progress(++finished, films.length); };
    const failFilm = (film, e) => { ctx.fail(film, e); ctx.progress(++finished, films.length); };
    const check = () => { if (ctx.signal?.aborted) throw abortError(); };

    const items = [];
    for (const film of films) { // films an on-demand run already did are skipped
      if (ctx.skip?.(film)) ctx.progress(++finished, films.length);
      else items.push({ film, title: plainTitle(film.ids.enwiki) });
    }
    let pending = []; // films that need DBpedia

    const flushDbpedia = async all => {
      while (pending.length >= (all ? 1 : DB_BATCH)) {
        check();
        const batch = pending.splice(0, DB_BATCH).map(it => ({ ...it, uri: dbpediaUri(it.title) }));
        try {
          const found = await dbpediaBatch(batch, ctx);
          for (const it of batch) {
            const categories = uniqueLabels(found.get(it.uri) ?? []);
            settle(it.film, categories.length ? { categories, via: 'dbpedia', title: it.title } : null);
          }
        } catch (e) {
          if (e?.code === 'aborted') throw e;
          for (const it of batch) failFilm(it.film, e);
        }
      }
    };

    for (let i = 0; i < items.length; i += WIKI_BATCH) {
      check();
      const batch = items.slice(i, i + WIKI_BATCH);
      let result;
      try {
        result = await wikiBatch([...new Set(batch.map(b => b.title))], ctx);
      } catch (e) {
        if (e?.code === 'aborted') throw e;
        if (e?.status) pending.push(...batch);          // Wikipedia said no (429/403/5xx): try DBpedia
        else for (const it of batch) failFilm(it.film, e); // network trouble: try again next time
        await flushDbpedia(false);
        continue;
      }
      for (const it of batch) {
        const categories = uniqueLabels(result.cats.get(result.resolve(it.title)) ?? []);
        if (categories.length) settle(it.film, { categories, via: 'wikipedia', title: it.title });
        else pending.push(it);
      }
      await flushDbpedia(false);
    }
    await flushDbpedia(true);
  },
};
