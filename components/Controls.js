'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {analysis} from '../lib/analysis-map';
import { toggleFilter } from '../lib/research-filters.mjs';
import { A, subscribe, getVersion, go, goPerson, level, searchItems, loadPeopleIndex, setPhase, setResearchMode, selectNet } from '../lib/atlas';
import { FAMILIES, YEARS, YEARS_LONG, famOf } from '../lib/theme';

export const useAtlas = () => useSyncExternalStore(subscribe, getVersion, () => 0);
const hue = (fam) => A.skin.hue[fam] || A.skin.neutral;

export function Crumbs() {
  useAtlas();
  const v = A.view;
  const items = [['world', null, 'World']];
  if (v.country) items.push(['country', v.country, v.country.name]);
  if (v.uni) items.push(['uni', v.uni, v.uni.name]);
  if (v.area) items.push(['area', v.area, v.area.name]);
  if (v.person) items.push(['person', v.person, v.person.name]);
  return (
    <nav id="crumbs" aria-label="Breadcrumb">
      {items.map(([kind, item, name], i) => {
        const last = i === items.length - 1;
        return (
          <span key={kind} style={{ display: 'contents' }}>
            {i > 0 && <span className="sep">›</span>}
            <button aria-current={last ? 'page' : undefined} title={name} onClick={() => !last && go(kind, item)}>{name}</button>
          </span>
        );
      })}
    </nav>
  );
}

export function Search({ ready }) {
  useAtlas();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [people, setPeople] = useState(null);
  const results = ready && q.trim() ? searchItems(q, people) : [];
  const pick = (r) => {
    if (!r) return;
    setQ(''); setOpen(false); document.activeElement?.blur();
    if (r.kind === 'netp') selectNet(r.item);
    else if (r.kind === 'personRef') goPerson(r.item);
    else if (r.kind === 'phase') setPhase(r.key).then(() => { if (!A.view.uni) go('world'); });
    else go(r.kind, r.item);
  };
  const warm = () => { if (!people) loadPeopleIndex().then(setPeople).catch(() => {}); };
  return (
    <div id="search">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
      <input
        id="q" type="search" placeholder="Search countries, universities, people" autoComplete="off" spellCheck={false}
        aria-label="Search" aria-controls="results" value={q}
        onFocus={warm}
        onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); warm(); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setSel((s) => Math.min(results.length - 1, s + 1)); e.preventDefault(); }
          else if (e.key === 'ArrowUp') { setSel((s) => Math.max(0, s - 1)); e.preventDefault(); }
          else if (e.key === 'Enter') pick(results[sel]);
          else if (e.key === 'Escape') { setQ(''); setOpen(false); e.target.blur(); }
        }}
      />
      <ul id="results" role="listbox" className={open && q.trim() ? 'on' : ''}>
        {results.length ? results.map((r, i) => (
          <li key={r.kind + (r.item.id || r.item.slug) + i} role="option" aria-selected={i === sel} onPointerDown={(e) => { e.preventDefault(); pick(r); }}>
            <span className="rn">{r.name}</span><span className="rs">{r.sub}</span>
          </li>
        )) : (
          <li className="none">{people ? 'No matches. Search covers countries, institutions, fields, subfields, topics, the open campus’s areas and every researcher mapped.' : 'Loading the researcher index…'}</li>
        )}
      </ul>
    </div>
  );
}

