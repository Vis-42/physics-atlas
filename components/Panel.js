'use client';
import { useEffect, useRef, useState } from 'react';
import { A, go, goPerson, level, setPanelHover, loadDetail, showLite, setPhase, selectNet, setResearchMode } from '../lib/atlas';
import { other } from '../lib/model';
import { loadHeat, makePhase, isMeasured } from '../lib/phase';
import { FAM_NAME, YEARS, YEARS_LONG } from '../lib/theme';
import { fmt, fmtShort } from '../lib/util';
import { useAtlas } from './Controls';

const hue = (fam) => A.skin.hue[fam] || A.skin.neutral;
const checked = () => {
  const d = A.W?.meta?.checked;
  if (!d) return '';
  const t = new Date(d + 'T00:00:00Z');
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ Sept /, ' Sep ');
};
const phName = () => (A.phase.kind === 'general' ? 'all fields' : A.phase.short);

const SRC = {
  cPapers: [`Papers, ${YEARS_LONG}`, 'Papers by the country’s independent research institutions in this view; physics counts are measured, other views are estimated from each institution’s topic mix'],
  cLink: [`Shared papers, ${YEARS_LONG}`, 'OpenAlex papers with authors in both places (all fields; in the physics view, physics-related papers only)'],
  cHeld: ['Institutions held', 'The five biggest universities in each of the 30 biggest research countries, the institutions with the most impact for their size, and the physics institutions with researcher data'],
  exc: ['Impact for its size', 'Rank among independent research institutions with 3,000+ papers and an h-index of 250+: how far its h-index sits above what its output would predict, nudged by recent citations per paper'],
  quality: ['Quality score', 'Elite papers divided by the square root of the institution’s papers in thousands (2017–26), times its h-index over 100. Elite papers are the world’s roughly 50,000 most-cited of those years (papers with over 100 authors count a tenth, since so many institutions share them). The score rewards strength, focus and staying power; it decides which institutions the atlas holds.'],
  sig: ['Highly cited papers', 'Significance, the atlas’s lens: papers 2017–26 among the top 5% most cited in this view (in all research, across all fields). Measured from OpenAlex; * marks an estimate from papers and recent citations per paper'],
  sigLink: ['Highly cited together', 'Highly cited papers (top 5% most cited, 2017–26) with authors at both institutions'],
  uniPapers: [`Papers, ${YEARS_LONG}`, 'OpenAlex works with an author at this institution; in a field or topic view, estimated from the institution’s topic mix (physics is measured)'],
  uniH: ['h-index', 'OpenAlex h-index of the institution: h works each cited at least h times'],
  uniCites: ['Citations, all time', 'OpenAlex citation count for all of the institution’s works, every field'],
  uniLink: [`Shared papers, ${YEARS_LONG}`, 'OpenAlex papers with authors at both institutions (all fields; in the physics view, physics-related papers only)'],
  fieldMix: ['Field mix', 'The institution’s papers in this view by OpenAlex field, grouped into 7 families'],
  areaCount: ['Research areas', 'The OpenAlex subfields in this view where the institution publishes most. Not departments'],
  areaPapers: [`Papers, ${YEARS_LONG}`, 'This institution’s papers in this OpenAlex subfield (measured for physics, otherwise estimated from its topic mix)'],
  areaSeen: ['Researchers seen', 'Researchers at this institution whose main area this is'],
  areaShown: ['Researchers shown', 'Top researchers by career h-index, up to 60 per area'],
  heatN: [`Papers, ${YEARS_LONG} (est.)`, 'The institution’s papers in this view, estimated from its topic mix and its 2017–26 output'],
  pH: ['h-index', 'OpenAlex career h-index: h papers each cited at least h times, all fields, all years'],
  pCareer: ['Citations, career', 'OpenAlex citation count for all of this person’s works'],
  pPhys: ['Physics papers, career', 'This person’s OpenAlex works in the physics-related subfields, all years'],
  areaLink: ['Co-authorships', 'Joint papers between researchers here whose main areas differ'],
  pPapers: ['Papers in the sample', 'This person’s papers among the most-cited papers sampled at this institution'],
  pCites: ['Citations', 'Citations of this person’s papers in the sample'],
  pYears: ['Years', 'First and last publication year in the sample'],
  xi: ['Joint papers', 'Papers in the sample written with people at that institution'],
  pLink: ['Joint papers', 'Physics-related papers both people wrote together, 2017–2026, big collaborations included'],
  sim: ['Similar work', 'How alike two researchers’ topic fingerprints are (cosine of their top OpenAlex topics), for people who have never written together'],
  bridge: ['Areas spanned', 'How many of this institution’s research areas the person works across, by their topics and co-authors'],
  paperCites: ['Citations', 'OpenAlex citation count for this paper'],
};

