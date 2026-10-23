// Import the actual REA CLI validation artifacts; do not infer a successful result.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const base=new URL('../artifacts/notepad/',import.meta.url);
const summary=JSON.parse(readFileSync(new URL('summary.json',base),'utf8'));
const observe=JSON.parse(readFileSync(new URL('observe.json',base),'utf8'));
const scenario=JSON.parse(readFileSync(new URL('scenario.json',base),'utf8'));
if(summary.status!=='passed'||summary.outcome!=='completed'||summary.text!==summary.read_back) throw new Error('Validation evidence is not a successful exact read-back');
const step=scenario.parameters.steps[0];
if(step.kind!=='key-entry'||step.text!==summary.text) throw new Error('Scenario step and summary do not match');
copyFileSync(new URL('after.png',base),new URL('./assets/evidence/notepad-after.png',import.meta.url));
copyFileSync(new URL('before.png',base),new URL('./assets/evidence/notepad-before.png',import.meta.url));
const c={
 validationLevel:'Real REA CLI; native-windows provider; local Windows Notepad',
 appName:'Windows Notepad',screenshot:'assets/evidence/notepad-after.png',
 observeCommand:`observe-native-ui\n"${summary.window.executable}"\n--pid ${summary.window.pid} --window-id ${summary.window.window_id} --json`,
 observeLines:[`provider.id: "${summary.provider.id}"`,`nodes.length: ${summary.node_count}`,`editor.path: ${JSON.stringify(summary.editor_path)}`,`editor.role: "EditControl"`,`screenshot: PNG · ${summary.screenshot.width} × ${summary.screenshot.height}`,`confidence: "${observe.confidence}"`],
 actionCommand:`capture-native-ui-scenario\n"${summary.window.executable}"\n--pid ${summary.window.pid} --window-id ${summary.window.window_id} --json`,
 actionLines:[`--steps '[{"kind":"${step.kind}","path":${JSON.stringify(step.path)},`,`"text":"${step.text}"}]'`,`outcome: "${summary.outcome}"`,`restore: "${scenario.normalized_result.restore}"`],
 readback:summary.read_back,repoUrl:'https://github.com/Northernator/rea-windows',repoLabel:'github.com/Northernator/rea-windows',
 screenshotSha256:summary.screenshot.sha256,targetSha256:summary.target_sha256,
 sources:['../artifacts/notepad/summary.json','../artifacts/notepad/observe.json','../artifacts/notepad/scenario.json'],
 note:'On-screen command excerpts omit the absolute path to scripts/rea.mjs. Full exact command arrays remain in the validation summary.'
};
writeFileSync(new URL('./evidence.json',import.meta.url),JSON.stringify(c,null,2)+'\n');
console.log(`Imported real CLI evidence: ${summary.provider.id}; ${summary.node_count} nodes; exact read-back verified`);
