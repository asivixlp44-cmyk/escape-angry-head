// Dev-only: a turntable of the Angry Head looks (open /headtest.html under `npm run dev`)
import { T, V3, scene, camera, renderer } from './engine.js';
import { HeadView, headGeometry } from './heads.js';
import { surfaceMaterial } from './materials.js';
const types = ['normal', 'fast', 'giant', 'ghost', 'boss'];
const views = types.map((t, i) => { const v = new HeadView(t); v.root.position.set((i - 2) * 13, 0, 0); scene.add(v.root); return v; });
const floor = new T.Mesh(new T.BoxGeometry(90, 1, 40), surfaceMaterial('concrete'));
floor.position.y = -0.5; floor.receiveShadow = true;
const g = floor.geometry, n = g.attributes.position.count, c = new Float32Array(n * 3).fill(0.75); g.setAttribute('color', new T.BufferAttribute(c, 3));
scene.add(floor);
const q = new URLSearchParams(location.search);
const yaw = +(q.get('yaw') || 0), dist = +(q.get('dist') || 34), focus = q.get('focus');
let t = +(q.get('t') || 1);
function frame() {
    const dt = 1 / 60; t += dt;
    views.forEach((v, i) => { v.root.rotation.y = yaw; v.root.updateMatrixWorld(); v.animate(dt, t, +(q.get('mode') || 1), 8, camera.position); });
    const fx = focus !== null ? (focus - 2) * 13 : 0;
    camera.position.set(fx + Math.sin(yaw) * 0 , 6 + (+(q.get('cy') || 0)), dist);
    camera.lookAt(fx, 5.5, 0);
    renderer.render(scene, camera);
    if (!window.__stop) requestAnimationFrame(frame);
}
frame();
window.__ready = true;
void V3; void headGeometry;