const PLATE = { world: 'Plate I · World', country: 'Plate II · Country', uni: 'Plate II · Country', campus: 'Plate III · Campus', district: 'Plate IV · District', person: 'Plate V · Person' };
export function Key() {
  useAtlas();
  const [min, setMin] = useState(false);
  const lv = level(), title = 'Key';
  const plate = PLATE[lv];
  if (analysis.active && A.researchMode === 'institutions') return null;
  if (A.researchMode !== 'institutions') return <div id="key"><div className="kt">Researcher map</div><div className="body"><p>Dot size: {A.researchMode.includes('frontier') ? 'recent top-10% papers' : A.researchMode.includes('career') ? 'career h-index' : 'evidence category (not vacancy count)'}</p><p>Lines: coauthorship in the sampled papers</p><p>Double bars: connection continues at the opposite edge</p><p>Orange ring: selected researcher</p></div></div>;
  return (
    <div id="key" className={min ? 'min' : ''}>
      <div className="kt">
        <span>{title + ' · ' + plate.split(' · ')[1]}</span>
        <button aria-label="Toggle key" onClick={() => setMin((m) => !m)}>{min ? 'Show' : 'Hide'}</button>
      </div>
      <div className="body">
        <div className="fams">
          {FAMILIES.map((f) => (
            <span key={f.key} className="fam" title={f.name}><i className="sw" style={{ '--c': hue(f.key) }} />{f.name}</span>
          ))}
        </div>
        <div className="row">
          <svg width="34" height="14" viewBox="0 0 34 14"><circle cx="4" cy="9" r="2.5" fill="currentColor" /><circle cx="13" cy="8" r="4" fill="currentColor" /><circle cx="26" cy="7" r="6" fill="currentColor" /></svg>
          {lv === 'district' || lv === 'person' ? 'Dot area: career h-index' : lv === 'country' || lv === 'world' ? 'Dot area: highly cited papers' : `Area size: papers ${YEARS}`}
        </div>
        <div className="row">
          <svg width="34" height="14" viewBox="0 0 34 14" stroke="currentColor"><path d="M1 3h32" strokeWidth=".6" /><path d="M1 7h32" strokeWidth="1.6" /><path d="M1 11.5h32" strokeWidth="3.2" /></svg>
          Road width: shared papers
        </div>
        <div className="row">
          <svg width="34" height="14" viewBox="0 0 34 14"><circle cx="7" cy="7" r="4" fill="none" stroke={A.skin.accent} strokeWidth="1.6" /></svg>
          Orange: your selection
        </div>
        <div className="row">
          <svg width="34" height="14" viewBox="0 0 34 14"><circle cx="7" cy="7" r="3" fill="currentColor" /><circle cx="7" cy="7" r="5.6" fill="none" stroke="#b0892a" strokeWidth="1.3" /></svg>
          Gold ring: punches above its size (impact for output)
        </div>
        {A.phase && A.phase.kind !== 'general' && <div className="row">
          <svg width="34" height="14" viewBox="0 0 34 14"><defs><radialGradient id="kh"><stop offset="0" stopColor={hue(A.phase.fam || 'phys')} stopOpacity=".7" /><stop offset="1" stopColor={hue(A.phase.fam || 'phys')} stopOpacity="0" /></radialGradient></defs><circle cx="17" cy="7" r="7" fill="url(#kh)" /></svg>
          Glow: where significant {A.phase.short} work happens
        </div>}
        {(lv === 'world' || lv === 'country') && A.W && A.W.period > 0 && <div className="row" title="A cartogram: each region's map area is 40% its true share of the Earth's surface and 60% its share of the world's highly cited research. The map wraps east-west.">
          <svg width="34" height="14" viewBox="0 0 34 14" stroke="currentColor" fill="none"><path d="M2 11 C 9 2, 25 2, 32 11" strokeWidth="1" /><path d="M2 11h30" strokeWidth=".6" strokeDasharray="2 2" /></svg>
          Map space: 60% research, 40% true area
        </div>}
        <div className="src">Sources: OpenAlex, {YEARS_LONG}{A.phase && A.phase.kind !== 'general' ? ' · View: ' + A.phase.short : ''}</div>
      </div>
    </div>
  );
}