function N({ v, k, txt }) {
  return <span className="n" tabIndex={0} data-src={k}>{txt ?? fmt(v ?? 0)}</span>;
}
const Dot = ({ fam }) => <i className="dot" style={{ '--c': hue(fam) }} />;
function Row({ kind, item, name, value, k, frac, small, txt, onPick }) {
  return (
    <li>
      <button className="rowb" onClick={() => { setPanelHover(null); onPick ? onPick() : go(kind, item); }}
        onMouseEnter={() => kind && setPanelHover({ kind, item })} onMouseLeave={() => setPanelHover(null)}>
        <span className="rn">{name}{small ? <small>{small}</small> : null}</span>
        <N v={value} k={k} txt={txt} />
        {frac != null && <span className="bar"><i style={{ width: (100 * Math.min(1, frac)).toFixed(1) + '%' }} /></span>}
      </button>
    </li>
  );
}
function Sources({ keys, extra }) {
  return (
    <>
      <details className="sources">
        <summary>Sources</summary>
        <ul>
          <li><b>Publication backbone:</b> OpenAlex works {YEARS_LONG}, from the OpenAlex snapshot (institutions, topics) and the OpenAlex API (physics papers, researchers and co-authors). Last checked {checked()}.</li>
          {keys.map((k) => <li key={k}><b>{SRC[k][0]}:</b> {SRC[k][1]}.</li>)}
          {extra && <li>{extra}</li>}
          <li>The map holds only names, institutions and links; every territory, road, glow and dot is drawn live in your browser.</li>
        </ul>
      </details>
      <p className="srcline">Sources: OpenAlex, {YEARS_LONG} · checked {checked()}</p>
    </>
  );
}
function Mix({ u }) {
  return (
    <>
      <div className="mix">{u.mix.map((m) => <i key={m.fam} title={FAM_NAME[m.fam]} style={{ flex: m.count, '--c': hue(m.fam) }} />)}</div>
      <div className="mixl">
        {u.mix.slice().sort((a, b) => b.count - a.count).map((m) => (
          <span key={m.fam}><Dot fam={m.fam} />{FAM_NAME[m.fam]} <N k="fieldMix" txt={Math.round((m.count / u.mixTotal) * 100) + '%'} /></span>
        ))}
      </div>
    </>
  );
}
const Exc = ({ u }) => (u.excellent ? <span className="tag" title="Centre of excellence: high impact for its size">Excellence</span> : null);
const pickHeat = (e) => { const held = A.W.uniById.get(e.inst.id); held ? go('uni', held) : showLite({ ...e.inst, n: e.n }); };

const est = (x) => (x ? '' : ' (est.)');
const sigTxt = (v, measured) => fmt(v) + (measured ? '' : '*');

// Where the most significant work in this view happens: ranked by highly cited papers.
function HeatLists({ cc }) {
  const heat = (A.heat || []).filter((e) => !cc || e.inst.cc === cc);
  if (!A.heat) return A.phase.kind === 'general' ? null : <p className="lede">Loading where this work happens…</p>;
  if (!heat.length) return null;
  const top = heat.slice(0, 10), max = top[0].n;
  const name = (e) => (e.inst.name.length > 40 ? e.inst.name.slice(0, 38) + '…' : e.inst.name);
  const cn = (e) => A.W.countryById.get(e.inst.cc)?.name || A.W.countryNames?.[e.inst.cc] || e.inst.cc;
  return (
    <>
      <h2>Where the most significant {A.phase.short} work happens</h2>
      <ol className="rows">{top.map((e) => <Row key={e.inst.id} name={name(e)} small={(cc ? '' : ' ' + cn(e)) + (e.p != null ? ' · ' + fmtShort(e.p) + ' papers' : '')} txt={sigTxt(e.n, !e.est)} k="sig" frac={e.n / max} onPick={() => pickHeat(e)} />)}</ol>
    </>
  );
}

