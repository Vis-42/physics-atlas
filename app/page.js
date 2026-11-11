'use client';
import { useEffect, useRef, useState } from 'react';
import { start } from '../lib/atlas';
import { Crumbs, Search, Key, ViewSwitch, ResearchSwitch } from '../components/Controls';
import { Analysis } from '../components/Analysis';
import { Panel } from '../components/Panel';

export default function Page() {
  const stage = useRef(null), canvas = useRef(null), tip = useRef(null);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    let live = true;
    start({ stageEl: stage.current, canvasEl: canvas.current, tipEl: tip.current, base: 'data' })
      .then(() => live && setStatus('ready'))
      .catch((e) => { console.warn(e); live && setStatus('error'); });
    return () => { live = false; };
  }, []);
  const ready = status === 'ready';
  return (
    <div id="app">
      <div id="stage" ref={stage}>
        <canvas id="map" ref={canvas} tabIndex={0} aria-label="Map of research collaboration, from the world down to one researcher" />
        <div id="frame" />
        {ready && <Crumbs />}
        <Search ready={ready} />
        {ready && <ViewSwitch />}
        {ready && <ResearchSwitch />}
        {ready && <Key />}
        {ready && <Analysis />}
      </div>
      <Panel status={status} />
      <div id="tip" ref={tip} role="tooltip" />
    </div>
  );
}
