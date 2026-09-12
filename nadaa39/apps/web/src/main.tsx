import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as THREE from 'three';
import './style.css';
import {apiUrl} from './api';

const API = apiUrl('');

type Message = {role:'user'|'nadaa', text:string};

function Morbius() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, .1, 100);
    camera.position.z = 4.5;
    const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.setSize(340,340);
    ref.current.appendChild(renderer.domElement);
    const group = new THREE.Group();
    const pts: THREE.Vector3[] = [];
    for (let i=0;i<=260;i++) {
      const t=i/260*Math.PI*2;
      const R=1.25, r=.22;
      const twist=t/2;
      pts.push(new THREE.Vector3((R+r*Math.cos(t))*Math.cos(twist),(R+r*Math.cos(t))*Math.sin(twist),r*Math.sin(t)));
    }
    const curve=new THREE.CatmullRomCurve3(pts);
    const geo=new THREE.TubeGeometry(curve,420,.035,8,true);
    const mat=new THREE.MeshBasicMaterial({color:0x9b6cff,wireframe:false});
    const mesh=new THREE.Mesh(geo,mat); group.add(mesh); scene.add(group);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.35,.012,6,96),new THREE.MeshBasicMaterial({color:0x20e0ff,transparent:true,opacity:.55}));
    ring.rotation.x=Math.PI/2; scene.add(ring);
    let id=0; const tick=()=>{id=requestAnimationFrame(tick);group.rotation.y+=.007;group.rotation.x=Math.sin(performance.now()/2200)*.15;ring.rotation.z+=.01;renderer.render(scene,camera)};tick();
    const onResize=()=>renderer.setSize(Math.min(ref.current!.clientWidth,360),Math.min(ref.current!.clientWidth,360)); window.addEventListener('resize',onResize);
    return ()=>{cancelAnimationFrame(id);window.removeEventListener('resize',onResize);renderer.dispose();ref.current?.removeChild(renderer.domElement)};
  },[]);
  return <div ref={ref} className="morbius"/>;
}