function World() {
  const W = A.W, ph = A.phase;
  const top = W.countries.slice().sort((a, b) => b.sig - a.sig).slice(0, 6);
  const lead = W.unis.filter((u) => !u.off).sort((a, b) => b.sig - a.sig).slice(0, 8);
  const links = W.croads.slice().sort((a, b) => b.s - a.s).slice(0, 5);
  return (
    <>
      <p className="kick">World scale{ph.kind !== 'general' ? ' · ' + ph.short : ''}</p>
      <h1>The world</h1>
      <p className="lede"><N v={W.countries.length} k={W.meta.qScored ? "quality" : "cHeld"} /> countries and <N v={W.unis.length} k={W.meta.qScored ? "quality" : "cHeld"} /> institutions, each sized by its significance in {phName()}: its highly cited papers, {YEARS}, not just how much it publishes. Roads join places that publish together.</p>
      {ph.kind === 'general'
        ? <p className="note">Switch the view to physics, a field, or search any subfield or topic to see where the most significant work in it happens.</p>
        : <p className="note">The glow shows where significant {ph.short} work happens; brighter means more highly cited papers.</p>}
      <HeatLists />
      <h2>Leading countries</h2>
      <ol className="rows">{top.map((c) => <Row key={c.id} kind="country" item={c} name={c.name} small={' ' + fmtShort(c.pw) + ' papers'} txt={sigTxt(c.sig, ph.kind === 'general' ? c.hc != null : true)} k="sig" frac={c.sig / top[0].sig} />)}</ol>
      {ph.kind === 'general' && <>
        <h2>Leading institutions</h2>
        <ol className="rows">{lead.map((u) => <Row key={u.id} kind="uni" item={u} name={<>{u.short}<Exc u={u} /></>} small={' ' + u.C.name + ' · ' + fmtShort(u.pw) + ' papers'} txt={sigTxt(u.sig, u.sigM)} k="sig" frac={u.sig / lead[0].sig} />)}</ol>
      </>}
      <h2>Strongest {ph.kind === 'physics' ? 'physics ' : ''}partnerships</h2>
      <ol className="rows">{links.map((r) => <Row key={r.a.id + r.b.id} kind="country" item={r.a} name={r.a.name + ' × ' + r.b.name} value={r.w} k="cLink" frac={r.s / links[0].s} />)}</ol>
      <SigNote />
      <Sources keys={['sig', 'cPapers', 'cHeld', 'cLink']} extra={A.W.meta.note} />
    </>
  );
}
// Researcher mode has its own panel; no institutional rankings or country totals.
function ResearchPanel() {
  const recent = A.researchMode === 'frontier', net = A.net;
  const title = recent ? 'Frontier now' : 'Career leaders';
  const heading = <><p className="kick">Researchers · {A.phase.short}</p><h1>{title}</h1></>;
  const back = <div className="research-actions"><button onClick={() => setResearchMode('institutions')}>Back to institutions</button></div>;
  if (A.netStatus === 'loading') return <>{heading}<p role="status" className="lede">Loading researcher evidence…</p>{back}</>;
  if (A.netStatus === 'error') return <>{heading}<p role="alert" className="lede">Researcher data couldn’t be loaded. Your map is still available.</p><div className="research-actions"><button onClick={() => setResearchMode(A.researchMode, {retry:true})}>Retry</button></div>{back}</>;
  if (!net?.people.length) return <>{heading}<p className="lede">{recent ? 'No eligible researchers are available in this subfield’s recent snapshot yet.' : 'A career researcher snapshot is not available for this subfield yet.'}</p>{back}</>;
  const top = net.people.slice().sort((a,b)=>b.score-a.score || (b.recentPapers||0)-(a.recentPapers||0));
  const selected = A.netSel && net.people.includes(A.netSel) ? A.netSel : null;
  const pairs = net.links.filter(l=>!selected || l.a===selected || l.b===selected).sort((a,b)=>b.n-a.n).slice(0,8);
  const unmapped = net.people.filter(p=>p.x==null).length;
  return <>{heading}
    <p className="lede">{recent ? 'Researchers producing high-impact work recently and publishing in this subfield within the last 12 months.' : 'Established researchers, ranked by career h-index within the existing most-cited candidate set.'}</p>
    {recent && <p className="note">{net.meta.start} – {net.meta.end} · snapshot {net.meta.asOf}. Ranked by top-10% cited papers, adjusted for publication year, type and subfield.</p>}
    <p className="srcline">{net.people.length} researchers · {unmapped ? `${unmapped} without a mapped location · ` : ''}Select a person to isolate their collaborations.</p>
    {selected && <section>
      <h2>{selected.name}</h2><p className="lede">{selected.iname}{selected.locationApproximate ? ' · location approximate to country' : selected.x==null ? ' · location unavailable' : ''}</p>
      <p>{recent ? `${fmt(selected.score)} recent top-10% papers · ${fmt(selected.recentPapers)} subfield papers in the last 12 months` : `Career h-index ${fmt(selected.h)} · ${fmtShort(selected.cites)} career citations`}</p>
      <div className="research-actions"><button onClick={() => selectNet(null)}>Show all researchers</button><a href={'https://openalex.org/'+selected.id} target="_blank" rel="noreferrer">OpenAlex profile ↗</a></div>
    </section>}
    <h2>{recent ? 'Recent impact' : 'Career h-index'}</h2>
    <ol className="rows">{top.map(p=><Row key={p.id} name={p.name} small={' '+p.iname+(recent ? ` · ${p.recentPapers} papers in last 12 months` : '')} value={p.score} frac={p.score/Math.max(1,top[0].score)} onPick={()=>selectNet(p)} />)}</ol>
    <h2>{selected ? 'Selected collaborations' : 'Collaborations in the sample'}</h2>
    {pairs.length ? <ol className="rows">{pairs.map(l=><Row key={l.a.id+l.b.id} name={l.a.name+' × '+l.b.name} txt={fmt(l.n)+' sampled papers'} onPick={()=>selectNet(selected===l.a ? l.b : l.a)} />)}</ol> : <p className="lede">No collaborations recorded in this sample. This does not mean there are none.</p>}
    <details className="research-method"><summary>How this view is built</summary>
      <p>{recent ? net.meta.method : 'The existing snapshot selects up to 60 researchers by career citation count for a subfield, then displays them by career h-index. These career metrics cover all of a person’s work, not only this subfield. Links come from up to 200 highly cited subfield papers from 2017–2026.'}</p>
      <p>Affiliations are the latest available in OpenAlex. Missing institution coordinates fall back to country-level placement and are marked in tooltips. Citation lag and author-profile errors can affect these indicators; this is a discovery aid, not a definitive assessment.</p>
      <a href="https://help.openalex.org/data/works/attributes/" target="_blank" rel="noreferrer">OpenAlex metric definitions ↗</a>
    </details>{back}
  </>;
}
const SigNote = () => (A.W.quality?.measured ? null : <p className="srcline">* Estimated from papers and recent citations per paper until highly cited counts are fetched.</p>);

