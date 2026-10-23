// Rebuild the editorial scenes from recorded validation evidence. No runtime fetches.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const c = JSON.parse(readFileSync(new URL('./evidence.json', import.meta.url), 'utf8'));
for (const key of ['appName','screenshot','observeCommand','observeLines','actionCommand','actionLines','readback','repoUrl','repoLabel']) {
  if (!c[key] || (Array.isArray(c[key]) && !c[key].length)) throw new Error(`Missing recorded evidence: ${key}`);
}
if (!existsSync(new URL(`./${c.screenshot}`, import.meta.url))) throw new Error('Recorded screenshot is missing');
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const styles = `
#root{position:absolute;inset:0;overflow:hidden;font-family:Inter,sans-serif;color:#151719}
.fill{position:absolute;inset:0;background:#e9ecef}
.fill.dark{background:#171a1d}
.heading{position:absolute;left:192px;top:112px;margin:0;font-size:86px;line-height:1.1;letter-spacing:-.045em;font-weight:720;max-width:1550px}
.sub{position:absolute;left:196px;top:237px;margin:0;font-size:34px;font-weight:500;line-height:1.4;color:#50575c}
.screen{position:absolute;left:120px;top:330px;width:1680px;height:650px;overflow:hidden}
.screen img{display:block;width:100%;height:auto;min-height:100%;object-fit:cover;object-position:top}
.mono{font-family:'JetBrains Mono',monospace}
.terminal{position:absolute;left:192px;top:320px;width:1536px;color:#f7f8f9;font-family:'JetBrains Mono',monospace;font-size:35px;line-height:1.55}
.command{margin:0 0 40px;white-space:pre-wrap;overflow-wrap:anywhere;color:#ffad8e}
.output{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;min-height:54px}
.muted{color:#aab2b8}
.label{color:#50575c;font-size:34px;font-weight:500}
.readbar{position:absolute;inset:auto 0 0;height:340px;background:#171a1d;color:#f7f8f9;padding:30px 192px;font-family:'JetBrains Mono',monospace}
.readlabel{font-size:29px;line-height:1.3;margin:0 0 10px;color:#aab2b8}.value{font-size:68px;line-height:1.1;margin:0;letter-spacing:-.025em;color:#ffad8e}.value span{display:block}
.orange{color:#c13d13}
`;
function scene(id, duration, content, animation, extra='') {
 const html=`<!doctype html><html><body><template><style>${styles}${extra}</style><div id="root" data-composition-id="${id}" data-start="0" data-duration="${duration}" data-width="1920" data-height="1080">${content}</div><script>const tl=gsap.timeline({paused:true});${animation}window.__timelines['${id}']=tl;</script></template></body></html>\n`;
 writeFileSync(new URL(`./compositions/${id}.html`,import.meta.url),html);
}
const image=(id,cls='screen')=>`<div class="${cls}" data-layout-allow-overflow="true"><img id="${id}-capture" src="${esc(c.screenshot)}" alt="${esc(c.appName)} captured during the local REA Windows test"></div>`;
scene('window',4,`
 <div class="fill"></div><div id="window-content" class="clip" data-start="0" data-duration="4" data-track-index="0" data-beat="Real Windows application" data-hold="true">
 <h1 class="heading">A real Windows window</h1><p class="sub">${esc(c.appName)} · captured during validation</p>${image('window')}</div>`,
 `tl.fromTo('.screen',{scale:1.1,y:20},{scale:1,y:0,duration:.6,ease:'power3.inOut'},.1);`);
const observeLines=c.observeLines.map((line,i)=>`<p id="observe-line-${i}" class="output">${esc(line)}</p>`).join('');
scene('observe',5,`
 <div class="fill dark"></div><div id="observe-content" class="clip" data-start="0" data-duration="5" data-track-index="0" data-beat="Observe native UI" data-hold="true">
 <h1 class="heading" style="color:#f7f8f9">Observe its native UI</h1><p class="sub" style="color:#aab2b8">REA CLI · recorded command and evidence excerpts</p>
 <div class="terminal"><p class="command">${esc(c.observeCommand)}</p>${observeLines}</div></div>`,
 `tl.fromTo('.command',{x:70,opacity:0},{x:0,opacity:1,duration:.4,ease:'power3.out'},0);tl.fromTo('.output',{opacity:0},{opacity:1,duration:.16,stagger:.16},.7);`);