function App(){
  const [messages,setMessages]=useState<Message[]>([{role:'nadaa',text:'Hello, Ramatema. I am Nadaa — nah-dah. MPI is online.'}]);
  const [input,setInput]=useState(''); const [live,setLive]=useState(false); const [status,setStatus]=useState('READY');
  const [url,setUrl]=useState(''); const [fileName,setFileName]=useState(''); const [voiceSetup,setVoiceSetup]=useState('');
  const [providers,setProviders]=useState<Record<string,boolean>>({}); const [activeProvider,setActiveProvider]=useState('offline'); const [selectedProvider,setSelectedProvider]=useState('auto');
  useEffect(()=>{fetch(`${API}api/providers`).then(r=>r.ok?r.json():Promise.reject()).then(d=>setProviders(d.providers||{})).catch(()=>setProviders({}));},[]);
  const audioCtx=useRef<AudioContext|null>(null); const playbackAt=useRef(0); const ws=useRef<WebSocket|null>(null); const stream=useRef<MediaStream|null>(null);


  function wavBytes(samples:Float32Array, sampleRate:number){
    const buffer=new ArrayBuffer(44+samples.length*2); const view=new DataView(buffer); const write=(o:string,p:number)=>{for(let i=0;i<o.length;i++)view.setUint8(p+i,o.charCodeAt(i))};
    write('RIFF',0); view.setUint32(4,36+samples.length*2,true); write('WAVE',8); write('fmt ',12); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); write('data',36); view.setUint32(40,samples.length*2,true); for(let i=0;i<samples.length;i++){const v=Math.max(-1,Math.min(1,samples[i])); view.setInt16(44+i*2,v<0?v*32768:v*32767,true)} return new Blob([buffer],{type:'audio/wav'});
  }
  async function recordWav(seconds:number){
    const s=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1}}); const ctx=new AudioContext({sampleRate:16000}); const src=ctx.createMediaStreamSource(s); const proc=ctx.createScriptProcessor(4096,1,1); const chunks:Float32Array[]=[]; let count=0; const target=16000*seconds;
    return await new Promise<Blob>((resolve,reject)=>{const finish=()=>{proc.disconnect();src.disconnect();s.getTracks().forEach(t=>t.stop());ctx.close();let total=0;for(const c of chunks)total+=c.length;const all=new Float32Array(Math.min(total,target));let o=0;for(const c of chunks){const take=Math.min(c.length,all.length-o);all.set(c.subarray(0,take),o);o+=take;if(o>=all.length)break}resolve(wavBytes(all,16000))}; proc.onaudioprocess=e=>{const c=e.inputBuffer.getChannelData(0).slice();chunks.push(c);count+=c.length;if(count>=target)finish()}; src.connect(proc);const sink=ctx.createGain(); sink.gain.value=0; proc.connect(sink); sink.connect(ctx.destination); setTimeout(()=>{if(count<target)finish()},seconds*1000+1500);}).finally(()=>ctx.close()).catch(e=>{s.getTracks().forEach(t=>t.stop());throw e});
  }
  async function enrollCreator(){setVoiceSetup('RECORDING CREATOR VOICE'); try{const wav=await recordWav(4); const fd=new FormData();fd.append('file',wav,'creator.wav'); const r=await fetch(`${API}api/voice/enroll`,{method:'POST',body:fd}); const d=await r.json(); if(!r.ok)throw new Error(d.detail||'Enrollment failed'); setVoiceSetup('CREATOR VOICE SAVED'); setMessages(m=>[...m,{role:'nadaa',text:'Creator voice enrolled. Future voice sessions can be gated against this voiceprint.'}])}catch(e){setVoiceSetup('VOICE SETUP ERROR');setMessages(m=>[...m,{role:'nadaa',text:`Voice enrollment failed: ${String(e)}`}])}}

  async function playPcm24k(base64:string){
    if(!audioCtx.current) audioCtx.current=new AudioContext(); const bin=atob(base64); const pcm=new Int16Array(bin.length/2); for(let i=0;i<pcm.length;i++)pcm[i]=bin.charCodeAt(i*2)|bin.charCodeAt(i*2+1)<<8; const buf=audioCtx.current.createBuffer(1,pcm.length,24000); const ch=buf.getChannelData(0); for(let i=0;i<pcm.length;i++)ch[i]=pcm[i]/32768; const src=audioCtx.current.createBufferSource(); src.buffer=buf; src.connect(audioCtx.current.destination); const start=Math.max(audioCtx.current.currentTime,playbackAt.current); src.start(start); playbackAt.current=start+buf.duration;
  }

  async function sendText(){ if(!input.trim()) return; const q=input.trim(); setInput(''); setMessages(m=>[...m,{role:'user',text:q}]); setStatus('THINKING');
    try{ const r=await fetch(`${API}api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:q,context:{provider:selectedProvider==='auto' ? '' : selectedProvider}})}); const d=await r.json();
      setActiveProvider(d.provider || 'offline'); setMessages(m=>[...m,{role:'nadaa',text:d.action?.risk==='CONFIRM' ? `${d.text || 'I can do that.'}\n\nAction requested: ${d.action.name}. I need your confirmation before executing it.` : (d.text || 'I could not answer that.')}]);
      if(d.action?.name==='open_whatsapp'){ window.location.href='whatsapp://'; }
      if(d.action?.name?.startsWith('generate_')){ const kind=d.action.name.replace('generate_','').replace('docx','docx').replace('pptx','pptx'); const rr=await fetch(`${API}api/generate/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:q})}); if(rr.ok){ const blob=await rr.blob(); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=kind==='pdf'?'nadaa-document.pdf':kind==='docx'?'nadaa-document.docx':'nadaa-presentation.pptx'; a.click(); URL.revokeObjectURL(a.href); }}
    } catch(e){setMessages(m=>[...m,{role:'nadaa',text:`Gateway unavailable: ${String(e)}`}])} finally{setStatus('READY')}
  }

  async function startLive(){
    if(live){ stream.current?.getTracks().forEach(t=>t.stop()); ws.current?.close(); audioCtx.current?.close(); setLive(false); setStatus('READY'); return; }
    try{
      const gate=await recordWav(2); const gateBytes=new Uint8Array(await gate.arrayBuffer()); let gateBin=''; for(const b of gateBytes) gateBin+=String.fromCharCode(b);
      const vr=await fetch(`${API}api/voice/verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio_base64:btoa(gateBin)})}); const vd=await vr.json();
      if(vd.creator_verified!==true) throw new Error('Creator voice not verified. Enroll the creator voice first or try again in a quiet room.');
      const tokenRes=await fetch(`${API}api/live-token`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voice_name:'Aoede'})}); const token=await tokenRes.json();
      if(!token.token) throw new Error(token.detail || 'No Live token');
      const socket=new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token.token)}`);
      ws.current=socket; setStatus('CONNECTING');
      socket.onopen=async()=>{ setLive(true);setStatus('LISTENING'); socket.send(JSON.stringify({setup:{model:`models/${token.model}`,generationConfig:{responseModalities:['AUDIO']}}}));
        const s=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1}});stream.current=s; audioCtx.current=new AudioContext(); const src=audioCtx.current.createMediaStreamSource(s); const proc=audioCtx.current.createScriptProcessor(4096,1,1);
        proc.onaudioprocess=(ev)=>{const data=ev.inputBuffer.getChannelData(0); const pcm=new Int16Array(data.length); for(let i=0;i<data.length;i++)pcm[i]=Math.max(-1,Math.min(1,data[i]))*32767; let bin='';const bytes=new Uint8Array(pcm.buffer);for(const b of bytes)bin+=String.fromCharCode(b); socket.send(JSON.stringify({realtimeInput:{mediaChunks:[{mimeType:'audio/pcm;rate=16000',data:btoa(bin)}]}}));}; src.connect(proc);proc.connect(audioCtx.current.destination);
      };
      socket.onmessage=(ev)=>{try{const d=JSON.parse(ev.data); const parts=d.serverContent?.modelTurn?.parts||[]; const txt=parts.find((p:any)=>p.text)?.text; const audio=parts.find((p:any)=>p.inlineData?.mimeType?.startsWith('audio/'))?.inlineData?.data; if(txt)setMessages(m=>[...m,{role:'nadaa',text:txt}]); if(audio)void playPcm24k(audio);}catch{}}
      socket.onerror=()=>setStatus('LIVE ERROR'); socket.onclose=()=>{setLive(false);setStatus('READY')};
    }catch(e){setStatus('LIVE UNAVAILABLE');setMessages(m=>[...m,{role:'nadaa',text:`Live voice could not start: ${String(e)}`}])}
  }

  async function openUrl(){if(!url.trim())return;const r=await fetch(`${API}api/fetch-url`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});const d=await r.json();setMessages(m=>[...m,{role:'nadaa',text:`I read ${d.title || d.url}.\n\n${d.text?.slice(0,1200) || 'No text extracted.'}`}] );setUrl('')}

  async function uploadFile(e:React.ChangeEvent<HTMLInputElement>){const f=e.target.files?.[0]; if(!f)return; setFileName(f.name); const fd=new FormData();fd.append('file',f);const r=await fetch(`${API}api/upload`,{method:'POST',body:fd});const d=await r.json();setMessages(m=>[...m,{role:'nadaa',text:`File received: ${d.filename}. I can now use the file as a workspace input.`}])}

  return <div className="app-shell">
    <div className="app-glow"/>
    <header className="app-header">
      <div className="app-brand"><div className="brand">NADAA</div><div className="sub">AI ASSISTANT · NAH-DAH</div></div>
      <div className="pill">● {status}</div>
    </header>

    <main className="app-main">
      <aside className="app-sidebar">
        <div className="avatar"><Morbius/></div>
        <div className="assistant-name">Nadaa</div>
        <div className="assistant-copy">Your personal AI assistant powered by MPI.</div>
        <button onClick={startLive} className={`voice-button ${live?'danger':'primary'}`}>{live?'Stop voice':'Start voice'}</button>
        <button onClick={enrollCreator} className="secondary-button">Enroll creator voice</button>
        <div className="sidebar-section"><span>STATUS</span><b>{live?'VOICE ACTIVE':'READY'}</b></div>
        <div className="sidebar-section"><span>MODEL ROUTING</span><b>MPI · FREE-FIRST · {activeProvider.toUpperCase()}</b><select className="provider-select" value={selectedProvider} onChange={e=>setSelectedProvider(e.target.value)}><option value="auto">AUTO · FALLBACK</option>{Object.entries(providers).filter(([,on])=>on).map(([name])=><option key={name} value={name}>{name.toUpperCase()}</option>)}</select></div>
        <div className="provider-list">{Object.entries(providers).map(([name,on])=><span key={name} className={on?'provider-on':'provider-off'}>{on?'●':'○'} {name}</span>)}</div>
      </aside>

      <section className="chat-panel">
        <div className="chat-topbar"><div><b>Conversation</b><span>Nadaa · your AI assistant</span></div><div className="top-actions"><button onClick={()=>setMessages([{role:'nadaa',text:'Hello. I am Nadaa — nah-dah. How can I help?'}])}>New chat</button></div></div>
        <div className="messages">{messages.map((m,i)=><div key={i} className={`msg ${m.role}`}><div className="tag">{m.role==='nadaa'?'NADAA':'YOU'}</div><div className="bubble">{m.text}</div></div>)}</div>
        <div className="composer"><button className="attach" onClick={()=>document.getElementById('nadaa-file')?.click()}>+</button><input id="nadaa-file" className="hidden-file" type="file" onChange={uploadFile}/><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendText()} placeholder="Message Nadaa…"/><button className="send" onClick={sendText}>↗</button></div>
      </section>

      <aside className="tools-panel">
        <div className="tools-title">Tools</div>
        <div className="tool-card"><b>FILES</b><span>{fileName || 'Upload images, PDFs and documents'}</span></div>
        <div className="tool-card"><b>LINK READER</b><div className="row compact"><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/><button onClick={openUrl}>Read</button></div></div>
        <div className="tool-card"><b>ACTIONS</b><span>WhatsApp, calls and app handoff through the native bridge.</span></div>
        <div className="tool-card"><b>EXPORT</b><span>PDF · DOCX · PPTX · LaTeX</span></div>
        <div className="notice">External or destructive actions require confirmation.</div>
      </aside>
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<App/>);