function Lite({ inst }) {
  const C = A.W.countryById.get(inst.cc);
  return (
    <div className="lite">
      <p className="kick">Institution · heat map</p>
      <h1>{inst.name}</h1>
      <p className="sub">{C ? <button onClick={() => go('country', C)}>{C.name}</button> : A.W.countryNames?.[inst.cc] || inst.cc}</p>
      <div className="facts">
        <div><N k="sig" txt={sigTxt(inst.n, !inst.est)} /><span className="l">highly cited in {A.phase.short}</span></div>
        <div><N v={inst.h} k="uniH" /><span className="l">h-index</span></div>
        <div><N v={inst.p ?? inst.works} k="uniPapers" /><span className="l">papers {inst.p != null ? 'in ' + A.phase.short : YEARS + ', all fields'}</span></div>
      </div>
      <p className="lede">Part of the heat map for {A.phase.short}. Its inside (areas and researchers) isn’t mapped yet.</p>
    </div>
  );
}

function Country({ c }) {
  const links = c.links.slice().sort((a, b) => b.s - a.s).slice(0, 5), lmax = links.length ? links[0].s : 1;
  const members = c.members.filter((u) => !u.off).slice(0, 8), mmax = members[0]?.sig || 1;
  const dom = A.W.uroadDom.filter((r) => r.a.C === c).sort((a, b) => b.s - a.s).slice(0, 5);
  return (
    <>
      {A.lite && A.lite.cc === c.id && <Lite inst={A.lite} />}
      <p className="kick">Country scale{A.phase.kind !== 'general' ? ' · ' + A.phase.short : ''}</p>
      <h1>{c.name}</h1>
      <div className="facts">
        <div><N k="sig" txt={sigTxt(c.sig, A.phase.kind === 'general' ? c.hc != null : true)} /><span className="l">highly cited papers</span></div>
        <div><N v={c.pw} k="cPapers" /><span className="l">papers {YEARS}</span></div>
        <div><N v={c.members.length} k={A.W.meta.qScored ? "quality" : "cHeld"} /><span className="l">institutions held</span></div>
      </div>
      <p className="lede">Its institutions at their real places on the map, sized and ranked by significance in {phName()}.</p>
      <HeatLists cc={c.id} />
      <h2>Leading institutions</h2>
      <ol className="rows">{members.slice(0, 8).map((u) => <Row key={u.id} kind="uni" item={u} name={<>{u.name}<Exc u={u} /></>} small={' ' + fmtShort(u.pw) + ' papers'} txt={sigTxt(u.sig, u.sigM)} k="sig" frac={u.sig / mmax} />)}</ol>
      {dom.length > 0 && <>
        <h2>Strongest {A.phase.kind === 'physics' ? 'physics ' : ''}partnerships</h2>
        <ol className="rows">{dom.map((r) => <Row key={r.a.id + r.b.id} kind="uni" item={r.a} name={r.a.short + ' × ' + r.b.short} small={r.hq != null ? ' ' + fmt(r.hq) + ' highly cited together' : ' ' + fmt(r.w) + ' papers'} txt={r.hq != null ? fmt(r.hq) : fmt(r.w)} k={r.hq != null ? 'sigLink' : 'uniLink'} frac={r.s / dom[0].s} />)}</ol>
      </>}
      {links.length > 0 && <>
        <h2>Top partner countries</h2>
        <ol className="rows">{links.map((r) => { const o = other(r, c); return <Row key={o.id} kind="country" item={o} name={o.name} value={r.w} k="cLink" frac={r.s / lmax} />; })}</ol>
      </>}
      <SigNote />
      <Sources keys={['sig', 'sigLink', 'cPapers', 'cHeld', 'uniLink']} />
    </>
  );
}