const actionLines=c.actionLines.map((line,i)=>`<p id="action-line-${i}" class="output">${esc(line)}</p>`).join('');
scene('action',6,`
 <div class="fill dark"></div><div id="action-content" class="clip" data-start="0" data-duration="6" data-track-index="0" data-beat="Explicit scenario action" data-hold="true">
 <h1 class="heading" style="color:#f7f8f9">Drive one explicit action</h1><p class="sub" style="color:#aab2b8">REA CLI · recorded command and scenario excerpts</p>
 <div class="terminal"><p class="command">${esc(c.actionCommand)}</p>${actionLines}</div></div>`,
 `tl.fromTo('.command',{opacity:0},{opacity:1,duration:.3},0);tl.fromTo('.output',{opacity:0},{opacity:1,duration:.16,stagger:.17},2.2);`);
scene('readback',5,`
 <div class="fill"></div><div id="readback-content" class="clip" data-start="0" data-duration="5" data-track-index="0" data-beat="Read back the result" data-hold="true">
 <h1 class="heading">Read back the result</h1><p class="sub">The UI value matches the requested action</p>${image('readback','readscreen')}
 <div class="readbar"><p class="readlabel">Observed value · exact read-back</p><p class="value">${c.readback.split(' + ').map((v,i)=>`<span>${i?' + ':''}${esc(v)}</span>`).join('')}</p></div></div>`,
 `tl.fromTo('.readscreen',{scale:1.05},{scale:1,duration:.55,ease:'power3.inOut'},0);tl.fromTo('.readbar',{y:360},{y:0,duration:.5,ease:'power3.out'},.55);`,
 `.readscreen{position:absolute;left:120px;top:302px;width:1680px;height:408px;overflow:hidden}.readscreen img{width:100%;height:auto;min-height:100%;object-fit:cover;object-position:top}`);
scene('proof',3,`
 <div class="fill"></div><div id="proof-content" class="clip" data-start="0" data-duration="3" data-track-index="0" data-beat="Evidence captured">
 <h1 class="heading">Every step leaves evidence</h1><p class="sub">Before + after snapshots · PNG + SHA-256</p>${image('proof')}</div>`,
 `tl.fromTo('.screen',{x:100,opacity:0},{x:0,opacity:1,duration:.45,ease:'power3.out'},0);`);
scene('end',3,`
 <div class="fill"></div><div id="end-content" class="clip" data-start="0" data-duration="3" data-track-index="0" data-beat="Repository">
 <div class="end-title"><h1 data-var-text="product">REA Windows</h1></div><p class="end-line">Native UI. Real evidence.</p><p class="end-url mono">${esc(c.repoLabel)}</p><p class="music-credit">Music: Cipher · Kevin MacLeod · CC BY 4.0</p></div>`,
 `tl.fromTo('.end-title h1',{x:-120},{x:0,duration:.4,ease:'power3.out'},0);tl.fromTo('.end-line',{opacity:0},{opacity:1,duration:.2},.32);tl.fromTo('.end-url',{opacity:0},{opacity:1,duration:.2},.45);`,
 `.end-title{position:absolute;left:192px;top:230px;overflow:hidden;width:1536px}.end-title h1{font-size:154px;line-height:1.08;letter-spacing:-.06em;margin:0;font-weight:750}.end-line{position:absolute;left:198px;top:480px;font-size:58px;margin:0;font-weight:500;letter-spacing:-.03em}.end-url{position:absolute;left:198px;top:700px;font-size:39px;margin:0;color:#c13d13;line-height:1.4}.music-credit{position:absolute;left:198px;top:910px;font-size:28px;line-height:1.4;color:#50575c;margin:0}`);
console.log('Rebuilt six source-backed scenes from evidence.json');