// Views: all research (default), physics-related, or one field. Subfields and topics come from search.
export function ViewSwitch() {
  useAtlas();
  const [open, setOpen] = useState(false);
  const [exp, setExp] = useState(null); // which field's subfields are listed
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    const out = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', out);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', out); };
  }, [open]);
  if (!A.W) return null;
  const ph = A.phase;
  const domains = new Map();
  for (const f of A.W.fields) { if (!domains.has(f.domain)) domains.set(f.domain, []); domains.get(f.domain).push(f); }
  const pick = (key) => { setOpen(false); setPhase(key); };
  return (
    <div id="view" ref={box} className={open ? 'on' : ''}>
      <button className="vb" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="vk">View</span><span className="vn">{ph.short}</span><span className="vc">▾</span>
      </button>
      {ph.kind !== 'general' && <button className="vx" aria-label="Back to all research" title="Back to all research" onClick={() => pick('general')}>×</button>}
      {open && (
        <div className="vm" role="listbox">
          <button role="option" aria-selected={ph.key === 'general'} onClick={() => pick('general')}><b>All research</b><small>Every field, sized by papers 2017–26</small></button>
          <div className="vrow">
            <button role="option" aria-selected={ph.key === 'physics'} onClick={() => pick('physics')}><b>Physics-related</b><small>31 subfields, with researchers and co-author links</small></button>
            <button className="vexp" aria-label="Show physics subfields" aria-expanded={exp === 'physics'} onClick={() => setExp(exp === 'physics' ? null : 'physics')}>{exp === 'physics' ? '−' : '+'}</button>
          </div>
          {exp === 'physics' && <Subs ids={A.W.meta.physicsSubfields} ph={ph} pick={pick} />}
          {[...domains].map(([d, fs]) => (
            <div key={d} className="vg">
              <p>{d}</p>
              {fs.sort((a, b) => a.name.localeCompare(b.name)).map((f) => (
                <div key={f.id}>
                  <div className="vrow">
                    <button role="option" aria-selected={ph.key === 'f' + f.id} onClick={() => pick('f' + f.id)}>
                      <i className="dot" style={{ '--c': hue(famOf(f.name)) }} />{f.name}
                    </button>
                    <button className="vexp" aria-label={'Show subfields of ' + f.name} aria-expanded={exp === f.id} onClick={() => setExp(exp === f.id ? null : f.id)}>{exp === f.id ? '−' : '+'}</button>
                  </div>
                  {exp === f.id && <Subs ids={A.W.subfieldList.filter((x) => x.field === f.id).map((x) => x.id)} ph={ph} pick={pick} />}
                </div>
              ))}
            </div>
          ))}
          <p className="vh">Open + under a field for its subfields, or search any topic (e.g. “quantum computing”) for its own heat map.</p>
        </div>
      )}
    </div>
  );
}

function Subs({ ids, ph, pick }) {
  const list = ids.map((id) => A.W.subfieldById.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="vsub">
      {list.map((x) => (
        <button key={x.id} role="option" aria-selected={ph.key === 's' + x.id} onClick={() => pick('s' + x.id)}>{x.name}</button>
      ))}
    </div>
  );
}

export function ResearchSwitch() {
  useAtlas();
  if (A.phase?.kind !== 'subfield') return null;
  const people=A.researchMode!=='institutions', selected=A.researchMode.split('+');
  return <div id="research-mode">
    <div className="map-focus" role="group" aria-label="Map focus"><span className="control-label">Explore</span>
      <button aria-pressed={!people} onClick={()=>setResearchMode('institutions')}>Institutions</button>
      <button aria-pressed={people} onClick={()=>setResearchMode(A.lastResearchMode||'career')}>Researchers</button>
    </div>
    {people&&<fieldset className="research-criteria"><legend>Researcher filters</legend><div className="criteria-options">
      {[['career','Career leaders','Career impact'],['frontier','Frontier now','Recent impact'],['open','Open to researchers','Recruitment evidence']].map(([mode,label,description])=>{
        const checked=selected.includes(mode);return <label key={mode} className={'criterion'+(checked?' chosen':'')}>
          <input type="checkbox" aria-label={label} checked={checked} disabled={checked&&selected.length===1} onChange={()=>setResearchMode(toggleFilter(A.researchMode,mode))}/>
          <span>{label}<small>{description}</small></span></label>;
      })}</div><p className="filter-hint">{selected.length>1?'Match all '+selected.length+' selected requirements':'Choose one or more requirements'}</p>
    </fieldset>}
  </div>;
}