// People who connect areas: by their own topics, and by who they write with.
function bridgesOf(d) {
  const ids = new Set(d.areas.map((a) => a.id));
  return d.people.map((p) => {
    const own = new Set((p.areas || []).filter((x) => ids.has(x)));
    const via = new Set(p.nb.map((n) => n.q.A.id));
    const all = new Set([...own, ...via]);
    return { p, n: all.size, own: own.size, via: via.size, score: all.size * Math.log(2 + (p.h || p.papers)) };
  }).filter((b) => b.n >= 3).sort((a, b) => b.score - a.score);
}
// Pairs who work on the same things but have never written together.
function unlinkedPairs(d) {
  const seen = new Set(), out = [];
  for (const p of d.people) for (const [qid, s] of p.sug || []) {
    const q = d.personById.get(qid);
    if (!q) continue;
    const k = [p.id, qid].sort().join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ p, q, s, w: s * Math.log(2 + (p.h || 0) + (q.h || 0)) });
  }
  return out.sort((a, b) => b.w - a.w);
}
function bridgesAreas(d) {
  return d.areas.map((a) => {
    const fams = new Set(), n = new Set();
    let w = 0;
    a.links.forEach((r) => { const o = other(r, a); n.add(o); if (o.fam !== a.fam) fams.add(o.fam); w += r.w; });
    return { a, fams: fams.size, n: n.size, w };
  }).filter((b) => b.w > 0).sort((x, y) => y.w - x.w).slice(0, 3);
}

