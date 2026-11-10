'use client';
import {A,go,setPhase,setResearchMode} from '../lib/atlas';
const typeNames={phd:'PhD / graduate study',postdoc:'Postdoctoral research',staff:'Research staff / predoc',collaboration:'Research collaboration',visiting:'Visiting / student research'};
export function OpenEvidence({person}){
 const institution=A.W.uniById.get(person.iid);
 return <section className="open-evidence"><h2>Recruitment evidence</h2><p className="lede">A public invitation is not an offer or a guarantee of space. Follow the source’s application route and confirm availability.</p>
 <ul className="initiative-list">{person.opportunities.map(o=><li key={o.id}>
  <strong>{o.title}</strong><p>{o.types.map(t=>typeNames[t]).join(' · ')}</p>
  <p>{o.summary}</p><p className="srcline">{o.evidence==='advertised'?'Advertised opportunity':'Standing invitation; capacity unconfirmed'} · checked {o.checkedAt} · review due {o.reviewBy}{o.deadline?' · deadline '+o.deadline:''}</p>
  <p>Funding: {o.funding}</p>{o.requirements&&<p>{o.requirements}</p>}
  <a href={o.source} target="_blank" rel="noreferrer">Official evidence and application instructions ↗</a>{o.contextSource&&<p><a href={o.contextSource} target="_blank" rel="noreferrer">Related recruitment restriction ↗</a></p>}
 </li>)}</ul>
 <p className="srcline">Institutional grants and partnerships provide context; they do not establish this researcher’s budget, spare supervision capacity, or hiring intent.</p>
 {!institution&&<p className="srcline">This institution has no detailed funding snapshot in the atlas yet. The funding statement above comes from the recruitment source.</p>}
 {institution&&<button className="e-more" onClick={async()=>{await setPhase('general');if(A.phase.key==='general')go('uni',institution)}}>View institution funding & initiatives</button>}
 </section>;
}
export function OpenCoverage({meta}){
 const browse=async e=>{if(!e.target.value)return;const key='s'+e.target.value;await setPhase(key);if(A.phase.key===key)await setResearchMode('open')};
 return <><p className="srcline">Recruitment sample: {meta?.current??0} profiles with current evidence. Unlisted availability is unknown.</p><details className="research-method" open={!meta?.current}><summary>Coverage, expiry & reviewed subfields</summary><p>Recruitment evidence is a manually reviewed sample, not a census. {meta?.reviewed??0} researcher profiles with evidence in this subfield; {meta?.current??0} currently pass date checks{meta?.expired?`; ${meta.expired} need renewed evidence`:''}. Unlisted researchers have unknown availability. Listings expire at their deadline or review date, whichever comes first. Date checks use UTC; verify local application cutoffs.</p>{meta?.coveredSubfields&&<label className="e-filter">Explore reviewed recruitment evidence ({meta.catalogResearchers} researchers across {meta.coveredSubfields.length} subfields)<select aria-label="Explore recruitment subfields" value="" onChange={browse}><option value="">Choose a subfield…</option>{meta.coveredSubfields.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}</details></>;
}
