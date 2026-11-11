import {A,notify} from './atlas';
import {P,label,placeLabels} from './paint';
import {T,DPR,W,H} from './camera';
import {kick} from './loop';
import {metricColor} from './analysis-metrics.mjs';
export const analysis={active:false,rows:[],scope:'institutions',metric:'papers',title:'',currency:'USD',max:1,diverging:true};
export function setAnalysis(values){Object.assign(analysis,values);notify();kick()}
export function drawAnalysis(){
 const {ctx,skin}=P,{rows,max,diverging,scope}=analysis;
 for(const r of rows){
  const item=r.item,col=metricColor(r.value,{max,diverging});
  const annotation=r.text+(r.before!=null||r.after!=null?` · 2024: ${r.before??'not reported'} → 2025: ${r.after??'not reported'}`:r.reason?' · '+r.reason:'');
  if(scope==='countries'&&item.path){P.hits.push({kind:'country',item,path:item.path,terr:true,analysis:annotation});ctx.save();ctx.setTransform(DPR*T.k,0,0,DPR*T.k,DPR*T.x,DPR*T.y);ctx.fillStyle=col;ctx.globalAlpha=r.value==null?.12:.65;ctx.fill(item.path);ctx.globalAlpha=.6;ctx.strokeStyle=skin.paper;ctx.lineWidth=.7/T.k;ctx.stroke(item.path);ctx.restore()}
  const x=item.x*T.k+T.x,y=item.y*T.k+T.y;
  if(x<0||x>W||y<0||y>H)continue;
  const radius=scope==='countries'?5:4.5;
  ctx.globalAlpha=1;ctx.beginPath();ctx.arc(x,y,radius,0,2*Math.PI);ctx.fillStyle=col;ctx.fill();ctx.strokeStyle=skin.paper;ctx.lineWidth=1.4;ctx.stroke();
  P.hits.push({analysis:annotation,kind:scope==='countries'?'country':'uni',item,x,y,r:radius+4,pri:5});
  const hovered=A.hover?.item===item||A.view.uni===item||A.view.country===item;
  if(hovered||rows.length<70)label({lines:[item.short||item.name],sub:r.text,font:skin.uni(11.5),size:11.5,subFont:skin.sub(10),subSize:10,color:skin.ink,alpha:1,x,y,pri:hovered?100:1,spots:[[8,-7]],owner:item});
 }
 ctx.globalAlpha=1;placeLabels();
}