function Uni({ u, campus }) {
  const links = u.links.slice().sort((a, b) => b.s - a.s).slice(0, 6), lmax = links.length ? links[0].s : 1;
  const d = u.detail;
  useEffect(() => { loadDetail(u); }, [u, A.phase.key]);
  let inner = <p className="note quiet">Opening its research areas…</p>;
  if (d) {
    const top = d.areas.slice().sort((a, b) => b.works - a.works).slice(0, 5);
    const br = bridgesAreas(d);
    const people = bridgesOf(d).slice(0, 5);
    const pairs = unlinkedPairs(d).slice(0, 5);
    inner = (
      <>
        {!campus && <p className="note">Keep zooming to open its {d.areas.length} research areas.</p>}
        <h2>Largest research areas</h2>
        <ol className="rows">{top.map((a) => <Row key={a.id} kind="area" item={a} name={<><Dot fam={a.fam} />{a.name}</>} value={a.works} k="areaPapers" frac={a.works / top[0].works} />)}</ol>
        {br.length > 0 && <>
          <h2>Areas that bridge others</h2>
          <ol className="rows">{br.map((b) => <Row key={b.a.id} kind="area" item={b.a} name={<><Dot fam={b.a.fam} />{b.a.name}</>} value={b.w} k="areaLink" small={` ties to ${b.n} areas in ${b.fams + 1} fields`} />)}</ol>
        </>}
        {people.length > 0 && <>
          <h2>People who bridge areas</h2>
          <ol className="rows">{people.map((b) => <Row key={b.p.id} kind="person" item={b.p} name={b.p.name} small={' ' + b.p.A.name} value={b.n} k="bridge" />)}</ol>
        </>}
        {pairs.length > 0 && <>
          <h2>Should know each other</h2>
          <ol className="rows">{pairs.map((x) => <Row key={x.p.id + x.q.id} kind="person" item={x.p} name={x.p.name + ' × ' + x.q.name} small={' never co-authored'} txt={Math.round(x.s * 100) + '%'} k="sim" />)}</ol>
        </>}
      </>
    );
  }
  return (
    <>
      <p className="kick">{campus ? 'Campus scale' : 'Institution'}{A.phase.kind !== 'general' ? ' · ' + A.phase.short : ''}</p>
      <h1>{u.name}<Exc u={u} /></h1>
      <p className="sub">{u.city} · <button onClick={() => go('country', u.C)}>{u.C.name}</button></p>
      <div className="facts">
        <div><N k="sig" txt={sigTxt(u.sig, u.sigM)} /><span className="l">highly cited papers</span></div>
        <div><N v={u.pw} k="uniPapers" /><span className="l">papers {YEARS}{isMeasured(u, A.phase) ? '' : ' (est.)'}</span></div>
        <div><N v={u.h} k="uniH" /><span className="l">h-index · {fmtShort(u.citations)} citations</span></div>
      </div>
      {u.q != null ? <p className="lede">Quality score <N k="quality" txt={fmt(Math.round(u.q))} />, #{fmt(u.qRank)} of the {fmt(A.W.meta.qScored)} leading institutions scored: {fmt(Math.round(u.eliteS + u.eliteB / 10))} elite papers from {fmtShort(u.works)} papers.</p> : u.excRank && <p className="lede">{u.pw ? <>{Math.round((1000 * u.sig) / Math.max(1, u.pw)) / 10}% of its papers are highly cited. </> : null}Impact for its size ranks <N k="exc" txt={'#' + fmt(u.excRank)} /> of {fmt(A.W.meta.excTotal)} research institutions.</p>}
      <h2>Field mix</h2>
      <Mix u={u} />
      {inner}
      {links.length > 0 && <>
        <h2>Top {A.phase.kind === 'physics' ? 'physics ' : ''}partners</h2>
        <ol className="rows">{links.map((r) => { const o = other(r, u); return <Row key={o.id} kind="uni" item={o} name={o.name} txt={r.hq != null ? fmt(r.hq) : fmt(r.w)} k={r.hq != null ? 'sigLink' : 'uniLink'} frac={r.s / lmax} small={(o.C !== u.C ? ' ' + o.C.name : '') + (r.hq != null ? ' · ' + fmtShort(r.w) + ' papers' : '')} />; })}</ol>
      </>}
      <Sources keys={['sig', 'sigLink', 'uniPapers', 'uniH', 'exc', 'fieldMix', 'areaCount', 'areaPapers', 'areaLink', 'sim', 'uniLink']} extra="Research areas are OpenAlex subfields until real departments are researched." />
    </>
  );
}

// People between this area and another: working in both (by their topics) or co-authoring across them.
function Between({ a }) {
  const d = a.U.detail;
  const others = d.areas.filter((o) => o !== a && o.people.length);
  const [bid, setBid] = useState('');
  if (!a.people.length || !others.length) return null;
  const b = d.areaById.get(bid);
  let rows = [];
  if (b) {
    const both = (p) => (p.areas || []).includes(a.id) && (p.areas || []).includes(b.id);
    const ties = (p, X) => p.nb.filter((n) => n.q.A === X).reduce((s, n) => s + n.w, 0);
    rows = [...a.people, ...b.people].map((p) => ({ p, both: both(p), t: ties(p, p.A === a ? b : a) }))
      .filter((r) => r.both || r.t > 0).sort((x, y) => (y.both - x.both) || y.t - x.t || (y.p.h || 0) - (x.p.h || 0)).slice(0, 8);
  }
  return (
    <>
      <h2>Find people between areas</h2>
      <select className="sel" value={bid} onChange={(e) => setBid(e.target.value)} aria-label="Pick another area">
        <option value="">Pick another area at {a.U.short}…</option>
        {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {b && (rows.length
        ? <ol className="rows">{rows.map((r) => <Row key={r.p.id} kind="person" item={r.p} name={r.p.name} small={' ' + r.p.A.name + (r.both ? ' · works in both' : '')} value={r.t} k="pLink" />)}</ol>
        : <p className="lede">Nobody here works across {a.name} and {b.name} yet.</p>)}
    </>
  );
}

// Where else an area's subfield is strongest, from its heat map.
function Elsewhere({ a }) {
  const [rows, setRows] = useState(null);
  const sid = a.id.slice(1);
  useEffect(() => {
    let live = true;
    loadHeat(A.base, A.W, makePhase(A.W, 's' + sid)).then((h) => live && setRows(h || [])).catch(() => live && setRows([]));
    return () => { live = false; };
  }, [sid]);
  // keep its place while loading, so nothing below it jumps
  if (!rows) return <div style={{ minHeight: 230 }} />;
  if (!rows.length) return null;
  const top = rows.filter((e) => e.inst.id !== a.U.id).slice(0, 5), max = top[0]?.n || 1;
  return (
    <>
      <h2>Strongest elsewhere</h2>
      <ol className="rows">{top.map((e) => <Row key={e.inst.id} name={e.inst.name.length > 38 ? e.inst.name.slice(0, 36) + '…' : e.inst.name} small={' ' + (A.W.countryById.get(e.inst.cc)?.name || A.W.countryNames?.[e.inst.cc] || e.inst.cc)} value={e.n} k="heatN" frac={e.n / max}
        onPick={() => setPhase('s' + sid).then(() => pickHeat(e))} />)}</ol>
    </>
  );
}

function Area({ a }) {
  const top = a.people.slice(0, 8), hmax = top[0]?.h || top[0]?.papers || 1;
  const links = a.links.slice(0, 5), lmax = links.length ? links[0].w : 1;
  const all = a.U.detail.people.length;
  const br = a.people.map((p) => ({ p, n: new Set([...(p.areas || []), ...p.nb.map((x) => x.q.A.id)]).size })).filter((b) => b.n >= 3).sort((x, y) => y.n - x.n || (y.p.h || 0) - (x.p.h || 0)).slice(0, 4);
  return (
    <>
      <p className="kick">District scale{A.phase.kind !== 'general' ? ' · ' + A.phase.short : ''}</p>
      <h1>{a.name}</h1>
      <p className="sub"><Dot fam={a.fam} />Research area at <button onClick={() => go('uni', a.U)}>{a.U.name}</button> · {a.field}</p>
      <div className="facts">
        <div><N v={a.works} k="areaPapers" /><span className="l">papers {YEARS}</span></div>
        <div><N v={a.researchersSeen} k="areaSeen" /><span className="l">researchers seen</span></div>
        <div><N v={a.people.length} k="areaShown" /><span className="l">shown here</span></div>
      </div>
      {a.people.length
        ? <p className="lede">Showing the top {a.people.length} researchers in this sample by career h-index{a.researchersSeen > a.people.length ? `, + ${fmt(a.researchersSeen - a.people.length)} more researchers` : ''}. Search reaches all {fmt(all)} people in the sample at {a.U.short}.</p>
        : <p className="lede">Researcher names for this area aren’t mapped yet (they are for physics-related areas so far). The territory shows {a.U.short}’s output in it.</p>}
      <h2>Top researchers</h2>
      {top.length > 0
        ? <ol className="rows">{top.map((p) => <Row key={p.id} kind="person" item={p} name={p.name} value={p.h ?? p.papers} k={p.h != null ? 'pH' : 'pPapers'} frac={(p.h ?? p.papers) / hmax} />)}</ol>
        : <p className="lede">None mapped yet for this area.</p>}
      <h2>Connects to</h2>
      {links.length > 0
        ? <ol className="rows">{links.map((r) => { const o = other(r, a); return <Row key={o.id} kind="area" item={o} name={<><Dot fam={o.fam} />{o.name}</>} value={r.w} k="areaLink" frac={r.w / lmax} />; })}</ol>
        : (() => {
          // no co-authorship data yet: the institution's other areas in the same field
          const kin = a.U.detail.areas.filter((o) => o !== a && o.field === a.field).sort((x, y) => y.works - x.works).slice(0, 5);
          return kin.length ? <>
            <p className="lede">No co-author links for this area yet. Its nearest areas here, by field:</p>
            <ol className="rows">{kin.map((o) => <Row key={o.id} kind="area" item={o} name={<><Dot fam={o.fam} />{o.name}</>} small=" same field" value={o.works} k="areaPapers" frac={o.works / kin[0].works} />)}</ol>
          </> : <p className="lede">No co-author links for this area yet.</p>;
        })()}
      {(a.xi || []).length > 0 && <>
        <h2>Writes most with, outside {a.U.short}</h2>
        <ol className="rows">{a.xi.slice(0, 6).map(([uid, name, n, slug]) => {
          const U = A.W.uniById.get(uid);
          return <Row key={uid} name={name} value={n} k="xi" frac={n / a.xi[0][2]} onPick={() => U && go('uni', U)} />;
        })}</ol>
      </>}
      {br.length > 0 && <>
        <h2>Who bridges it to other areas</h2>
        <ol className="rows">{br.map((b) => <Row key={b.p.id} kind="person" item={b.p} name={b.p.name} value={b.n} k="bridge" />)}</ol>
      </>}
      <Between a={a} />
      <Elsewhere a={a} />
      <Sources keys={['areaPapers', 'areaSeen', 'areaShown', 'areaLink', 'pH']} extra="Research areas are OpenAlex subfields, not departments. Researchers are matched to their current institution." />
    </>
  );
}

function Person({ p }) {
  const nb = p.nb.slice(0, 6), nmax = nb.length ? nb[0].w : 1;
  const prof = p.h != null;
  const d = p.U.detail;
  const near = (p.sug || []).map(([id, s]) => ({ q: d.personById.get(id), s })).filter((x) => x.q).slice(0, 5);
  const far = (p.sugx || []).slice(0, 5);
  const spans = new Set([...(p.areas || []), ...p.nb.map((x) => x.q.A.id)]);
  const spanNames = [...spans].map((id) => d.areaById.get(id)?.name).filter(Boolean);
  return (
    <>
      <p className="kick">Person scale</p>
      <h1>{p.name}</h1>
      <p className="sub"><Dot fam={p.fam} /><button onClick={() => go('area', p.A)}>{p.A.name}</button> · {p.U.short}</p>
      {prof ? (
        <div className="facts">
          <div><N v={p.h} k="pH" /><span className="l">h-index</span></div>
          <div><N k="pCareer" txt={fmtShort(p.career)} /><span className="l">citations, career</span></div>
          <div><N v={p.phys} k="pPhys" /><span className="l">physics papers, career</span></div>
        </div>
      ) : (
        <div className="facts">
          <div><N v={p.papers} k="pPapers" /><span className="l">papers in the sample</span></div>
          <div><N v={p.citations} k="pCites" /><span className="l">citations</span></div>
          <div><N k="pYears" txt={p.first === p.last ? String(p.first) : p.first + '–' + String(p.last).slice(2)} /><span className="l">years</span></div>
        </div>
      )}
      {spanNames.length > 1 && <p className="lede">Works across <N k="bridge" txt={String(spanNames.length)} /> areas here: {spanNames.slice(0, 5).join(', ')}{spanNames.length > 5 ? '…' : ''}.</p>}
      <h2>Strongest ties</h2>
      {nb.length ? <ol className="rows">{nb.map((n) => <Row key={n.q.id} kind="person" item={n.q} name={n.q.name} value={n.w} k="pLink" frac={n.w / nmax} small={n.q.A !== p.A ? ' ' + n.q.A.name : ''} />)}</ol>
        : <p className="lede">No joint papers with others mapped at {p.U.short}.</p>}
      {(p.xt || []).length > 0 && <>
        <h2>Co-authors at other institutions</h2>
        <ol className="rows">{p.xt.slice(0, 8).map(([aid, name, uid, iname, w, slug]) => {
          const U = slug ? A.W.unis.find((x) => x.slug === slug) : A.W.uniById.get(uid);
          return <Row key={aid} name={name} small={' ' + (A.W.uniById.get(uid)?.short || iname || '')} value={w} k="pLink"
            onPick={() => { if (U && slug) goPerson({ U, id: aid }); else if (U) go('uni', U); }} />;
        })}</ol>
      </>}
      {near.length > 0 && <>
        <h2>Should know, here</h2>
        <ol className="rows">{near.map((x) => <Row key={x.q.id} kind="person" item={x.q} name={x.q.name} small={' ' + x.q.A.name} txt={Math.round(x.s * 100) + '%'} k="sim" />)}</ol>
      </>}
      {far.length > 0 && <>
        <h2>Closest work elsewhere</h2>
        <ol className="rows">{far.map(([id, slug, name, short, s]) => <Row key={id} name={name} small={' ' + short} txt={Math.round(s * 100) + '%'} k="sim"
          onPick={() => { const U = A.W.unis.find((x) => x.slug === slug); if (U) goPerson({ U, id }); }} />)}</ol>
      </>}
      {(p.topPapers || []).length > 0 && <>
        <h2>Most-cited papers</h2>
        <ul className="papers">{p.topPapers.map((t, i) => <li key={i}>{t.title}<span className="meta">{t.year} · <N v={t.cites} k="paperCites" /> citations</span></li>)}</ul>
      </>}
      <Sources keys={prof ? ['pH', 'pCareer', 'pPhys', 'pLink', 'sim', 'paperCites'] : ['pPapers', 'pCites', 'pYears', 'pLink', 'sim', 'paperCites']} extra="“Should know” pairs have closely matching topics but no joint papers in OpenAlex." />
    </>
  );
}

function Body({ status }) {
  useAtlas();
  if (status === 'error') return (<><p className="kick">Error</p><h1>The data didn’t load</h1><p className="lede err">Couldn’t read the files in /data.</p></>);
  if (status !== 'ready') return (<><p className="kick">Loading</p><h1>Drawing the atlas</h1></>);
  if (A.researchMode !== 'institutions') return <ResearchPanel />;
  const lv = level(), v = A.view;
  if (lv === 'world') return A.lite ? <><Lite inst={A.lite} /><World /></> : <World />;
  if (lv === 'country') return <Country c={v.country} />;
  if (lv === 'campus' || lv === 'uni') return <Uni u={v.uni} campus={lv === 'campus'} />;
  if (lv === 'district') return <Area a={v.area} />;
  return <Person p={v.person} />;
}

export function Panel({ status }) {
  useAtlas();
  const [open, setOpen] = useState(false);
  const panel = useRef(null), ntip = useRef(null), drag = useRef(null);
  const v = A.view, lv = A.ready ? level() : 'loading';
  const where = lv + ':' + (v.person?.id || v.area?.id || v.uni?.id || v.country?.id || '') + ':' + (A.phase?.key || '') + ':' + A.researchMode + ':' + (A.netSel?.id || '');
  // On phones, jump back to the top only when the place changes, not on every update.
  useEffect(() => { if (panel.current && window.innerWidth <= 720) panel.current.scrollTop = 0; }, [where]);
  const show = (el) => {
    const t = ntip.current;
    if (!t) return;
    const n = el?.closest?.('.n[data-src]'), s = n && SRC[n.dataset.src || ''];
    if (!n || !s) { t.classList.remove('on'); return; }
    t.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = s[0];
    t.append(b, document.createElement('br'), s[1] + '.', document.createElement('br'), `OpenAlex · checked ${checked()}`);
    t.classList.add('on');
    const a = n.getBoundingClientRect(), r = t.getBoundingClientRect();
    let top = a.top - r.height - 8;
    if (top < 6) top = a.bottom + 8;
    const left = Math.min(Math.max(6, a.left + a.width / 2 - r.width / 2), innerWidth - r.width - 6);
    t.style.transform = `translate(${left}px, ${top}px)`;
  };
  return (
    <>
      <aside id="panel" ref={panel} className={open ? 'open' : ''} aria-live="polite"
        onMouseOver={(e) => show(e.target)} onFocus={(e) => show(e.target)} onClick={(e) => show(e.target)}
        onMouseLeave={() => { ntip.current?.classList.remove('on'); setPanelHover(null); }}
        onBlur={() => ntip.current?.classList.remove('on')}>
        <button id="handle" aria-label={open ? 'Collapse panel' : 'Expand panel'} onClick={() => setOpen((o) => !o)}
          onPointerDown={(e) => { drag.current = e.clientY; }}
          onPointerUp={(e) => { const d = drag.current == null ? 0 : e.clientY - drag.current; drag.current = null; if (Math.abs(d) > 24) { e.preventDefault(); setOpen(d < 0); } }} />
        <div id="pbody"><Body status={status} /></div>
      </aside>
      <div id="ntip" ref={ntip} role="tooltip" />
    </>
  );
}
