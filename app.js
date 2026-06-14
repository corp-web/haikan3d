/* 配管3D — 3Dモデル空間 + AutoCAD風ビューキューブ
   ・床下も回れる視点 / 床グリッド・座標軸（modelGroup）
   ・右上ビューキューブ：面クリックで正対＋平行投影、二重リング＋東西南北
   ・ホーム＝初期視点、円弧矢印＝平行投影時のみ画面90°ロール
   ・視点切替はトゥイーンでなめらかに移行
   制御方針：平行投影(ortho)中はOrbitControlsを止め、こちらでカメラを所有する。
            画面をドラッグしたら up を(0,1,0)に戻してから OrbitControls を再開する
            （OrbitControls に Y以外の up を絶対に渡さない＝フリーズ防止）。 */

const vp = document.getElementById('viewport');

// ---- レンダラ ----
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.autoClear = false;
vp.appendChild(renderer.domElement);

// ---- シーン ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141c33);
scene.fog = new THREE.Fog(0x141c33, 18, 60);

// ---- カメラ ----
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
const HOME = { pos: new THREE.Vector3(0.9, 0.75, 1.2), target: new THREE.Vector3(0, 0, 0) };
camera.position.copy(HOME.pos);

// ---- 視点操作 (OrbitControls) ----
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.copy(HOME.target);
controls.minDistance = 0.08;
controls.maxDistance = 80;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
// 左=回転 / 中ボタン(ホイール押し込み)ドラッグ=画面移動(パン) / 右=移動。ホイール回転はズーム。
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

// ---- 平行投影カメラ（面クリック時に使用。透視カメラへ毎フレーム同期） ----
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 2000);
let useOrtho = false;
function activeCam() { return useOrtho ? orthoCam : camera; }
function syncOrtho() {
  const t = controls.target;
  const dist = camera.position.distanceTo(t);
  orthoCam.position.copy(camera.position);
  orthoCam.up.copy(camera.up);
  orthoCam.lookAt(t);
  const halfH = Math.tan((camera.fov / 2) * Math.PI / 180) * dist;
  const halfW = halfH * camera.aspect;
  orthoCam.left = -halfW; orthoCam.right = halfW;
  orthoCam.top = halfH;  orthoCam.bottom = -halfH;
  orthoCam.updateProjectionMatrix();
}

// ---- ライト ----
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.95);
key.position.set(8, 12, 6); scene.add(key);
const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
fill.position.set(-8, 4, -6); scene.add(fill);

// ---- モデル空間（配管はここに入れる） ----
const modelGroup = new THREE.Group();
scene.add(modelGroup);
let grid = null;
function buildGrid(c1, c2) {
  if (grid) { modelGroup.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
  grid = new THREE.GridHelper(20, 40, c1, c2);
  grid.material.opacity = 0.6; grid.material.transparent = true;
  modelGroup.add(grid);
}
buildGrid(0x4a5a8a, 0x2a3a5c);
// ---- 明暗テーマ（背景・グリッド・UI を一括切替） ----
let lightMode = false;
function setLightMode(on) {
  lightMode = !!on;
  const bg = lightMode ? 0xd2dbe8 : 0x141c33;   // 白モードは少し青みグレー＝白線も見やすく
  scene.background = new THREE.Color(bg);
  if (typeof renderer !== 'undefined' && renderer) renderer.setClearColor(bg, 1);
  buildGrid(lightMode ? 0x8a96b4 : 0x4a5a8a, lightMode ? 0xb6c0d4 : 0x2a3a5c);
  if (gizmo && gizmo.applyTheme) gizmo.applyTheme(lightMode);
  if (window.__rebuildAllAnns) window.__rebuildAllAnns();   // 構築線・寸法線の合成方式を切替に反映（色を保つ）
  document.body.classList.toggle('light', lightMode);
  const b = document.getElementById('cmdTheme');
  if (b) b.title = lightMode ? '背景をダークに戻す' : '背景をホワイトに切替';
}
// 座標軸は原点ではなく画面左下隅に小さく描く（axisGizmo・下部で構築/描画）

// ---- アンドゥ／リドゥ：操作後に状態スナップショットを取る（capture最先頭で登録し、setTimeoutで操作完了後に実行）----
['pointerup', 'keyup', 'input', 'change'].forEach(ev =>
  window.addEventListener(ev, () => { if (window.__scheduleHistory) window.__scheduleHistory(); }, true));
window.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;   // 入力欄はブラウザ標準のundoに任せる
  const k = (e.key || '').toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); if (window.__undo) window.__undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); if (window.__redo) window.__redo(); }
}, true);

// 作図／鏡モード中のカーソル：CAD風の十字＋中央ピックボックス（黒縁＋白で明暗どちらの背景でも視認）
const DRAW_CURSOR = (() => {
  const lines = "<line x1='20' y1='1' x2='20' y2='14'/><line x1='20' y1='26' x2='20' y2='39'/>"
    + "<line x1='1' y1='20' x2='14' y2='20'/><line x1='26' y1='20' x2='39' y2='20'/><rect x='14' y='14' width='12' height='12'/>";
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>"
    + "<g fill='none' stroke='black' stroke-width='1.6'>" + lines + "</g>"
    + "<g fill='none' stroke='white' stroke-width='0.7'>" + lines + "</g></svg>";
  return "url(\"data:image/svg+xml;utf8," + encodeURIComponent(svg) + "\") 20 20, crosshair";
})();

// ===================================================================
//  ビューキューブ（画面右上の独立ギズモ・別シーン）
// ===================================================================
const GIZMO_CAM_DIST = 8.6;
const gizmo = {};
(function buildGizmo() {
  const gScene = new THREE.Scene();
  const gCam = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
  gCam.position.set(0, 0, GIZMO_CAM_DIST);
  gCam.lookAt(0, 0, 0);
  // 立体感のある照明：空/地の自然グラデ(HemisphereLight)＋斜め上のキーライト＋弱い補助光。
  // 各面の明るさが向きで変わり、より現実のキューブらしく見える。
  gScene.add(new THREE.HemisphereLight(0xffffff, 0x6b7280, 0.95));
  const gl = new THREE.DirectionalLight(0xffffff, 0.85);
  gl.position.set(3.5, 6, 4.5); gScene.add(gl);
  const glFill = new THREE.DirectionalLight(0xffffff, 0.22);
  glFill.position.set(-4, -1.5, -3); gScene.add(glFill);

  const globe = new THREE.Group();
  const cubeSize = 1.5;

  // 明暗テーマの色（ダーク背景＝明るいキューブ／ホワイト背景＝濃いめのキューブ）
  const GIZ_THEME = {
    dark:  { g0: '#eef1f6', g1: '#d2d7e0', border: '#aab2c2', text: '#566072', edge: 0x9aa2b2, dir: '#cdd5e2' },
    light: { g0: '#ccd4e2', g1: '#aab4c6', border: '#8b95aa', text: '#2a3344', edge: 0x7c8498, dir: '#46506a' },
  };
  let gizPal = GIZ_THEME.dark;
  function faceTexture(text) {
    const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    // 面はほぼ一様色（陰影は3D照明側で付ける＝向きに応じた立体感）。中心をわずかに明るくして艶を演出。
    const rg = ctx.createRadialGradient(s * 0.42, s * 0.40, s * 0.05, s * 0.5, s * 0.5, s * 0.72);
    rg.addColorStop(0, gizPal.g0); rg.addColorStop(1, gizPal.g1);
    ctx.fillStyle = rg; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = gizPal.border; ctx.lineWidth = 6; ctx.strokeRect(3, 3, s - 6, s - 6);
    ctx.fillStyle = gizPal.text;
    ctx.font = '116px "Hiragino Kaku Gothic ProN","Meiryo","Segoe UI",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, s / 2, s / 2 + 6);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter; tex.anisotropy = 4;
    return tex;
  }
  const FACE_TEXTS = ['右', '左', '上', '下', '前', '後'];
  const faceMat = t => new THREE.MeshStandardMaterial({ map: faceTexture(t), color: 0xffffff, roughness: 0.58, metalness: 0.06 });
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize),
    FACE_TEXTS.map(faceMat)
  );
  globe.add(cube);
  gizmo.cube = cube;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize)),
    new THREE.LineBasicMaterial({ color: gizPal.edge })
  );
  globe.add(edges);
  const dirPlanes = [];   // 方位ラベル（北南東西）の再着色用

  const compass = new THREE.Group();
  compass.position.y = -cubeSize * 0.55;
  globe.add(compass);
  function thinRing(rIn, rOut) {
    const r = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 80),
      new THREE.MeshBasicMaterial({ color: 0x6f7c96, side: THREE.DoubleSide, transparent: true, opacity: 0.45 }));
    r.rotation.x = -Math.PI / 2; return r;
  }
  const ringInner = cubeSize * 1.18, ringOuter = cubeSize * 1.62;
  compass.add(thinRing(ringInner - 0.04, ringInner));
  compass.add(thinRing(ringOuter - 0.05, ringOuter));

  function dirTexture(text) {
    const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = gizPal.dir;
    ctx.font = 'bold 96px "Hiragino Kaku Gothic ProN","Meiryo","Segoe UI",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, s / 2, s / 2 + 4);
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.anisotropy = 4;
    return tex;
  }
  function dirPlane(text, rotZ) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72),
      new THREE.MeshBasicMaterial({ map: dirTexture(text), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    pl.rotation.x = -Math.PI / 2; pl.rotation.z = rotZ;
    dirPlanes.push({ mesh: pl, text });
    return pl;
  }
  const RL = (ringInner + ringOuter) / 2;
  [{ t:'北', x:0, z:-RL, rz:0 }, { t:'南', x:0, z:RL, rz:Math.PI },
   { t:'東', x:RL, z:0, rz:-Math.PI/2 }, { t:'西', x:-RL, z:0, rz:Math.PI/2 }]
    .forEach(m => { const pl = dirPlane(m.t, m.rz); pl.position.set(m.x, 0.01, m.z); compass.add(pl); });

  gScene.add(globe);
  gizmo.scene = gScene;
  gizmo.cam = gCam;
  // 明暗テーマの適用（背景は透明＝3D背景に乗るので、キューブ自体の色を切替）
  gizmo.applyTheme = (light) => {
    gizPal = light ? GIZ_THEME.light : GIZ_THEME.dark;
    FACE_TEXTS.forEach((t, i) => { const m = cube.material[i]; if (m.map) m.map.dispose(); m.map = faceTexture(t); m.needsUpdate = true; });
    edges.material.color.setHex(gizPal.edge);
    for (const d of dirPlanes) { if (d.mesh.material.map) d.mesh.material.map.dispose(); d.mesh.material.map = dirTexture(d.text); d.mesh.material.needsUpdate = true; }
  };
})();

// ===================================================================
//  座標軸インジケータ（画面左下の小さな別シーン・視点に連動して回る）
//  赤=X / 緑=Y / 青=Z。原点の AxesHelper の代わり。
// ===================================================================
const AXIS_PX = 84;            // 描画サイズ(px)・ビューキューブより小さく
const AXIS_MARGIN = 12;
const axisGizmo = {};
(function buildAxisGizmo() {
  const aScene = new THREE.Scene();
  const aCam = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
  const L = 1.0;                // 軸の長さ
  const dirs = [
    { d: new THREE.Vector3(1, 0, 0), c: 0xff5a5a, t: 'X' },   // 赤
    { d: new THREE.Vector3(0, 1, 0), c: 0x5ad27a, t: 'Y' },   // 緑
    { d: new THREE.Vector3(0, 0, 1), c: 0x5a8aff, t: 'Z' },   // 青
  ];
  function label(text, color) {
    const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.font = 'bold 46px "Segoe UI",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, s / 2, s / 2 + 2);
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.anisotropy = 4;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.setScalar(0.5);
    return sp;
  }
  dirs.forEach(a => {
    const arrow = new THREE.ArrowHelper(a.d, new THREE.Vector3(0, 0, 0), L, a.c, 0.26, 0.16);
    aScene.add(arrow);
    const lab = label(a.t, a.c);
    lab.position.copy(a.d.clone().multiplyScalar(L + 0.28));
    aScene.add(lab);
  });
  axisGizmo.scene = aScene;
  axisGizmo.cam = aCam;
})();

// ---- リサイズ ----
function resize() {
  const w = vp.clientWidth, h = vp.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ===================================================================
//  視点状態の管理
//  mode: 'orbit'（OrbitControlsで自由操作）/ 'ortho'（平行投影固定・controls停止）
//  tween 中は両方停止してこちらでカメラを動かす。
// ===================================================================
let tween = null;
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function orientQuat(eye, target, up) {
  const m = new THREE.Matrix4().lookAt(eye, target, up);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
// なめらか移行。orthoAfter=trueなら移行後に平行投影固定モードへ。
function flyTo(endPos, endTarget, endUp, orthoAfter) {
  tween = {
    t: 0, dur: 450,
    startTarget: controls.target.clone(),
    endTarget: endTarget.clone(),
    startDist: camera.position.distanceTo(controls.target),
    endDist: endPos.distanceTo(endTarget),
    qStart: orientQuat(camera.position, controls.target, camera.up),
    qEnd: orientQuat(endPos, endTarget, endUp),
    endUp: endUp.clone(),
    orthoAfter,
  };
  controls.enabled = false;       // 移行中は OrbitControls 停止
}
function updateTween(dtMs) {
  try {
    tween.t = Math.min(1, tween.t + dtMs / tween.dur);
    const e = easeInOut(tween.t);
    // 確実なインスタンスAPI（slerp）で補間
    const q = tween.qStart.clone().slerp(tween.qEnd, e);
    const target = tween.startTarget.clone().lerp(tween.endTarget, e);
    const dist = tween.startDist + (tween.endDist - tween.startDist) * e;
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(dist));
    camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(q));
    camera.lookAt(target);
    if (tween.t >= 1) {
      const orthoAfter = tween.orthoAfter;
      tween = null;
      useOrtho = orthoAfter;
      if (!useOrtho) {
        camera.up.set(0, 1, 0);
        camera.lookAt(controls.target);
        controls.enabled = true;
      } else {
        controls.enabled = false;
      }
      updateRollButtons();
    }
  } catch (err) {
    // 万一エラーが出ても描画ループを止めないよう、移行を打ち切って復帰
    console.error('tween error:', err);
    tween = null;
    useOrtho = false;
    camera.up.set(0, 1, 0);
    camera.lookAt(controls.target);
    controls.enabled = true;
    updateRollButtons();
  }
}

// 平行投影(ortho)モードを抜けて自由操作(orbit)へ。OrbitControls に Y-up を渡す。
function exitOrtho() {
  useOrtho = false;
  camera.up.set(0, 1, 0);
  camera.lookAt(controls.target);
  controls.enabled = true;
  updateRollButtons();
}

// ---- ホーム（初期視点へなめらかに戻る） ----
function resetView() {
  flyTo(HOME.pos.clone(), HOME.target.clone(), new THREE.Vector3(0, 1, 0), false);
}
document.getElementById('homeBtn').onclick = resetView;

// ---- 画面ロール（平行投影時のみ・なめらかに90°回す） ----
function rollView(sign) {
  if (!useOrtho || tween) return;
  const axis = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  const q = new THREE.Quaternion().setFromAxisAngle(axis, sign * Math.PI / 2);
  const endUp = camera.up.clone().applyQuaternion(q).normalize();
  flyTo(camera.position.clone(), controls.target.clone(), endUp, true);   // 平行投影を保ったまま回す
}
document.getElementById('rollCCW').onclick = () => rollView(1);
document.getElementById('rollCW').onclick  = () => rollView(-1);

// ---- 尺度（平行投影での表示倍率）。CSS 96dpi 基準で 1モデルm→画面px を物理尺度に合わせる ----
const PX_PER_M = 96 / 0.0254;   // CSS px / 物理m（96dpi）
const SCALE_OPTS = [
  ['1:1', 1], ['1:2', 0.5], ['1:4', 0.25], ['1:5', 0.2], ['1:8', 0.125], ['1:10', 0.1], ['1:16', 0.0625],
  ['1:20', 0.05], ['1:30', 1 / 30], ['1:40', 0.025], ['1:50', 0.02], ['1:100', 0.01],
  ['2:1', 2], ['4:1', 4], ['8:1', 8], ['10:1', 10], ['100:1', 100],
];
function setScale(f) {
  if (!f || f <= 0 || tween) return;
  if (!useOrtho) { useOrtho = true; controls.enabled = false; updateRollButtons(); }   // 尺度は平行投影で意味を持つ
  const h = renderer.domElement.clientHeight || window.innerHeight;
  const halfH = h / (2 * f * PX_PER_M);
  const dist = halfH / Math.tan((camera.fov / 2) * Math.PI / 180);
  const t = controls.target;
  const dir = camera.position.clone().sub(t);
  if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1);
  dir.normalize();
  camera.position.copy(t).addScaledVector(dir, dist);
  camera.lookAt(t);
  syncOrtho();
}
function currentScaleF() {
  const dist = camera.position.distanceTo(controls.target);
  const halfH = Math.tan((camera.fov / 2) * Math.PI / 180) * dist;
  const h = renderer.domElement.clientHeight || window.innerHeight;
  return halfH > 1e-9 ? (h / (2 * halfH)) / PX_PER_M : 0;
}
function fmtScaleF(f) {
  if (!isFinite(f) || f <= 0) return '—';
  if (f >= 1) { const n = Math.round(f * 10) / 10; return (Number.isInteger(n) ? n : n.toFixed(1)) + ':1'; }
  return '1:' + Math.round(1 / f);
}
// 平行投影(尺度表示)中もホイールで拡縮できるように（OrbitControlsは停止中のため自前で）
renderer.domElement.addEventListener('wheel', e => {
  if (!useOrtho || tween) return;   // 透視投影は OrbitControls が処理
  e.preventDefault();
  zoomStep(e.deltaY > 0 ? 1.1 : 1 / 1.1);
}, { passive: false });
(function setupScale() {
  const sel = document.getElementById('scaleSel');
  if (!sel) return;
  const ph = sel.options[0];   // 先頭の表示欄（value=""）に現在尺度を出す
  for (const [label, f] of SCALE_OPTS) { const o = document.createElement('option'); o.value = String(f); o.textContent = label; sel.appendChild(o); }
  sel.addEventListener('change', () => { const f = parseFloat(sel.value); if (f > 0) setScale(f); sel.value = ''; });
  let last = '';
  window.__updateScaleLabel = () => { const s = fmtScaleF(currentScaleF()); if (s !== last) { last = s; if (ph) ph.textContent = s; } };
})();

function updateRollButtons() {
  [document.getElementById('rollCCW'), document.getElementById('rollCW')].forEach(b => {
    if (b) b.classList.toggle('disabled', !useOrtho);
  });
}

// ---- ビューキューブ面クリック → 正対＋平行投影（なめらかに移行） ----
function snapToDir(dir) {
  const t = controls.target;
  const dist = camera.position.distanceTo(t);
  const endPos = t.clone().add(dir.clone().multiplyScalar(dist));
  const endUp = Math.abs(dir.y) > 0.99
    ? new THREE.Vector3(0, 0, dir.y > 0 ? -1 : 1)
    : new THREE.Vector3(0, 1, 0);
  flyTo(endPos, t.clone(), endUp, true);
}

// ---- ギズモ領域のクリック判定 ----
const GIZMO_PX = 140;
const GIZMO_MARGIN = 12;
const RIBBON_H = 46;            // 下部リボンの高さ（左下の座標軸インジケータをこの分だけ上へ逃がす）
const gizmoRay = new THREE.Raycaster();
const gizmoNdc = new THREE.Vector2();
let gizmoDown = null;
function gizmoRect() {
  const w = renderer.domElement.clientWidth;
  return { x0: w - GIZMO_PX - GIZMO_MARGIN, y0: GIZMO_MARGIN, size: GIZMO_PX };
}
function inGizmo(px, py) {
  const r = gizmoRect();
  return px >= r.x0 && px <= r.x0 + r.size && py >= r.y0 && py <= r.y0 + r.size;
}

renderer.domElement.addEventListener('pointerdown', e => {
  const rect = renderer.domElement.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  if (inGizmo(px, py)) {
    gizmoDown = { x: e.clientX, y: e.clientY };
    return;
  }
  // ギズモ外をドラッグし始めたら、平行投影モードを抜けて自由操作へ
  if (useOrtho && !tween) exitOrtho();
});

renderer.domElement.addEventListener('pointerup', e => {
  if (!gizmoDown) return;
  const moved = Math.hypot(e.clientX - gizmoDown.x, e.clientY - gizmoDown.y);
  gizmoDown = null;
  if (moved > 6) return;                 // ドラッグは無視（タップのみ）
  const rect = renderer.domElement.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  if (!inGizmo(px, py)) return;
  const r = gizmoRect();
  gizmoNdc.x = ((px - r.x0) / r.size) * 2 - 1;
  gizmoNdc.y = -((py - r.y0) / r.size) * 2 + 1;
  gizmoRay.setFromCamera(gizmoNdc, gizmo.cam);
  const hits = gizmoRay.intersectObject(gizmo.cube, false);
  if (!hits.length) return;
  const n = hits[0].face.normal.clone().transformDirection(gizmo.cube.matrixWorld).normalize();
  snapToDir(n);
});

// ---- ギズモを画面右上に描く ----
function renderGizmo() {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  gizmo.cam.position.copy(dir.clone().multiplyScalar(GIZMO_CAM_DIST));
  gizmo.cam.up.copy(camera.up);
  gizmo.cam.lookAt(0, 0, 0);
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  const x = w - GIZMO_PX - GIZMO_MARGIN, y = h - GIZMO_PX - GIZMO_MARGIN;
  renderer.setViewport(x, y, GIZMO_PX, GIZMO_PX);
  renderer.setScissor(x, y, GIZMO_PX, GIZMO_PX);
  renderer.setScissorTest(true);
  renderer.clear(false, true, false);   // 色は消さず深度のみ＝背景は3Dシーンのまま（透明）。キューブが背景に乗る
  renderer.render(gizmo.scene, gizmo.cam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
}

// ---- 座標軸インジケータを画面左下に描く ----
const AXIS_CAM_DIST = 5.2;
function renderAxisGizmo() {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  axisGizmo.cam.position.copy(dir.clone().multiplyScalar(AXIS_CAM_DIST));
  axisGizmo.cam.up.copy(camera.up);
  axisGizmo.cam.lookAt(0, 0, 0);
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  const x = AXIS_MARGIN, y = AXIS_MARGIN + RIBBON_H;   // 左下（WebGLは下原点）。下部リボンに隠れぬよう上へ逃がす
  renderer.setViewport(x, y, AXIS_PX, AXIS_PX);
  renderer.setScissor(x, y, AXIS_PX, AXIS_PX);
  renderer.setScissorTest(true);
  renderer.clear(false, true, false);               // 色は消さず深度だけ消す（背景は本シーンのまま）
  renderer.render(axisGizmo.scene, axisGizmo.cam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
}

// ===================================================================
//  部品の3D形状ビルダー
// ===================================================================
// 鋳鋼フランジ風マテリアル（濃いチャコール・つや消し気味）
const FLANGE_MAT = new THREE.MeshStandardMaterial({
  color: 0x44494f, metalness: 0.55, roughness: 0.55,
});

// ---- フランジの選択肢 ----
const FLANGE_SIZES = ['10A','15A','20A','25A','32A','40A','50A','65A','80A','100A',
  '125A','150A','200A','250A','300A','350A','400A','450A','500A'];
const FLANGE_TYPES = [
  { code: 'SOP', name: 'スリップオン' },
  { code: 'SW',  name: 'ソケットウェルド' },
  { code: 'WN',  name: 'ウェルドネック' },
  { code: 'LJ',  name: 'ルーズ(遊合)' },
  { code: 'BL',  name: 'ブラインド' },
];
// クラスごとに規格上存在するタイプ（淡路マテリアカタログ各ページの規定より）。
// 高圧クラス(JIS40K/JPI2500LB)は差込み形(SOP/LJ)が無く、WN/SW/BLのみ。
const TYPES_BY_CLASS = {
  'JIS 5K':     ['SOP','SW','WN','LJ','BL'],
  'JIS 10K':    ['SOP','SW','WN','LJ','BL'],
  'JIS 20K':    ['SOP','SW','WN','LJ','BL'],
  'JIS 40K':    ['SW','WN','BL'],
  'JPI 150LB':  ['SOP','SW','WN','BL'],
  'JPI 300LB':  ['SOP','SW','WN','BL'],
  'JPI 600LB':  ['SOP','SW','WN','BL'],
};
function typesForClass(cls) {
  const ok = TYPES_BY_CLASS[cls] || ['SOP','SW','WN','LJ','BL'];
  return FLANGE_TYPES.filter(t => ok.includes(t.code));
}
// 選択可能クラス＝寸法を規格で検証済みのものに限定（社長提供 2013_35-40.pdf でD/C/n/h/t・RF座径g を確認）。
// JIS 40K / JPI 600LB はこのPDFに無くRF座径g・WN面間が未検証のため、当面は選択肢から外す。
//   → 正規の規格寸法表（座径g・WN全長）が入手でき次第、下の UNVERIFIED を FLANGE_CLASSES に戻す。
const FLANGE_CLASSES = ['JIS 5K','JIS 10K','JIS 20K','JPI 150LB','JPI 300LB'];
const FLANGE_CLASSES_UNVERIFIED = ['JIS 40K','JPI 600LB'];   // 寸法照合待ち（復活用に保持）
const FLANGE_FACES = ['RF','FF'];

// 管外径（ボア径・mm）＝配管の外径。JIS共通。
const FLG_BORE = { '10A':17.3,'15A':21.7,'20A':27.2,'25A':34.0,'32A':42.7,'40A':48.6,'50A':60.5,
  '65A':76.3,'80A':89.1,'100A':114.3,'125A':139.8,'150A':165.2,'200A':216.3,'250A':267.4,
  '300A':318.5,'350A':355.6,'400A':406.4,'450A':457.2,'500A':508.0 };

// ソケットウェルド(SW)のソケット深さ(mm)。出典＝淡路マテリア JPIカタログ「ソケット深さ d1」。
// SWは小口径専用(〜80A)。深さはクラス150/300とも同値。
const SW_SOCKET_DEPTH = { '10A':10,'15A':10,'20A':11,'25A':13,'32A':14,'40A':16,'50A':18,'65A':19,'80A':21 };

// ===== 接続鋼管の肉厚(mm) =====
// 出典＝淡路マテリア カタログ「接続鋼管の基準厚さ」。実務で多用するスケジュールを収録。
// (-)は規格に値が無い／省略。値が無い径は内径を概算で補う。
const SCHEDULES = ['Sch5S', 'Sch10S', 'Sch20S', 'Sch40', 'Sch80', 'Sch160', 'XXS'];
const PIPE_WALL = {
  // 呼び径: { スケジュール: 肉厚t(mm) }  出典＝接続鋼管の基準厚さ（JIS/ASME標準値）
  '10A':  { 'Sch5S':1.65,'Sch10S':1.65,'Sch20S':2.0, 'Sch40':2.3, 'Sch80':3.2, 'Sch160':4.7, 'XXS':6.4 },
  '15A':  { 'Sch5S':1.65,'Sch10S':2.1, 'Sch20S':2.5, 'Sch40':2.8, 'Sch80':3.7, 'Sch160':4.7, 'XXS':7.5 },
  '20A':  { 'Sch5S':1.65,'Sch10S':2.1, 'Sch20S':2.5, 'Sch40':2.9, 'Sch80':3.9, 'Sch160':5.5, 'XXS':7.8 },
  '25A':  { 'Sch5S':1.65,'Sch10S':2.8, 'Sch20S':3.0, 'Sch40':3.4, 'Sch80':4.5, 'Sch160':6.4, 'XXS':9.1 },
  '32A':  { 'Sch5S':1.65,'Sch10S':2.8, 'Sch20S':3.0, 'Sch40':3.6, 'Sch80':4.9, 'Sch160':6.4, 'XXS':9.7 },
  '40A':  { 'Sch5S':1.65,'Sch10S':2.8, 'Sch20S':3.0, 'Sch40':3.7, 'Sch80':5.1, 'Sch160':7.1, 'XXS':10.2 },
  '50A':  { 'Sch5S':1.65,'Sch10S':2.8, 'Sch20S':3.5, 'Sch40':3.9, 'Sch80':5.5, 'Sch160':8.7, 'XXS':11.1 },
  '65A':  { 'Sch5S':2.1, 'Sch10S':3.0, 'Sch20S':3.5, 'Sch40':5.2, 'Sch80':7.0, 'Sch160':9.5, 'XXS':14.0 },
  '80A':  { 'Sch5S':2.1, 'Sch10S':3.0, 'Sch20S':4.0, 'Sch40':5.5, 'Sch80':7.6, 'Sch160':11.1,'XXS':15.2 },
  '100A': { 'Sch5S':2.1, 'Sch10S':3.0, 'Sch20S':4.0, 'Sch40':6.0, 'Sch80':8.6, 'Sch160':13.5,'XXS':17.1 },
  '125A': { 'Sch5S':2.8, 'Sch10S':3.4, 'Sch20S':5.0, 'Sch40':6.6, 'Sch80':9.5, 'Sch160':15.9,'XXS':19.0 },
  '150A': { 'Sch5S':2.8, 'Sch10S':3.4, 'Sch20S':5.0, 'Sch40':7.1, 'Sch80':11.0,'Sch160':18.2,'XXS':21.9 },
  '200A': { 'Sch5S':2.8, 'Sch10S':4.0, 'Sch20S':6.5, 'Sch40':8.2, 'Sch80':12.7,'Sch160':23.0,'XXS':22.2 },
  '250A': { 'Sch5S':3.4, 'Sch10S':4.0, 'Sch20S':6.5, 'Sch40':9.3, 'Sch80':15.1,'Sch160':28.6,'XXS':25.4 },
  '300A': { 'Sch5S':4.0, 'Sch10S':4.5, 'Sch20S':6.5, 'Sch40':10.3,'Sch80':17.4,'Sch160':33.3,'XXS':25.4 },
  '350A': { 'Sch5S':4.0, 'Sch10S':5.0, 'Sch20S':8.0, 'Sch40':11.1,'Sch80':19.0,'Sch160':35.7 },
  '400A': { 'Sch5S':4.5, 'Sch10S':5.0, 'Sch20S':8.0, 'Sch40':12.7,'Sch80':21.4,'Sch160':40.5 },
  '450A': { 'Sch5S':4.5, 'Sch10S':5.0, 'Sch20S':8.0, 'Sch40':14.3,'Sch80':23.8,'Sch160':45.2 },
  '500A': { 'Sch5S':5.0, 'Sch10S':5.5, 'Sch20S':9.5, 'Sch40':15.1,'Sch80':26.2,'Sch160':50.0 },
};
// ===== SGP / FSGP 肉厚(mm) =====
// SGP ＝ 配管用炭素鋼鋼管（JIS G3452）。Sch番号を持たない独自の標準肉厚。
// FSGP ＝ その SGP に整合する突合せ溶接式管継手の呼び厚さ（＝SGP管と同肉厚）。
// 出典＝淡路マテリア 溶接式管継手カタログ「管継手の厚さ（JIS）」FSGP列／JIS G3452。
// パイプは「SGP」、継手は「FSGP」として選ぶが、肉厚値はこの1表を共用する。
const SGP_WALL = {
  '10A':2.3,'15A':2.8,'20A':2.8,'25A':3.2,'32A':3.5,'40A':3.5,'50A':3.8,
  '65A':4.2,'80A':4.2,'100A':4.5,'125A':4.5,'150A':5.0,'200A':5.8,'250A':6.6,
  '300A':6.9,'350A':7.9,'400A':7.9,'450A':7.9,'500A':7.9,
};
// 管肉厚(mm)。SGP/FSGP は専用表、それ以外はSch表。どちらも無ければ管外径の約6%で概算。
function pipeWall(sizeA, sch) {
  if (sch === 'SGP' || sch === 'FSGP') {
    if (SGP_WALL[sizeA] != null) return SGP_WALL[sizeA];
    return (FLG_BORE[sizeA] || 114) * 0.06;
  }
  const row = PIPE_WALL[sizeA];
  if (row && row[sch]) return row[sch];
  return (FLG_BORE[sizeA] || 114) * 0.06;
}
// パイプ用スケジュール一覧（Sch各種＋SGP）と、継手用一覧（Sch各種＋FSGP）。
// SCHEDULES（ステンレス系Sch）は据え置き。フランジは従来どおり SCHEDULES を使う。
const PIPE_SCHEDULES = [...SCHEDULES, 'SGP'];
const FITTING_SCHEDULES = [...SCHEDULES, 'FSGP'];

// ===== 材質（種類の記号）の選択肢 =====
// アイテムリストの「材質」欄は手入力もできるが、ここの一覧から選べる（datalist）。
// 継手＝淡路マテリア カタログ「管継手の規格・鋼種」鋼管製の27種（炭素鋼9＋合金鋼8＋ステンレス10）。
const FITTING_MATERIALS = [
  // 炭素鋼（JIS B2311/B2312/B2313）
  'FSGP','PY400','PG370','PS410','PS480','PT370','PT410','PT480','PL380',
  // 合金鋼
  'PA12','PA22','PA23','PA24','PA25','PA26','PL450','PL690',
  // ステンレス鋼
  'SUS304','SUS304H','SUS304L','SUS309S','SUS310S','SUS316','SUS316H','SUS316L','SUS321','SUS347',
];
// パイプ＝上記継手の母材に対応する管材質（同表の鋼管規格欄に準拠）。
//   FSGP→SGP(G3452) / PY400→STPY400(G3457) / PG→STPG(G3454) / PS→STS(G3455) /
//   PT→STPT(G3456) / PL380,450,690→STPL(G3460) / PA→STPA(G3458) / SUS→SUS○○TP(G3459)。
// ステンレスは継目無(-TPS)・アーク溶接(-TPA)を併記（社長指定の表記）。
const PIPE_MATERIALS = [
  // 炭素鋼管
  'SGP','STPY400','STPG370','STPG410','STS370','STS410','STS480',
  'STPT370','STPT410','STPT480','STPL380',
  // 合金鋼管
  'STPA12','STPA20','STPA22','STPA23','STPA24','STPA25','STPA26','STPL450','STPL690',
  // ステンレス鋼管（継目無 -TPS／アーク溶接 -TPA）
  'SUS304-TPS','SUS304-TPA','SUS304H-TPS','SUS304H-TPA','SUS304L-TPS','SUS304L-TPA',
  'SUS309S-TPS','SUS309S-TPA','SUS310S-TPS','SUS310S-TPA',
  'SUS316-TPS','SUS316-TPA','SUS316H-TPS','SUS316H-TPA','SUS316L-TPS','SUS316L-TPA',
  'SUS321-TPS','SUS321-TPA','SUS347-TPS','SUS347-TPA',
];
// フランジ＝管材とは別系統（板材・鍛鋼品）。配管用フランジで実際に多い JIS 材を分かる範囲で。
//   SS400=一般構造用圧延鋼材(G3101) / S20C,S25C=機械構造用炭素鋼(G4051) /
//   SF=炭素鋼鍛鋼品(G3201) / SFVC=圧力容器用炭素鋼鍛鋼品(G3202) /
//   SFL=低温圧力容器用鍛鋼品(G3205) / SFVA=高温圧力容器用合金鋼鍛鋼品(G3203) /
//   SUS○○F=ステンレス鋼鍛鋼品(G3214)。手入力で他の材も入れられる。
const FLANGE_MATERIALS = [
  // 炭素鋼（板・棒）
  'SS400','S20C','S25C',
  // 炭素鋼鍛鋼品
  'SF390A','SF440A','SF490A',
  // 圧力容器用炭素鋼鍛鋼品
  'SFVC1','SFVC2A','SFVC2B',
  // 低温圧力容器用鍛鋼品
  'SFL1','SFL2','SFL3',
  // 高温圧力容器用合金鋼鍛鋼品
  'SFVAF1','SFVAF11A','SFVAF12','SFVAF22A',
  // ステンレス鋼鍛鋼品
  'SUS304F','SUS304LF','SUS316F','SUS316LF','SUS321F','SUS347F',
];
// 部品種別 → 使う材質一覧（datalist のID）。手入力は全種別で可。
function matListIdForPart(p) {
  const t = p && p.userData && p.userData.partType;
  if (t === 'pipe') return 'matListPipe';
  if (t === 'flange') return 'matListFlange';
  return 'matListFitting';                  // エルボ・キャップ・ティー・レジューサ
}
// 候補一覧（datalist）を1度だけ DOM に用意する。
(function buildMaterialDatalists() {
  if (typeof document === 'undefined' || !document.body) return;
  const mk = (id, items) => {
    if (document.getElementById(id)) return;
    const dl = document.createElement('datalist'); dl.id = id;
    items.forEach(v => dl.appendChild(new Option(v, v)));
    document.body.appendChild(dl);
  };
  mk('matListPipe', PIPE_MATERIALS);
  mk('matListFitting', FITTING_MATERIALS);
  mk('matListFlange', FLANGE_MATERIALS);
})();

// ===== フランジ規格寸法表（mm） =====
// 各行: D=フランジ外径, C=ボルト穴中心円径(PCD), n=ボルト穴数, h=ボルト穴径, t=フランジ厚さ
// 出典＝JIS B2220-1995 / JPI（社長提供の規格表 2013_35-40.pdf より転記）
const FLANGE_DIMS = {
  'JIS 5K': {
    '10A':{D:75,C:55,n:4,h:12,t:9},  '15A':{D:80,C:60,n:4,h:12,t:9},
    '20A':{D:85,C:65,n:4,h:12,t:10}, '25A':{D:95,C:75,n:4,h:12,t:10},
    '32A':{D:115,C:90,n:4,h:15,t:12},'40A':{D:120,C:95,n:4,h:15,t:12},
    '50A':{D:130,C:105,n:4,h:15,t:14},'65A':{D:155,C:130,n:4,h:15,t:14},
    '80A':{D:180,C:145,n:4,h:19,t:14},'100A':{D:200,C:165,n:8,h:19,t:16},
    '125A':{D:235,C:200,n:8,h:19,t:16},'150A':{D:265,C:230,n:8,h:19,t:18},
    '200A':{D:320,C:280,n:8,h:23,t:20},'250A':{D:385,C:345,n:12,h:23,t:22},
    '300A':{D:430,C:390,n:12,h:23,t:22},'350A':{D:480,C:435,n:12,h:25,t:24},
    '400A':{D:540,C:495,n:16,h:25,t:24},'450A':{D:605,C:555,n:16,h:25,t:24},
    '500A':{D:655,C:605,n:20,h:25,t:24},
  },
  'JIS 10K': {
    '10A':{D:90,C:65,n:4,h:15,t:12},  '15A':{D:95,C:70,n:4,h:15,t:12},
    '20A':{D:100,C:75,n:4,h:15,t:14}, '25A':{D:125,C:90,n:4,h:19,t:14},
    '32A':{D:135,C:100,n:4,h:19,t:16},'40A':{D:140,C:105,n:4,h:19,t:16},
    '50A':{D:155,C:120,n:4,h:19,t:16},'65A':{D:175,C:140,n:4,h:19,t:18},
    '80A':{D:185,C:150,n:8,h:19,t:18},'100A':{D:210,C:175,n:8,h:19,t:18},
    '125A':{D:250,C:210,n:8,h:23,t:20},'150A':{D:280,C:240,n:8,h:23,t:22},
    '200A':{D:330,C:290,n:12,h:23,t:22},'250A':{D:400,C:355,n:12,h:25,t:24},
    '300A':{D:445,C:400,n:16,h:25,t:24},'350A':{D:490,C:445,n:16,h:25,t:26},
    '400A':{D:560,C:510,n:16,h:27,t:28},'450A':{D:620,C:565,n:20,h:27,t:30},
    '500A':{D:675,C:620,n:20,h:27,t:30},
  },
  'JIS 20K': {
    '10A':{D:90,C:65,n:4,h:15,t:14},  '15A':{D:95,C:70,n:4,h:15,t:14},
    '20A':{D:100,C:75,n:4,h:15,t:16}, '25A':{D:125,C:90,n:4,h:19,t:16},
    '32A':{D:135,C:100,n:4,h:19,t:18},'40A':{D:140,C:105,n:4,h:19,t:18},
    '50A':{D:155,C:120,n:8,h:19,t:18},'65A':{D:175,C:140,n:8,h:19,t:20},
    '80A':{D:200,C:160,n:8,h:23,t:22},'100A':{D:225,C:185,n:8,h:23,t:24},
    '125A':{D:270,C:225,n:8,h:25,t:26},'150A':{D:305,C:260,n:12,h:25,t:28},
    '200A':{D:350,C:305,n:12,h:25,t:30},'250A':{D:430,C:380,n:12,h:27,t:34},
    '300A':{D:480,C:430,n:16,h:27,t:36},'350A':{D:540,C:480,n:16,h:33,t:40},
    '400A':{D:605,C:540,n:16,h:33,t:46},'450A':{D:675,C:605,n:20,h:33,t:48},
    '500A':{D:730,C:660,n:20,h:33,t:50},
  },
  // JPI（JPI並びにANSI共通：外径O・ボルト中心径C・厚み最小Q）。10Aは規格に無し→10Kフォールバック
  'JPI 150LB': {
    '15A':{D:89,C:60.5,n:4,h:16,t:11.5},   '20A':{D:99,C:69.8,n:4,h:16,t:13.0},
    '25A':{D:108,C:79.2,n:4,h:16,t:14.5},  '32A':{D:117,C:88.9,n:4,h:16,t:16.0},
    '40A':{D:127,C:98.6,n:4,h:16,t:18.0},  '50A':{D:152,C:120.6,n:4,h:19,t:19.5},
    '65A':{D:178,C:139.7,n:4,h:19,t:22.5}, '80A':{D:190,C:152.4,n:4,h:19,t:24.0},
    '100A':{D:229,C:190.5,n:8,h:19,t:24.0},'125A':{D:254,C:215.9,n:8,h:22,t:24.0},
    '150A':{D:279,C:241.3,n:8,h:22,t:25.5},'200A':{D:343,C:298.4,n:8,h:22,t:28.5},
    '250A':{D:406,C:362.0,n:12,h:26,t:30.5},'300A':{D:483,C:431.8,n:12,h:26,t:32.0},
    '350A':{D:535,C:476.2,n:12,h:29,t:35.5},'400A':{D:595,C:539.8,n:16,h:29,t:37.0},
    '450A':{D:635,C:577.8,n:16,h:32,t:40.0},'500A':{D:700,C:635.0,n:20,h:32,t:43.0},
  },
  'JPI 300LB': {
    '15A':{D:95,C:66.5,n:4,h:16,t:14.5},   '20A':{D:117,C:82.6,n:4,h:19,t:16.0},
    '25A':{D:124,C:88.9,n:4,h:19,t:18.0},  '32A':{D:133,C:98.6,n:4,h:19,t:19.5},
    '40A':{D:155,C:114.3,n:4,h:22,t:21.0}, '50A':{D:165,C:127.0,n:8,h:22,t:22.5},
    '65A':{D:190,C:149.4,n:8,h:22,t:25.5}, '80A':{D:210,C:168.1,n:8,h:22,t:28.5},
    '100A':{D:254,C:200.2,n:8,h:22,t:32.0},'125A':{D:279,C:235.0,n:8,h:22,t:35.5},
    '150A':{D:318,C:269.7,n:12,h:22,t:37.0},'200A':{D:381,C:330.2,n:12,h:26,t:41.5},
    '250A':{D:444,C:387.4,n:16,h:29,t:48.0},'300A':{D:520,C:450.8,n:16,h:32,t:51.0},
    '350A':{D:585,C:514.4,n:20,h:32,t:54.0},'400A':{D:650,C:571.5,n:20,h:35,t:57.5},
    '450A':{D:710,C:628.6,n:24,h:35,t:60.5},'500A':{D:775,C:685.8,n:24,h:35,t:63.5},
  },
  // JIS 40K（JIS B2220-1995 呼び圧力40K 溶接フランジ／WN・BL）。15A〜400A。
  'JIS 40K': {
    '15A':{D:115,C:80,n:4,h:19,t:20},  '20A':{D:120,C:85,n:4,h:19,t:20},
    '25A':{D:130,C:95,n:4,h:19,t:22},  '32A':{D:140,C:105,n:4,h:19,t:24},
    '40A':{D:160,C:120,n:4,h:23,t:24}, '50A':{D:165,C:130,n:8,h:19,t:26},
    '65A':{D:200,C:160,n:8,h:23,t:30}, '80A':{D:210,C:170,n:8,h:23,t:32},
    '90A':{D:230,C:185,n:8,h:23,t:34}, '100A':{D:250,C:205,n:8,h:25,t:36},
    '125A':{D:300,C:250,n:8,h:25,t:40},'150A':{D:355,C:295,n:12,h:25,t:44},
    '200A':{D:405,C:345,n:12,h:25,t:50},'250A':{D:475,C:410,n:12,h:27,t:56},
    '300A':{D:540,C:470,n:16,h:27,t:60},'350A':{D:585,C:515,n:16,h:33,t:64},
    '400A':{D:645,C:570,n:16,h:33,t:70},
  },
  // JPI 600LB（JPI-7S-15 / ASME B16.5 クラス600 PN110）外径O/中心径C/穴数N/穴径d/厚みQ
  'JPI 600LB': {
    '15A':{D:95,C:66.5,n:4,h:16,t:14.3},   '20A':{D:117,C:82.6,n:4,h:19,t:15.8},
    '25A':{D:124,C:88.9,n:4,h:19,t:17.6},  '32A':{D:133,C:98.6,n:4,h:19,t:20.6},
    '40A':{D:155,C:114.3,n:4,h:22,t:22.4}, '50A':{D:165,C:127.0,n:8,h:19,t:25.4},
    '65A':{D:190,C:149.4,n:8,h:22,t:28.5}, '80A':{D:210,C:168.1,n:8,h:22,t:31.8},
    '100A':{D:273,C:215.9,n:8,h:26,t:38.1},'125A':{D:330,C:266.7,n:8,h:29,t:44.5},
    '150A':{D:356,C:292.1,n:12,h:29,t:47.8},'200A':{D:419,C:349.2,n:12,h:32,t:55.7},
    '250A':{D:508,C:431.8,n:16,h:35,t:63.5},'300A':{D:560,C:489.0,n:20,h:35,t:66.6},
    '350A':{D:603,C:527.0,n:20,h:35,t:69.9},'400A':{D:686,C:603.2,n:20,h:41,t:76.2},
    '450A':{D:743,C:654.0,n:20,h:41,t:82.6},'500A':{D:813,C:723.9,n:24,h:44,t:88.9},
  },
  // 注：JPI 900/1500/2500LB はカタログ寸法の照合が未完のため、確証が取れるまで掲載しない。
};
// 指定クラス・サイズの寸法。無い場合は10Kへフォールバック
function flangeDim(cls, sizeA) {
  const table = FLANGE_DIMS[cls] || FLANGE_DIMS['JIS 10K'];
  return table[sizeA] || FLANGE_DIMS['JIS 10K'][sizeA] || FLANGE_DIMS['JIS 10K']['100A'];
}

// ===== RF ガスケット座径 g（mm）＝レイズドフェイスの外径 =====
// 出典＝JIS B2220-1995（資料35〜37頁）／ JPI・ASME B16.5（資料39頁 座径R）。
// この実寸を使うことで「RFがボルト穴にかぶる」現象を根本解消し、座面も正確になる。
const RF_FACE_DIA = {
  'JIS 5K': { '10A':39,'15A':44,'20A':49,'25A':59,'32A':70,'40A':75,'50A':85,'65A':110,
    '80A':121,'100A':141,'125A':176,'150A':206,'200A':252,'250A':317,'300A':360,
    '350A':403,'400A':463,'450A':523,'500A':573 },
  'JIS 10K': { '10A':46,'15A':51,'20A':56,'25A':67,'32A':76,'40A':81,'50A':96,'65A':116,
    '80A':126,'100A':151,'125A':182,'150A':212,'200A':262,'250A':324,'300A':368,
    '350A':413,'400A':475,'450A':530,'500A':585 },
  'JIS 20K': { '10A':46,'15A':51,'20A':56,'25A':67,'32A':76,'40A':81,'50A':96,'65A':116,
    '80A':132,'100A':160,'125A':195,'150A':230,'200A':275,'250A':345,'300A':395,
    '350A':440,'400A':495,'450A':560,'500A':615 },
  // JPI 150/300 は座径R 共通（圧力でなくボア径で決まる）
  'JPI 150LB': { '15A':35.1,'20A':42.9,'25A':50.8,'32A':63.5,'40A':73.2,'50A':91.9,'65A':104.6,
    '80A':127.0,'100A':157.2,'125A':185.6,'150A':215.9,'200A':269.7,'250A':323.8,'300A':381.0,
    '350A':412.8,'400A':469.9,'450A':533.4,'500A':584.2 },
  'JPI 300LB': { '15A':35.1,'20A':42.9,'25A':50.8,'32A':63.5,'40A':73.2,'50A':91.9,'65A':104.6,
    '80A':127.0,'100A':157.2,'125A':185.6,'150A':215.9,'200A':269.7,'250A':323.8,'300A':381.0,
    '350A':412.8,'400A':469.9,'450A':533.4,'500A':584.2 },
};
function rfFaceDia(cls, sizeA) {
  const t = RF_FACE_DIA[cls];
  return t && t[sizeA] != null ? t[sizeA] : null;
}

// ===== WN（ウェルドネック）全長 Y（mm）＝面間（RF面〜溶接端） =====
// 出典＝JPI・ASME B16.5（資料40頁 全長WN）。JPI 150/300 の真の溶接ネック寸法。
// ※JIS 5K/10K/20K はこのカタログにハブ付き(SOH)短ハブの全長Tしか無く、
//   いわゆる長首WNは規定されないため、JIS クラスは従来の比例推定を維持する。
const WN_FULL_LEN = {
  'JPI 150LB': { '15A':47.8,'20A':52.3,'25A':55.6,'32A':57.2,'40A':62.0,'50A':63.5,'65A':69.8,
    '80A':69.8,'100A':76.2,'125A':88.9,'150A':88.9,'200A':101.6,'250A':101.6,'300A':114.3,
    '350A':127.0,'400A':127.0,'450A':139.7,'500A':144.5 },
  'JPI 300LB': { '15A':52.3,'20A':57.2,'25A':62.0,'32A':65.0,'40A':68.3,'50A':69.8,'65A':76.2,
    '80A':79.2,'100A':85.9,'125A':98.6,'150A':98.6,'200A':111.3,'250A':117.3,'300A':130.0,
    '350A':142.7,'400A':146.0,'450A':158.8,'500A':162.1 },
};
function wnFullLen(cls, sizeA) {
  const t = WN_FULL_LEN[cls];
  return t && t[sizeA] != null ? t[sizeA] : null;
}

// 円板に穴を開けた板（ringGeo/discGeo）を作る共通：軸=Y・厚みhで中心原点
function plateWithHoles(R, h, holes) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, R, 0, Math.PI * 2, false);
  holes.forEach(({ x, y, r }) => {
    const p = new THREE.Path();
    p.absarc(x, y, r, 0, Math.PI * 2, true);
    shape.holes.push(p);
  });
  // 面取り（ベベル）は外周エッジだけでなく各穴のフチにも同量で掛かるため、
  // 最も小さい穴（＝ボルト穴）の半径で頭打ちにし、穴を食い潰さないようにする。
  // ※旧実装は板厚・外径基準のみで、500A等の厚肉大口径で面取りが穴径の大半を覆っていた。
  const minHoleR = holes.length ? Math.min(...holes.map(hl => hl.r)) : R;
  const bevel = Math.min(h * 0.18, R * 0.05, minHoleR * 0.22);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h - bevel * 2, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 64,
  });
  geo.translate(0, 0, -(h - bevel * 2) / 2);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}
// 内外径つきの筒（ハブ・首・ボア壁）。軸=Y・高さh・中心原点
function ringGeo(outerR, innerR, h) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const p = new THREE.Path();
  p.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  shape.holes.push(p);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 64 });
  geo.translate(0, 0, -h / 2);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

// フランジ生成（軸=Y／単位m）。opts={sizeA,type,cls,face}
function makeFlange(opts) {
  const o = Object.assign({ sizeA: '100A', type: 'SOP', cls: 'JIS 10K', face: 'RF' }, opts || {});
  const dim = flangeDim(o.cls, o.sizeA);              // 規格寸法(mm)
  const R = dim.D / 2 / 1000;                          // 外径半径(m)
  const boreD = (FLG_BORE[o.sizeA] || 114) / 1000;    // ボア径(m)
  const boreR = boreD / 2;
  const thk = dim.t / 1000;                            // フランジ厚さ(m)
  const bcR = dim.C / 2 / 1000;                        // ボルト穴中心円半径(m)
  const holeR = dim.h / 2 / 1000;                      // ボルト穴半径(m)
  const nBolt = dim.n;                                 // ボルト穴数（規格通り）

  const mat = FLANGE_MAT.clone();                      // この個体の材質（選択発光を個別化）
  const g = new THREE.Group();
  const add = (geo) => g.add(new THREE.Mesh(geo, mat));

  // ボルト穴の配置（規格の穴数・ピッチ円で正確に）
  const holes = [];
  for (let i = 0; i < nBolt; i++) {
    const a = (i / nBolt) * Math.PI * 2 + Math.PI / nBolt;
    holes.push({ x: Math.cos(a) * bcR, y: Math.sin(a) * bcR, r: holeR });
  }
  // 中心ボア。SWは「背面から座ぐり＋奥に細い流路穴」、BLは穴なし、他は貫通。
  const isBlind = o.type === 'BL';
  const isSW = o.type === 'SW';
  const isWN = o.type === 'WN';
  // 中心穴の内径。WN/SWは肉厚(スケジュール)を持つので管内径＝外径-2×肉厚。他はボアそのまま。
  const wallM = pipeWall(o.sizeA, o.sch) / 1000;          // 管肉厚(m)
  const flowR = (isSW || isWN) ? Math.max(boreR - wallM, boreR * 0.4)
              : (o.type === 'LJ' ? boreR + 0.0008 : boreR);   // LJは管に遊嵌＝ボアを少し広げる
  if (!isBlind) holes.push({ x: 0, y: 0, r: flowR });

  // 本体プレート
  add(plateWithHoles(R, thk, holes));

  // タイプ別のハブ・首（背面 -Y 側）
  const back = -thk / 2;
  const front = thk / 2;
  // 背面に付く中空テーパ筒。outerBottom=板側外半径, outerTop=先端外半径, h=長さ, innerR=ボア半径。
  // 外周(開端テーパ)＋内周(開端ボア壁)＋先端の環状フタ で隙間なく閉じる。
  function hub(outerBottom, outerTop, h, innerR) {
    const yMid = back - h / 2;
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(outerTop, outerBottom, h, 56, 1, true), mat);
    outer.position.y = yMid; g.add(outer);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(innerR, innerR, h, 40, 1, true), mat);
    inner.position.y = yMid; g.add(inner);
    if (outerTop - innerR > 0.0005) {
      const capH = Math.max(0.0015, h * 0.04);
      const cap = ringGeo(outerTop, innerR, capH);
      cap.translate(0, back - h + capH / 2, 0); g.add(new THREE.Mesh(cap, mat));
    }
  }
  if (o.type === 'SOP') {
    // スリップオン：ブラインドに中央穴が開いただけ＝平板のみ（ハブなし）
  } else if (o.type === 'SW') {
    // ソケットウェルド：板背面に円筒ハブ＋背面からパイプを差し込むソケット座ぐり。
    // ハブ外周・先端・ソケット壁・肩・流路穴壁を「1本の断面」で一体成形（溝/段差を出さない）。
    const sockDepth = (SW_SOCKET_DEPTH[o.sizeA] || 12) / 1000;   // 規格ソケット深さ(m)
    const hubH = Math.max(boreR * 0.5, sockDepth - thk + 0.004); // ハブ長
    const hOR = boreR * 1.45;                     // ハブ外半径
    const yHubEnd = back - hubH;                  // ハブ背面端
    const yShoulder = yHubEnd + sockDepth;        // ソケット底（肩）
    // 断面プロファイル(r, y) 閉ループ：外周→先端→ソケット壁→肩→流路穴壁
    const prof = [
      [hOR,   back],        // ハブ外周・板側
      [hOR,   yHubEnd],     // ハブ外周・先端
      [boreR, yHubEnd],     // 先端の環（ソケット入口）
      [boreR, yShoulder],   // ソケット壁→底
      [flowR, yShoulder],   // 肩
      [flowR, back],        // 流路穴壁・板側
    ].map(p => new THREE.Vector2(p[0], p[1]));
    const swGeo = new THREE.LatheGeometry(prof, 56);
    // 角をくっきり出す：法線を滑らかに繋がず面ごとに分ける（フラットシェーディング）
    const swMat = mat.clone();
    swMat.side = THREE.DoubleSide;     // 裏面も描いて透け防止
    swMat.flatShading = true;          // 角ばった見た目
    swMat.needsUpdate = true;
    g.add(new THREE.Mesh(swGeo, swMat));
  } else if (o.type === 'WN') {
    // ウェルドネック：板から太い根元→テーパ首→先端は管外径の直管部。内側は管内径で貫通(中空)。
    // 首の長さ＝規格の全長Y（面間）− フランジ厚t。
    // クラス専用値が無いJIS(5K/10K/20K/40K)等は、同口径のJPI 150LB全長Yを代用する。
    //   JIS B2220には長首WN規定が無いが、JPIのYは同じ管外径の実在WN面間なので妥当な近似。
    //   ※旧フォールバック R*0.9(外径半径基準)は500Aで303mm等と過大だった（外径で伸ばすのが誤り）。
    const wnY = wnFullLen(o.cls, o.sizeA) || wnFullLen('JPI 150LB', o.sizeA);
    const neckH = wnY != null ? Math.max((wnY - dim.t) / 1000, thk * 0.5)
                              : Math.max(boreD * 0.9, thk * 2.0);   // 10A等の小径フォールバック
    // 根元の外半径：ボルト穴の内側に必ず収める（穴を覆わない）。
    const rootMax = bcR - holeR - 0.004;          // ボルト穴の内縁
    const rootOR = Math.min(boreR * 1.35, rootMax);
    const tipOR  = boreR;                          // 先端の外半径(=管外径)
    const innerR = flowR;                          // 管内径(中空)＝流路穴と同径
    const yTip = back - neckH;
    // 先端は管と突合せ溶接する開先端(BE)：他継手と同じ30°面取り＋1mmルートフェイス
    const tW = Math.max(tipOR - innerR, 0);
    const fW = Math.min(WELD_ROOT_FACE, tW * 0.5);
    const hW = Math.max(tW - fW, 0) * Math.tan(WELD_BEVEL_DEG * Math.PI / 180);   // 開先の軸方向深さ
    // 断面プロファイル(外側を上→先端→内側を戻る)で中空のWN首を一体成形
    const prof = [
      [rootOR, back],          // 根元 外周（板側）
      [tipOR,  yTip + hW],     // 先端 外周（開先で hW だけ後退）
      [innerR + fW, yTip],     // 開先斜面→ルートフェイス外縁
      [innerR, yTip],          // ルートフェイス内縁（管内径・端面）
      [innerR, back],          // 内側 板側（中空穴の壁）
    ].map(p => new THREE.Vector2(Math.max(p[0], 0.0005), p[1]));
    const wnGeo = new THREE.LatheGeometry(prof, 56);
    const wnMat = mat.clone(); wnMat.side = THREE.DoubleSide;
    g.add(new THREE.Mesh(wnGeo, wnMat));
  } else if (o.type === 'LJ') {
    // ラップジョイント：ハブの無い平らなバッキングリング（本体プレートは上で追加済み）。
    // スタブエンドは後段のドッキング処理で前面に一体化する。
  }
  // BL は穴なしの平板のみ（付加なし）

  // フェイス（前面 +Y 側）。RF＝ボルト穴の内側まで広がるガスケット座
  // ※LJはフラット面（ガスケット面はスタブエンドのラップ側が持つ）ため座を付けない
  if (o.face === 'RF' && o.type !== 'LJ') {
    const rfH = Math.max(0.0015, thk * 0.12);
    // RF（ガスケット座）外径＝規格の座径 g（JIS B2220 / JPI・ASME）。規格値を最優先で使う。
    // 規格 g は必ずボルト穴の内縁より内側に収まるため、穴かぶりは原理的に起きない。
    // 規格値が無いクラス（JPI 600 等）のみ、ボルト穴内縁の内側に収める安全式でフォールバック。
    const gDia = rfFaceDia(o.cls, o.sizeA);
    const rfOR = gDia != null ? (gDia / 2 / 1000)
                              : Math.max(boreR + 0.002, bcR - holeR - 0.003);
    const rf = isBlind
      ? plateWithHoles(rfOR, rfH, [])
      : ringGeo(rfOR, boreR, rfH);
    rf.translate(0, front + rfH / 2, 0); add(rf);
  }

  // LJ（ラップジョイント）はスタブエンドをドッキングした一体物として生成する
  if (o.type === 'LJ') {
    const stubCls = STUB_CLASSES.includes(o.cls.replace('JIS ', '')) ? o.cls.replace('JIS ', '') : '10K';
    const stubSch = STUB_SCHEDULES.includes(o.sch) ? o.sch : 'Sch10S';
    const stub = makeStubEnd({ sizeA: o.sizeA, cls: stubCls, sch: stubSch });
    const sd = STUB_DIMS[o.sizeA] || STUB_DIMS['25A'];
    const Fm = sd.F / 1000;
    const lapTm = Math.max((sd.w[stubSch] != null ? sd.w[stubSch] : sd.w['Sch10S']) / 1000, 0.0015);
    stub.position.y = front - Fm / 2 + lapTm;   // つば背面をLJ前面(+thk/2)に合わせる
    g.add(stub);
  }

  g.userData.partType = 'flange';
  g.userData.flange = { ...o };
  return g;
}

// 現在パレットで選択中のフランジ仕様
const flangeOpts = { sizeA: '25A', type: 'SOP', cls: 'JIS 10K', face: 'RF', sch: 'Sch40' };

// ===================================================================
//  スタブエンド（ラップジョイント用）BENKAN / JPF SP 001
//  od:外径 F:長さ R:隅R w:肉厚{Sch} G:つば径{呼び圧力}  単位mm
//  ※LJ(バッキングフランジ)とセット。LJのクラスはこの 5K/10K/16K/20K に対応。
// ===================================================================
const STUB_SIZES = ['15A','20A','25A','32A','40A','50A','65A','80A','90A','100A',
  '125A','150A','200A','250A','300A','350A','400A','450A','500A'];
const STUB_CLASSES = ['5K','10K','16K','20K'];
const STUB_SCHEDULES = ['Sch5S','Sch10S','Sch20S','Sch40'];
const STUB_DIMS = {
  '15A': {od:21.7, F:30, R:3, w:{Sch5S:1.65,Sch10S:2.1,Sch20S:2.5,Sch40:2.8},  G:{'5K':44,'10K':51,'16K':51,'20K':51}},
  '20A': {od:27.2, F:30, R:3, w:{Sch5S:1.65,Sch10S:2.1,Sch20S:2.5,Sch40:2.9},  G:{'5K':49,'10K':56,'16K':56,'20K':56}},
  '25A': {od:34.0, F:50, R:3, w:{Sch5S:1.65,Sch10S:2.8,Sch20S:3.0,Sch40:3.4},  G:{'5K':59,'10K':67,'16K':67,'20K':67}},
  '32A': {od:42.7, F:50, R:4, w:{Sch5S:1.65,Sch10S:2.8,Sch20S:3.0,Sch40:3.6},  G:{'5K':70,'10K':76,'16K':76,'20K':76}},
  '40A': {od:48.6, F:50, R:4, w:{Sch5S:1.65,Sch10S:2.8,Sch20S:3.0,Sch40:3.7},  G:{'5K':75,'10K':81,'16K':81,'20K':81}},
  '50A': {od:60.5, F:50, R:4, w:{Sch5S:1.65,Sch10S:2.8,Sch20S:3.5,Sch40:3.9},  G:{'5K':85,'10K':96,'16K':96,'20K':96}},
  '65A': {od:76.3, F:50, R:5, w:{Sch5S:2.1,Sch10S:3.0,Sch20S:3.5,Sch40:5.2},   G:{'5K':110,'10K':116,'16K':116,'20K':116}},
  '80A': {od:89.1, F:50, R:5, w:{Sch5S:2.1,Sch10S:3.0,Sch20S:4.0,Sch40:5.5},   G:{'5K':121,'10K':126,'16K':132,'20K':132}},
  '90A': {od:101.6,F:50, R:5, w:{Sch5S:2.1,Sch10S:3.0,Sch20S:4.0,Sch40:5.7},   G:{'5K':131,'10K':136,'16K':145,'20K':145}},
  '100A':{od:114.3,F:50, R:5, w:{Sch5S:2.1,Sch10S:3.0,Sch20S:4.0,Sch40:6.0},   G:{'5K':141,'10K':151,'16K':160,'20K':160}},
  '125A':{od:139.8,F:50, R:6, w:{Sch5S:2.8,Sch10S:3.4,Sch20S:5.0,Sch40:6.6},   G:{'5K':176,'10K':182,'16K':195,'20K':195}},
  '150A':{od:165.2,F:50, R:6, w:{Sch5S:2.8,Sch10S:3.4,Sch20S:5.0,Sch40:7.1},   G:{'5K':206,'10K':212,'16K':230,'20K':230}},
  '200A':{od:216.3,F:65, R:6, w:{Sch5S:2.8,Sch10S:4.0,Sch20S:6.5,Sch40:8.2},   G:{'5K':252,'10K':262,'16K':275,'20K':275}},
  '250A':{od:267.4,F:65, R:6, w:{Sch5S:3.4,Sch10S:4.0,Sch20S:6.5,Sch40:9.3},   G:{'5K':317,'10K':324,'16K':345,'20K':345}},
  '300A':{od:318.5,F:65, R:9, w:{Sch5S:4.0,Sch10S:4.5,Sch20S:6.5,Sch40:10.3},  G:{'5K':360,'10K':368,'16K':395,'20K':395}},
  '350A':{od:355.6,F:75, R:9, w:{Sch5S:4.0,Sch10S:5.0,Sch20S:8.0,Sch40:11.1},  G:{'5K':403,'10K':413,'16K':440,'20K':440}},
  '400A':{od:406.4,F:75, R:9, w:{Sch5S:4.2,Sch10S:5.0,Sch20S:8.0,Sch40:12.7},  G:{'5K':463,'10K':475,'16K':495,'20K':495}},
  '450A':{od:457.2,F:75, R:9, w:{Sch5S:4.5,Sch10S:5.0,Sch20S:8.0,Sch40:14.3},  G:{'5K':523,'10K':530,'16K':560,'20K':560}},
  '500A':{od:508.0,F:75, R:9, w:{Sch5S:5.0,Sch10S:5.5,Sch20S:9.5,Sch40:15.1},  G:{'5K':573,'10K':585,'16K':615,'20K':615}},
};
// スタブエンド生成（軸=Y／単位m）。つば面=front(+Y)、管は -Y へ伸びる。
// LJ(ラップジョイント)フランジに内部でドッキングして使う（単独部品ではない）。
function makeStubEnd(opts) {
  const o = Object.assign({ sizeA: '25A', cls: '10K', sch: 'Sch10S' }, opts || {});
  const d = STUB_DIMS[o.sizeA] || STUB_DIMS['25A'];
  const outR = d.od / 2 / 1000;                       // 管外半径
  const w = (d.w[o.sch] != null ? d.w[o.sch] : d.w['Sch10S']) / 1000;     // 肉厚
  const inR = Math.max(outR - w, outR * 0.3);         // 管内半径(ボア)
  const lapOR = (d.G[o.cls] != null ? d.G[o.cls] : d.G['10K']) / 2 / 1000; // つば外半径
  const F = d.F / 1000;                               // 全長
  const lapT = Math.max(w, 0.0015);                   // つば厚(=肉厚 T,GT)
  let R = d.R / 1000;                                 // 隅R
  R = Math.min(R, Math.max(lapOR - outR - 0.0005, 0.0005), (F - lapT) * 0.4);
  const yFace = F / 2, yEnd = -F / 2, yLapBack = yFace - lapT;
  // 隅Rの円弧：(outR+R, yLapBack) → (outR, yLapBack-R)。中心(outR+R, yLapBack-R)
  const prof = [
    new THREE.Vector2(lapOR, yFace),       // つば外縁・面側
    new THREE.Vector2(lapOR, yLapBack),    // つば外縁・背側
    new THREE.Vector2(outR + R, yLapBack), // 背面→隅R開始
  ];
  const segs = 8;
  for (let i = 1; i <= segs; i++) {
    const a = Math.PI / 2 + (i / segs) * (Math.PI / 2);
    prof.push(new THREE.Vector2(outR + R + R * Math.cos(a), (yLapBack - R) + R * Math.sin(a)));
  }
  // 管端は配管と突合せ溶接する開先端(BE)：他継手と同じ30°面取り＋1mmルートフェイス
  const tS = Math.max(outR - inR, 0);
  const fS = Math.min(WELD_ROOT_FACE, tS * 0.5);
  const hS = Math.max(tS - fS, 0) * Math.tan(WELD_BEVEL_DEG * Math.PI / 180);   // 開先の軸方向深さ
  prof.push(new THREE.Vector2(outR, yEnd + hS));   // 管外周（開先で hS だけ後退）
  prof.push(new THREE.Vector2(inR + fS, yEnd));    // 開先斜面→ルートフェイス外縁
  prof.push(new THREE.Vector2(inR, yEnd));         // ルートフェイス内縁（端面・ボア）
  prof.push(new THREE.Vector2(inR, yFace));        // ボア→面側
  prof.push(new THREE.Vector2(lapOR, yFace)); // 面(ガスケット面)で閉じる
  const geo = new THREE.LatheGeometry(prof, 72);
  geo.computeVertexNormals();
  const mat = FLANGE_MAT.clone(); mat.side = THREE.DoubleSide; mat.needsUpdate = true;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat));
  g.userData.partType = 'stub';
  g.userData.stub = { ...o };
  return g;
}

// パイプ生成（軸=Y／単位m）。中空の直管。外径=FLG_BORE、肉厚=pipeWall(スケジュール)。
// opts={sizeA, sch, length(mm)}。両端を起点(機点)に持つよう中心を原点に置く。
// ===== 溶接開先（端末面：ルートフェイス＋面取り）=====
const WELD_ROOT_FACE = 0.001;      // ルートフェイス 1mm
const WELD_BEVEL_DEG = 30;         // 開先角度（端面＝軸直角面からの角度）
// 中空筒の開先付き断面プロファイル(r,y)を返す。yHi>yLo。bevelHi/bevelLo で各端に開先を付与
function weldHollowProfile(ro, ri, yLo, yHi, bevelHi, bevelLo) {
  const t = ro - ri;
  const f = Math.min(WELD_ROOT_FACE, t * 0.5);                         // ルートフェイス（薄肉は肉厚の半分まで）
  const h = Math.max(t - f, 0) * Math.tan(WELD_BEVEL_DEG * Math.PI / 180);  // 面取りの軸方向深さ
  const V = (r, y) => new THREE.Vector2(r, y);
  const hiOut = bevelHi ? yHi - h : yHi, loOut = bevelLo ? yLo + h : yLo;
  const p = [V(ro, hiOut), V(ro, loOut)];                              // 外周（面取り開始位置まで）
  if (bevelLo) { p.push(V(ri + f, yLo), V(ri, yLo)); } else { p.push(V(ri, yLo)); }   // 下端：面取り→ルートフェイス
  p.push(V(ri, yHi));                                                  // 内周
  if (bevelHi) { p.push(V(ri + f, yHi), V(ro, hiOut)); } else { p.push(V(ro, hiOut)); }   // 上端：ルートフェイス→面取り（閉）
  return p;
}
function makePipe(opts) {
  const o = Object.assign({ sizeA: '25A', sch: 'Sch40', length: 1000 }, opts || {});
  const outR = (FLG_BORE[o.sizeA] || 114) / 2 / 1000;       // 管外半径(m)
  const w = pipeWall(o.sizeA, o.sch) / 1000;                 // 肉厚(m)
  const inR = Math.max(outR - w, outR * 0.2);                // 管内半径(m)
  const L = Math.max((o.length || 1000) / 1000, 0.01);       // 全長(m)
  // 断面(r,y)を一周＝中空筒。両端に溶接開先（ルートフェイス＋面取り）
  const prof = weldHollowProfile(outR, inR, -L / 2, L / 2, true, true);
  const geo = new THREE.LatheGeometry(prof, 64);
  geo.computeVertexNormals();
  const mat = FLANGE_MAT.clone(); mat.side = THREE.DoubleSide; mat.needsUpdate = true;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat));
  g.userData.partType = 'pipe';
  g.userData.pipe = { ...o };
  return g;
}
// 現在パレットで選択中のパイプ仕様（既定：Sch10S・長さ100mm）
const pipeOpts = { sizeA: '25A', sch: 'Sch10S', length: 100 };

// ===================================================================
//  突合せ溶接式管継手（エルボ・キャップ）
//  出典＝淡路マテリア 溶接式管継手カタログ（JIS B2311/2312/2313, ASME B16.9）
//  ・中心-端 / 中心-中心 / 背-端の距離は規格実寸 mm。肉厚は pipeWall(Sch) を流用。
// ===================================================================
const ELBOW_90L = {'15A':38.1,'20A':38.1,'25A':38.1,'32A':47.6,'40A':57.2,'50A':76.2,'65A':95.3,
  '80A':114.3,'90A':133.4,'100A':152.4,'125A':190.5,'150A':228.6,'200A':304.8,'250A':381.0,
  '300A':457.2,'350A':533.4,'400A':609.6,'450A':685.8,'500A':762.0};
const ELBOW_45L = {'15A':15.8,'20A':15.8,'25A':15.8,'32A':19.7,'40A':23.7,'50A':31.6,'65A':39.5,
  '80A':47.3,'90A':55.3,'100A':63.1,'125A':78.9,'150A':94.7,'200A':126.3,'250A':157.8,
  '300A':189.4,'350A':220.9,'400A':252.5,'450A':284.1,'500A':315.6};
const ELBOW_90S = {'25A':25.4,'32A':31.8,'40A':38.1,'50A':50.8,'65A':63.5,'80A':76.2,'90A':88.9,
  '100A':101.6,'125A':127.0,'150A':152.4,'200A':203.2,'250A':254.0,'300A':304.8,'350A':355.6,
  '400A':406.4,'450A':457.2,'500A':508.0};
const ELBOW_45S = {'40A':15.8,'50A':21.0,'65A':26.3,'80A':31.6,'90A':36.8,'100A':42.1,'125A':52.6,
  '150A':63.1,'200A':84.2,'250A':105.2,'300A':126.2,'350A':147.3,'400A':168.3,'450A':189.4,'500A':210.4};
const RETURN_180L = {'15A':76.2,'20A':76.2,'25A':76.2,'32A':95.2,'40A':114.4,'50A':152.4,'65A':190.6,
  '80A':228.6,'90A':266.8,'100A':304.8,'125A':381.0,'150A':457.2,'200A':609.6,'250A':762.0,
  '300A':914.4,'350A':1066.8,'400A':1219.2};
const RETURN_180S = {'25A':50.8,'32A':63.6,'40A':76.2,'50A':101.6,'65A':127.0,'80A':152.4,'90A':177.8,
  '100A':203.2,'125A':254.0,'150A':304.8,'200A':406.4,'250A':508.0,'300A':609.6,'350A':711.2,'400A':812.8};
const CAP_E = {'15A':25.4,'20A':25.4,'25A':38.1,'32A':38.1,'40A':38.1,'50A':38.1,'65A':38.1,'80A':50.8,
  '90A':63.5,'100A':63.5,'125A':76.2,'150A':88.9,'200A':101.6,'250A':127.0,'300A':152.4,'350A':165.1,
  '400A':177.8,'450A':203.2,'500A':228.6};

// 中空の曲げ管。R=中心線半径(m), angleDeg=曲げ角。XY平面で曲がり、円弧中心=原点。
// backLocal=円弧始端中心(-R,0,0)、faceLocal=円弧終端中心 を userData に設定。
function makeBendCore(R, angleDeg, ro, ri, mat) {
  const ang = angleDeg * Math.PI / 180;
  const curve = new THREE.Curve();
  curve.getPoint = function (t, target) {
    const a = Math.PI - ang * t;                 // 始端=180°(-R,0)→終端
    return (target || new THREE.Vector3()).set(R * Math.cos(a), R * Math.sin(a), 0);
  };
  const arcSeg = Math.max(8, Math.round(48 * angleDeg / 180));
  const rad = 28;
  const g = new THREE.Group();
  // 溶接開先：外管は両端を h だけ短縮し、開先フラスタム＋ルートフェイス環を足す。内管(ボア)は全長
  const t_ = ro - ri, f = Math.min(WELD_ROOT_FACE, t_ * 0.5), h = Math.max(t_ - f, 0) * Math.tan(WELD_BEVEL_DEG * Math.PI / 180);
  const arcLen = R * ang, dt = arcLen > 1e-6 ? Math.min(h / arcLen, 0.45) : 0;   // h を t オフセットへ換算
  const outerCurve = new THREE.Curve();
  outerCurve.getPoint = (t, target) => curve.getPoint(dt + (1 - 2 * dt) * t, target);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(outerCurve, arcSeg, ro, rad, false), mat));   // 外管（端を短縮）
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, arcSeg, ri, rad, false), mat));        // 内管（ボア・全長）
  const yAxis = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1);
  for (const t of [0, 1]) {                       // 両端：開先フラスタム＋ルートフェイス環
    const p = curve.getPoint(t), tan = curve.getTangent(t).normalize();
    const bodyDir = (t === 0) ? tan.clone() : tan.clone().negate();   // 先端→本体側
    if (h > 1e-6) {
      const fr = new THREE.Mesh(new THREE.CylinderGeometry(ro, ri + f, h, rad, 1, true), mat);   // +Y=ro(本体側)/-Y=ri+f(先端側)
      fr.quaternion.setFromUnitVectors(yAxis, bodyDir);
      fr.position.copy(p).addScaledVector(bodyDir, h / 2);
      g.add(fr);
    }
    const land = new THREE.Mesh(new THREE.RingGeometry(ri, ri + f, rad), mat);   // ルートフェイス（先端の平環）
    land.position.copy(p);
    land.quaternion.setFromUnitVectors(zAxis, tan);
    g.add(land);
  }
  g.userData.backLocal = curve.getPoint(0);
  g.userData.faceLocal = curve.getPoint(1);
  g.userData.backNormal = curve.getTangent(0).clone();   // 背端の面法線(管軸)＝ロール軸
  g.userData.faceNormal = curve.getTangent(1).clone();   // 面端の面法線(管軸)＝ロール軸
  // 工作点(PI)：両端の管中心線を延長して垂直に交わる角の点。L棒の寸法基準点。180°(平行)は交点なしで省く。
  {
    const p1 = g.userData.backLocal, d1 = g.userData.backNormal;
    const p2 = g.userData.faceLocal, d2 = g.userData.faceNormal;
    const cx = d1.clone().cross(d2);
    if (cx.lengthSq() > 1e-9) {                          // 平行(180°)でなければ交点が定まる
      const s = p2.clone().sub(p1).cross(d2).dot(cx) / cx.lengthSq();
      g.userData.cornerLocal = p1.clone().addScaledVector(d1, s);
      g.userData.extraLocals = [g.userData.cornerLocal];   // 機点・スナップ・起点候補に加える
      g.userData.gripLocal = g.userData.cornerLocal;       // 挿入時の起点＝工作点(角)。配置後はユーザーが機点クリックで変更可
    }
  }
  return g;
}

// エルボ生成。opts={sizeA, sch, kind:'90L'|'90S'|'45L'|'45S'|'180L'|'180S'}
function makeElbow(opts) {
  const o = Object.assign({ sizeA: '50A', sch: 'Sch40', kind: '90L' }, opts || {});
  const ro = (FLG_BORE[o.sizeA] || 114) / 2 / 1000;
  const ri = Math.max(ro - pipeWall(o.sizeA, o.sch) / 1000, ro * 0.3);
  const mat = FLANGE_MAT.clone(); mat.side = THREE.DoubleSide; mat.needsUpdate = true;
  let R, angle;
  if (o.kind === '180L') { R = (RETURN_180L[o.sizeA] || 152) / 2 / 1000; angle = 180; }
  else if (o.kind === '180S') { R = (RETURN_180S[o.sizeA] || 102) / 2 / 1000; angle = 180; }
  else {
    const tbl = { '90L': ELBOW_90L, '90S': ELBOW_90S, '45L': ELBOW_45L, '45S': ELBOW_45S }[o.kind] || ELBOW_90L;
    angle = o.kind.startsWith('45') ? 45 : 90;
    const cE = (tbl[o.sizeA] || 76) / 1000;
    R = cE / Math.tan(angle / 2 * Math.PI / 180);    // 中心-端 → 中心線半径
  }
  const g = makeBendCore(R, angle, ro, ri, mat);
  g.userData.partType = 'elbow';
  g.userData.elbow = { ...o };
  return g;
}

// キャップ生成（軸=Y）。溶接口を y=0、ドームを +Y。E=背-溶接端の距離。
function makeCap(opts) {
  const o = Object.assign({ sizeA: '50A', sch: 'Sch40' }, opts || {});
  const ro = (FLG_BORE[o.sizeA] || 114) / 2 / 1000;
  const wall = pipeWall(o.sizeA, o.sch) / 1000;
  const ri = Math.max(ro - wall, ro * 0.3);
  const E = (CAP_E[o.sizeA] || 50) / 1000;
  const skirt = Math.min(E * 0.35, ro * 0.6);
  const domeH = E - skirt;
  const _tW = ro - ri, _fW = Math.min(WELD_ROOT_FACE, _tW * 0.5), _hW = Math.max(_tW - _fW, 0) * Math.tan(WELD_BEVEL_DEG * Math.PI / 180);   // 溶接口の開先
  const N = 18, prof = [];
  prof.push(new THREE.Vector2(ro, _hW));            // 溶接口 外周（開先開始）
  prof.push(new THREE.Vector2(ro, skirt));
  for (let i = 1; i <= N; i++) { const a = (i / N) * (Math.PI / 2); prof.push(new THREE.Vector2(ro * Math.cos(a), skirt + domeH * Math.sin(a))); }
  for (let i = N; i >= 1; i--) { const a = (i / N) * (Math.PI / 2); prof.push(new THREE.Vector2(Math.max(ri * Math.cos(a), 0.0003), skirt + Math.max(domeH - wall, domeH * 0.5) * Math.sin(a))); }
  prof.push(new THREE.Vector2(ri, skirt));
  prof.push(new THREE.Vector2(ri, 0));              // 溶接口 内周（ボア先端）
  prof.push(new THREE.Vector2(ri + _fW, 0));        // ルートフェイス
  prof.push(new THREE.Vector2(ro, _hW));            // 面取り（閉）
  const geo = new THREE.LatheGeometry(prof, 56);
  geo.computeVertexNormals();
  const mat = FLANGE_MAT.clone(); mat.side = THREE.DoubleSide; mat.needsUpdate = true;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat));
  g.userData.partType = 'cap';
  g.userData.cap = { ...o };
  g.userData.faceLocal = new THREE.Vector3(0, 0, 0);   // 溶接口（唯一の接続点）
  g.userData.backLocal = new THREE.Vector3(0, 0, 0);
  return g;
}

// ===================================================================
//  ティー・レジューサ（出典＝淡路マテリア溶接式管継手 JIS B2311/2312・ASME B16.9）
//  ・同径T/径違いT：中心-端 C（run）=M（outlet）。run（大きい方）の呼び径で決まる。
//  ・レジューサ：端-端 H。大径の呼び径で決まる（同心・偏心とも同じ H）。
//  ・肉厚は pipeWall(sizeA,sch) を流用。
// ===================================================================
const TEE_C = {'15A':25,'20A':29,'25A':38,'32A':48,'40A':57,'50A':64,'65A':76,'80A':86,
  '90A':95,'100A':105,'125A':124,'150A':143,'200A':178,'250A':216,'300A':254,'350A':279,
  '400A':305,'450A':343,'500A':381};
const REDUCER_H = {'15A':38,'20A':38,'25A':51,'32A':51,'40A':64,'50A':76,'65A':89,'80A':89,
  '90A':89,'100A':102,'125A':127,'150A':140,'200A':152,'250A':178,'300A':203,'350A':330,
  '400A':356,'450A':381,'500A':508};
const SIZE_ORDER = ['15A','20A','25A','32A','40A','50A','65A','80A','90A','100A','125A','150A',
  '200A','250A','300A','350A','400A','450A','500A'];
function sizesUpTo(sizeA) { const i = SIZE_ORDER.indexOf(sizeA); return i < 0 ? SIZE_ORDER.slice() : SIZE_ORDER.slice(0, i + 1); }

// 中空円筒(軸=Y・中心原点・長さL・外半径ro・内半径ri)。両端開口。
function hollowTube(ro, ri, L, seg) {
  const prof = [new THREE.Vector2(ro, L / 2), new THREE.Vector2(ro, -L / 2),
    new THREE.Vector2(ri, -L / 2), new THREE.Vector2(ri, L / 2), new THREE.Vector2(ro, L / 2)];
  const g = new THREE.LatheGeometry(prof, seg || 48); g.computeVertexNormals(); return g;
}

// ティー生成。opts={sizeA(run=大), sizeB(branch=枝), sch}。同径は sizeB=sizeA。
function makeTee(opts) {
  const o = Object.assign({ sizeA: '25A', sizeB: '25A', sch: 'Sch10S' }, opts || {});
  const mat = FLANGE_MAT.clone(); mat.side = THREE.DoubleSide; mat.needsUpdate = true;
  const roR = (FLG_BORE[o.sizeA] || 114) / 2 / 1000;
  const riR = Math.max(roR - pipeWall(o.sizeA, o.sch) / 1000, roR * 0.3);
  const roB = (FLG_BORE[o.sizeB] || 60) / 2 / 1000;
  const riB = Math.max(roB - pipeWall(o.sizeB, o.sch) / 1000, roB * 0.3);
  const C = (TEE_C[o.sizeA] || 38) / 1000;         // run 中心-端
  const M = (TEE_C[o.sizeA] || 38) / 1000;         // outlet 中心-端（run径で決まる）
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.LatheGeometry(weldHollowProfile(roR, riR, -C, C, true, true), 48), mat));   // run（Y軸・両端に開先）
  const br = new THREE.Mesh(new THREE.LatheGeometry(weldHollowProfile(roB, riB, -M / 2, M / 2, true, false), 40), mat);   // branch（外端のみ開先・内端は本管接合）
  br.rotation.x = Math.PI / 2; br.position.z = M / 2; g.add(br);
  g.userData.partType = 'tee';
  g.userData.tee = { ...o };
  g.userData.faceLocal = new THREE.Vector3(0, C, 0);    // run +Y端
  g.userData.backLocal = new THREE.Vector3(0, -C, 0);   // run -Y端
  // 工作点：本管(Y軸)と枝管(Z軸)が垂直に交わる中心(0,0,0)＝COP。エルボの角に相当する起点。
  g.userData.cornerLocal = new THREE.Vector3(0, 0, 0);
  g.userData.extraLocals = [new THREE.Vector3(0, 0, M), g.userData.cornerLocal];  // 枝端フェイス中心＋工作点(中心)。機点・スナップ・起点候補
  g.userData.gripLocal = g.userData.cornerLocal;        // 挿入時の起点＝工作点(中心)。配置後は機点クリックで変更可
  return g;
}

// 偏心レジューサの中空ジオメトリ。大端(y=-H/2,中心x=0)→小端(y=+H/2,中心x=roBig-roSm)で片側面一。
function eccentricReducerGeo(roBig, roSm, riBig, riSm, H, seg) {
  const dx = roBig - roSm;            // 小端中心の片寄せ量（下面が一直線）
  const yB = -H / 2, yS = H / 2;
  const tB = roBig - riBig, fB = Math.min(WELD_ROOT_FACE, tB * 0.5), hB = Math.max(tB - fB, 0) * Math.tan(WELD_BEVEL_DEG * Math.PI / 180);
  const tS = roSm - riSm, fS = Math.min(WELD_ROOT_FACE, tS * 0.5), hS = Math.max(tS - fS, 0) * Math.tan(WELD_BEVEL_DEG * Math.PI / 180);
  const pos = [], idx = [];
  const ring = (r, cx, y) => { const a = []; for (let i = 0; i <= seg; i++) { const t = i / seg * Math.PI * 2; a.push([cx + r * Math.cos(t), y, r * Math.sin(t)]); } return a; };
  const oB = ring(roBig, 0, yB + hB), oS = ring(roSm, dx, yS - hS);   // 外周（開先開始位置まで短縮）
  const btB = ring(riBig + fB, 0, yB), btS = ring(riSm + fS, dx, yS); // 開先先端（ルートフェイス外縁）
  const iB = ring(riBig, 0, yB), iS = ring(riSm, dx, yS);
  const base = () => pos.length / 3;
  const strip = (top, bot) => { const b = base(); top.concat(bot).forEach(p => pos.push(p[0], p[1], p[2])); const n = seg + 1;
    for (let i = 0; i < seg; i++) { const a = b + i, c = b + i + 1, d = b + n + i, e = b + n + i + 1; idx.push(a, d, c, c, d, e); } };
  strip(oS, oB);                      // 外側スラント
  strip(iB, iS);                      // 内側面（ボア）
  strip(oB, btB);                     // 大端 面取り
  strip(btS, oS);                     // 小端 面取り
  const ringFace = (outer, inner) => { const b = base(); outer.concat(inner).forEach(p => pos.push(p[0], p[1], p[2])); const n = seg + 1;
    for (let i = 0; i < seg; i++) { const a = b + i, c = b + i + 1, d = b + n + i, e = b + n + i + 1; idx.push(a, c, d, c, e, d); } };
  ringFace(btB, iB); ringFace(btS, iS); // 端のルートフェイス環（大・小）
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}

// レジューサ生成。opts={sizeA(大), sizeB(小), sch, ecc:同心false/偏心true}
function makeReducer(opts) {
  const o = Object.assign({ sizeA: '50A', sizeB: '25A', sch: 'Sch10S', ecc: false }, opts || {});
  const mat = FLANGE_MAT.clone(); mat.side = THREE.DoubleSide; mat.needsUpdate = true;
  const roBig = (FLG_BORE[o.sizeA] || 114) / 2 / 1000, roSm = (FLG_BORE[o.sizeB] || 60) / 2 / 1000;
  const riBig = Math.max(roBig - pipeWall(o.sizeA, o.sch) / 1000, roBig * 0.3);
  const riSm = Math.max(roSm - pipeWall(o.sizeB, o.sch) / 1000, roSm * 0.3);
  const H = (REDUCER_H[o.sizeA] || 76) / 1000;
  const g = new THREE.Group();
  if (!o.ecc) {
    const _tB = roBig - riBig, _fB = Math.min(WELD_ROOT_FACE, _tB * 0.5), _hB = Math.max(_tB - _fB, 0) * Math.tan(WELD_BEVEL_DEG * Math.PI / 180);
    const _tS = roSm - riSm, _fS = Math.min(WELD_ROOT_FACE, _tS * 0.5), _hS = Math.max(_tS - _fS, 0) * Math.tan(WELD_BEVEL_DEG * Math.PI / 180);
    const prof = [
      new THREE.Vector2(roBig, -H / 2 + _hB),   // 大端 外周（開先開始）
      new THREE.Vector2(roSm,  H / 2 - _hS),    // 小端 外周（開先開始）
      new THREE.Vector2(riSm + _fS, H / 2),     // 小端 面取り→ルートフェイス
      new THREE.Vector2(riSm, H / 2),
      new THREE.Vector2(riBig, -H / 2),         // 内側スラント→大端ボア
      new THREE.Vector2(riBig + _fB, -H / 2),   // 大端 ルートフェイス
      new THREE.Vector2(roBig, -H / 2 + _hB),   // 大端 面取り（閉）
    ];
    const geo = new THREE.LatheGeometry(prof, 56); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, mat));
  } else {
    g.add(new THREE.Mesh(eccentricReducerGeo(roBig, roSm, riBig, riSm, H, 56), mat));
    // 偏心の「フラット側」(+X：大端・小端の外縁が x=roBig で揃う直線辺 / z=0 の母線) に見分け用の目印線
    const markR = Math.max(roSm * 0.05, 0.0012);
    const flatMark = new THREE.Mesh(new THREE.CylinderGeometry(markR, markR, H, 8),
      new THREE.MeshBasicMaterial({ color: 0x1f3a93 }));   // 視認用の濃色（照明非依存）
    flatMark.position.set(roBig, 0, 0);                    // フラット側の母線(軸=Y)に沿わせる
    g.add(flatMark);
  }
  g.userData.partType = 'reducer';
  g.userData.reducer = { ...o };
  // 偏心は小端中心が x 方向へ dx=roBig-roSm ずれる。同心はずれなし(x=0)。
  const smX = o.ecc ? (roBig - roSm) : 0;
  g.userData.faceLocal = new THREE.Vector3(smX, H / 2, 0);   // 小端中心（+Y・偏心はx寄せ）
  g.userData.backLocal = new THREE.Vector3(0, -H / 2, 0);    // 大端中心（-Y）
  return g;
}

// 突合せ溶接継手（エルボ・キャップ等）共通の選択仕様。デフォルトは BW / 25A / Sch10S。
// 接続タイプ：BW=突合せ溶接（現状）。将来 SW(差込み溶接)・SCRD(ねじ込み) を追加予定。
const FITTING_TYPES = ['BW'];   // ※準備中の SW / SCRD は規格データ整備後に追加
const fittingOpts = { type: 'BW', sizeA: '25A', sizeB: '20A', sch: 'Sch10S' };
// fittingOpts.sizeA がその表に無ければ既定サイズへ丸める（描画用）。優先=25A→50A→先頭。
function clampFitSize(tbl) {
  if (tbl[fittingOpts.sizeA]) return fittingOpts.sizeA;
  const keys = Object.keys(tbl);
  return keys.includes('25A') ? '25A' : (keys.includes('50A') ? '50A' : keys[0]);
}

// ツール定義（今後ここに部品を足していく）
const TOOLS = [
  { type: 'flange', name: 'フランジ', build: () => makeFlange(flangeOpts) },
  { type: 'pipe', name: 'パイプ', build: () => makePipe(pipeOpts) },
  { type: 'elbow90L', name: '90°エルボ(L)', sizes: ELBOW_90L,
    build: () => makeElbow({ ...fittingOpts, kind: '90L', sizeA: clampFitSize(ELBOW_90L) }) },
  { type: 'elbow90S', name: '90°エルボ(S)', sizes: ELBOW_90S,
    build: () => makeElbow({ ...fittingOpts, kind: '90S', sizeA: clampFitSize(ELBOW_90S) }) },
  { type: 'elbow45L', name: '45°エルボ(L)', sizes: ELBOW_45L,
    build: () => makeElbow({ ...fittingOpts, kind: '45L', sizeA: clampFitSize(ELBOW_45L) }) },
  { type: 'elbow45S', name: '45°エルボ(S)', sizes: ELBOW_45S,
    build: () => makeElbow({ ...fittingOpts, kind: '45S', sizeA: clampFitSize(ELBOW_45S) }) },
  { type: 'return180L', name: '180°エルボ(L)', sizes: RETURN_180L,
    build: () => makeElbow({ ...fittingOpts, kind: '180L', sizeA: clampFitSize(RETURN_180L) }) },
  { type: 'return180S', name: '180°エルボ(S)', sizes: RETURN_180S,
    build: () => makeElbow({ ...fittingOpts, kind: '180S', sizeA: clampFitSize(RETURN_180S) }) },
  { type: 'cap', name: 'キャップ', sizes: CAP_E,
    build: () => makeCap({ ...fittingOpts, sizeA: clampFitSize(CAP_E) }) },
  { type: 'teeS', name: 'ティー(T)', sizes: TEE_C,
    build: () => makeTee({ sch: fittingOpts.sch, sizeA: clampFitSize(TEE_C), sizeB: clampFitSize(TEE_C) }) },
  { type: 'teeR', name: 'ティー(RT)', sizes: TEE_C, hasB: true,
    build: () => { const a = clampFitSize(TEE_C); return makeTee({ sch: fittingOpts.sch, sizeA: a, sizeB: clampSizeB(a) }); } },
  { type: 'redC', name: 'レジューサ(C)', sizes: REDUCER_H, hasB: true,
    build: () => { const a = clampFitSize(REDUCER_H); return makeReducer({ sch: fittingOpts.sch, sizeA: a, sizeB: clampSizeB(a), ecc: false }); } },
  { type: 'redE', name: 'レジューサ(E)', sizes: REDUCER_H, hasB: true,
    build: () => { const a = clampFitSize(REDUCER_H); return makeReducer({ sch: fittingOpts.sch, sizeA: a, sizeB: clampSizeB(a), ecc: true }); } },
];
// 突合せ溶接継手ツールか（パイプ・フランジ以外）／ツール検索
function isFittingType(type) { return type !== 'flange' && type !== 'pipe'; }
function toolByType(type) { return TOOLS.find(t => t.type === type); }
// sizeB(小径/枝径)を sizeA 未満（最大でも一段小さい）にクランプ。fittingOpts.sizeB を尊重しつつ範囲内へ。
function clampSizeB(sizeA) {
  const cand = sizesUpTo(sizeA).slice(0, -1);     // sizeA より小さい呼び径のみ
  if (!cand.length) return sizeA;                 // 最小径なら同径扱い
  return cand.includes(fittingOpts.sizeB) ? fittingOpts.sizeB : cand[cand.length - 1];
}

// ===================================================================
//  ツールパレットの3Dサムネイル（各タイルで部品がゆっくり回る）
// ===================================================================
const palThumbs = [];
(function buildPalette() {
  const host = document.getElementById('palItems');
  if (!host) return;
  TOOLS.forEach(tool => {
    const tile = document.createElement('div');
    tile.className = 'pal-tile';
    tile.dataset.type = tool.type;
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 96;
    tile.appendChild(cv);              // 部品名はドロップダウンに表示するためタイル内には出さない
    host.appendChild(tile);

    // クリックで追従開始（アイテムがマウスについてくる）→ 3D空間でクリックして設置。
    // 同じタイルをもう一度クリックすると追従解除。ドラッグ不要。
    tile.addEventListener('click', e => {
      if (followTool && followTool.tool === tool) { stopFollow(); return; }
      startFollow(tool, tile, e.clientX, e.clientY);
    });

    const tScene = new THREE.Scene();
    tScene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const tl = new THREE.DirectionalLight(0xffffff, 0.9); tl.position.set(2, 4, 3); tScene.add(tl);
    const tl2 = new THREE.DirectionalLight(0x99b0d0, 0.4); tl2.position.set(-3, 1, -2); tScene.add(tl2);
    const tCam = new THREE.PerspectiveCamera(38, cv.width / cv.height, 0.01, 10);
    tCam.position.set(0.32, 0.4, 0.5); tCam.lookAt(0, 0, 0);   // 斜め見下ろし（画像の角度）
    let tRenderer;
    try {
      tRenderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
      tRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      tRenderer.setSize(cv.width, cv.height, false);
    } catch (err) { console.error('palette thumb init error:', err); return; }
    const pivot = new THREE.Group();     // 縦表示＋サイズ正規化の入れ物
    tScene.add(pivot);

    // サムネイルの中身を作り直す（口径などが変わっても枠に収める）
    function rebuildThumb() {
      while (pivot.children.length) {
        const c = pivot.children.pop();
        c.traverse && c.traverse(n => { if (n.geometry) n.geometry.dispose(); });
      }
      const obj = tool.build();
      obj.rotation.z = Math.PI / 2;      // 縦（立てた状態）で見せる
      // バウンディングから一定サイズに正規化（10A〜500Aで見た目が揃う）
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const maxd = Math.max(size.x, size.y, size.z) || 1;
      const s = 0.34 / maxd;             // 枠に収まるよう余白を確保（エルボ等のはみ出し対策）
      obj.scale.setScalar(s);
      const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
      obj.position.sub(c);               // 中心を原点へ
      pivot.add(obj);
    }
    rebuildThumb();
    palThumbs.push({ scene: tScene, cam: tCam, renderer: tRenderer, obj: pivot, tool, tile, rebuild: rebuildThumb });
  });
})();

// 部品種別の選択（パレットは1つだけ表示）。ドロップダウンで切替。
function buildPartSelect() {
  const sel = document.getElementById('partSelect');
  if (!sel) return;
  sel.innerHTML = '';
  TOOLS.forEach(t => sel.add(new Option(t.name, t.type)));
  sel.addEventListener('change', () => setActivePart(sel.value));
}
function setActivePart(type) {
  stopFollow();                                   // 別部品へ切替時は追従解除
  palThumbs.forEach(t => { if (t.tile) t.tile.style.display = (t.tool.type === type) ? '' : 'none'; });
  const sel = document.getElementById('partSelect'); if (sel) sel.value = type;
  setActivePartType(type);                        // オプション欄(フランジ/パイプ)の出し分け
}

// 仕様変更時にサムネイルを作り直す（全部品）
function refreshThumbs() {
  palThumbs.forEach(t => t.rebuild());
}

// ---- フランジ仕様のドロップダウン ----
// 文字列配列で select の選択肢を入れ替える
function fillSelect(id, items, val) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = '';
  items.forEach(it => el.add(new Option(it, it)));
  if (items.includes(val)) el.value = val;
  else if (items.length) el.value = items[0];
}
// タイプに応じたスケジュール一覧（LJはドッキングするスタブエンド規格＝5S/10S/20S/40）
function schListForType() { return flangeOpts.type === 'LJ' ? STUB_SCHEDULES : SCHEDULES; }

// 全ドロップダウンを組み直す（起動時）。タイプとクラスは相互に整合させる。
function syncOptionsUI() {
  rebuildClassOptions();   // タイプに合うクラスだけ
  rebuildTypeOptions();    // クラスに合うタイプだけ
  rebuildSizeOptions();
  fillSelect('optFace', FLANGE_FACES, flangeOpts.face);
  fillSelect('optSch', schListForType(), flangeOpts.sch);
  updateOptVisibility();
}

// 欄の表示／非表示・有効無効（タイプで出し分け）
function updateOptVisibility() {
  // スケジュール欄：WN・SW・LJ（LJはドッキングするスタブエンドの肉厚）で表示
  const schOn = (flangeOpts.type === 'WN' || flangeOpts.type === 'SW' || flangeOpts.type === 'LJ');
  const sw = document.getElementById('optSchWrap'); if (sw) sw.style.display = schOn ? '' : 'none';
  // フェイス欄：LJは無効化（フラット面固定。ガスケット面はスタブ側のつばが持つ）
  const fe = document.getElementById('optFace'); const feLab = fe && fe.closest('label');
  if (fe) {
    const isLJ = flangeOpts.type === 'LJ';
    fe.disabled = isLJ;
    if (feLab) feLab.style.opacity = isLJ ? '0.4' : '';
  }
}
// 旧名の互換
function updateSchVisibility() { updateOptVisibility(); }

// いずれかの欄が変わった時：仕様へ反映し、連動欄を組み直す
function onOptChange(srcId) {
  const o = flangeOpts;
  const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  if (srcId === 'optType') {
    o.type = v('optType');
    rebuildClassOptions();        // タイプに規格が無いクラスを消す
  } else if (srcId === 'optClass') {
    o.cls = v('optClass');
    rebuildTypeOptions();         // クラスに規格が無いタイプを消す
  }
  o.type = v('optType');
  o.cls  = v('optClass');
  if (srcId === 'optType' || srcId === 'optClass') {
    rebuildSizeOptions();
    fillSelect('optSch', schListForType(), o.sch);            // タイプでSch一覧を切替
  }
  o.sizeA = v('optSize');
  o.face  = v('optFace');
  o.sch   = v('optSch');
  updateOptVisibility();
  refreshThumbs();
}

// ---- パイプのオプションUI（呼び径・Sch・長さ mm） ----
function buildPipeOptions() {
  fillSelect('optPipeSize', FLANGE_SIZES, pipeOpts.sizeA);
  fillSelect('optPipeSch', PIPE_SCHEDULES, pipeOpts.sch);
  const len = document.getElementById('optPipeLen'); if (len) len.value = pipeOpts.length;
}
function onPipeOptChange() {
  const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  pipeOpts.sizeA = v('optPipeSize');
  pipeOpts.sch = v('optPipeSch');
  const len = parseFloat(v('optPipeLen')); pipeOpts.length = (len > 0 ? len : 1000);
  refreshThumbs();
}
['optPipeSize', 'optPipeSch', 'optPipeLen'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', onPipeOptChange);
});

// ---- 突合せ溶接継手（エルボ・キャップ・ティー・レジューサ）のオプションUI ----
let activeFittingType = 'elbow90L';
// アクティブ継手の規格サイズ表に合わせて呼び径ドロップダウンを作り直す。
// 径違い/レジューサ(hasB)のときは小径(sizeB)ドロップダウンも sizeA 未満で出す。
function rebuildFittingSize() {
  const tool = toolByType(activeFittingType);
  const sizes = tool ? Object.keys(tool.sizes) : FLANGE_SIZES;
  if (!sizes.includes(fittingOpts.sizeA)) fittingOpts.sizeA = sizes.includes('25A') ? '25A' : sizes[0];
  fillSelect('optFitType', FITTING_TYPES, fittingOpts.type);   // 接続タイプ（現状BWのみ）
  fillSelect('optFitSize', sizes, fittingOpts.sizeA);
  fillSelect('optFitSch', FITTING_SCHEDULES, fittingOpts.sch);
  // 小径(sizeB)欄：径違い/レジューサのみ表示
  const bWrap = document.getElementById('optFitSizeBWrap');
  const hasB = !!(tool && tool.hasB);
  if (bWrap) bWrap.style.display = hasB ? '' : 'none';
  if (hasB) {
    const bSizes = sizesUpTo(fittingOpts.sizeA).slice(0, -1);   // sizeA 未満
    if (!bSizes.length) { fillSelect('optFitSizeB', [fittingOpts.sizeA], fittingOpts.sizeA); fittingOpts.sizeB = fittingOpts.sizeA; }
    else { if (!bSizes.includes(fittingOpts.sizeB)) fittingOpts.sizeB = bSizes[bSizes.length - 1]; fillSelect('optFitSizeB', bSizes, fittingOpts.sizeB); }
  }
}
function onFitOptChange() {
  const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  const t = v('optFitType'); if (t !== undefined) fittingOpts.type = t;
  fittingOpts.sizeA = v('optFitSize');
  fittingOpts.sch = v('optFitSch');
  const b = v('optFitSizeB'); if (b !== undefined) fittingOpts.sizeB = b;
  rebuildFittingSize();   // sizeA 変更で sizeB 候補が変わるため作り直し
  refreshThumbs();
}
['optFitType', 'optFitSize', 'optFitSch', 'optFitSizeB'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', onFitOptChange);
});

// 部品種別に応じてオプションパネルを出し分け（フランジ／パイプ／継手）
function setActivePartType(type) {
  const fl = document.getElementById('flangeOptsUI');
  const pi = document.getElementById('pipeOptsUI');
  const fi = document.getElementById('fittingOptsUI');
  const fitting = isFittingType(type) && type !== 'flange';   // flange は別UI
  const isPipe = (type === 'pipe');
  const isFlange = (type === 'flange');
  if (fl) fl.style.display = isFlange ? '' : 'none';
  if (pi) pi.style.display = isPipe ? '' : 'none';
  if (fi) fi.style.display = (fitting && !isPipe) ? '' : 'none';
  if (fitting && !isPipe) { activeFittingType = type; rebuildFittingSize(); }
}

// ===================================================================
//  部品の配置：パレットのアイテムを1クリック→追従→ビューでクリックで設置
// ===================================================================
const placeRay = new THREE.Raycaster();
const placeNdc = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);   // y=0 の床面

let followTool = null;        // 追従中のツール {tool, tile}

// 初期方向：面を「立てた」状態。Z軸リングの先頭(index 0 = Z270)が立った向き(面が水平+X)。
//  → フランジは面が横向き＝立つ／パイプは軸が水平＝寝かせて置ける（どちらも +Y が水平）。
const DEFAULT_DIR = 0;
let followOrient = DEFAULT_DIR;  // 配置の方向(dir) index（右クリックで送る）
let followRoll = 0;              // 配置のひねり(roll)（Shift+右クリックで切替）
let followQuat = null;           // 追従中に線分式回転で保持する向き（パイプ・エルボ・キャップ用。null=離散dir/roll系）
let followPreview = null;     // 追従中の半透明3Dプレビュー（実物と同じ形）

// ---- 再移動（配置済み部品を掴んで動かす） ----
let movingPart = null;        // 移動中の配置済み部品（null=移動していない）
let movingOrient = 0;         // 移動中部品の方向(dir) index
let movingRoll = 0;           // 移動中部品のひねり(roll) 0/45°
let moveOrig = null;          // 取消用：掴む前の position
let moveGroup = [];           // 集団移動：主選択と一緒に動かす他の選択部品 [{part, startPos}]
let annFollowMove = false;    // 部品の集団移動に、窓選択した線も追従させるか
let touchShift = false;       // タッチ用の仮想Shift（画面のShiftボタンON）。e.shiftKey と OR して使う（Y方向作図・楕円化など）
let touchCtrl = false;        // タッチ用の仮想Ctrl（画面のCtrlボタンON）。e.ctrlKey/metaKey と OR して使う（複数選択トグル）
let movingByDrag = false;     // ダブルクリック→押したままドラッグで自由移動中か（pointerupで確定）
let _lastDownT = 0, _lastDownX = 0, _lastDownY = 0, _lastDownPart = null;  // ダブルクリック押下検出用
const SNAP_PX = 18;           // 機点スナップが効く画面距離(px)

// 複数選択中に primary を掴んだとき、一緒に動かす他メンバーの開始位置を記録する。
// primary が選択集合に入っていて2件以上なら集団移動、そうでなければ空（=単体移動）。
function moveGroupFor(primary) {
  if (!selectedParts.has(primary) || selectedParts.size <= 1) return [];
  const arr = [];
  for (const p of selectedParts) if (p !== primary) arr.push({ part: p, startPos: p.position.clone() });
  return arr;
}
// primary が startPos から動いた分だけ、グループ各メンバーを平行移動させる。
// 向きは変えないので position 差分＝起点差分で平行移動が成立する。
function applyGroupDelta(group, primary, primaryStartPos) {
  if (!group || !group.length) return;
  const delta = primary.position.clone().sub(primaryStartPos);
  for (const g of group) g.part.position.copy(g.startPos).add(delta);
}

// ---- 方向移動（選択部品を45°刻みの方向へドラッグ＝トラッキング移動） ----
// {part, sx, sy, startOrigin(Vec3), planeY, dir(Vec3|null), dist, started, locked}
let dirDrag = null;
const DIR_STEP = Math.PI / 4;   // 45°刻み

// ---- パイプ長さ調整 ----
// pipeEndSel: 選択中パイプの「起点(固定端)」 'face'|'back'|null（null=未選択＝COPモード）
// pipeEndDrag: 端ドラッグ中の状態 {part, grabbedEnd, sx, sy, moved, origLen}
let pipeEndSel = null;
let pipeEndDrag = null;
function pipeSelected() {
  return !!(selectedPart && selectedPart.userData.partType === 'pipe' && !dirActive());
}
function pipeLenMode() { return pipeSelected() && !!pipeEndSel; }   // 起点選択済み＝長さモード
// パイプの長さ(mm)を変更し、keepEnd('face'|'back')の端を同じ位置に保って作り直す
function rebuildPipe(part, lengthMm, keepEnd) {
  keepEnd = keepEnd || 'face';
  const o = part.userData.pipe;
  const keepLocal = keepEnd === 'back' ? part.userData.backLocal : part.userData.faceLocal;
  const keepPos = connModelPos(part, keepLocal);            // 保持する端の現在位置
  o.length = Math.max(lengthMm, 1);
  while (part.children.length) {                            // メッシュを作り直す
    const c = part.children.pop();
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
  const np = makePipe(o);
  while (np.children.length) part.add(np.children.pop());
  const half = (o.length / 1000) / 2;
  part.userData.faceLocal.set(0, half, 0);
  part.userData.backLocal.set(0, -half, 0);
  const newKeep = keepEnd === 'back' ? part.userData.backLocal : part.userData.faceLocal;
  part.position.copy(keepPos).sub(newKeep.clone().applyQuaternion(part.quaternion));
  if (typeof setEmissive === 'function' && selectedParts.has(part)) setEmissive(part, SEL_COLOR);   // 作り直しで消えた選択発光を戻す
  if (typeof refreshItemList === 'function') refreshItemList();   // 長さ変更を一覧へ反映
}
// 固定端 anchorW（modelローカル）を保持したまま、可動端 movingEnd を「軸 axis × sign 方向」へ lengthMm だけ伸ばす。
// sign<0 のときは固定端を通り越して反対側へ伸びる＝パイプの向きが反転する（長さ調整で“通り抜け”を実現）。
function rebuildPipeAlong(part, lengthMm, movingEnd, anchorW, axis, sign) {
  const fixedEnd = movingEnd === 'face' ? 'back' : 'face';
  const o = part.userData.pipe; o.length = Math.max(lengthMm, 1);
  while (part.children.length) { const c = part.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
  const np = makePipe(o); while (np.children.length) part.add(np.children.pop());
  const half = (o.length / 1000) / 2;
  const faceL = part.userData.faceLocal, backL = part.userData.backLocal;
  faceL.set(0, half, 0); backL.set(0, -half, 0);
  const dir = axis.clone().multiplyScalar(sign < 0 ? -1 : 1);          // 固定端→可動端の向き（sign<0で反転）
  const yDir = (movingEnd === 'face') ? dir : dir.clone().negate();    // ローカル+Y(back→face) を可動端向きへ合わせる
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), yDir.clone().normalize());
  part.quaternion.copy(q);
  const fixedLocal = fixedEnd === 'face' ? faceL : backL;
  part.position.copy(anchorW).sub(fixedLocal.clone().applyQuaternion(q));   // 固定端を anchorW に合わせる
  if (typeof setEmissive === 'function' && selectedParts.has(part)) setEmissive(part, SEL_COLOR);
  if (typeof refreshItemList === 'function') refreshItemList();
}
// 端 movingEnd の COP(高さ mm) を copYmm にする＝その端だけ上下（反対端固定）。パイプを傾ける（斜め管化）。
function tiltPipeEndY(part, movingEnd, copYmm) {
  const faceL = part.userData.faceLocal, backL = part.userData.backLocal;
  if (!faceL || !backL) return;
  const fixedEnd = movingEnd === 'face' ? 'back' : 'face';
  const fixedW = connModelPos(part, fixedEnd === 'face' ? faceL : backL).clone();
  const movingW = connModelPos(part, movingEnd === 'face' ? faceL : backL);
  const newMovingW = new THREE.Vector3(movingW.x, copYmm / 1000, movingW.z);
  const faceW = (movingEnd === 'face') ? newMovingW : fixedW;        // local +Y は back→face
  const backW = (movingEnd === 'back') ? newMovingW : fixedW;
  const dir = faceW.clone().sub(backW);
  const length = dir.length();
  if (length < 1e-4) return;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const o = part.userData.pipe; o.length = length * 1000;
  while (part.children.length) { const c = part.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
  const np = makePipe(o); while (np.children.length) part.add(np.children.pop());
  const half = length / 2;
  faceL.set(0, half, 0); backL.set(0, -half, 0);
  part.quaternion.copy(q);
  const fixedLocal = fixedEnd === 'face' ? faceL : backL;
  part.position.copy(fixedW).sub(fixedLocal.clone().applyQuaternion(q));
  if (typeof setEmissive === 'function' && selectedParts.has(part)) setEmissive(part, SEL_COLOR);   // 選択発光を維持
  if (typeof refreshItemList === 'function') refreshItemList();
}
// 入力フォームの長さ→パイプを伸縮（選択(緑)端を動かし、反対端を固定）
function applyPipeLength() {
  if (!pipeLenMode()) return;
  const fixed = pipeEndSel === 'face' ? 'back' : 'face';
  rebuildPipe(selectedPart, parseFloat(hYInput.value) || 1, fixed);
}
// カーソルに近いパイプの端を返す（'face'|'back'|null）
function nearestPipeEnd(part, clientX, clientY) {
  const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
  let best = null, bestD = 16;
  for (const end of ['face', 'back']) {
    const local = end === 'face' ? part.userData.faceLocal : part.userData.backLocal;
    if (!local) continue;
    const ndc = modelGroup.localToWorld(connModelPos(part, local)).project(cam);
    if (ndc.z >= 1) continue;
    const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - clientX, sy - clientY);
    if (d < bestD) { bestD = d; best = end; }
  }
  return best;
}
// 軸線(p0World+方向aWorld)上でカーソル光線に最も近い点を返す
function closestPointOnAxis(clientX, clientY, p0, a) {
  const rect = renderer.domElement.getBoundingClientRect();
  placeNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  placeNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  placeRay.setFromCamera(placeNdc, activeCam());
  const o = placeRay.ray.origin, d = placeRay.ray.direction;
  const w0 = o.clone().sub(p0);
  const b = d.dot(a), denom = 1 - b * b;
  // 2直線(光線・軸)の最近点パラメータ s（軸方向の符号付き距離）
  const s = Math.abs(denom) < 1e-4 ? w0.dot(a) : (a.dot(w0) - b * d.dot(w0)) / denom;
  return p0.clone().add(a.clone().multiplyScalar(s));
}
// 両端センターのマーカーを描く（起点=pipeEndSel側は緑・大、もう一方は橙・極小）
function drawPipeEnds(part) {
  clearMarkers();
  const f = connModelPos(part, part.userData.faceLocal);
  const b = connModelPos(part, part.userData.backLocal);
  const rN = markerRadiusFor(part, false), rB = markerRadiusFor(part, true);
  addMarker(f, pipeEndSel === 'face' ? 0x39ff8a : 0xff8a3c, pipeEndSel === 'face' ? rB : rN);
  addMarker(b, pipeEndSel === 'back' ? 0x39ff8a : 0xff8a3c, pipeEndSel === 'back' ? rB : rN);
}
// パイプの軸線(anchorW + axis)上で「同じ通り」に乗る他部品の機点へ、長さ(可動端)をスナップ。
// ・軸線からのズレ(垂直距離)が極小のものだけを対象（ズレていたら拾わない）。
// ・吸着判定は移動時と同じ画面距離 SNAP_PX(=18px)：機点の画面位置とカーソルが近ければ吸着。
// 返り値＝その機点の軸方向位置(m)。無ければ null。
function nearestAxisSnap(part, anchorW, axis, clientX, clientY) {
  const ro = (FLG_BORE[part.userData.pipe.sizeA] || 114) / 2 / 1000;
  const perpTol = Math.max(ro * 0.25, 0.0015);   // 軸線からの許容ズレ（ほぼ同一線上のみ）
  const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
  let best = null, bestD = SNAP_PX;              // 移動時と同じ距離感（画面18px）
  const testPos = (mpos) => {
    const v = mpos.clone().sub(anchorW);
    const along = v.dot(axis);                   // 固定端からの軸方向距離
    if (along <= 0.003) return;                  // 固定端より手前/同位置は対象外
    const perp = v.clone().sub(axis.clone().multiplyScalar(along)).length();
    if (perp > perpTol) return;                  // 軸線から外れている＝同じ通りでない→拾わない
    const ndc = modelGroup.localToWorld(mpos.clone()).project(cam);
    if (ndc.z >= 1) return;
    const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - clientX, sy - clientY);   // 画面距離（移動スナップと同基準）
    if (d < bestD) { bestD = d; best = along; }
  };
  for (const p of placedParts) {
    if (p === part || !p.userData.faceLocal) continue;
    for (const local of connsOf(p)) testPos(connModelPos(p, local));
  }
  // 線分・寸法線の端点、構築線どうしの交点にも吸着（2026-06-13 社長指示：線分にマッチ）
  if (window.__annSnapPoints) for (const mpos of window.__annSnapPoints()) testPos(mpos);
  return best;
}
// スライド（ドラッグ）でパイプを伸縮。選択(緑)端 pipeEndSel がマウスに追従して動き、反対端を固定。
// 軸線上に他部品の機点があれば、移動時と同じ距離感(画面18px)で長さを吸着。
function stretchPipe(clientX, clientY) {
  const part = pipeEndDrag.part;
  const moving = pipeEndDrag.grabbedEnd || pipeEndSel || 'face';   // 掴んだ端が動く
  const fixed = moving === 'face' ? 'back' : 'face';          // 反対端を固定
  // ドラッグ開始時に「固定端の位置」と「固定端→可動端の軸」を一度だけ確定。
  // 途中で固定端を通り越して反転しても基準がブレないよう、毎フレーム再計算しない。
  if (!pipeEndDrag.axis) {
    const a0 = connModelPos(part, fixed === 'face' ? part.userData.faceLocal : part.userData.backLocal);
    const f0 = connModelPos(part, moving === 'face' ? part.userData.faceLocal : part.userData.backLocal);
    pipeEndDrag.anchor = a0.clone();
    pipeEndDrag.axis = f0.clone().sub(a0).normalize();
  }
  const anchorW = pipeEndDrag.anchor, axis = pipeEndDrag.axis;
  const proj = closestPointOnAxis(clientX, clientY, anchorW, axis).sub(anchorW).dot(axis);
  if (pipeEndDrag.startProj == null) pipeEndDrag.startProj = proj;   // つかんだ瞬間を基準に
  let signed = pipeEndDrag.origLen / 1000 + (proj - pipeEndDrag.startProj);   // 固定端からの符号付き距離（負＝反対側へ通り抜け）
  const snapLen = nearestAxisSnap(part, anchorW, axis, clientX, clientY);     // カーソル近傍の機点へ吸着（同じ側のみ）
  if (snapLen != null) signed = snapLen;
  const sign = signed < 0 ? -1 : 1;
  const len = Math.max(Math.abs(signed), 0.005);    // 長さは最小5mm（向きは sign で保持）
  rebuildPipeAlong(part, len * 1000, moving, anchorW, axis, sign);
  drawPipeEnds(part);
  if (snapLen != null) addMarker(anchorW.clone().add(axis.clone().multiplyScalar(signed)), 0x39ff8a, markerRadiusFor(part, true));  // 吸着点を緑で強調
  updateForm();
}
function cancelPipeEndDrag() {
  if (!pipeEndDrag) return;
  if (pipeEndDrag.moved) {
    const moving = pipeEndDrag.grabbedEnd || pipeEndSel || 'face';
    if (pipeEndDrag.axis) rebuildPipeAlong(pipeEndDrag.part, pipeEndDrag.origLen, moving, pipeEndDrag.anchor, pipeEndDrag.axis, 1);   // 元の固定端・軸・長さで原状復帰（反転していても戻る）
    else rebuildPipe(pipeEndDrag.part, pipeEndDrag.origLen, moving === 'face' ? 'back' : 'face');
  }
  pipeEndDrag = null; controls.enabled = true; _idleSig = null;
}
// アイドル時：選択中パイプの両端センターを表示（操作中は各処理がmarkerGroupを管理）
// 状態が変わったときだけ作り直す（毎フレーム再生成しない）
let _idleSig = null;
// 選択中アイテムの全機点を表示（grip＝起点は緑・大、他は水色・小）。
function drawSelectedConns(part) {
  clearMarkers();
  const grip = gripLocalOf(part);
  for (const local of connsOf(part)) {
    const isGrip = local === grip;
    addMarker(connModelPos(part, local), isGrip ? 0x39ff8a : 0x7fd1ff, markerRadiusFor(part, isGrip));
  }
}
function updateIdleMarkers() {
  if (followTool || movingPart || dirDrag || pipeEndDrag) { _idleSig = null; return; }
  let sig = null;
  if (pipeSelected() && selectedPart.userData.faceLocal) {
    const f = connModelPos(selectedPart, selectedPart.userData.faceLocal);
    const b = connModelPos(selectedPart, selectedPart.userData.backLocal);
    sig = `pipe|${pipeEndSel}|${f.x.toFixed(3)},${f.y.toFixed(3)},${f.z.toFixed(3)}|${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)}`;
  } else if (selectedPart && selectedParts.size <= 1 && selectedPart.userData.faceLocal && !dirActive()) {
    // 非パイプの選択中アイテム：全機点を表示し grip を強調
    const gk = connModelPos(selectedPart, gripLocalOf(selectedPart));
    sig = `conn|${selectedPart.uuid}|${gk.x.toFixed(3)},${gk.y.toFixed(3)},${gk.z.toFixed(3)}|${connsOf(selectedPart).length}`;
  }
  if (sig === _idleSig) return;       // 状態変化なし→何もしない
  if (!sig) clearMarkers();
  else if (sig.startsWith('pipe|')) drawPipeEnds(selectedPart);
  else drawSelectedConns(selectedPart);
  _idleSig = sig;
}

// ---- 起点・機点マーカー（橙=起点 / 水色=機点 / 緑=吸着中） ----
const markerGroup = new THREE.Group();
modelGroup.add(markerGroup);
function clearMarkers() {
  while (markerGroup.children.length) {
    const c = markerGroup.children.pop();
    if (c.geometry) c.geometry.dispose();
    if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
  }
}
function addMarker(modelPos, color, r) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(r, 16, 12),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.92 }));
  m.position.copy(modelPos);
  m.renderOrder = 999;          // 常に手前に描く（部品に隠れない）
  markerGroup.add(m);
}
// 部品の外半径(m)。機点マーカーのサイズ基準に使う。線分端点や不明部品はフォールバック値。
function partBoreRadius(part) {
  const u = part && part.userData;
  const spec = u && (u.pipe || u.elbow || u.cap || u.tee || u.reducer || u.flange);
  const sizeA = spec && spec.sizeA;
  if (sizeA && FLG_BORE[sizeA]) return FLG_BORE[sizeA] / 2 / 1000;
  return 0.03;
}
// 機点マーカーの半径(m)：部品の口径に比例（大きい部品でも分かりやすく）。最小・最大でクランプ。big=起点/吸着の強調用。
function markerRadiusFor(part, big) {
  const ro = partBoreRadius(part);
  const base = Math.min(Math.max(ro * 0.11, 0.0022), 0.022);
  return big ? base * 1.7 : base;
}

// 部品の機点（接続点）をローカル座標で確定する。
// build直後（無回転・原点）に呼ぶこと。faceLocal=フェイス中心(=起点)、backLocal=背面(溶接端)。
function computeConns(obj) {
  // ビルダーが機点を明示設定済み（エルボ等の曲がり物）ならそれを尊重する
  if (obj.userData.faceLocal && obj.userData.backLocal) return;
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.userData.faceLocal = new THREE.Vector3(0, box.max.y, 0);   // +Y最先端＝フェイス中心
  obj.userData.backLocal = new THREE.Vector3(0, box.min.y, 0);   // -Y端＝背面
}
// 部品の機点ローカル点を modelGroup ローカル座標へ
function connModelPos(obj, local) {
  return local.clone().applyQuaternion(obj.quaternion).add(obj.position);
}
// 部品の全機点（ローカル）を返す。faceLocal/backLocal に加え、extraLocals（ティーの枝端等）も含む。
function connsOf(p) {
  const arr = [];
  if (p.userData.faceLocal) arr.push(p.userData.faceLocal);
  if (p.userData.backLocal) arr.push(p.userData.backLocal);
  if (p.userData.extraLocals) for (const e of p.userData.extraLocals) arr.push(e);
  return arr;
}
// 起点に使う機点（grip）。ユーザーが選んだ機点 gripLocal、未選択なら faceLocal。
// パイプは端クリックで pipeEndSel(face/back) を起点に選ぶので、選択中パイプはそれを優先（移動と回転で起点を一致させる）。
function gripLocalOf(obj) {
  if (obj.userData.partType === 'pipe' && obj === selectedPart && pipeEndSel)
    return pipeEndSel === 'back' ? obj.userData.backLocal : obj.userData.faceLocal;
  return obj.userData.gripLocal || obj.userData.faceLocal;
}
// カーソル近傍(画面SNAP_PX)にある obj 自身の機点ローカルを返す。無ければ null。
function nearestConnLocal(part, clientX, clientY) {
  const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
  let best = null, bestD = SNAP_PX;
  for (const local of connsOf(part)) {
    const ndc = modelGroup.localToWorld(connModelPos(part, local).clone()).project(cam);
    if (ndc.z >= 1) continue;
    const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - clientX, sy - clientY);
    if (d < bestD) { bestD = d; best = local; }
  }
  return best;
}
// 部品の起点（＝選んだ機点 grip、未選択なら faceLocal）の modelGroup ローカル位置
function originModelPos(obj) {
  return connModelPos(obj, gripLocalOf(obj));
}
// 起点(grip)が target（modelGroupローカル点）に来るよう部品を移動
function setPartByOrigin(obj, targetModelLocal) {
  const off = gripLocalOf(obj).clone().applyQuaternion(obj.quaternion);
  obj.position.copy(targetModelLocal).sub(off);
}
// カーソル近傍の他部品の機点を探す（画面距離）。見つかれば modelGroupローカル点を返す。
function resolveSnap(clientX, clientY, exclude) {
  const rect = renderer.domElement.getBoundingClientRect();
  const cam = activeCam();
  let best = null, bestD = SNAP_PX;
  for (const p of placedParts) {
    if (p === exclude || !p.userData.faceLocal) continue;
    for (const local of connsOf(p)) {
      const mpos = connModelPos(p, local);
      const ndc = modelGroup.localToWorld(mpos.clone()).project(cam);
      if (ndc.z >= 1) continue;                         // カメラ背後は除外
      const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) { bestD = d; best = mpos; }
    }
  }
  // 線分・寸法線の端点にもスナップ（描画モジュールが提供）
  if (window.__annSnapPoints) {
    for (const mpos of window.__annSnapPoints()) {
      const ndc = modelGroup.localToWorld(mpos.clone()).project(cam);
      if (ndc.z >= 1) continue;
      const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) { bestD = d; best = mpos.clone(); }
    }
  }
  return best;
}
// 配置/移動の着地点を決める：まず機点スナップ、無ければ高さ planeY の水平面。
// planeY を渡すと「その高さの平面」上で平行移動できる（再移動で高さが床に戻らない）。
function resolveTarget(clientX, clientY, exclude, planeY = 0) {
  const snap = resolveSnap(clientX, clientY, exclude);
  if (snap) return { point: snap, snapped: true };
  const rect = renderer.domElement.getBoundingClientRect();
  placeNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  placeNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  placeRay.setFromCamera(placeNdc, activeCam());
  const hit = new THREE.Vector3();
  const plane = planeY === 0 ? floorPlane : new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  if (!placeRay.ray.intersectPlane(plane, hit)) return null;
  modelGroup.worldToLocal(hit);
  return { point: hit, snapped: false };
}
// 起点マーカー＋他部品の全機点マーカーを描く（snapPoint と一致する機点は緑・大）
function showInteractionMarkers(movingObj, snapPoint) {
  clearMarkers();
  addMarker(originModelPos(movingObj), 0xff8a3c, markerRadiusFor(movingObj, false));    // 起点（橙）
  for (const p of placedParts) {
    if (p === movingObj || !p.userData.faceLocal) continue;
    const rN = markerRadiusFor(p, false), rB = markerRadiusFor(p, true);
    for (const local of connsOf(p)) {
      const mpos = connModelPos(p, local);
      const isSnap = snapPoint && mpos.distanceTo(snapPoint) < 1e-6;
      addMarker(mpos, isSnap ? 0x39ff8a : 0x7fd1ff, isSnap ? rB : rN);
    }
  }
  // 線分・寸法線の端点もアイテムの機点と同じ水色マーカーで示す（スナップ中は緑・大）
  if (window.__annSnapPoints) {
    const rN = markerRadiusFor(null, false), rB = markerRadiusFor(null, true);
    for (const mpos of window.__annSnapPoints()) {
      const isSnap = snapPoint && mpos.distanceTo(snapPoint) < 1e-6;
      addMarker(mpos, isSnap ? 0x39ff8a : 0x7fd1ff, isSnap ? rB : rN);
    }
  }
}

// 向きは「方向(dir)」と「ひねり(roll)」の2系統に分離する。
//  ・方向(dir)：右クリックで送る。各軸を「立てた向き」から45°刻みで一周＋最初へ戻る1回。
//    index 0..8 = Z軸（45°×8で一周→9回目で最初の向きへ戻る）、9..17 = X軸（同様）。
//    つまり一周して最初の位置に戻った次のクリックで、次の軸へ方向が変わる。
//  ・ひねり(roll)：Shift+右クリックで切替。部品自身の軸(ローカル+Y)まわり 45°×8 の8段階。
// 最終姿勢 = 方向Q × ひねりQ。
const DIR_QUATS = (() => {
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  const d2r = d => d * Math.PI / 180;
  const list = [];
  // Z軸リング(index 0-8)：立てた向き(Z270)から45°ずつ、9回目(k=8=360°)で最初へ戻る
  for (let k = 0; k < 9; k++) list.push(new THREE.Quaternion().setFromAxisAngle(Z, d2r((270 + k * 45) % 360)));
  // X軸リング(index 9-17)：立てた向き(X90)から45°ずつ、9回目で最初へ戻る
  for (let k = 0; k < 9; k++) list.push(new THREE.Quaternion().setFromAxisAngle(X, d2r((90 + k * 45) % 360)));
  return list;   // 計18（各軸 45°×8で一周＋最初へ戻る1回 = 9回 ×2軸）
})();
const DIR_COUNT = DIR_QUATS.length;           // 16方向（Z一周8＋X一周8）
const ROLL_COUNT = 8;                          // ひねり：45°×8段階
const _rollAxis = new THREE.Vector3(0, 1, 0);  // 部品自身の軸（ローカル+Y）
const _tmpQ = new THREE.Quaternion();
// dirIdx・rollIdx から姿勢を適用（位置は起点合わせで別途決める）
function orientRotation(obj, dirIdx, rollIdx) {
  const d = DIR_QUATS[((dirIdx % DIR_COUNT) + DIR_COUNT) % DIR_COUNT];
  const r = (((rollIdx | 0) % ROLL_COUNT) + ROLL_COUNT) % ROLL_COUNT;
  _tmpQ.setFromAxisAngle(_rollAxis, r * Math.PI / 4);   // 45°×r（ローカル軸まわり）
  obj.quaternion.copy(d).multiply(_tmpQ);
}

// 追従開始：本物の3Dフランジを半透明でマウスに追従させる
function startFollow(tool, tile, x, y) {
  if (window.__exitDrawMode) window.__exitDrawMode();   // 部品配置を始めたら描画モードは解除
  stopFollow();
  followTool = { tool, tile };
  followOrient = DEFAULT_DIR; followRoll = 0; followQuat = null; resetPipeRotState();   // 初期は面を立てた状態（線分式回転の軸状態もリセット）
  setActivePartType(tool.type);     // パレット選択中の部品に応じてオプション欄を切替
  tile.classList.add('selected');
  // 半透明プレビュー（配置される物そのもの）
  followPreview = tool.build();
  computeConns(followPreview);              // 起点・機点を確定（無回転状態で）
  followPreview.traverse(o => {
    if (o.isMesh && o.material) {
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.55;
      o.material.depthWrite = false;
    }
  });
  modelGroup.add(followPreview);
  updateFollowPreview(x, y);
}
function stopFollow() {
  if (followTool) followTool.tile.classList.remove('selected');
  if (followPreview) {
    modelGroup.remove(followPreview);
    followPreview.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    followPreview = null;
  }
  followTool = null;
  clearMarkers();
}
// プレビューを「起点が指す点」に置く＋向き適用＋機点スナップ
function updateFollowPreview(clientX, clientY) {
  if (!followPreview) return;
  const rect = renderer.domElement.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    followPreview.visible = false; clearMarkers(); return;
  }
  followPreview.visible = true;
  if (isFreeRotPart(followPreview) && followQuat) followPreview.quaternion.copy(followQuat);   // 線分式で回した向きを毎フレーム維持
  else orientRotation(followPreview, followOrient, followRoll);
  // 最初の部品も線分と同じく、カーソル位置（スナップ無ければ床面投影）へ自由配置
  const tgt = resolveTarget(clientX, clientY, null);
  if (!tgt) return;
  setPartByOrigin(followPreview, tgt.point);
  showInteractionMarkers(followPreview, tgt.snapped ? tgt.point : null);
}
function moveFollow(x, y) { updateFollowPreview(x, y); }

// 追従中：右クリック＝方向(dir)送り、Shift+右クリック＝ひねり(roll)切替。起点は保つ。
function cycleFollowOrientation(shift) {
  if (!followTool || !followPreview) return;
  const keep = originModelPos(followPreview);
  if (isFreeRotPart(followPreview)) {            // パイプ・エルボ・キャップは再選択時と同じ線分式回転（起点まわり45°／Shift鉛直／垂直クロス）
    if (followQuat) followPreview.quaternion.copy(followQuat);
    else orientRotation(followPreview, followOrient, followRoll);
    lineRotate45(followPreview, shift);
    followQuat = followPreview.quaternion.clone();
  } else if (shift) { followRoll = (followRoll + 1) % ROLL_COUNT; orientRotation(followPreview, followOrient, followRoll); }
  else { followOrient = (followOrient + 1) % DIR_COUNT; orientRotation(followPreview, followOrient, followRoll); }
  setPartByOrigin(followPreview, keep);
  showInteractionMarkers(followPreview, null);
}

// 仮配置：プレビューの姿勢（位置・向き）をそのままコピーして置く＝見た目が完全一致。
// 置いた部品オブジェクトを返す（呼び出し側で選択＝高さ入力フォームを出す）。
function placeToolAt(tool, clientX, clientY) {
  if (!followPreview) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  updateFollowPreview(clientX, clientY);     // 確定直前にプレビュー位置を最新化
  const obj = tool.build();
  computeConns(obj);
  obj.quaternion.copy(followPreview.quaternion);
  obj.position.copy(followPreview.position);
  obj.userData.placed = true;
  obj.userData.orient = followOrient;
  obj.userData.roll = followRoll;
  modelGroup.add(obj);
  placedParts.push(obj);
  refreshItemList();
  return obj;
}

// ===================================================================
//  再移動：配置済み部品をダブルクリックで掴む→追従→クリックで置く
// ===================================================================
function startMovePart(part) {
  stopFollow();
  movingPart = part;
  movingOrient = part.userData.orient || 0;
  movingRoll = part.userData.roll || 0;
  moveOrig = part.position.clone();
  moveGroup = moveGroupFor(part);                  // 複数選択ならその他メンバーも一緒に動かす
  const partWasSelected = selectedParts.has(part);
  if (!partWasSelected) selectPart(part);          // 未選択を掴んだ時だけ単一選択へ（既存の複数選択は保持）
  annFollowMove = partWasSelected && window.__annHasSel && window.__annHasSel();   // 窓選択に線が含まれていれば一緒に動かす
  if (annFollowMove) window.__annMoveStart();
}
function moveExistingPart(clientX, clientY) {
  if (!movingPart) return;
  const rect = renderer.domElement.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
  // 注意：ここで orientRotation を再適用してはならない。右クリック45°やスピナーで自由回転させた
  // 部品の向きが「向き番号テーブル」へ巻き戻されてしまう（2026-06-13 修正：移動前の向きを維持）。
  // 移動中の向き送りは cycleMoveOrientation が明示的に適用する。
  const curY = originModelPos(movingPart).y;                  // 現在の高さを保持して平行移動
  const tgt = resolveTarget(clientX, clientY, movingPart, curY);
  if (!tgt) return;
  setPartByOrigin(movingPart, tgt.point);
  applyGroupDelta(moveGroup, movingPart, moveOrig);           // グループを同じ分だけ平行移動
  if (annFollowMove) { const d = movingPart.position.clone().sub(moveOrig); window.__annMoveApply(d.x, d.y, d.z); }
  showInteractionMarkers(movingPart, tgt.snapped ? tgt.point : null);
  updateForm();
}
function dropMovingPart() {           // ドラッグを離して（またはクリックで）確定
  if (!movingPart) return;
  movingPart.userData.orient = movingOrient;
  movingPart.userData.roll = movingRoll;
  movingPart = null; moveOrig = null; moveGroup = []; movingByDrag = false;
  if (annFollowMove) { window.__annMoveEnd(); annFollowMove = false; }
  controls.enabled = true;
  clearMarkers();
  updateForm();
}
function cancelMovePart() {           // Escで取消（元位置へ戻す）
  if (!movingPart) return;
  if (moveOrig) movingPart.position.copy(moveOrig);
  for (const g of moveGroup) g.part.position.copy(g.startPos);   // グループも元位置へ
  if (annFollowMove) { window.__annMoveCancel(); annFollowMove = false; }
  movingPart = null; moveOrig = null; moveGroup = []; movingByDrag = false;
  controls.enabled = true;
  clearMarkers();
}
// 移動中：右クリック＝方向送り、Shift+右クリック＝ひねり切替。起点は保つ。
function cycleMoveOrientation(shift) {
  if (!movingPart) return;
  const keep = originModelPos(movingPart);
  if (shift) movingRoll = (movingRoll + 1) % ROLL_COUNT;
  else movingOrient = (movingOrient + 1) % DIR_COUNT;
  orientRotation(movingPart, movingOrient, movingRoll);
  setPartByOrigin(movingPart, keep);
  showInteractionMarkers(movingPart, null);
}
// 配置済み（選択中）：右クリック＝方向送り、Shift+右クリック＝ひねり切替。起点は保つ。
function cycleSelectedOrientation(shift) {
  if (!selectedPart || !selectedPart.userData.faceLocal) return;
  const keep = originModelPos(selectedPart);
  if (shift) selectedPart.userData.roll = ((selectedPart.userData.roll || 0) + 1) % ROLL_COUNT;
  else selectedPart.userData.orient = ((selectedPart.userData.orient || 0) + 1) % DIR_COUNT;
  orientRotation(selectedPart, selectedPart.userData.orient || 0, selectedPart.userData.roll || 0);
  setPartByOrigin(selectedPart, keep);
  _idleSig = null;                    // パイプ端マーカー等を更新
  updateForm();                       // 向きでCOP↔ELが変わるのでラベル更新
}
// ---- パイプ・エルボの回転：線分と同じ仕様（起点まわりに45°／Shift=鉛直／垂直時クロス／長押しで角度スピナー） ----
let _pipeRotAxis = null, _pipeTipAxis = null, _pipeTipMode = false;
function resetPipeRotState() { _pipeRotAxis = null; _pipeTipAxis = null; _pipeTipMode = false; }
function isFreeRotPart(part) { return !!(part && ['pipe', 'elbow', 'cap', 'tee', 'reducer'].includes(part.userData.partType)); }   // 短押し右クリック45°の対象（レデューサーはキャップと同じ）
function isSpinRotPart(part) { return !!(part && ['pipe', 'elbow', 'cap', 'tee', 'reducer', 'flange'].includes(part.userData.partType)); }      // 長押し角度スピナーの対象（レデューサー追加）
function is180Elbow(part) { return !!(part && part.userData.partType === 'elbow' && part.userData.elbow && String(part.userData.elbow.kind || '').startsWith('180')); }
// 180°エルボは右クリックとShiftの回転を入れ替える
function rotShift(part, shift) { return is180Elbow(part) ? !shift : shift; }
function partRotPivotDir(part) {     // {pivot, dirRef}：起点（grip）の位置と、起点→最も離れた機点の向き
  const gl = (part.userData.partType === 'pipe')
    ? ((pipeEndSel === 'back') ? part.userData.backLocal : part.userData.faceLocal)
    : gripLocalOf(part);
  const pivot = connModelPos(part, gl);
  let dirRef = new THREE.Vector3(1, 0, 0), best = -1;
  for (const local of connsOf(part)) {
    const w = connModelPos(part, local), d = w.distanceTo(pivot);
    if (d > best) { best = d; dirRef = w.clone().sub(pivot); }
  }
  if (best <= 1e-6) dirRef = new THREE.Vector3(0, 1, 0).applyQuaternion(part.quaternion);   // 機点1つ：フェイス法線方向
  return { pivot, dirRef };
}
function pipeRotAxisFor(shift, dirRef) {
  const horiz = dirRef.x * dirRef.x + dirRef.z * dirRef.z;
  const isVertical = horiz < 1e-6 && Math.abs(dirRef.y) > 1e-6;
  const baseAxis = () => horiz > 1e-9 ? new THREE.Vector3(-dirRef.z, 0, dirRef.x).normalize() : new THREE.Vector3(1, 0, 0);
  if (shift) { _pipeTipMode = false; if (!_pipeRotAxis) _pipeRotAxis = baseAxis(); return _pipeRotAxis; }
  if (isVertical || _pipeTipMode) { _pipeTipMode = true; if (!_pipeTipAxis) { const b = _pipeRotAxis || baseAxis(); _pipeTipAxis = new THREE.Vector3(-b.z, 0, b.x).normalize(); } return _pipeTipAxis; }
  _pipeRotAxis = null; _pipeTipAxis = null; return new THREE.Vector3(0, 1, 0);
}
function rotatePipeAround(part, pivot, q) {
  const rel = part.position.clone().sub(pivot).applyQuaternion(q);   // 先に相対位置を回す（順序重要）
  part.quaternion.premultiply(q);                                   // newQuat = q * oldQuat（ワールド系で回す）
  part.position.copy(pivot).add(rel);
}
function gripFaceNormal(part) {   // 選択中の機点(grip=端面)の法線→ワールド。エルボは端面の管軸(接線)、ティーは端点方向で代用
  const u = part.userData, gl = gripLocalOf(part);
  let n;
  if (u.faceNormal && u.faceLocal && gl.distanceTo(u.faceLocal) < 1e-6) n = u.faceNormal.clone();
  else if (u.backNormal && u.backLocal && gl.distanceTo(u.backLocal) < 1e-6) n = u.backNormal.clone();
  else { n = gl.clone(); if (n.lengthSq() < 1e-9) n.set(0, 1, 0); }   // tee/cap等：端点方向で代用
  return n.normalize().applyQuaternion(part.quaternion);
}
function bowAxis(part) {   // おじき軸＝ローカルZ(部品に固定)。エルボ=曲げ面の法線/キャップ=面内の一軸。面に対し一定方向・退化せず・その軸で倒しても軸不変で連続安定
  return new THREE.Vector3(0, 0, 1).applyQuaternion(part.quaternion).normalize();
}
function capSideAxis(part) {   // キャップ横回転軸＝ローカル-X(部品に固定)。おじき(ローカルZ)と常に直交=90°、どの姿勢でも既定の関係を保つ
  return new THREE.Vector3(-1, 0, 0).applyQuaternion(part.quaternion).normalize();
}
function partRotAxis(part, shift, dirRef) {   // エルボ/ティー：右クリック=選択端面の法線まわりロール／Shift=おじき(水平軸で倒す)
  const t = part && part.userData.partType;
  const u = part.userData;
  // エルボの工作点(角)を起点にしている時は「各面に対する回転」：右クリック=face面の管軸／Shift=back面の管軸まわり。
  // 各面の中心線は角を通るので、その面の脚は固定されもう一方が振れる（pivot=角）。
  if (t === 'elbow' && u.cornerLocal && gripLocalOf(part).distanceTo(u.cornerLocal) < 1e-6) {
    resetPipeRotState();
    const n = shift ? u.backNormal : u.faceNormal;
    if (n) return n.clone().normalize().applyQuaternion(part.quaternion);
  }
  const rollPart = (t === 'tee' || t === 'elbow' || t === 'cap' || t === 'reducer');   // 右クリック=面まわり等にする部品（レデューサーはキャップと同じ）
  if (rollPart) {
    if (!shift) {
      resetPipeRotState();
      if (t === 'cap' || t === 'reducer') return capSideAxis(part);   // キャップ/レデューサーの右クリック：横回転（ローカル-X・部品固定）
      return gripFaceNormal(part);                          // エルボ・ティー：選択端面の法線まわりロール
    }
    if (t === 'elbow' || t === 'cap' || t === 'reducer') return bowAxis(part);   // エルボ/キャップ/レデューサーのShift：おじき＝ローカルZ（部品固定）。横(右クリック=ローカル-X)と90°関係を保つ
    return new THREE.Vector3(1, 0, 0).applyQuaternion(part.quaternion).normalize();   // ティーのShift：おじき＝ローカルX（部品固定）。本管軸Y・枝軸Zの双方に直交＝右クリック(面の法線まわり)と常に別動作
  }
  return pipeRotAxisFor(rotShift(part, shift), dirRef);                 // パイプ
}
function lineRotate45(part, shift) {   // 起点(grip)まわりに45°回す核（パイプ・エルボ・キャップ・ティー共通。追従中も再利用）
  const { pivot, dirRef } = partRotPivotDir(part);
  const q = new THREE.Quaternion().setFromAxisAngle(partRotAxis(part, shift, dirRef), Math.PI / 4);
  rotatePipeAround(part, pivot, q);
}
function pipeRotate(shift) {
  const part = selectedPart; if (!isFreeRotPart(part)) return;
  lineRotate45(part, shift);
  if (selectedParts.has(part)) setEmissive(part, SEL_COLOR);
  _idleSig = null; updateForm();
}
let _pipeSpin = null;
function pipeRotateSpinStart(shift) {
  const part = selectedPart; if (!isSpinRotPart(part)) return false;
  const { pivot, dirRef } = partRotPivotDir(part);
  let axis;
  if (part.userData.partType === 'flange') {   // フランジは従来の向き/ひねりと同じ軸で連続回転
    if (shift) axis = new THREE.Vector3(0, 1, 0).applyQuaternion(part.quaternion).normalize();   // ひねり送り＝フェイス法線(ローカル+Y)
    else { const di = part.userData.orient || 0; axis = (di < DIR_COUNT / 2) ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0); }   // 向き送り＝方向リング軸(世界Z or X)
  } else {
    axis = partRotAxis(part, shift, dirRef);   // パイプ・エルボ・キャップは線分式／ティーのShiftは端面(本管軸)まわり
  }
  _pipeSpin = { part, pivot: pivot.clone(), axis: axis.clone(), pos0: part.position.clone(), quat0: part.quaternion.clone() };
  return true;
}
function pipeRotateSpinApply(deg) {
  if (!_pipeSpin) return;
  const s = _pipeSpin, q = new THREE.Quaternion().setFromAxisAngle(s.axis, deg * Math.PI / 180);
  s.part.quaternion.copy(s.quat0).premultiply(q);
  s.part.position.copy(s.pivot).add(s.pos0.clone().sub(s.pivot).applyQuaternion(q));
  if (selectedParts.has(s.part)) setEmissive(s.part, SEL_COLOR);
  _idleSig = null; updateForm();
}
function pipeRotateSpinEnd() { _pipeSpin = null; }
function pipeRotateSpinCancel() {
  if (!_pipeSpin) return;
  _pipeSpin.part.position.copy(_pipeSpin.pos0); _pipeSpin.part.quaternion.copy(_pipeSpin.quat0);
  _idleSig = null; _pipeSpin = null;
}
function pipeRotateSpinActive() { return !!_pipeSpin; }
function pipeRotateSpinPivot() { return _pipeSpin ? _pipeSpin.pivot.clone() : null; }

// ===================================================================
//  方向移動（選択部品を45°刻みの方向へドラッグ＝トラッキング移動）
//  ・ドラッグ方向を45°にスナップし、その向きへ起点を直進
//  ・移動距離をフォームへリアルタイム表示。距離は数値入力でも指定可
// ===================================================================
// 高さ planeY の水平面とカーソル光線の交点（modelGroupローカル）。スナップ無し。
function planeHitAt(clientX, clientY, planeY) {
  const rect = renderer.domElement.getBoundingClientRect();
  placeNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  placeNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  placeRay.setFromCamera(placeNdc, activeCam());
  const plane = planeY === 0 ? floorPlane : new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  const hit = new THREE.Vector3();
  if (!placeRay.ray.intersectPlane(plane, hit)) return null;
  return modelGroup.worldToLocal(hit);
}
// 線分を markerGroup に足す
function addGuideSeg(aModel, bModel, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([aModel.clone(), bModel.clone()]);
  const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
  ln.renderOrder = 998;
  markerGroup.add(ln);
}
// 方向ガイド直角三角形：斜辺=実移動、X脚とZ脚を描く（距離値は脚の入力欄で表示・入力）
function addGuideTriangle(aModel, bModel, color) {
  const y = aModel.y;
  const corner = new THREE.Vector3(bModel.x, y, aModel.z);          // 直角の角（Xに進んでからZ）
  const geo = new THREE.BufferGeometry().setFromPoints([aModel.clone(), corner.clone(), bModel.clone()]);
  geo.computeVertexNormals();
  const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.16 }));
  fill.renderOrder = 997;
  markerGroup.add(fill);
  // 3辺とも斜辺(45°線)と同じ色に統一
  addGuideSeg(aModel, corner, color);
  addGuideSeg(corner, bModel, color);
  addGuideSeg(aModel, bModel, color);
}
// 現在の起点位置に合わせてガイド三角形・マーカー・フォーム(X/Z)を描き直す
function drawDirGuide() {
  if (!dirDrag) return;
  const cur = originModelPos(dirDrag.part);
  showInteractionMarkers(dirDrag.part, null);
  addGuideTriangle(dirDrag.startOrigin, cur, 0xffcc33);      // 直角三角形＋X/Z距離ラベル
  updateForm();                                             // X/Z距離をリアルタイム表示
}
// 直行移動の45°ライン上に「本当に乗っている」機点だけへ along 距離をスナップ。
// ・ラインからの垂直ズレ(高さ差含む3D)が極小のものだけ対象＝直行を崩さない（ライン外れは拾わない）。
// ・吸着判定は他スナップと同じ画面距離 SNAP_PX(=18px)。返り値＝起点からその機点までの along 距離(m)。無ければ null。
function nearestDirSnap(startOrigin, dir, clientX, clientY, exParts) {
  const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
  const perpTol = 0.0015;                          // 45°ラインからの許容ズレ（ほぼ同一線上のみ＝1.5mm）
  let best = null, bestD = SNAP_PX;
  const consider = (mpos) => {
    const v = mpos.clone().sub(startOrigin);
    const along = v.dot(dir);                       // 進行方向への距離
    if (along <= 0.003) return;                     // 起点より手前/同位置は対象外
    const perp = v.clone().sub(dir.clone().multiplyScalar(along)).length();   // ライン(3D)からの垂直ズレ（高さ差含む）
    if (perp > perpTol) return;                     // ライン上に乗っていない→スナップしない（位置がずれるなら拾わない）
    const ndc = modelGroup.localToWorld(mpos.clone()).project(cam);
    if (ndc.z >= 1) return;
    const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - clientX, sy - clientY);
    if (d < bestD) { bestD = d; best = along; }
  };
  for (const p of placedParts) {
    if ((exParts && exParts.has(p)) || !p.userData.faceLocal) continue;
    for (const local of connsOf(p)) consider(connModelPos(p, local));
  }
  if (window.__annSnapPoints) for (const mpos of window.__annSnapPoints()) consider(mpos);   // 線分・寸法線の端点（追従中の線は除外済）
  return best;
}
function updateDirMove(clientX, clientY) {
  const hit = planeHitAt(clientX, clientY, dirDrag.planeY);
  if (!hit) return;
  const vx = hit.x - dirDrag.startOrigin.x, vz = hit.z - dirDrag.startOrigin.z;
  const ang = Math.round(Math.atan2(vz, vx) / DIR_STEP) * DIR_STEP;     // 45°スナップ
  const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
  let dist = Math.max(0, vx * dir.x + vz * dir.z);                      // 進行方向への投影距離
  // 45°ライン上に本当に乗っている機点があれば、その距離へ吸着（along のみ合わせるのでラインは崩れない）
  const exParts = new Set([dirDrag.part]);
  if (dirDrag.group) for (const g of dirDrag.group) exParts.add(g.part);
  const snapAlong = nearestDirSnap(dirDrag.startOrigin, dir, clientX, clientY, exParts);
  if (snapAlong != null) dist = snapAlong;
  setPartByOrigin(dirDrag.part, dirDrag.startOrigin.clone().add(dir.clone().multiplyScalar(dist)));
  applyGroupDelta(dirDrag.group, dirDrag.part, dirDrag.primaryStartPos);  // グループを同じ分だけ平行移動
  if (dirDrag.annFollow) { const d = dirDrag.part.position.clone().sub(dirDrag.primaryStartPos); window.__annMoveApply(d.x, d.y, d.z); }   // 選択中の線も追従
  drawDirGuide();
  if (snapAlong != null) addMarker(dirDrag.startOrigin.clone().add(dir.clone().multiplyScalar(dist)), 0x39ff8a, markerRadiusFor(dirDrag.part, true));   // 吸着点を緑で強調
}
function cancelDirDrag() {                              // Escで取消（元位置へ戻す）
  if (!dirDrag) return;
  if (dirDrag.startOrigin) setPartByOrigin(dirDrag.part, dirDrag.startOrigin);
  if (dirDrag.group) for (const g of dirDrag.group) g.part.position.copy(g.startPos);  // グループも元位置へ
  if (dirDrag.annFollow) { window.__annMoveCancel(); }   // 追従した線も元位置へ
  dirDrag = null; controls.enabled = true; clearMarkers(); updateForm();
}

// ===================================================================
//  高さ数値入力（選択部品の起点高さ mm）— 部品のすぐ脇に浮かぶフォーム
//  仮配置→このフォームで高さ入力→「確定」(=選択解除) で確定配置
// ===================================================================
const hForm = document.getElementById('hForm');
const hYInput = document.getElementById('hY');
const hLabel = document.getElementById('hLabel');
const rotForm = document.getElementById('rotForm');     // 右クリック長押しの角度スピナー
const rotAInput = document.getElementById('rotA');
const legXInput = document.getElementById('legX');
const legZInput = document.getElementById('legZ');
const legXBox = document.getElementById('legXBox');
const legZBox = document.getElementById('legZBox');
// 高さラベル：フェイスが立っている(法線が水平)=COP(管中心高さ)、寝ている(法線が上下)=EL(基準面高さ)
// ティーは主管×枝管の交点(中心)を高さ基準とするため常に COP。
const _zeroLocal = new THREE.Vector3(0, 0, 0);
function heightLabelFor(obj) {
  if (!obj) return 'COP';
  if (obj.userData.partType === 'tee') return 'COP';
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(obj.quaternion);   // フェイス法線(=ローカル+Y)の世界向き
  return Math.abs(n.y) > 0.5 ? 'EL' : 'COP';
}
// 高さ基準点(model座標)。ティーは主管×枝管の交点(ローカル原点=中心)、他は起点(grip)。
function heightRefModelPos(obj) {
  if (obj && obj.userData.partType === 'tee') return connModelPos(obj, _zeroLocal);
  return originModelPos(obj);
}
// 高さ基準点が Y=y(m) に来るよう移動（x,z は保つ）。
function setPartByHeight(obj, y) {
  obj.position.y += (y - heightRefModelPos(obj).y);
}
// 方向移動中か（脚の距離入力欄を出すモード）
function dirActive() { return !!(dirDrag && (dirDrag.started || dirDrag.locked)); }
// フォームの値・ラベルを更新。方向移動中は「距離」（直進した距離）、それ以外はCOP/高さ。
// 線分が選択中（部品は未選択）なら、その起点側の基準点を返す。それ以外は null
function lineElRef() { return (!selectedPart && selectedParts.size === 0 && window.__lineElRef) ? window.__lineElRef() : null; }
function updateForm() {
  if (!hYInput) return;
  if (dirActive()) {
    if (hLabel) hLabel.textContent = '距離';
    const cur = originModelPos(dirDrag.part);
    hYInput.value = Math.round(Math.hypot(cur.x - dirDrag.startOrigin.x, cur.z - dirDrag.startOrigin.z) * 1000);
    return;
  }
  const lref = lineElRef();                     // 線分選択中＝起点側のEL（パイプと同じEL表示）
  if (lref) { if (hLabel) hLabel.textContent = 'EL'; hYInput.value = Math.round(lref.y * 1000); return; }
  if (selectedParts.size > 1) {               // 複数選択：基準アイテムのELを表示。変更分だけ全員を相対シフト
    if (hLabel) hLabel.textContent = 'EL基準';
    hYInput.value = (selectedPart && selectedPart.userData.faceLocal) ? Math.round(originModelPos(selectedPart).y * 1000) : '';
    return;
  }
  if (pipeSelected()) {
    if (pipeEndDrag && pipeEndDrag.part === selectedPart) {   // 端ドラッグ中＝長さ
      if (hLabel) hLabel.textContent = '長さ';
      hYInput.value = Math.round(selectedPart.userData.pipe.length);
    } else {                                                  // それ以外＝COP（端選択時はその端、未選択はface端）
      if (hLabel) hLabel.textContent = heightLabelFor(selectedPart);
      const endLocal = pipeEndSel === 'back' ? selectedPart.userData.backLocal : selectedPart.userData.faceLocal;
      hYInput.value = Math.round(connModelPos(selectedPart, endLocal).y * 1000);
    }
    return;
  }
  const obj = selectedPart;
  if (hLabel) hLabel.textContent = heightLabelFor(obj);
  hYInput.value = (obj && obj.userData.faceLocal) ? Math.round(heightRefModelPos(obj).y * 1000) : '';
}
// フォームを部品の画面範囲の「脇」に置く（毎フレーム）。どの視点でも部品と重ならない。
function positionHeightForm() {
  if (!hForm) return;
  if (window.__mirrorActive && window.__mirrorActive()) { hForm.style.display = 'none'; return; }   // 鏡モード中は入力フォームを出さない
  if (rotForm && rotForm.style.display === 'flex') { hForm.style.display = 'none'; return; }   // 角度スピナー中はEL非表示
  // 寸法線（単独選択）の「値」フォームは専用のテキスト入力（__positionDimValueForm）が担う
  if (!selectedPart && selectedParts.size === 0 && window.__dimValueSel && window.__dimValueSel()) { hForm.style.display = 'none'; return; }
  const lref = lineElRef();                     // 線分選択中＝起点側にELフォームを出す
  if (lref) {
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const ndc = modelGroup.localToWorld(lref.clone()).project(cam);
    if (ndc.z >= 1) { hForm.style.display = 'none'; return; }
    const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    hForm.style.display = 'flex';
    const fw = hForm.offsetWidth || 120, fh = hForm.offsetHeight || 28;
    hForm.style.left = Math.round(Math.max(rect.left + 4, Math.min(sx + 14, rect.right - fw - 4))) + 'px';
    hForm.style.top = Math.round(Math.max(rect.top + 4, Math.min(sy - fh - 8, rect.bottom - fh - 4))) + 'px';
    return;
  }
  if (!selectedPart || !selectedPart.userData.faceLocal) { hForm.style.display = 'none'; return; }
  // パイプは「起点となっている端」のすぐ近くにフォームを出す（どちらの端のEL/長さか分かるように）
  if (selectedPart.userData.partType === 'pipe') {
    const endLocal = pipeEndSel === 'back' ? selectedPart.userData.backLocal : selectedPart.userData.faceLocal;
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const ndc = modelGroup.localToWorld(connModelPos(selectedPart, endLocal)).project(cam);
    if (ndc.z >= 1) { hForm.style.display = 'none'; return; }
    const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    hForm.style.display = 'flex';
    const fw = hForm.offsetWidth || 120, fh = hForm.offsetHeight || 28;
    let left = Math.max(rect.left + 4, Math.min(sx + 14, rect.right - fw - 4));
    let top = Math.max(rect.top + 4, Math.min(sy - fh - 8, rect.bottom - fh - 4));
    hForm.style.left = Math.round(left) + 'px';
    hForm.style.top = Math.round(top) + 'px';
    return;
  }
  // 非パイプ：高さ基準点（ティーは中心／他は選択した機点grip）の画面脇にフォームを出す。
  const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
  const refLocal = (selectedPart.userData.partType === 'tee') ? _zeroLocal : gripLocalOf(selectedPart);
  const ndc = modelGroup.localToWorld(connModelPos(selectedPart, refLocal)).project(cam);
  if (ndc.z >= 1) { hForm.style.display = 'none'; return; }   // カメラ背後
  const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
  const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
  hForm.style.display = 'flex';
  const fw = hForm.offsetWidth || 120, fh = hForm.offsetHeight || 28;
  const left = Math.max(rect.left + 4, Math.min(sx + 14, rect.right - fw - 4));   // 基準点の右脇
  const top = Math.max(rect.top + 4, Math.min(sy - fh - 8, rect.bottom - fh - 4));
  hForm.style.left = Math.round(left) + 'px';
  hForm.style.top = Math.round(top) + 'px';
}
// 高さ入力→選択部品をその高さへ（X,Zは保つ）。
// 複数選択時は基準アイテム(selectedPart)を入力ELに合わせ、その差分だけ全員を一緒に上下（相対差は保持）。
function applyHeightInput() {
  const y = (parseFloat(hYInput.value) || 0) / 1000;
  if (selectedParts.size > 1) {               // 複数選択：基準の変化量(dy)を全員へ加える＝全体シフト
    if (!selectedPart || !selectedPart.userData.faceLocal) return;
    const dy = y - originModelPos(selectedPart).y;
    if (dy === 0) return;
    for (const obj of selectedParts) {
      if (!obj.userData.faceLocal) continue;
      const o = originModelPos(obj);
      setPartByOrigin(obj, new THREE.Vector3(o.x, o.y + dy, o.z));   // 各自の高さに同じ差分を加算
    }
    if (window.__annShiftSelected) window.__annShiftSelected(0, dy, 0);   // 一緒に窓選択した線も同じ高さ差分で追従
    return;
  }
  const obj = selectedPart;
  if (!obj || !obj.userData.faceLocal) return;
  const before = heightRefModelPos(obj).y;
  setPartByHeight(obj, y);   // 高さ基準点(ティーは中心/他は起点grip)の Y を y に合わせる
  const dy = heightRefModelPos(obj).y - before;
  if (dy !== 0 && window.__annShiftSelected) window.__annShiftSelected(0, dy, 0);   // 1部品+線の窓選択でも線を追従
}
// パイプのCOP入力：端を選んでいればその端だけ上下（傾く）、未選択なら全体を上下
function applyPipeCOP() {
  const part = selectedPart; if (!part || !part.userData.pipe) return;
  const y = parseFloat(hYInput.value) || 0;   // mm
  if (pipeEndSel) tiltPipeEndY(part, pipeEndSel, y);   // 一方の端だけ上下＝傾ける
  else setPartByHeight(part, y / 1000);                // 端未選択＝全体を平行移動
}
// 脚の入力欄（X脚・Y脚）の値→起点からその相対量だけ移動（値は絶対値・向きはドラッグした方向を踏襲）
function applyLegInputs() {
  if (!dirDrag) return;
  const cur = originModelPos(dirDrag.part);
  const sx = Math.sign(cur.x - dirDrag.startOrigin.x) || 1;
  const sz = Math.sign(cur.z - dirDrag.startOrigin.z) || 1;
  const x = (Math.abs(parseFloat(legXInput.value)) || 0) / 1000 * sx;
  const z = (Math.abs(parseFloat(legZInput.value)) || 0) / 1000 * sz;
  setPartByOrigin(dirDrag.part, new THREE.Vector3(dirDrag.startOrigin.x + x, dirDrag.startOrigin.y, dirDrag.startOrigin.z + z));
  applyGroupDelta(dirDrag.group, dirDrag.part, dirDrag.primaryStartPos);
  dirDrag.locked = true;
  drawDirGuide();
}
// 距離入力→現在の進行方向に沿ってその距離だけ起点から移動（45°・90°どちらでも）
function applyDistInput() {
  if (!dirDrag) return;
  const cur = originModelPos(dirDrag.part);
  const ox = cur.x - dirDrag.startOrigin.x, oz = cur.z - dirDrag.startOrigin.z;
  const len = Math.hypot(ox, oz);
  const D = Math.max(0, (parseFloat(hYInput.value) || 0) / 1000);
  const dx = len > 1e-6 ? ox / len : 1, dz = len > 1e-6 ? oz / len : 0;
  setPartByOrigin(dirDrag.part, new THREE.Vector3(dirDrag.startOrigin.x + dx * D, dirDrag.startOrigin.y, dirDrag.startOrigin.z + dz * D));
  applyGroupDelta(dirDrag.group, dirDrag.part, dirDrag.primaryStartPos);
  dirDrag.locked = true;
  drawDirGuide();
}
if (hYInput) {
  const applyHY = () => {
    if (dirActive()) applyDistInput();
    else if (lineElRef()) window.__lineApplyEl(parseFloat(hYInput.value) || 0);   // 線分EL（起点指定の有無で全体/片側）
    else if (pipeSelected()) applyPipeCOP();   // パイプCOP（端選択＝その端だけ傾け／未選択＝全体）。長さはドラッグ
    else applyHeightInput();
  };
  hYInput.addEventListener('input', applyHY);    // スピナー長押し・連続増減でも追従
  hYInput.addEventListener('change', applyHY);
  hYInput.addEventListener('keydown', e => {
    // 線選択中のEL欄（構築線は自動フォーカス）：Delete＝選択中の線を削除／Escape＝閉じる（選択解除）
    // Delete は構築線選択時のみ（線分のEL編集中の文字削除を誤爆させない）
    if (lineElRef()) {
      if (e.key === 'Delete' && window.__annSelIsXline && window.__annSelIsXline()) {
        e.preventDefault(); e.stopPropagation(); hYInput.blur();
        if (window.__annDeleteSelected) window.__annDeleteSelected();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); hYInput.blur();
        if (window.__annDeselect) window.__annDeselect();
        return;
      }
    }
    if (e.key === 'Enter') {
      if (dirActive()) { applyDistInput(); dirDrag = null; clearMarkers(); updateForm(); }   // 距離確定→ロック解除・補助線消去
      else if (lineElRef()) {
        window.__lineApplyEl(parseFloat(hYInput.value) || 0); updateForm();   // 線分EL確定（起点指定の有無で全体/片側）
        // 構築線：EL決定の後に方位角スピナーを出し、角度Enterで選択ごと閉じる（2026-06-13 社長指示）
        if (window.__annSelIsXline && window.__annSelIsXline()) { _xlineChainClose = true; hYInput.blur(); startRotSpin(true, 0, 0); }
      }
      else if (selectedParts.size > 1) { applyHeightInput(); updateForm(); }  // 複数選択EL一括確定（選択は維持）
      else if (pipeSelected()) { applyPipeCOP(); updateForm(); }              // パイプCOP確定（端選択＝傾け／未選択＝全体。長さはドラッグ）
      else { applyHeightInput(); selectPart(null); }                          // フランジCOP確定→選択解除
    }
    e.stopPropagation();
  });
}
[legXInput, legZInput].forEach(inp => {
  if (!inp) return;
  inp.addEventListener('input', applyLegInputs);    // スピナー長押し・連続増減でも追従
  inp.addEventListener('change', applyLegInputs);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { applyLegInputs(); dirDrag = null; clearMarkers(); updateForm(); }  // 確定→ロック解除・補助線消去
    e.stopPropagation();
  });
});
// 補助三角形の脚の値の位置に距離入力欄を配置（毎フレーム）。斜め移動時のみ表示。
function positionLegInputs() {
  if (!legXBox || !legZBox) return;
  if (!dirActive()) { legXBox.style.display = 'none'; legZBox.style.display = 'none'; return; }
  const a = dirDrag.startOrigin, cur = originModelPos(dirDrag.part);
  const dx = cur.x - a.x, dz = cur.z - a.z;
  if (Math.abs(dx) < 1e-4 || Math.abs(dz) < 1e-4) {   // 90°(軸方向)は出さない
    legXBox.style.display = 'none'; legZBox.style.display = 'none'; return;
  }
  const y = a.y, corner = new THREE.Vector3(cur.x, y, a.z);
  placeLegInput(legXBox, legXInput, new THREE.Vector3((a.x + corner.x) / 2, y, a.z), new THREE.Vector3(0, 0, -Math.sign(dz)), Math.abs(Math.round(dx * 1000)));
  placeLegInput(legZBox, legZInput, new THREE.Vector3(corner.x, y, (a.z + cur.z) / 2), new THREE.Vector3(Math.sign(dx), 0, 0), Math.abs(Math.round(dz * 1000)));
}
function placeLegInput(box, inp, worldMid, outDir, valueMm) {
  const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
  const p = worldMid.clone().project(cam);
  if (p.z >= 1) { box.style.display = 'none'; return; }
  const sx = rect.left + (p.x * 0.5 + 0.5) * rect.width;
  const sy = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
  const p2 = worldMid.clone().add(outDir.clone().multiplyScalar(0.05)).project(cam);   // 外向きの画面方向
  let ox = p2.x - p.x, oy = -(p2.y - p.y);
  const l = Math.hypot(ox, oy) || 1; ox /= l; oy /= l;
  const off = 22;
  box.style.display = 'inline-flex';
  box.style.left = Math.round(sx + ox * off - box.offsetWidth / 2) + 'px';
  box.style.top = Math.round(sy + oy * off - box.offsetHeight / 2) + 'px';
  if (document.activeElement !== inp) inp.value = valueMm;     // 編集中は上書きしない
}

// ===================================================================
//  配置済み部品の選択・削除
// ===================================================================
const placedParts = [];              // 配置した部品（選択・削除の対象）
let selectedPart = null;             // 主選択（移動・回転・高さ入力の対象）
const selectedParts = new Set();     // 複数選択（Ctrl+クリック）。selectedPart は常にこの集合の要素の一つ
const SEL_COLOR = 0x2f6bff;          // 選択ハイライト（青）
const pickRay = new THREE.Raycaster();
const pickNdc = new THREE.Vector2();

function setEmissive(obj, hex) {
  obj.traverse(o => {
    if (o.isMesh && o.material && o.material.emissive) {
      o.material.emissive.setHex(hex);
    }
  });
}
// 単一選択（従来動作）。additive=true で Ctrl+クリックのトグル複数選択になる。
function selectPart(obj, additive = false) {
  if (additive) { toggleSelect(obj); return; }
  if (typeof resetPipeRotState === 'function') resetPipeRotState();   // 選択が変わったらパイプ回転軸をリセット
  if (window.__annClearSel) window.__annClearSel();   // 部品を単独選択/解除したら線選択も解除（部品と排他）
  if (pipeEndDrag && pipeEndDrag.part !== obj) { pipeEndDrag = null; controls.enabled = true; }
  if (dirDrag && dirDrag.part !== obj) { dirDrag = null; controls.enabled = true; clearMarkers(); }
  if (selectedPart !== obj) pipeEndSel = null;   // 別部品/解除なら起点選択を外す（_idleSigは更新判定に任せる）
  // 既存の複数選択を一旦すべて解除してから1つだけ選ぶ
  for (const p of selectedParts) setEmissive(p, 0x000000);
  selectedParts.clear();
  selectedPart = obj;
  if (obj) { selectedParts.add(obj); setEmissive(obj, SEL_COLOR); }   // 青く光らせて選択表示
  if (obj && obj.userData && obj.userData.groupId != null) {          // グループの一員 → 同グループの部品・注釈も一緒に選択
    for (const p of placedParts) if (p.userData.groupId === obj.userData.groupId && p !== obj) { selectedParts.add(p); setEmissive(p, SEL_COLOR); }
    if (window.__annAddGroupToSel) window.__annAddGroupToSel(obj.userData.groupId);
  }
  updateForm();
  refreshItemList();   // 3D空間での選択/解除を一覧へ反映
}
// グループ化／解除（リボン編集グループ）。部品＋注釈にまたがる
let groupSeq = 0;
window.__bumpGroupSeq = (n) => { if (n > groupSeq) groupSeq = n; };   // ファイル読込後の採番衝突防止
window.__selectPartsGroup = (gid) => { for (const p of placedParts) if (p.userData.groupId === gid) { selectedParts.add(p); setEmissive(p, SEL_COLOR); } };
function groupSelection() {
  const parts = [...selectedParts];
  const annCount = window.__annSelCount ? window.__annSelCount() : 0;
  if (parts.length + annCount < 2) return;          // 2つ以上で意味がある
  const gid = ++groupSeq;
  for (const p of parts) p.userData.groupId = gid;
  if (window.__annSetGroup) window.__annSetGroup(gid);
  refreshItemList();
}
function ungroupSelection() {
  const gids = new Set();
  for (const p of selectedParts) if (p.userData.groupId != null) gids.add(p.userData.groupId);
  if (window.__annSelGroupIds) for (const g of window.__annSelGroupIds()) gids.add(g);
  if (!gids.size) return;
  for (const p of placedParts) if (gids.has(p.userData.groupId)) p.userData.groupId = null;
  if (window.__annClearGroupIds) window.__annClearGroupIds(gids);
  refreshItemList();
}
// Ctrl+クリック：対象を選択集合に出し入れする（主選択 selectedPart も更新）
function toggleSelect(obj) {
  if (!obj) return;                          // 空クリックは現在の選択を保持
  if (selectedParts.has(obj)) {              // 既に選択済み → 外す
    selectedParts.delete(obj);
    setEmissive(obj, 0x000000);
    if (selectedPart === obj) {              // 主選択が外れたら残りの一つを主選択へ
      selectedPart = selectedParts.size ? [...selectedParts][selectedParts.size - 1] : null;
      pipeEndSel = null;
    }
  } else {                                   // 未選択 → 加える（=新しい主選択）
    selectedParts.add(obj);
    setEmissive(obj, SEL_COLOR);
    selectedPart = obj;
    pipeEndSel = null;
  }
  updateForm();
  refreshItemList();
}
// 線クロージャから参照：選択中部品の数・スナップ・平行移動（線と部品を一緒に動かす）
window.__partSelCount = () => selectedParts.size;
window.__partSelSnapshot = () => [...selectedParts].map(p => ({ p, pos: p.position.clone() }));
window.__partSelApply = (snap, dx, dy, dz) => { for (const s of snap) s.p.position.set(s.pos.x + dx, s.pos.y + dy, s.pos.z + dz); };
function deleteSelected() {
  const targets = selectedParts.size ? [...selectedParts] : (selectedPart ? [selectedPart] : []);
  const annDeleted = window.__annDeleteSelected ? window.__annDeleteSelected() : 0;   // 窓選択した線も削除
  if (!targets.length) return;
  for (const part of targets) {
    if (movingPart === part) { movingPart = null; moveOrig = null; clearMarkers(); }
    if (dirDrag && dirDrag.part === part) { dirDrag = null; controls.enabled = true; clearMarkers(); }
    if (pipeEndDrag && pipeEndDrag.part === part) { pipeEndDrag = null; controls.enabled = true; }
    modelGroup.remove(part);
    const i = placedParts.indexOf(part);
    if (i >= 0) placedParts.splice(i, 1);
    part.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
  selectedParts.clear();
  selectedPart = null;
  pipeEndSel = null;
  updateForm();
  refreshItemList();
}

// ===================================================================
//  設置アイテム一覧（右側パネル）
// ===================================================================
// 配置済み部品1個を「種別(末尾に形状記号まで)・タイプ(将来のBW/SW/SCRD用・現状空)・サイズ・クラス」に分解。
// 種別の例: フランジ / 90°エルボ(L) / ティー(RT) / レジューサ(E) / キャップ。
function partColumns(p) {
  const u = p.userData;
  switch (u.partType) {
    case 'flange': { const o = u.flange || {}; return { kind: 'フランジ', type: o.type || '', size: o.sizeA || '', cls: o.cls || '' }; }
    case 'pipe':   { const o = u.pipe || {};   return { kind: 'パイプ', type: `L${Math.round(o.length || 0)}`, size: o.sizeA || '', cls: o.sch || '' }; }
    case 'elbow':  { const o = u.elbow || {};  const am = {'90L':'90°エルボ(L)','90S':'90°エルボ(S)','45L':'45°エルボ(L)','45S':'45°エルボ(S)','180L':'180°エルボ(L)','180S':'180°エルボ(S)'}; return { kind: am[o.kind] || 'エルボ', type: 'BW', size: o.sizeA || '', cls: o.sch || '' }; }
    case 'cap':    { const o = u.cap || {};    return { kind: 'キャップ', type: 'BW', size: o.sizeA || '', cls: o.sch || '' }; }
    case 'tee':    { const o = u.tee || {};    const rt = (o.sizeB && o.sizeB !== o.sizeA); return { kind: rt ? 'ティー(RT)' : 'ティー(T)', type: 'BW', size: rt ? `${o.sizeA}×${o.sizeB}` : (o.sizeA || ''), cls: o.sch || '' }; }
    case 'reducer':{ const o = u.reducer || {};return { kind: o.ecc ? 'レジューサ(E)' : 'レジューサ(C)', type: 'BW', size: `${o.sizeA || ''}×${o.sizeB || ''}`, cls: o.sch || '' }; }
    default: return { kind: u.partType || 'アイテム', type: '', size: '', cls: '' };
  }
}
// 種別の並び順＝ツールパレット(TOOLS)の順。partType→順位を引く。
const _typeOrder = {};
TOOLS.forEach((t, i) => { _typeOrder[t.type] = i; });
function partTypeRank(p) {
  // TOOLS.type は 'teeS/teeR/redC/redE' 等。partType('tee'等)から代表ツールの順位を求める。
  const u = p.userData;
  if (u.partType === 'tee')     return _typeOrder[(u.tee && u.tee.sizeB && u.tee.sizeB !== u.tee.sizeA) ? 'teeR' : 'teeS'];
  if (u.partType === 'reducer') return _typeOrder[(u.reducer && u.reducer.ecc) ? 'redE' : 'redC'];
  if (u.partType === 'elbow') {
    const k = u.elbow && u.elbow.kind;
    const map = { '90L':'elbow90L','90S':'elbow90S','45L':'elbow45L','45S':'elbow45S','180L':'return180L','180S':'return180S' };
    return _typeOrder[map[k]] != null ? _typeOrder[map[k]] : 99;
  }
  return _typeOrder[u.partType] != null ? _typeOrder[u.partType] : 99;
}
const _ilBody = document.getElementById('ilBody');
// 一覧表を作り直す。同仕様(種別・タイプ・サイズ・クラスが全一致)を1行にまとめ、数量列に件数を表示。
function refreshItemList() {
  if (!_ilBody) return;
  _ilBody.innerHTML = '';
  if (!placedParts.length) {
    const tr = document.createElement('tr'); tr.className = 'il-empty';
    const td = document.createElement('td'); td.colSpan = 8; td.textContent = 'まだありません';
    tr.appendChild(td); _ilBody.appendChild(tr); return;
  }
  // 同仕様でグループ化。各グループは {col, parts[], rank, seq}
  const groups = [], byKey = new Map();
  let seq = 0;
  for (const p of placedParts) {
    const c = partColumns(p);
    const mat = (p.userData && p.userData.mat) || '';   // 材質：将来パレットで選択予定。現状は空欄
    const key = `${c.kind}|${c.type}|${c.size}|${c.cls}|${mat}`;
    let g = byKey.get(key);
    if (!g) { g = { col: c, mat, parts: [], rank: partTypeRank(p), seq: seq++ }; byKey.set(key, g); groups.push(g); }
    g.parts.push(p);
  }
  // 並び順＝種別(ツールパレット順)優先、同種別内は初出順
  groups.sort((a, b) => (a.rank - b.rank) || (a.seq - b.seq));
  groups.forEach((g, i) => {
    const c = g.col;
    const tr = document.createElement('tr');
    if (g.parts.some(p => selectedParts.has(p))) tr.className = 'selected';   // 1個でも選択中ならハイライト
    const mk = (cls, txt) => { const td = document.createElement('td'); if (cls) td.className = cls; td.textContent = txt; td.title = txt; return td; };
    tr.appendChild(mk('c-no', i + 1));
    tr.appendChild(mk('', c.kind));
    tr.appendChild(mk('c-type', c.type));
    tr.appendChild(mk('c-size', c.size));
    tr.appendChild(mk('c-cls', c.cls));
    tr.appendChild(mk('c-qty', g.parts.length));
    // 材質セル＝手入力できる入力欄＋候補一覧（datalist）。種別に応じた候補を割り当てる。
    const matTd = document.createElement('td'); matTd.className = 'c-mat';
    const matInp = document.createElement('input'); matInp.type = 'text';
    matInp.className = 'mat-input'; matInp.value = g.mat || ''; matInp.placeholder = '—';
    matInp.title = '材質（手入力 または 一覧から選択）';
    const listId = matListIdForPart(g.parts[0]);
    if (listId) matInp.setAttribute('list', listId);
    // 入力欄の操作は行選択・移動を誘発させない
    ['click', 'mousedown', 'dblclick'].forEach(ev => matInp.addEventListener(ev, e => e.stopPropagation()));
    // 再選択しやすいよう、フォーカス時に値を一旦空にして候補一覧を全件表示する。
    // （datalist は入力済み文字で候補を絞り込むため、選択済みだと他が出なくなる）
    // 現在値は placeholder へ退避し、何も選ばず離れたら元へ戻す（誤消去防止）。
    matInp.addEventListener('focus', () => {
      if (matInp.value) { matInp.dataset.prev = matInp.value; matInp.placeholder = matInp.value; matInp.value = ''; }
    });
    matInp.addEventListener('blur', () => {
      if (matInp.value.trim() === '' && matInp.dataset.prev) matInp.value = matInp.dataset.prev;
      matInp.placeholder = '—'; delete matInp.dataset.prev;
    });
    // 確定（change＝Enter/フォーカス喪失/候補選択）でグループ全部品へ材質を反映し再集計
    matInp.addEventListener('change', e => {
      e.stopPropagation();
      const val = matInp.value.trim();
      for (const p of g.parts) { p.userData.mat = val; }
      refreshItemList();
    });
    matTd.appendChild(matInp); tr.appendChild(matTd);
    const del = mk('c-del', '×'); del.title = 'この仕様をすべて削除';
    tr.appendChild(del);
    // 行クリック＝その仕様の全アイテムを選択（Ctrlで選択に追加）
    tr.addEventListener('click', e => {
      if (e.target === del || e.target === matInp) return;
      const add = e.ctrlKey || e.metaKey || touchCtrl;
      if (!add) { for (const p of selectedParts) setEmissive(p, 0x000000); selectedParts.clear(); }
      for (const p of g.parts) { selectedParts.add(p); setEmissive(p, SEL_COLOR); }
      selectedPart = g.parts[g.parts.length - 1];
      pipeEndSel = null; updateForm(); refreshItemList();
    });
    // ×クリック＝その仕様のアイテムをすべて削除
    del.addEventListener('click', e => {
      e.stopPropagation();
      for (const p of g.parts) {
        modelGroup.remove(p);
        const idx = placedParts.indexOf(p); if (idx >= 0) placedParts.splice(idx, 1);
        selectedParts.delete(p); if (selectedPart === p) selectedPart = null;
        p.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      }
      updateForm(); refreshItemList();
    });
    _ilBody.appendChild(tr);
  });
}

// カーソル下の配置済み部品（ルート）を返す。無ければ null。
function pickPlacedAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  pickRay.setFromCamera(pickNdc, activeCam());
  const hits = pickRay.intersectObjects(placedParts, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.placed) o = o.parent;
  return o || null;
}
// ビューのクリックで部品を選択（配置モードでないとき）。additive=true で複数選択トグル。
function pickPartAt(clientX, clientY, additive = false) {
  const hit = pickPlacedAt(clientX, clientY);
  // 複数選択中のメンバーを通常クリック＝選択を保持し主選択だけ更新（ダブルクリック集団移動のため潰さない）
  if (!additive && hit && selectedParts.has(hit) && selectedParts.size > 1) {
    selectedPart = hit; pipeEndSel = null; updateForm(); refreshItemList();
    return;
  }
  selectPart(hit, additive);   // 単一選択時は何も無ければ null＝選択解除
}

// マウス追従（配置追従中／部品移動中／方向ドラッグ中）
window.addEventListener('pointermove', e => {
  if (pipeEndDrag) {
    if (!pipeEndDrag.moved && Math.hypot(e.clientX - pipeEndDrag.sx, e.clientY - pipeEndDrag.sy) > 4) {
      pipeEndDrag.moved = true;
      // つかんだ端を選択(緑)＝その端がマウスに追従して動く（反対端を固定）
      pipeEndSel = pipeEndDrag.grabbedEnd;
    }
    if (pipeEndDrag.moved) stretchPipe(e.clientX, e.clientY);
    return;
  }
  if (followTool) moveFollow(e.clientX, e.clientY);
  else if (movingPart) moveExistingPart(e.clientX, e.clientY);
  else if (dirDrag && !dirDrag.locked) {
    if (!dirDrag.started && Math.hypot(e.clientX - dirDrag.sx, e.clientY - dirDrag.sy) > 4) dirDrag.started = true;
    if (dirDrag.started) updateDirMove(e.clientX, e.clientY);
  }
});

// 部品の上で押し下げ＝その部品を選択し、ドラッグで「方向移動」開始（オービットより先に捕捉）。
// captureフェーズで controls.enabled=false にし、OrbitControls の回転開始を抑止する。
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0 || followTool || movingPart) return;
  if (e.ctrlKey || e.metaKey || touchCtrl) return;      // Ctrl+クリックは複数選択トグル（移動ドラッグを開始しない）→ pointerup で処理
  const rect = renderer.domElement.getBoundingClientRect();
  if (inGizmo(e.clientX - rect.left, e.clientY - rect.top)) return;
  // パイプ端の優先掴み：選択中がパイプで、その端の近く(16px)を押したら、
  // 重なる他部品(フランジ等)より優先してパイプ端を掴む（起点が取れない問題の対策）。
  if (selectedPart && selectedPart.userData.partType === 'pipe' && selectedParts.size <= 1) {
    const pe = nearestPipeEnd(selectedPart, e.clientX, e.clientY);
    if (pe) {
      pipeEndDrag = { part: selectedPart, grabbedEnd: pe, sx: e.clientX, sy: e.clientY, moved: false, origLen: selectedPart.userData.pipe.length };
      controls.enabled = false;
      return;
    }
  }
  const part = pickPlacedAt(e.clientX, e.clientY);
  if (!part) return;                       // 部品以外＝通常のオービット
  // --- ダブルクリック（同じ部品を素早く2回押下）→ 押したままドラッグで自由移動 ---
  const isDbl = (e.timeStamp - _lastDownT < 350)
             && Math.hypot(e.clientX - _lastDownX, e.clientY - _lastDownY) < 6
             && _lastDownPart === part;
  _lastDownT = e.timeStamp; _lastDownX = e.clientX; _lastDownY = e.clientY; _lastDownPart = part;
  // クリック近傍の機点を「移動の起点(grip)」に選ぶ（パイプ以外・単一選択時）。方向/自由移動とも起点になる。
  if (part.userData.partType !== 'pipe' && !(selectedParts.has(part) && selectedParts.size > 1)) {
    const gl = nearestConnLocal(part, e.clientX, e.clientY);
    if (gl) { part.userData.gripLocal = gl; resetPipeRotState(); }   // 起点が変わったら回転軸を再計算
  }
  if (isDbl) {
    _lastDownT = 0; _lastDownPart = null;              // 3連クリックの誤検出を防ぐためリセット
    if (dirDrag) { dirDrag = null; clearMarkers(); }   // 1回目クリックで張った方向移動を破棄
    startMovePart(part);                 // 自由移動開始（複数選択ならグループ維持＝集団自由移動）
    movingByDrag = true;                 // このまま押し下げ→ドラッグ→pointerupで確定
    controls.enabled = false;            // ドラッグ中はオービット停止
    return;
  }
  // 既に複数選択の一員を掴んだ＝集団移動（選択は保持し、パイプ端の伸縮はしない）
  const groupMove = selectedParts.has(part) && selectedParts.size > 1;
  const group = groupMove ? moveGroupFor(part) : [];
  if (!selectedParts.has(part)) selectPart(part);   // 未選択を掴んだ時だけ単一選択へ（既存の選択＝部品+線は保持）
  // パイプ：端センター付近＝起点選択/長さスライド、本体＝起点解除して方向移動（集団移動中は伸縮しない）
  if (!groupMove && part.userData.partType === 'pipe') {
    const end = nearestPipeEnd(part, e.clientX, e.clientY);
    if (end) {
      pipeEndDrag = { part, grabbedEnd: end, sx: e.clientX, sy: e.clientY, moved: false, origLen: part.userData.pipe.length };
      controls.enabled = false;
      return;
    }
    // 本体つかみでは起点(pipeEndSel)を保持＝選択した端を起点に移動できる（COP解除は端の再クリックで）
  }
  const o = originModelPos(part);
  dirDrag = { part, sx: e.clientX, sy: e.clientY, startOrigin: o.clone(), planeY: o.y, dir: null, dist: 0, started: false, locked: false,
              group, primaryStartPos: part.position.clone(), annFollow: false };
  if (window.__annHasSel && window.__annHasSel()) { window.__annMoveStart(); dirDrag.annFollow = true; }   // 窓選択の線も一緒に直行移動
  controls.enabled = false;                // ドラッグ中はオービット停止
}, true);
window.addEventListener('pointerup', e => {
  if (e.button !== 0) return;
  if (movingPart && movingByDrag) { dropMovingPart(); return; }   // ダブルクリック自由移動：離して確定
  if (pipeEndDrag) {                                  // 伸縮確定 or 端クリックで起点選択
    if (!pipeEndDrag.moved) { pipeEndSel = (pipeEndSel === pipeEndDrag.grabbedEnd) ? null : pipeEndDrag.grabbedEnd; resetPipeRotState(); }   // クリック＝この端を起点に（同じ端を再クリックで起点解除＝COPモード）
    pipeEndDrag = null; controls.enabled = true; _idleSig = null; updateForm();
    return;
  }
  if (!dirDrag) return;
  controls.enabled = true;
  if (dirDrag.annFollow) window.__annMoveEnd();                    // 追従した線を現在位置で確定（スナップ解放）
  if (dirDrag.started) { dirDrag.locked = true; updateForm(); }   // 方向ロック→距離入力可
  else { dirDrag = null; clearMarkers(); _idleSig = null; }       // ドラッグせず＝選択のみ（補助線消去・端表示は再判定）
});

// ビュー上のクリック：配置中は配置／移動中は確定／それ以外は選択。
// いずれも視点ドラッグと区別するため移動量をみる。
let viewDown = null;
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0) { viewDown = null; return; }   // 左ボタンのみ（右=切替/中=パン は対象外）
  if (e.ctrlKey || e.metaKey || touchCtrl) { viewDown = null; return; }   // Ctrl は窓選択/個別トグル側で一括処理
  const rect = renderer.domElement.getBoundingClientRect();
  if (inGizmo(e.clientX - rect.left, e.clientY - rect.top)) { viewDown = null; return; }  // ギズモ上は無視
  viewDown = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', e => {
  if (e.button !== 0 || !viewDown) return;   // 左ボタンのみ
  const moved = Math.hypot(e.clientX - viewDown.x, e.clientY - viewDown.y);
  viewDown = null;
  if (pipeEndDrag) return;               // パイプ端を掴み中＝クリック選択しない（重なり時の誤選択防止）
  if (moved > 6) return;                 // ドラッグ（視点操作）はクリック扱いしない
  if (followTool) {
    const obj = placeToolAt(followTool.tool, e.clientX, e.clientY);  // 仮配置
    if (obj) { stopFollow(); selectPart(obj); }   // 追従終了→選択して高さ入力フォームを出す
  } else if (movingPart) {
    dropMovingPart();                    // 移動モード：現在位置で仮確定（選択は継続）
  } else {
    pickPartAt(e.clientX, e.clientY, false);   // 通常クリック＝単一選択（Ctrlは別経路で処理済み）
  }
});

// 自由移動（掴んでドラッグ）は pointerdown のダブルクリック検出で開始する（上記参照）。
// ブラウザ既定のダブルクリック選択などは抑止しておく。
renderer.domElement.addEventListener('dblclick', e => e.preventDefault());

// ===================================================================
//  窓選択（Ctrl+ドラッグ）：矩形を描き、囲んだアイテムを選択に追加
//  ・Ctrl+クリック（動かさない）は従来どおり個別トグル
//  ・Ctrl+ドラッグ中は視点回転（OrbitControls）を止める
// ===================================================================
const selBoxEl = document.createElement('div');
selBoxEl.id = 'selBox';
document.body.appendChild(selBoxEl);
let boxSel = null;       // {sx, sy, moved}  Ctrl+ドラッグ中の状態（client座標）

function drawSelBox(x0, y0, x1, y1) {
  const l = Math.min(x0, x1), t = Math.min(y0, y1);
  selBoxEl.style.display = 'block';
  selBoxEl.style.left = l + 'px';
  selBoxEl.style.top = t + 'px';
  selBoxEl.style.width = Math.abs(x1 - x0) + 'px';
  selBoxEl.style.height = Math.abs(y1 - y0) + 'px';
}
// 矩形内に起点（接続点）が入るアイテムを選択集合へ追加（既存選択に積み増す）
function selectPartsInRect(x0, y0, x1, y1) {
  const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
  let last = null;
  for (const p of placedParts) {
    if (!p.userData.faceLocal) continue;
    const ndc = modelGroup.localToWorld(originModelPos(p)).project(cam);
    if (ndc.z >= 1) continue;                       // カメラ背後は除外
    const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
      if (!selectedParts.has(p)) { selectedParts.add(p); setEmissive(p, SEL_COLOR); }
      last = p;
    }
  }
  if (last) { selectedPart = last; pipeEndSel = null; updateForm(); }   // 主選択を矩形内の1つに
  if (window.__annSelectInRect) window.__annSelectInRect(x0, y0, x1, y1);   // 線分も同じ矩形で選択
  refreshItemList();
}
// 開始：Ctrl押下＋左ボタンで窓選択を始める（capture で OrbitControls より先に捕捉）
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0 || followTool || movingPart) return;
  if (!(e.ctrlKey || e.metaKey || touchCtrl)) return;
  boxSel = { sx: e.clientX, sy: e.clientY, moved: false };
  controls.enabled = false;            // ドラッグ中は視点回転させない
  e.stopPropagation();                 // 既存の選択/方向移動/オービット開始を抑止
}, true);
window.addEventListener('pointermove', e => {
  if (!boxSel) return;
  if (!boxSel.moved && Math.hypot(e.clientX - boxSel.sx, e.clientY - boxSel.sy) > 4) boxSel.moved = true;
  if (boxSel.moved) drawSelBox(boxSel.sx, boxSel.sy, e.clientX, e.clientY);
});
window.addEventListener('pointerup', e => {
  if (!boxSel) return;
  const moved = boxSel.moved;
  const x0 = Math.min(boxSel.sx, e.clientX), x1 = Math.max(boxSel.sx, e.clientX);
  const y0 = Math.min(boxSel.sy, e.clientY), y1 = Math.max(boxSel.sy, e.clientY);
  boxSel = null;
  selBoxEl.style.display = 'none';
  controls.enabled = true;
  if (moved) selectPartsInRect(x0, y0, x1, y1);            // 窓選択
  else if (!(window.__annToggleAt && window.__annToggleAt(e.clientX, e.clientY)))
    pickPartAt(e.clientX, e.clientY, true);               // Ctrl+クリック＝線が無ければ部品をトグル
});
// Esc=移動取消/追従解除/選択解除、Delete・Backspace=選択部品の削除
window.addEventListener('keydown', e => {
  if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
    if (e.key === 'Escape') e.target.blur();   // 入力欄でEsc＝入力モード解除（フォーカスを外す）
    return;                                     // それ以外は入力優先で無視
  }
  if (e.key === 'Escape') {
    if (pipeEndDrag) cancelPipeEndDrag();
    else if (dirDrag) cancelDirDrag();
    else if (movingPart) cancelMovePart();
    else { stopFollow(); selectPart(null); if (window.__annClearSel) window.__annClearSel(); }
  } else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
});
// 右クリック＝向きの送り（追従中／移動中／配置済み選択中）。右ドラッグ(パン)は回転しない。
// 線を選択して右クリック「長押し」＝角度スピナーで任意角度回転。
let rDownPos = null, rLongTimer = null, rLongFired = false;
function clearRLong() { if (rLongTimer) { clearTimeout(rLongTimer); rLongTimer = null; } }
// 角度スピナーの対象を「選択中パイプ」か「選択中の線」に振り分ける
function pipeRotTarget() { return isSpinRotPart(selectedPart); }   // 長押しスピナーの対象（パイプ・エルボ・フランジ）
function rotSpinStart(shift) { return pipeRotTarget() ? pipeRotateSpinStart(shift) : !!(window.__annRotateSpinStart && window.__annRotateSpinStart(shift)); }
function rotSpinApply(deg) { if (pipeRotateSpinActive()) pipeRotateSpinApply(deg); else if (window.__annRotateSpinApply) window.__annRotateSpinApply(deg); }
function rotSpinEnd() { if (pipeRotateSpinActive()) pipeRotateSpinEnd(); else if (window.__annRotateSpinEnd) window.__annRotateSpinEnd(); }
function rotSpinCancel() { if (pipeRotateSpinActive()) pipeRotateSpinCancel(); else if (window.__annRotateSpinCancel) window.__annRotateSpinCancel(); }
function rotSpinActive() { return pipeRotateSpinActive() || !!(window.__annRotateSpinActive && window.__annRotateSpinActive()); }
function rotSpinPivot() { return pipeRotateSpinActive() ? pipeRotateSpinPivot() : (window.__annRotateSpinPivot && window.__annRotateSpinPivot()); }
function canRotSpin() { return pipeRotTarget() || (window.__annHasSel && window.__annHasSel() && !selectedPart); }
// 右クリック微調整のモード：'angle'＝一般の回転スピナー／'move'＝構築線の平行移動（mm）／'heading'＝構築線の方位角（絶対°）
let _nudgeMode = 'angle';
// 構築線の「EL→角度→閉じ」連鎖中フラグ：方位角スピナーをEnterで確定したら選択も閉じる（2026-06-13 社長指示）
let _xlineChainClose = false;
// EL入力欄へ即フォーカス（クリック不要で Enter 決定できるように）。フォーム表示の1フレーム後に当てる
function focusElInputSoon() {
  setTimeout(() => {
    if (hForm) hForm.style.display = 'flex';
    if (hYInput) { hYInput.focus(); hYInput.select(); }
  }, 60);
}
function nudgeApply(v) {
  if (_nudgeMode === 'move') { if (window.__annMoveSpinApply) window.__annMoveSpinApply(v); }
  else if (_nudgeMode === 'heading') { if (window.__annHeadingSpinApply) window.__annHeadingSpinApply(v); }
  else if (_nudgeMode === 'dimdir') { if (window.__dimDirSpinApply) window.__dimDirSpinApply(v); }
  else if (_nudgeMode === 'dimoff') { if (window.__dimOffSpinApply) window.__dimOffSpinApply(v); }
  else if (_nudgeMode === 'dimskew') { if (window.__dimSkewSpinApply) window.__dimSkewSpinApply(v); }
  else if (_nudgeMode === 'dimroll') { if (window.__dimRollSpinApply) window.__dimRollSpinApply(v); }
  else rotSpinApply(v);
}
function nudgeActive() {
  if (_nudgeMode === 'move') return !!(window.__annMoveSpinActive && window.__annMoveSpinActive());
  if (_nudgeMode === 'heading') return !!(window.__annHeadingSpinActive && window.__annHeadingSpinActive());
  if (_nudgeMode === 'dimdir') return !!(window.__dimDirSpinActive && window.__dimDirSpinActive());
  if (_nudgeMode === 'dimoff') return !!(window.__dimOffSpinActive && window.__dimOffSpinActive());
  if (_nudgeMode === 'dimskew') return !!(window.__dimSkewSpinActive && window.__dimSkewSpinActive());
  if (_nudgeMode === 'dimroll') return !!(window.__dimRollSpinActive && window.__dimRollSpinActive());
  return rotSpinActive();
}
function nudgePivot() {
  if (_nudgeMode === 'move') return window.__annMoveSpinPivot && window.__annMoveSpinPivot();
  if (_nudgeMode === 'heading') return window.__annHeadingSpinPivot && window.__annHeadingSpinPivot();
  if (_nudgeMode === 'dimdir') return window.__dimDirSpinPivot && window.__dimDirSpinPivot();
  if (_nudgeMode === 'dimoff') return window.__dimOffSpinPivot && window.__dimOffSpinPivot();
  if (_nudgeMode === 'dimskew') return window.__dimSkewSpinPivot && window.__dimSkewSpinPivot();
  if (_nudgeMode === 'dimroll') return window.__dimRollSpinPivot && window.__dimRollSpinPivot();
  return rotSpinPivot();
}
function nudgeStep() { return (_nudgeMode === 'move' || _nudgeMode === 'dimoff') ? 1 : 0.5; }   // 移動・逃げ=1mm刻み／角度・方位=0.5°刻み
function setNudgeLabel() {                                          // フォームの見出し・単位をモードで切替
  const lab = document.getElementById('rotLabel'), unit = document.getElementById('rotUnit');
  if (lab) lab.textContent = _nudgeMode === 'move' ? '移動' : _nudgeMode === 'dimoff' ? '逃げ' : _nudgeMode === 'dimskew' ? '斜め' : _nudgeMode === 'dimroll' ? '回転' : (_nudgeMode === 'heading' || _nudgeMode === 'dimdir') ? '方位' : '角度';
  if (unit) unit.textContent = (_nudgeMode === 'move' || _nudgeMode === 'dimoff') ? 'mm' : '°';
}
// 逃げ方向の回転スピナー（Shift+右クリックの直後に呼ばれる）
function startDimRollSpin(rec) {
  if (!(window.__dimRollSpinStart && window.__dimRollSpinStart(rec))) return;
  _nudgeMode = 'dimroll';
  setNudgeLabel();
  rotAInput.value = window.__dimRollSpinStartDeg ? window.__dimRollSpinStartDeg().toFixed(1) : '0';
  positionRotForm(0, 0);
  rotForm.style.display = 'flex';
  rotAInput.focus(); rotAInput.select();
  if (typeof updateForm === 'function') updateForm();
}
// スライド寸法の角度スピナー（右クリック切替の直後に呼ばれる）
function startDimSkewSpin(rec) {
  if (!(window.__dimSkewSpinStart && window.__dimSkewSpinStart(rec))) return;
  _nudgeMode = 'dimskew';
  setNudgeLabel();
  rotAInput.value = window.__dimSkewSpinStartDeg ? window.__dimSkewSpinStartDeg().toFixed(1) : '0';
  positionRotForm(0, 0);
  rotForm.style.display = 'flex';
  rotAInput.focus(); rotAInput.select();
  if (typeof updateForm === 'function') updateForm();
}
// 寸法線スピナーの連鎖対象。next='dir'（配置直後：立面なら方位スピナーへ）／'el'（再選択：EL調整へ）
let _dimChainRec = null, _dimChainNext = null;
// 寸法線の逃げ量スピナー（配置確定直後・再選択時に呼ばれる）
function startDimOffSpin(rec, next) {
  if (!(window.__dimOffSpinStart && window.__dimOffSpinStart(rec))) return;
  _nudgeMode = 'dimoff';
  _dimChainRec = rec;
  _dimChainNext = next || 'dir';
  setNudgeLabel();
  rotAInput.value = window.__dimOffSpinStartMm ? String(window.__dimOffSpinStartMm()) : '0';
  positionRotForm(0, 0);
  rotForm.style.display = 'flex';
  rotAInput.focus(); rotAInput.select();
  if (typeof updateForm === 'function') updateForm();
}
// 立面寸法線の逃げ方位スピナー（逃げ量スピナーの後に呼ばれる）
function startDimDirSpin(rec) {
  if (!(window.__dimDirSpinStart && window.__dimDirSpinStart(rec))) return;
  _nudgeMode = 'dimdir';
  setNudgeLabel();
  rotAInput.value = window.__dimDirSpinStartDeg ? window.__dimDirSpinStartDeg().toFixed(1) : '0';
  positionRotForm(0, 0);
  rotForm.style.display = 'flex';
  rotAInput.focus(); rotAInput.select();
  if (typeof updateForm === 'function') updateForm();
}
function positionRotForm(cx, cy) {
  const rect = renderer.domElement.getBoundingClientRect();
  let sx = cx, sy = cy;
  const piv = nudgePivot();
  if (piv) { const n = modelGroup.localToWorld(piv).project(activeCam()); if (n.z < 1) { sx = rect.left + (n.x * 0.5 + 0.5) * rect.width; sy = rect.top + (-n.y * 0.5 + 0.5) * rect.height; } }
  const fw = rotForm.offsetWidth || 90, fh = rotForm.offsetHeight || 28;
  rotForm.style.left = Math.round(Math.max(rect.left + 4, Math.min(sx + 16, rect.right - fw - 4))) + 'px';
  rotForm.style.top = Math.round(Math.max(rect.top + 4, Math.min(sy - fh - 10, rect.bottom - fh - 4))) + 'px';
}
function startRotSpin(shift, cx, cy) {
  // 構築線を選択中：無Shift＝1mm平行移動スピナー、Shift＝方位角スピナー。それ以外（パイプ等）＝従来の角度スピナー
  const xlineSel = !selectedPart && window.__annSelIsXline && window.__annSelIsXline();
  if (xlineSel) _nudgeMode = shift ? 'heading' : 'move';
  else _nudgeMode = 'angle';
  let ok;
  if (_nudgeMode === 'move') ok = !!(window.__annMoveSpinStart && window.__annMoveSpinStart());
  else if (_nudgeMode === 'heading') ok = !!(window.__annHeadingSpinStart && window.__annHeadingSpinStart());
  else ok = rotSpinStart(shift);
  if (!ok) { _nudgeMode = 'angle'; return; }
  setNudgeLabel();
  rotAInput.value = _nudgeMode === 'heading' ? (window.__annHeadingSpinStartDeg ? window.__annHeadingSpinStartDeg().toFixed(1) : '0') : '0';
  positionRotForm(cx, cy);
  rotForm.style.display = 'flex';
  rotAInput.focus(); rotAInput.select();
  if (typeof updateForm === 'function') updateForm();   // スピナー表示中はEL入力を隠す
}
function endRotSpin(commit) {
  const wasHeading = _nudgeMode === 'heading';
  const wasDimOff = _nudgeMode === 'dimoff';
  const wasDimDir = _nudgeMode === 'dimdir';
  if (_nudgeMode === 'move') { if (commit) { if (window.__annMoveSpinEnd) window.__annMoveSpinEnd(); } else if (window.__annMoveSpinCancel) window.__annMoveSpinCancel(); }
  else if (_nudgeMode === 'heading') { if (commit) { if (window.__annHeadingSpinEnd) window.__annHeadingSpinEnd(); } else if (window.__annHeadingSpinCancel) window.__annHeadingSpinCancel(); }
  else if (_nudgeMode === 'dimdir') { if (commit) { if (window.__dimDirSpinEnd) window.__dimDirSpinEnd(); } else if (window.__dimDirSpinCancel) window.__dimDirSpinCancel(); }
  else if (_nudgeMode === 'dimoff') { if (commit) { if (window.__dimOffSpinEnd) window.__dimOffSpinEnd(); } else if (window.__dimOffSpinCancel) window.__dimOffSpinCancel(); }
  else if (_nudgeMode === 'dimskew') { if (commit) { if (window.__dimSkewSpinEnd) window.__dimSkewSpinEnd(); } else if (window.__dimSkewSpinCancel) window.__dimSkewSpinCancel(); }
  else if (_nudgeMode === 'dimroll') { if (commit) { if (window.__dimRollSpinEnd) window.__dimRollSpinEnd(); } else if (window.__dimRollSpinCancel) window.__dimRollSpinCancel(); }
  else { if (commit) rotSpinEnd(); else rotSpinCancel(); }
  if (rotForm) rotForm.style.display = 'none';
  _nudgeMode = 'angle';
  // 構築線のEL→角度連鎖：角度をEnterで確定したら選択も閉じる（Esc取消なら選択を維持してELへ戻る）
  if (_xlineChainClose) {
    _xlineChainClose = false;
    if (commit && wasHeading && window.__annDeselect) { window.__annDeselect(); return; }
  }
  // 寸法線の連鎖：逃げ量スピナーを確定したら、立面寸法は続けて方位スピナーへ。
  // 連鎖が終わったら寸法線を選択状態にし、「値」フォームで数字を任意に変えられるようにする
  if (_dimChainRec) {
    const r = _dimChainRec;
    _dimChainRec = null; _dimChainNext = null;
    if (commit && wasDimOff) {
      const dx = r.b.x - r.a.x, dz = r.b.z - r.a.z;
      if (dx * dx + dz * dz < 1e-9 && r.style.dimOff && r.style.dimDir) {
        startDimDirSpin(r);
        _dimChainRec = r;   // 方位スピナーの確定後にも「値」フォームへつなぐ
        return;
      }
      if (window.__annSelectRec) window.__annSelectRec(r);   // 確定後＝選択して「値」フォームを出す
    } else if (commit && wasDimDir) {
      if (window.__annSelectRec) window.__annSelectRec(r);
    }
  }
  if (typeof updateForm === 'function') updateForm();   // スピナーを閉じたらEL入力等を出し直す
}
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 2) return;
  rDownPos = { x: e.clientX, y: e.clientY }; rLongFired = false; clearRLong();
  if (canRotSpin()) {                          // 線またはパイプを選択中＝長押しで角度スピナー
    const sh = e.shiftKey || touchShift, cx = e.clientX, cy = e.clientY;
    rLongTimer = setTimeout(() => { rLongFired = true; startRotSpin(sh, cx, cy); }, 350);
  }
});
window.addEventListener('pointermove', e => { if (rLongTimer && rDownPos && Math.hypot(e.clientX - rDownPos.x, e.clientY - rDownPos.y) > 6) clearRLong(); });
window.addEventListener('pointerup', e => { if (e.button === 2) clearRLong(); });
renderer.domElement.addEventListener('contextmenu', e => {
  e.preventDefault();                 // ブラウザのメニューは常に抑止
  clearRLong();
  const moved = rDownPos ? Math.hypot(e.clientX - rDownPos.x, e.clientY - rDownPos.y) : 0;
  rDownPos = null;
  if (rLongFired) { rLongFired = false; return; }   // 長押しで角度スピナーを出した → 45°回転はしない
  if (moved > 6) return;              // 右ドラッグ＝視点パン → 回転しない
  orientStep(e.shiftKey || touchShift);             // Shift+右クリック＝ひねり(roll)切替
});
// 向きの送り（右クリック相当）。タッチのコントローラーからも同じ処理を呼ぶ。
function orientStep(shift) {
  if (followTool) cycleFollowOrientation(shift);
  else if (movingPart) cycleMoveOrientation(shift);
  else if (isFreeRotPart(selectedPart)) pipeRotate(shift);   // パイプ・エルボは線分と同じ回転（起点まわり45°）
  else if (selectedPart) cycleSelectedOrientation(shift);   // その他の部品は従来の向き送り
  else if (window.__annHasSel && window.__annHasSel()) {
    // 寸法線（単独選択）：右クリック＝スライド寸法（+45°→−45°→0°→繰返し）／Shift+右クリック＝逃げ方向をAB軸まわりに45°回転
    if (window.__annSelIsSingleDim && window.__annSelIsSingleDim()) {
      if (shift) { const r = window.__dimRollStep(); if (r) startDimRollSpin(r); }
      else { const r = window.__dimSkewToggle(); if (r) startDimSkewSpin(r); }
    }
    // 構築線は短い右クリックでは回転させない（微調整は右クリック長押し＝平行移動/Shiftで角度）。線分は従来どおり45°回転
    else if (!(window.__annSelIsXline && window.__annSelIsXline())) window.__annRotate(shift);
  }
}
if (rotAInput) {
  // 角度=0〜360未満/方位=0〜180未満（いずれも0.5°刻みで折り返し）／移動・逃げ=mm整数（折り返し無し・負値可）
  // 斜め（スライド寸法）=−85〜+85°（折り返さずクランプ・0.5°刻み・負値可）
  const wrap = a => (_nudgeMode === 'move' || _nudgeMode === 'dimoff') ? Math.round(a)
    : _nudgeMode === 'dimskew' ? Math.max(-85, Math.min(85, Math.round(a * 2) / 2))
    : _nudgeMode === 'heading' ? (Math.round((((a % 180) + 180) % 180) * 2) / 2)
    : (Math.round((((a % 360) + 360) % 360) * 2) / 2);
  const setRot = v => { rotAInput.value = v; nudgeApply(v); };
  const applyRot = () => { setRot(wrap(parseFloat(rotAInput.value) || 0)); };
  rotAInput.addEventListener('change', applyRot);   // 手入力の確定で折り返し
  rotAInput.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); applyRot(); endRotSpin(true); }
    else if (e.key === 'Escape') { e.preventDefault(); endRotSpin(false); }
    else if (e.key === 'Delete' &&
             (_nudgeMode === 'dimoff' || _nudgeMode === 'dimdir' || _nudgeMode === 'dimskew' || _nudgeMode === 'dimroll' || _nudgeMode === 'heading')) {
      // 寸法線・構築線のスピナーにフォーカスが入ったままでも Delete で対象を削除できる
      e.preventDefault();
      const chainRec = _dimChainRec; _dimChainRec = null; _dimChainNext = null;
      endRotSpin(false);
      if (window.__annHasSel && window.__annHasSel()) { if (window.__annDeleteSelected) window.__annDeleteSelected(); }
      else if (chainRec && window.__annDeleteRec) window.__annDeleteRec(chainRec);
    }
  });
  // 自前の▲▼：角度0.5°／移動1mm刻み・長押しで連続。dir=+1/-1
  const stepRot = dir => setRot(wrap((parseFloat(rotAInput.value) || 0) + dir * nudgeStep()));
  const rotUp = document.getElementById('rotUp'), rotDn = document.getElementById('rotDn');
  const bindHold = (btn, dir) => {
    if (!btn) return;
    let to = null, iv = null;
    const stop = () => { if (to) clearTimeout(to); if (iv) clearInterval(iv); to = iv = null; };
    btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); stepRot(dir); to = setTimeout(() => { iv = setInterval(() => stepRot(dir), 22); }, 350); });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
  };
  bindHold(rotUp, 1); bindHold(rotDn, -1);
  // フォーム外をクリックしたら確定して閉じる（フォーム内の操作は維持）
  document.addEventListener('pointerdown', e => {
    if (!nudgeActive()) return;
    if (rotForm.contains(e.target)) return;
    endRotSpin(true);
  }, true);
}

// 起動時：透視ビューなので矢印は無効
updateRollButtons();

// ===================================================================
//  タッチ用オンスクリーン・コントローラー（iPad/iPhone）
//  右クリック(向き/ひねり)・ホイール(ズーム)・Esc(取消) を画面ボタンで代替。
//  タッチ端末で自動表示／PCでも ?ctrl=1 を付ければ検証用に表示できる。
// ===================================================================
// ズーム：カメラと注視点の距離を factor 倍する（<1=拡大 / >1=縮小）。
// 透視・平行投影どちらも camera.position から導くので両対応。
function zoomStep(factor) {
  const t = controls.target;
  const off = camera.position.clone().sub(t);
  let d = off.length() * factor;
  d = Math.min(controls.maxDistance, Math.max(controls.minDistance, d));
  camera.position.copy(t).add(off.normalize().multiplyScalar(d));
  if (!useOrtho) controls.update();
}
(function setupTouchControls() {
  const pad = document.getElementById('touchCtrl');
  if (!pad) return;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const forced = /[?&]ctrl=1/.test(location.search);
  if (coarse || ('ontouchstart' in window) || forced) document.body.classList.add('tc-on');
  // タップ／長押し連続に対応した汎用バインド（押している間 fn を繰り返す）
  const bindHold = (id, fn, repeat) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    let to = null, iv = null;
    const stop = () => { if (to) clearTimeout(to); if (iv) clearInterval(iv); to = iv = null; };
    btn.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); fn();
      if (repeat) to = setTimeout(() => { iv = setInterval(fn, 90); }, 350);
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  };
  bindHold('tcOrient',  () => orientStep(false), false);
  bindHold('tcTwist',   () => orientStep(true),  false);
  bindHold('tcEsc',     () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), false);
  bindHold('tcDel',     () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })), false);
  // Shift／Ctrl＝タッチ用の仮想モディファイア（PCのShift/Ctrl押下と同じ挙動を再現するトグル）
  const bindMod = (id, get, set, after) => {
    const btn = document.getElementById(id); if (!btn) return;
    const sync = () => btn.classList.toggle('on', get());
    btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); set(!get()); sync(); if (after) after(); });
    btn.addEventListener('contextmenu', e => e.preventDefault());
    sync();
  };
  bindMod('tcShift', () => touchShift, v => { touchShift = v; }, null);
  bindMod('tcCtrl',  () => touchCtrl,  v => { touchCtrl = v; }, () => { if (window.__syncTouchOrbit) window.__syncTouchOrbit(); });
})();

// ---- 描画ループ ----
let prevT = performance.now();
(function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = now - prevT; prevT = now;
  if (tween) updateTween(dt);
  else if (!useOrtho) controls.update();   // 平行投影固定中は controls を回さない
  if (useOrtho) syncOrtho();
  updateIdleMarkers();         // 選択中パイプの両端センターを表示（アイドル時）
  renderer.clear();
  renderer.render(scene, activeCam());
  renderGizmo();
  renderAxisGizmo();           // 左下の座標軸インジケータ
  positionHeightForm();        // 選択部品の脇に高さ入力フォームを追従させる
  positionLegInputs();         // 方向移動中、三角形の脚に距離入力欄を追従させる
  if (window.__updateDimTextFacing) window.__updateDimTextFacing();   // 寸法文字の裏表をカメラに合わせて補正
  if (window.__positionDimValueForm) window.__positionDimValueForm(); // 選択中の寸法線の「値」フォームを追従
  if (window.__posLineGuide) window.__posLineGuide();   // 線分描画中、三角形の脚にX/Z/Y入力欄を追従
  if (window.__updateScaleLabel) window.__updateScaleLabel();   // 現在の表示尺度を右上に表示
  // パレットのサムネイル（静止表示）。非表示の部品は描画しない。
  for (const t of palThumbs) {
    if (t.tile && t.tile.style.display === 'none') continue;
    t.renderer.render(t.scene, t.cam);
  }
})();

// ===================================================================
//  フランジの「実在する組み合わせ」だけを選べるようにする
//  ・SW(ソケットウェルド)は小口径のみ(〜80A)。100AのSW等は規格に無い。
//  ・JPI(150LB/300LB)は10A規格が無い(15A〜)。
// ===================================================================
function flangeAvailableSizes(cls, type) {
  // そのクラスの寸法表に実在するサイズだけを対象にする
  const table = FLANGE_DIMS[cls] || {};
  let sizes = FLANGE_SIZES.filter(s => table[s]);
  if (sizes.length === 0) sizes = FLANGE_SIZES.slice();   // 念のため
  if (type === 'SW') {                                     // SWは小口径のみ(〜80A)
    const swOK = ['10A','15A','20A','25A','32A','40A','50A','65A','80A'];
    sizes = sizes.filter(s => swOK.includes(s));
  }
  if (type === 'LJ') sizes = sizes.filter(s => s !== '10A');  // LJはスタブエンドに合わせ15A〜
  return sizes;
}
// 呼び径ドロップダウンを組み直す（フランジ）。仕様へ反映。
function rebuildSizeOptions() {
  const sel = document.getElementById('optSize');
  if (!sel) return;
  const avail = flangeAvailableSizes(flangeOpts.cls, flangeOpts.type);
  const cur = sel.value;
  sel.innerHTML = '';
  avail.forEach(s => sel.add(new Option(s, s)));
  sel.value = avail.includes(cur) ? cur : (avail.includes(flangeOpts.sizeA) ? flangeOpts.sizeA : avail[0]);
  flangeOpts.sizeA = sel.value;
}
// クラスに応じてタイプの選択肢を組み直す（フランジ用。規格に無いタイプは消える）
function rebuildTypeOptions() {
  const sel = document.getElementById('optType');
  if (!sel) return;
  const avail = typesForClass(flangeOpts.cls);
  const cur = sel.value;
  sel.innerHTML = '';
  avail.forEach(t => sel.add(new Option(t.code, t.code)));
  const codes = avail.map(t => t.code);
  sel.value = codes.includes(cur) ? cur : codes[0];
  flangeOpts.type = sel.value;
}
// あるタイプに規格が存在するクラスだけを返す（タイプ→クラスの逆引き）
function classesForType(type) {
  return FLANGE_CLASSES.filter(cls =>
    (TYPES_BY_CLASS[cls] || ['SOP','SW','WN','LJ','BL']).includes(type));
}
// タイプに応じてクラスの選択肢を組み直す（そのタイプの規格が無いクラスは消える）
function rebuildClassOptions() {
  const sel = document.getElementById('optClass');
  if (!sel) return;
  const avail = classesForType(flangeOpts.type);
  const cur = sel.value;
  sel.innerHTML = '';
  avail.forEach(c => sel.add(new Option(c, c)));
  sel.value = avail.includes(cur) ? cur : (avail.includes(flangeOpts.cls) ? flangeOpts.cls : avail[0]);
  flangeOpts.cls = sel.value;
}
// 全ドロップダウンに変更リスナーを付与（アクティブ部品の仕様へ反映）
['optSize', 'optType', 'optClass', 'optFace', 'optSch'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => onOptChange(id));
});
syncOptionsUI();   // 起動時：アクティブ部品(フランジ)で初期化
buildPipeOptions();   // パイプのオプション欄も用意（初期は非表示）
buildPartSelect();    // 部品種別ドロップダウンを用意
setActivePart('flange');   // 初期表示はフランジ1つのみ
refreshItemList();    // 設置アイテム一覧を初期化（空表示）

// ===================================================================
//  リボン：コマンド（ファイル / 描画 / 編集 / 表示）
//  ・既存の配置/選択/移動ロジックには手を入れず、新規モジュールとして実装。
//  ・描画モード中はポインタ操作を window のキャプチャ段で横取りし、既存ハンドラを抑止する。
// ===================================================================
(function setupRibbon() {
  const $ = id => document.getElementById(id);
  const V3 = THREE.Vector3;

  // ---- 部品仕様(userData)からメッシュを再生成（複製・読込・鏡で共用） ----
  const SPEC_FIELD = { flange: 'flange', pipe: 'pipe', elbow: 'elbow', cap: 'cap', tee: 'tee', reducer: 'reducer' };
  function buildFromSpec(u) {
    switch (u.partType) {
      case 'flange':  return makeFlange(u.flange);
      case 'pipe':    return makePipe(u.pipe);
      case 'elbow':   return makeElbow(u.elbow);
      case 'cap':     return makeCap(u.cap);
      case 'tee':     return makeTee(u.tee);
      case 'reducer': return makeReducer(u.reducer);
      default:        return null;
    }
  }
  function specOf(u) { const f = SPEC_FIELD[u.partType]; return f ? u[f] : null; }
  // build直後（原点・無回転）に機点を確定させてから返す
  function makeSpecPart(u) { const o = buildFromSpec(u); if (o) computeConns(o); return o; }
  function disposeObj(o) {
    o.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); }
    });
  }
  // 配置済みとして登録（modelGroup へ追加・placedParts へ push）
  function registerPart(obj, src) {
    obj.userData.placed = true;
    if (src) {
      obj.userData.orient = src.userData.orient || 0;
      obj.userData.roll = src.userData.roll || 0;
      if (src.userData.mat) obj.userData.mat = src.userData.mat;
    }
    modelGroup.add(obj);
    placedParts.push(obj);
    return obj;
  }
  // 複数選択に置き換える（青ハイライト）
  function selectMany(parts) {
    selectPart(null);
    for (const p of parts) { selectedParts.add(p); setEmissive(p, SEL_COLOR); }
    if (parts.length) selectedPart = parts[parts.length - 1];
    updateForm(); refreshItemList();
  }

  // ================= 編集：複製 =================
  function duplicate() {
    const src = [...selectedParts];
    const annSrc = [...selAnns];                  // 線分・構築線・寸法線も複製対象（2026-06-13 社長指示）
    if (!src.length && !annSrc.length) return;
    const off = new V3(0.1, 0, 0.1);   // 100mm 斜めにずらして重ならないように
    const copies = [];
    for (const s of src) {
      const obj = makeSpecPart(s.userData);
      if (!obj) continue;
      obj.quaternion.copy(s.quaternion);
      obj.position.copy(s.position).add(off);
      obj.scale.copy(s.scale);
      if (s.userData.gripLocal) obj.userData.gripLocal = s.userData.gripLocal.clone();
      registerPart(obj, s);
      copies.push(obj);
    }
    const annCopies = [];
    for (const r of annSrc) {
      const dst = Object.assign({}, r.style);
      if (dst.angP2) dst.angP2 = [dst.angP2[0] + off.x, dst.angP2[1] + off.y, dst.angP2[2] + off.z];   // 角度のP2も同じだけずらす
      addAnnotation(r.type, r.a.clone().add(off), r.b.clone().add(off), dst);
      annCopies.push(annStore[annStore.length - 1]);
    }
    if (copies.length) selectMany(copies);        // 部品コピーを選択（線選択はここで一旦クリアされる）
    if (annCopies.length) {                       // 線コピーも選択に加える
      if (!copies.length) { selAnns.clear(); clearAnnHi(); lineSel = null; }
      for (const r of annCopies) selAnns.add(r);
      if (!copies.length) lineSel = annCopies[annCopies.length - 1];
      refreshAnnHi(); refreshHandles();
      if (typeof updateForm === 'function') updateForm();
    }
  }

  // ================= 編集：鏡（対話式・2026-06-13 社長指示の新フロー） =================
  // 選択 → 鏡ボタン → ①反転軸の起点をクリック（機点・交点へ吸着）
  //                  → ②方向をクリック（45°刻み・ガイド表示）
  //                  → 「元のオブジェクトを削除するか」を選択 → 実行。
  // 部品だけでなく線分・構築線・寸法線も反転できる。
  let mirrorMode = null;   // { parts:[], anns:[], p1:V3|null }
  const mirrorGuide = new THREE.Group();
  modelGroup.add(mirrorGuide);
  function clearMirrorGuide() {
    while (mirrorGuide.children.length) { const c = mirrorGuide.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
  }
  function endMirrorMode() {
    mirrorMode = null; clearMirrorGuide();
    renderer.domElement.style.cursor = '';
  }
  window.__mirrorActive = () => !!mirrorMode;   // 鏡モード中は各種入力フォームを隠す用
  // 点 p を通り法線 n（単位・水平）の鉛直面で反転する行列
  function reflectMatrixAbout(p, n) {
    const m = new THREE.Matrix4().set(
      1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 0,
      -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 0,
      -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, 0,
      0, 0, 0, 1);
    return new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(m)
      .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  }
  function mirror() {
    if (mirrorMode) { endMirrorMode(); return; }          // もう一度押す＝取消
    const parts = [...selectedParts], anns = [...selAnns];
    if (!parts.length && !anns.length) return;
    mirrorMode = { parts, anns, p1: null };
    renderer.domElement.style.cursor = DRAW_CURSOR;       // モード表示はカーソルのみ（メッセージ画面は出さない）
  }
  // 鏡の変換行列を求める。カーソルが指す方向（45°刻み）へ反転（鉛直面での鏡映）。
  // ※Shift の特殊機能は廃止（2026-06-13 社長指示）
  function mirrorXformFrom(cx, cy) {
    const p1 = mirrorMode.p1;
    const step = Math.PI / 4;
    const hit = planeHitAt(cx, cy, p1.y);
    if (!hit) return null;
    const vx = hit.x - p1.x, vz = hit.z - p1.z;
    if (Math.hypot(vx, vz) < 1e-6) return null;
    const ang = Math.round(Math.atan2(vz, vx) / step) * step;   // カーソル方位（45°刻み）
    const n = new V3(Math.cos(ang), 0, Math.sin(ang));          // カーソルが指す方向へ反転
    if (n.x < -1e-6 || (Math.abs(n.x) < 1e-6 && n.z < 0)) n.negate();   // ±は同じ面＝符号を正規化
    return { M: reflectMatrixAbout(p1, n), key: 'mir:' + n.x.toFixed(3) + ',' + n.z.toFixed(3) };
  }
  // 方向プレビュー：補助線は出さず、鏡像そのもの（半透明ゴースト）を表示する。refl＝変換行列（鏡映/立てる回転）
  function buildMirrorPreview(refl) {
    clearMirrorGuide();
    const p1 = mirrorMode.p1;
    const reflDirV = v => v.clone().transformDirection(refl);
    for (const s of mirrorMode.parts) {
      s.updateMatrixWorld(true);
      const g = s.clone(true);
      const m = new THREE.Matrix4().multiplyMatrices(refl, s.matrix);
      const pos = new V3(), quat = new THREE.Quaternion(), scl = new V3();
      m.decompose(pos, quat, scl);
      g.position.copy(pos); g.quaternion.copy(quat); g.scale.copy(scl);
      g.traverse(o => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.4;
          o.material.depthWrite = false; o.material.side = THREE.DoubleSide;
          if (o.material.color) o.material.color.lerp(new THREE.Color(0x4d8fff), 0.5);   // 青味のゴースト＝その場反転でも見分けられる
        }
      });
      mirrorGuide.add(g);
    }
    for (const r of mirrorMode.anns) {
      const a2 = r.a.clone().applyMatrix4(refl), b2 = r.b.clone().applyMatrix4(refl);
      const st = Object.assign({}, r.style);
      if (st.dimDir) { const d2 = reflDirV(new V3(st.dimDir.x, st.dimDir.y, st.dimDir.z)); st.dimDir = { x: d2.x, y: d2.y, z: d2.z }; }
      if (st.angP2) { const p2 = new V3(st.angP2[0], st.angP2[1], st.angP2[2]).applyMatrix4(refl); st.angP2 = [p2.x, p2.y, p2.z]; }
      const g = buildAnn(r.type, a2, b2, st);
      g.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = Math.min(o.material.opacity != null ? o.material.opacity : 1, 0.4); } });
      mirrorGuide.add(g);
    }
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 12, 10), new THREE.MeshBasicMaterial({ color: 0x6fd2ff, depthTest: false, transparent: true }));
    dot.position.copy(p1); dot.renderOrder = 998;
    mirrorGuide.add(dot);
  }
  // 「オブジェクトを削除しますか？ はい／いいえ」の小パネル（オブジェクトの手元に表示）
  const mirrorAsk = document.createElement('div');
  mirrorAsk.style.cssText = 'position:fixed;z-index:90;display:none;flex-direction:column;gap:6px;padding:8px 12px;font:13px Meiryo,sans-serif;color:#e8eef7;background:rgba(16,24,42,.95);border:1px solid #3a4a6e;border-radius:8px';
  const mirrorAskText = document.createElement('div');
  mirrorAskText.textContent = 'オブジェクトを削除しますか？';
  mirrorAsk.appendChild(mirrorAskText);
  const mirrorAskBtns = document.createElement('div');
  mirrorAskBtns.style.cssText = 'display:flex;gap:8px;justify-content:center';
  const mkAskBtn = (label) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'min-width:56px;padding:3px 10px;font:13px Meiryo,sans-serif;cursor:pointer;background:#22305a;color:#e8eef7;border:1px solid #41538a;border-radius:5px';
    return b;
  };
  const mirrorAskYes = mkAskBtn('はい'), mirrorAskNo = mkAskBtn('いいえ');
  mirrorAskBtns.appendChild(mirrorAskYes); mirrorAskBtns.appendChild(mirrorAskNo);
  mirrorAsk.appendChild(mirrorAskBtns);
  document.body.appendChild(mirrorAsk);
  let _mirrorAskCtx = null;   // { parts, anns, copies, annCopies }
  function finishMirrorAsk(del) {
    mirrorAsk.style.display = 'none';
    const ctx = _mirrorAskCtx; _mirrorAskCtx = null;
    if (!ctx) return;
    if (del) {
      // 削除対象は「鏡の元オブジェクト」に固定（パネル表示中に選択が変わっても誤削除しない）
      for (const part of ctx.parts) {
        modelGroup.remove(part);
        const i = placedParts.indexOf(part);
        if (i >= 0) placedParts.splice(i, 1);
        part.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        selectedParts.delete(part);
        if (selectedPart === part) selectedPart = null;
      }
      for (const r of ctx.anns) { if (window.__annDeleteRec) window.__annDeleteRec(r); }
      refreshItemList();
    }
    if (ctx.copies.length) selectMany(ctx.copies);
    if (ctx.annCopies.length) {
      if (!ctx.copies.length) { selAnns.clear(); clearAnnHi(); lineSel = null; }
      for (const r of ctx.annCopies) selAnns.add(r);
      if (!ctx.copies.length) lineSel = ctx.annCopies[ctx.annCopies.length - 1];
      refreshAnnHi(); refreshHandles();
      if (typeof updateForm === 'function') updateForm();
    }
  }
  mirrorAskYes.onclick = () => finishMirrorAsk(true);
  mirrorAskNo.onclick = () => finishMirrorAsk(false);
  function execMirror(refl) {  // refl＝変換行列（鏡映 or 立てる回転。mirrorXformFrom が生成）
    const p1 = mirrorMode.p1;
    const reflDir = v => v.clone().transformDirection(refl);   // 方向ベクトル用（線形部のみ）
    const copies = [];
    for (const s of mirrorMode.parts) {
      const obj = makeSpecPart(s.userData);
      if (!obj) continue;
      s.updateMatrixWorld(true);
      const m = new THREE.Matrix4().multiplyMatrices(refl, s.matrix);   // modelGroupは原点・無変換 → 局所=世界
      const pos = new V3(), quat = new THREE.Quaternion(), scl = new V3();
      m.decompose(pos, quat, scl);
      obj.position.copy(pos); obj.quaternion.copy(quat); obj.scale.copy(scl);
      // 反転でポリゴンの向きが裏返るため、見えなくならないよう両面表示にする
      obj.traverse(o => {
        if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.side = THREE.DoubleSide; o.material.needsUpdate = true; }
      });
      if (s.userData.gripLocal) obj.userData.gripLocal = s.userData.gripLocal.clone();
      registerPart(obj, s);
      copies.push(obj);
    }
    const annCopies = [];
    for (const r of mirrorMode.anns) {
      const a2 = r.a.clone().applyMatrix4(refl), b2 = r.b.clone().applyMatrix4(refl);
      const st = Object.assign({}, r.style);
      if (st.dimDir) { const d2 = reflDir(new V3(st.dimDir.x, st.dimDir.y, st.dimDir.z)); st.dimDir = { x: d2.x, y: d2.y, z: d2.z }; }
      if (st.angP2) { const p2 = new V3(st.angP2[0], st.angP2[1], st.angP2[2]).applyMatrix4(refl); st.angP2 = [p2.x, p2.y, p2.z]; }
      addAnnotation(r.type, a2, b2, st);
      annCopies.push(annStore[annStore.length - 1]);
    }
    // 元を削除するかは、オブジェクトの手元の小パネル（はい／いいえ）で選ぶ
    _mirrorAskCtx = { parts: mirrorMode.parts, anns: mirrorMode.anns, copies, annCopies };
    const box = new THREE.Box3();
    for (const s of mirrorMode.parts) box.expandByObject(s);
    for (const r of mirrorMode.anns) { box.expandByPoint(r.a); box.expandByPoint(r.b); }
    const c = box.isEmpty() ? p1.clone() : box.getCenter(new V3());
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = modelGroup.localToWorld(c).project(activeCam());
    const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    mirrorAsk.style.display = 'flex';
    mirrorAsk.style.left = Math.round(Math.min(Math.max(sx + 12, rect.left + 8), rect.right - 190)) + 'px';
    mirrorAsk.style.top = Math.round(Math.min(Math.max(sy - 20, rect.top + 8), rect.bottom - 90)) + 'px';
    endMirrorMode();
  }
  // 鏡モード中のポインタ・キー操作（他のハンドラより先に捕捉して横取りを防ぐ）
  window.addEventListener('pointerdown', e => {
    if (!mirrorMode || e.button !== 0) return;
    if (e.target !== renderer.domElement) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (!mirrorMode.p1) {                                  // ①起点（各アイテムの機点・線端点・交点へ吸着）
      let p = drawSnapPoint(e.clientX, e.clientY);
      if (!p) { const t = resolveTarget(e.clientX, e.clientY, null, 0); p = t ? t.point.clone() : null; }
      if (!p) return;
      mirrorMode.p1 = p;
      mirrorMode.previewKey = 'mir:1.000,0.000';
      buildMirrorPreview(reflectMatrixAbout(p, new V3(1, 0, 0)));   // 初期＝X方向へ反転
    } else {                                               // ②方向 → 実行
      const r = mirrorXformFrom(e.clientX, e.clientY);
      if (r) execMirror(r.M);
    }
  }, true);
  window.addEventListener('pointermove', e => {
    if (!mirrorMode) return;
    if (!mirrorMode.p1) {                                  // 起点選択中：吸着候補を緑マーカーで可視化
      clearMirrorGuide();
      const p = drawSnapPoint(e.clientX, e.clientY);
      if (p) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 12, 10),
          new THREE.MeshBasicMaterial({ color: 0x39ff8a, depthTest: false, transparent: true, opacity: 0.95 }));
        dot.position.copy(p); dot.renderOrder = 999;
        mirrorGuide.add(dot);
      }
      return;
    }
    const r = mirrorXformFrom(e.clientX, e.clientY);
    if (r && mirrorMode.previewKey !== r.key) {            // 変換が変わった時だけプレビューを作り直す（45°刻み）
      mirrorMode.previewKey = r.key;
      buildMirrorPreview(r.M);
    }
  }, true);
  window.addEventListener('keydown', e => {
    if (mirrorMode && e.key === 'Escape') { e.stopImmediatePropagation(); endMirrorMode(); }
  }, true);
  // ※右クリックは視点パンに使うため取消には割り当てない（取消＝Esc または 鏡ボタン再押下）

  // ================= 表示：範囲ズーム =================
  function zoomExtents() {
    const targets = selectedParts.size ? [...selectedParts] : placedParts;
    if (!targets.length) { resetView(); return; }
    const box = new THREE.Box3();
    for (const p of targets) box.expandByObject(p);
    if (box.isEmpty()) { resetView(); return; }
    const c = box.getCenter(new V3());
    const r = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.05);
    const fov = camera.fov * Math.PI / 180;
    const dist = r / Math.sin(fov / 2) * 1.15;
    let dir = new V3().subVectors(camera.position, controls.target);
    if (dir.lengthSq() < 1e-9) dir.copy(HOME.pos);
    dir.normalize();
    const endPos = c.clone().add(dir.multiplyScalar(dist));
    const up = useOrtho ? camera.up.clone() : new V3(0, 1, 0);
    flyTo(endPos, c.clone(), up, false);
  }

  // ================= ファイル：保存 / 開く =================
  // 図面仕様・押印の入力欄（id→保存キー）。3D空間で入力し、保存・印刷に反映する。
  const DWG_SPEC_FIELDS = [
    ['dwgLaw', 'law'], ['dwgClass', 'cls'], ['dwgTempD', 'tempD'], ['dwgTempN', 'tempN'],
    ['dwgPresD', 'presD'], ['dwgPresN', 'presN'], ['dwgTestP', 'testP'], ['dwgTestA', 'testA'],
    ['dwgRT', 'rt'], ['dwgPT', 'pt'], ['dwgHeat', 'heat'], ['dwgWash', 'wash'],
    ['dwgPaint', 'paint'], ['dwgInsul', 'insul'],
    ['dwgDesign', 'design'], ['dwgDraw', 'draw'], ['dwgCheck', 'check'], ['dwgApprove', 'approve'],
    ['dwgRev', 'rev'],
  ];
  function gatherSpec() {
    const o = {};
    for (const [id, k] of DWG_SPEC_FIELDS) { const el = $(id); o[k] = el ? el.value : ''; }
    return o;
  }
  function applySpec(s) {
    s = s || {};
    for (const [id, k] of DWG_SPEC_FIELDS) { const el = $(id); if (el) el.value = s[k] || ''; }
  }
  function serialize() {
    return {
      app: '配管3D', version: 1,
      drawing: { date: $('dwgDate').value, place: $('dwgPlace').value, name: $('dwgName').value, no: $('dwgNo').value, spec: gatherSpec() },
      parts: placedParts.map(p => ({
        partType: p.userData.partType,
        spec: specOf(p.userData),
        mat: p.userData.mat || '',
        orient: p.userData.orient || 0,
        roll: p.userData.roll || 0,
        pos: p.position.toArray(),
        quat: p.quaternion.toArray(),
        scale: p.scale.toArray(),
        grip: p.userData.gripLocal ? p.userData.gripLocal.toArray() : null,
        groupId: p.userData.groupId != null ? p.userData.groupId : null,
      })),
      annotations: annStore.map(a => ({ type: a.type, a: a.a.toArray(), b: a.b.toArray(), style: a.style, groupId: a.groupId != null ? a.groupId : null })),
    };
  }
  function save() {
    const data = serialize();
    let nm = ($('dwgNo').value || $('dwgName').value || '配管図').trim() || '配管図';
    nm = nm.replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nm + '.p3d.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  function clearAllParts() {
    for (const p of [...placedParts]) { modelGroup.remove(p); disposeObj(p); }
    placedParts.length = 0;
    selectedParts.clear();
    selectedPart = null;
  }
  function applyData(data) {
    if (!data || !Array.isArray(data.parts)) { alert('配管3Dのファイルではありません。'); return; }
    clearAllParts();
    clearAnnotations();
    for (const rec of data.parts) {
      const field = SPEC_FIELD[rec.partType];
      if (!field) continue;
      const u = { partType: rec.partType }; u[field] = rec.spec;
      const obj = makeSpecPart(u);
      if (!obj) continue;
      if (rec.pos) obj.position.fromArray(rec.pos);
      if (rec.quat) obj.quaternion.fromArray(rec.quat);
      if (rec.scale) obj.scale.fromArray(rec.scale);
      if (rec.grip) obj.userData.gripLocal = new V3().fromArray(rec.grip);
      obj.userData.orient = rec.orient || 0;
      obj.userData.roll = rec.roll || 0;
      if (rec.mat) obj.userData.mat = rec.mat;
      if (rec.groupId != null) obj.userData.groupId = rec.groupId;
      obj.userData.placed = true;
      modelGroup.add(obj);
      placedParts.push(obj);
    }
    const d = data.drawing || {};
    $('dwgDate').value = d.date || ''; $('dwgPlace').value = d.place || '';
    $('dwgName').value = d.name || ''; $('dwgNo').value = d.no || '';
    applySpec(d.spec);
    if (Array.isArray(data.annotations)) {
      for (const a of data.annotations) { addAnnotation(a.type, new V3().fromArray(a.a), new V3().fromArray(a.b), a.style); if (a.groupId != null) annStore[annStore.length - 1].groupId = a.groupId; }
    }
    let maxG = 0;
    for (const p of placedParts) if (p.userData.groupId > maxG) maxG = p.userData.groupId;
    for (const a of annStore) if (a.groupId > maxG) maxG = a.groupId;
    if (window.__bumpGroupSeq) window.__bumpGroupSeq(maxG);
    selectPart(null); refreshItemList();
  }
  // ===== アンドゥ／リドゥ（状態スナップショット方式：serialize/applyData を流用） =====
  let _hist = [], _hi = -1, _histSuppress = false, _histTimer = null;
  function _snap() { try { return JSON.stringify(serialize()); } catch (e) { return null; } }
  function updateUndoButtons() {
    const u = document.getElementById('cmdUndo'), r = document.getElementById('cmdRedo');
    if (u) u.classList.toggle('rb-dis', _hi <= 0);
    if (r) r.classList.toggle('rb-dis', _hi >= _hist.length - 1);
  }
  function recordHistory() {
    if (_histSuppress) return;
    const s = _snap();
    if (s == null) return;                        // まだ初期化途中などで取得不可なら見送る
    if (_hi >= 0 && s === _hist[_hi]) return;     // 変化なしは記録しない
    _hist = _hist.slice(0, _hi + 1);              // リドゥ側を切り捨て
    _hist.push(s); _hi = _hist.length - 1;
    if (_hist.length > 80) { _hist.shift(); _hi--; }   // 上限
    updateUndoButtons();
  }
  function scheduleHistory() { if (_histTimer) clearTimeout(_histTimer); _histTimer = setTimeout(() => { _histTimer = null; recordHistory(); }, 140); }
  function _applyHist(s) { _histSuppress = true; try { applyData(JSON.parse(s)); } finally { _histSuppress = false; } updateUndoButtons(); }
  function undo() {
    if (_histTimer) { clearTimeout(_histTimer); _histTimer = null; recordHistory(); }   // 保留中の変更を確定してから
    if (_hi <= 0) return;
    _hi--; _applyHist(_hist[_hi]);
  }
  function redo() { if (_hi >= _hist.length - 1) return; _hi++; _applyHist(_hist[_hi]); }
  function resetHistory() { _hist = []; _hi = -1; recordHistory(); }
  window.__scheduleHistory = scheduleHistory;
  window.__recordHistory = recordHistory;
  window.__undo = undo; window.__redo = redo; window.__resetHistory = resetHistory;
  setTimeout(() => { try { recordHistory(); } catch (e) {} }, 0);   // 初期状態を基準として記録（初期化完了後に実行）
  function load() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { applyData(JSON.parse(r.result)); resetHistory(); } catch (err) { alert('読込に失敗しました：' + err.message); } };
      r.readAsText(f);
    };
    inp.click();
  }

  // ================= ファイル：画像 / 印刷 =================
  function snapshot() {
    // 一度フルフレームで描画してからキャプチャ（ギズモのscissorが混ざらないように）
    renderer.setViewport(0, 0, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.render(scene, activeCam());
    return renderer.domElement.toDataURL('image/png');
  }
  // 印刷用の線画マテリアル（白地に黒い輪郭線・陰影なし・隠線は消える）
  let _printFillMat = null, _printEdgeMat = null;
  function _printMats() {
    if (!_printFillMat) {
      _printFillMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      _printEdgeMat = new THREE.LineBasicMaterial({ color: 0x111111 });
    }
    return { fill: _printFillMat, edge: _printEdgeMat };
  }
  // 印刷用：白背景・グリッド非表示・線画化して撮る（参考の手書き図面に寄せる）
  function snapshotForPrint() {
    const prevBg = scene.background;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevGrid = grid ? grid.visible : null;
    scene.background = new THREE.Color(0xffffff);
    renderer.setClearColor(0xffffff, 1);
    if (grid) grid.visible = false;

    // 各部品メッシュ：陰影なしの淡い面に差し替え＋黒い稜線(EdgesGeometry)を重ねる。
    const { fill, edge } = _printMats();
    const matBackup = [];   // [mesh, 元material]
    const overlays = [];    // [mesh, lineSegments, edgesGeometry]
    for (const p of placedParts) {
      p.traverse(o => {
        if (o.isMesh && o.geometry) {
          matBackup.push([o, o.material]);
          o.material = fill;
          try {
            const eg = new THREE.EdgesGeometry(o.geometry, 24);   // 24°超の稜線のみ＝清書きの輪郭
            const ls = new THREE.LineSegments(eg, edge);
            ls.renderOrder = 2;
            o.add(ls);
            overlays.push([o, ls, eg]);
          } catch (e) { /* geometry によっては失敗：面だけで続行 */ }
        }
      });
    }

    renderer.setViewport(0, 0, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.render(scene, activeCam());
    const url = renderer.domElement.toDataURL('image/png');

    // 後始末：稜線を外して元のマテリアルへ戻す
    for (const [o, ls, eg] of overlays) { o.remove(ls); eg.dispose(); }
    for (const [o, m] of matBackup) o.material = m;
    scene.background = prevBg;
    renderer.setClearColor(prevClear, prevAlpha);
    if (grid) grid.visible = prevGrid;
    renderer.clear();
    renderer.render(scene, activeCam());
    return url;
  }
  function exportPng() {
    const url = snapshot();
    let nm = ($('dwgNo').value || '配管図').trim().replace(/[\\/:*?"<>|]/g, '_') || '配管図';
    const a = document.createElement('a'); a.href = url; a.download = nm + '.png'; a.click();
  }
  // 配置部品を同仕様でまとめ、部品表の行データを返す（アイテムリストと同じ集計）
  function partsRows() {
    const byKey = new Map(), groups = [];
    let seq = 0;
    for (const p of placedParts) {
      const c = partColumns(p);
      const mat = (p.userData && p.userData.mat) || '';
      const key = `${c.kind}|${c.type}|${c.size}|${c.cls}|${mat}`;
      let g = byKey.get(key);
      if (!g) { g = { c, mat, qty: 0, rank: partTypeRank(p), seq: seq++ }; byKey.set(key, g); groups.push(g); }
      g.qty++;
    }
    groups.sort((a, b) => (a.rank - b.rank) || (a.seq - b.seq));
    return groups.map((g, i) => ({ no: i + 1, kind: g.c.kind, type: g.c.type, size: g.c.size, cls: g.c.cls, mat: g.mat, qty: g.qty }));
  }
  function esc(s) { return String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  const PRINT_COMPANY = '志基テクノ株式会社';
  // 現在のビューでの「北（-Z）」が画面上どちらを向くか（度）。方位記号の回転に使う。
  function northScreenAngleDeg() {
    try {
      const cam = activeCam(); cam.updateMatrixWorld();
      const base = (typeof controls !== 'undefined' && controls.target) ? controls.target.clone() : new V3(0, 0, 0);
      const o = base.clone().project(cam);
      const n = base.clone().add(new V3(0, 0, -1)).project(cam);
      const dx = n.x - o.x, dy = n.y - o.y;
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return 0;
      return Math.atan2(dx, dy) * 180 / Math.PI;   // SVG回転角（上向き基準・時計回り）
    } catch (e) { return 0; }
  }
  function printSheet() {
    const img = snapshotForPrint();   // 白地・グリッドなしの線画
    const nAng = northScreenAngleDeg();
    const no = esc($('dwgNo').value), name = esc($('dwgName').value);
    // 方位記号(P.N)以外の枠図（外枠・区域記号・部品表・仕様条件表・押印・備考・表題欄）は廃止。図面＋方位のみ。
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>配管図 ${no || name || ''}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{height:100%;background:#fff;}
  body{font-family:"Meiryo","Hiragino Kaku Gothic ProN",sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .pg{position:relative;width:100%;height:100%;overflow:hidden;background:#fff;}
  .pg>img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;}
  .north{position:absolute;left:8mm;top:6mm;width:21mm;height:27mm;}
  .north .pn{font-size:3.4mm;font-weight:700;}
  @media print{@page{size:A3 landscape;margin:8mm;}}
</style></head><body>
  <div class="pg">
    <img src="${img}">
    <svg class="north" viewBox="0 0 64 84">
      <text class="pn" x="32" y="10" text-anchor="middle">P.N</text>
      <g transform="rotate(${nAng.toFixed(1)} 32 46)">
        <!-- 3Dコンパスローズ：二重リング＋4方位の星（各点を明/暗に割って立体感）。北の針を長く -->
        <circle cx="32" cy="46" r="29" fill="none" stroke="#111" stroke-width="0.6"/>
        <circle cx="32" cy="46" r="24.5" fill="none" stroke="#111" stroke-width="0.3"/>
        <g stroke="#111" stroke-width="0.4" stroke-linejoin="round">
          <polygon points="32,12 25,39 32,46" fill="#dcdcdc"/>
          <polygon points="32,12 39,39 32,46" fill="#1b1b1b"/>
          <polygon points="61,46 39,39 32,46" fill="#dcdcdc"/>
          <polygon points="61,46 39,53 32,46" fill="#1b1b1b"/>
          <polygon points="32,77 39,53 32,46" fill="#dcdcdc"/>
          <polygon points="32,77 25,53 32,46" fill="#1b1b1b"/>
          <polygon points="3,46 25,53 32,46" fill="#dcdcdc"/>
          <polygon points="3,46 25,39 32,46" fill="#1b1b1b"/>
        </g>
        <circle cx="32" cy="46" r="2.4" fill="#111"/>
      </g>
    </svg>
  </div>
</body></html>`;
    printViaFrame(html);
  }
  // ポップアップを使わず非表示iframeで印刷（PC・iPad Safari どちらでもブロックされにくい）
  function printViaFrame(html) {
    let ifr = document.getElementById('__printFrame');
    if (ifr && ifr.parentNode) ifr.parentNode.removeChild(ifr);
    ifr = document.createElement('iframe');
    ifr.id = '__printFrame';
    ifr.setAttribute('aria-hidden', 'true');
    ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;';
    document.body.appendChild(ifr);
    const idoc = ifr.contentWindow.document;
    idoc.open(); idoc.write(html); idoc.close();
    let done = false;
    const go = () => {
      if (done) return; done = true;
      try { ifr.contentWindow.focus(); ifr.contentWindow.print(); }
      catch (e) { alert('印刷の起動に失敗しました：' + (e && e.message || e)); }
    };
    ifr.onload = () => setTimeout(go, 250);
    setTimeout(go, 900);   // onload が発火しない環境の保険
  }

  // ===================================================================
  //  描画：線分 / 構築線（レーザー）/ 寸法線
  // ===================================================================
  const annGroup = new THREE.Group();
  modelGroup.add(annGroup);
  const annStore = [];   // {type,a,b,obj}
  const COL = { line: 0x7fd1ff, xline: 0xff6bd0, dim: 0xffd24a };
  const XLINE_COLOR = 0xff6a00;   // 構築線の色＝オレンジ。ダーク／ホワイト両モードで同一・視認性重視（線種・色の選択は無し）

  // ---- 線分の書式（色・線種・太さ）。右クリックメニューで編集する ----
  // 線種パターンは「描く長さ, 空ける長さ, …」をワールド長(m)で表す（偶数番＝描く区間）
  const LTYPES = {
    solid:      { name: '実線',     pat: null },
    dashed:     { name: '破線',     pat: [0.030, 0.018] },
    dotted:     { name: '点線',     pat: [0.005, 0.013] },
    dashdot:    { name: '一点鎖線', pat: [0.034, 0.013, 0.005, 0.013] },
    dashdotdot: { name: '二点鎖線', pat: [0.034, 0.012, 0.005, 0.012, 0.005, 0.012] },
  };
  // 線の角度スナップ刻みは45°固定（設定不要）。太さは極細固定。
  const angleStep = 45;
  // 線種ごとの固定色（色は線種で決まるので色選択は不要）：実線=白・破線=黒・点線=青・一点鎖線=赤
  const LTYPE_COLOR = { solid: 0xffffff, dashed: 0x000000, dotted: 0x4a9bff, dashdot: 0xff5a5a, dashdotdot: 0x000000 };
  function ltypeColor(lt) { return LTYPE_COLOR[lt] != null ? LTYPE_COLOR[lt] : 0xffffff; }
  const MENU_LTYPES = ['solid', 'dashed', 'dotted', 'dashdot'];   // メニューに出す線種（選ぶだけ）
  function defaultStyle(type) {
    const ltype = (type === 'xline') ? 'dashed' : (type === 'dim') ? 'solid' : 'dashdot';   // 線分・円の既定＝一点鎖線（赤）
    const color = (type === 'xline') ? XLINE_COLOR : ltypeColor(ltype);   // 構築線はレーザー色固定
    return { color, ltype, width: 0.0006 };   // 太さ＝極細固定・色＝線種で決定
  }
  // 描画ツールごとの既定書式（リボンのアイコン右クリックで設定）。新規に引く線はこれを継承。
  const toolStyle = { line: defaultStyle('line'), xline: defaultStyle('xline'), dim: defaultStyle('dim'), circle: defaultStyle('circle') };
  // 寸法の現在の種別（リボン「寸法」右クリックで選択）。平行=現行の2点間距離。
  //   parallel=平行／angle=角度／radius=半径／diameter=直径／leader=引出。操作の基本仕様は全種別とも平行と同じ。
  let dimKind = 'parallel';
  const DIM_KIND_LABEL = { parallel: '平行', angle: '角度', radius: '半径', diameter: '直径', leader: '引出' };
  // 文字の既定書式（リボン「文字」右クリックで設定）。色＝シアン／飾り＝枠なし
  const textOpts = { color: 0x00ffff, deco: 'none' };   // deco: none/box/underline/double
  function styleFor(type) {
    const s = toolStyle[type] || defaultStyle(type);
    const out = { color: s.color, ltype: s.ltype, width: s.width };
    if (type === 'dim') out.dimKind = dimKind;   // 描画中の寸法に現在の種別を載せる
    return out;
  }
  function hexCss(h) { return '#' + ('000000' + (h >>> 0).toString(16)).slice(-6); }

  // 線分を「太さのある円柱」で描く（WebGLは線の太さを無視するため実体ジオメトリで表現）
  function cylSeg(p0, p1, radius, mat) {
    const len = p0.distanceTo(p1);
    if (len < 1e-6) return null;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8, 1, true), mat);
    m.position.copy(p0).add(p1).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new V3(0, 1, 0), p1.clone().sub(p0).normalize());
    m.renderOrder = 998;
    return m;
  }
  // 線種パターンに沿って「描く区間」の配列 [[p0,p1],…] を返す（solidは全長1本）
  function dashPieces(a, b, pat) {
    const total = a.distanceTo(b);
    if (!pat || total < 1e-6) return [[a, b]];
    const dir = b.clone().sub(a).normalize();
    const pieces = []; let d = 0, i = 0, guard = 0;
    while (d < total - 1e-9 && guard++ < 5000) {
      const seg = pat[i % pat.length];
      if (seg <= 0) break;
      const d2 = Math.min(d + seg, total);
      if (i % 2 === 0) pieces.push([a.clone().addScaledVector(dir, d), a.clone().addScaledVector(dir, d2)]);
      d = d2; i++;
    }
    return pieces;
  }
  // 太さ・線種付きの直線（円柱の集合）。1マテリアルを共有して色を一括管理。
  function styledSeg(a, b, style) {
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: style.color, depthTest: false, transparent: true, opacity: 0.98 });
    const pat = (LTYPES[style.ltype] || LTYPES.solid).pat;
    for (const [p0, p1] of dashPieces(a, b, pat)) {
      const m = cylSeg(p0, p1, style.width, mat); if (m) grp.add(m);
    }
    return grp;
  }
  function endDot(p, color, r) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(r, 0.0014), 12, 8),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
    m.position.copy(p); m.renderOrder = 999; return m;
  }
  // 構築線はレーザー（光の線）一種類で描く：赤い光暈＋白く光る芯を加算合成で発光させる。
  // 色・線種の選択は無し（style は無視）。長尺だが円柱3本だけなので軽い。
  function laserTube(A, B, radius, color, opacity, solid) {
    const len = A.distanceTo(B);
    // 白モードは加算合成だと色が白く飛ぶので通常合成＋不透明寄りにして本来の色を保つ（寸法線=黄のまま）。
    // solid=true（構築線）はモードに依らず常に通常合成・同一不透明度＝ダーク／ホワイトで同じ色・同じ見え方。
    const light = (typeof lightMode !== 'undefined') && lightMode;
    const useNormal = solid || light;
    const op = (light && !solid) ? Math.min(1, opacity * 1.8) : opacity;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthTest: false, blending: useNormal ? THREE.NormalBlending : THREE.AdditiveBlending });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8, 1, true), mat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize());
    m.userData.baseColor = color;   // 選択解除時にこの色へ戻す（paintAnnが参照）
    m.renderOrder = 998;
    return m;
  }
  function xlineSeg(A, B, style) {
    const grp = new THREE.Group();
    // 構築線＝両モード共通色。solid=true で加算合成を使わず、ダーク／ホワイトで同じ見え方にする。
    grp.add(laserTube(A, B, 0.0016, XLINE_COLOR, 0.22, true));   // 外側のにじみ
    grp.add(laserTube(A, B, 0.0007, XLINE_COLOR, 0.5, true));    // 中間
    grp.add(laserTube(A, B, 0.00032, XLINE_COLOR, 1.0, true));   // 芯（同色・不透明）
    return grp;
  }
  // 文字スプライト（寸法値）。カメラへ正対し、3D空間に置く。
  function labelSprite(text, color) {
    const fs = 44, pad = 10;
    const meas = document.createElement('canvas').getContext('2d');
    meas.font = `bold ${fs}px Meiryo, sans-serif`;
    const tw = Math.ceil(meas.measureText(text).width);
    const cv = document.createElement('canvas');
    cv.width = tw + pad * 2; cv.height = fs + pad * 2;
    const c = cv.getContext('2d');
    c.font = `bold ${fs}px Meiryo, sans-serif`;
    c.fillStyle = 'rgba(18,26,48,.86)';
    c.fillRect(0, 0, cv.width, cv.height);
    c.strokeStyle = '#3a4a6e'; c.lineWidth = 2; c.strokeRect(1, 1, cv.width - 2, cv.height - 2);
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, cv.width / 2, cv.height / 2 + 2);
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const s = 0.0011;
    sp.scale.set(cv.width * s, cv.height * s, 1);
    sp.renderOrder = 1000;
    return sp;
  }
  // ---- 寸法線専用：文字と線の色 ----
  const DIM_YELLOW = 0xffee00;        // 補助線・寸法線本体・矢印＝明るい黄色
  const DIM_TEXT_CSS = '#ff4040';     // 寸法文字＝赤
  // 寸法文字：枠・背景なしの赤文字スプライト。常にカメラ正対なので裏表・潰れが起きない。
  // 向きと位置は毎フレーム __updateDimTextFacing が画面投影に合わせて調整する
  // （画面上で寸法線と平行に回転し、画面で見て線の「上側」に出る）。
  function dimTextSprite(text, A2, B2, vUp, opt) {
    let col = (opt && opt.color != null) ? opt.color : DIM_TEXT_CSS;   // 文字色（既定＝寸法の赤）
    if (typeof col === 'number') col = '#' + ('000000' + (col >>> 0).toString(16)).slice(-6);
    const deco = (opt && opt.deco) || 'none';                    // none / box / underline / double
    const fs = 44, pad = (deco === 'box') ? 9 : 6;
    const extra = deco === 'double' ? 9 : (deco === 'underline' ? 5 : 0);   // 下線ぶんの下余白
    const meas = document.createElement('canvas').getContext('2d');
    meas.font = `bold ${fs}px Meiryo, sans-serif`;
    const tw = Math.ceil(meas.measureText(text).width);
    const cv = document.createElement('canvas');
    cv.width = tw + pad * 2; cv.height = fs + pad * 2 + extra;
    const c = cv.getContext('2d');
    c.font = `bold ${fs}px Meiryo, sans-serif`;
    if (deco === 'box') { c.strokeStyle = col; c.lineWidth = 3; c.strokeRect(1.5, 1.5, cv.width - 3, cv.height - 3); }
    c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, cv.width / 2, pad + fs / 2 + 2);
    if (deco === 'underline' || deco === 'double') {
      const yb = pad + fs + 2; c.strokeStyle = col; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(pad, yb); c.lineTo(cv.width - pad, yb); c.stroke();
      if (deco === 'double') { c.beginPath(); c.moveTo(pad, yb + 5); c.lineTo(cv.width - pad, yb + 5); c.stroke(); }
    }
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter;
    const s = 0.0011;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(cv.width * s, cv.height * s, 1);
    sp.userData.dimText = { a: A2.clone(), b: B2.clone(), vUp: vUp.clone(), h: cv.height * s };
    sp.position.copy(A2.clone().add(B2).multiplyScalar(0.5)).addScaledVector(vUp, (cv.height * s) / 2 + 0.004);
    sp.renderOrder = 1000;
    return sp;
  }
  // 毎フレーム：寸法文字を「画面上で寸法線と平行・線の上側」に合わせる（常に読める向き）
  window.__updateDimTextFacing = () => {
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const scr = p => { const n = modelGroup.localToWorld(p.clone()).project(cam); return { x: (n.x * 0.5 + 0.5) * rect.width, y: (-n.y * 0.5 + 0.5) * rect.height }; };
    for (const rec of annStore) {
      if (rec.type !== 'dim') continue;
      const isText = rec.style && rec.style.dimKind === 'text';
      rec.obj.traverse(o => {
        const dt = o.userData.dimText;
        if (!dt || !o.material) return;
        if (isText) {                                        // 文字：配置点に置き、style.textRot で画面内回転（正立は0°）
          o.material.rotation = (rec.style.textRot || 0) * Math.PI / 180;
          const pm = scr(dt.a), pu = scr(dt.a.clone().addScaledVector(dt.vUp, 0.01));
          const s = (pu.y <= pm.y) ? 1 : -1;
          o.position.copy(dt.a).addScaledVector(dt.vUp, s * (dt.h / 2 + 0.004));
          return;
        }
        const pa = scr(dt.a), pb = scr(dt.b);
        let ang = Math.atan2(-(pb.y - pa.y), pb.x - pa.x);   // 画面上の寸法線の向き
        if (ang > Math.PI / 2) ang -= Math.PI;               // 上下逆さにならない範囲（±90°）へ折返し
        else if (ang < -Math.PI / 2) ang += Math.PI;
        o.material.rotation = ang;
        const mid = dt.a.clone().add(dt.b).multiplyScalar(0.5);
        const pm = scr(mid), pu = scr(mid.clone().addScaledVector(dt.vUp, 0.01));
        const sgn = (pu.y <= pm.y) ? 1 : -1;                 // 画面で見て上側へ
        o.position.copy(mid).addScaledVector(dt.vUp, sgn * (dt.h / 2 + 0.004));
      });
    }
  };
  // 円/楕円の半径(rx=X半径, rz=Z半径)。style.rx/rz があればそれ、無ければ中心→bの水平距離（真円）。
  function circleRadii(style, a, b) {
    const rx = (style && style.rx != null) ? style.rx : Math.hypot(b.x - a.x, b.z - a.z);
    const rz = (style && style.rz != null) ? style.rz : rx;
    return { rx, rz };
  }
  // 円/楕円の向き（中心まわりの回転）。style.quat={x,y,z,w} があればそれ、無ければ水平（恒等）。
  function quatFromStyle(style) {
    const c = style && style.quat;
    return c ? new THREE.Quaternion(c.x, c.y, c.z, c.w) : new THREE.Quaternion();
  }
  // 折れ線(pts)を線種パターン(pat:ワールド長[描く,空ける,…]／null=実線)に沿って太さ付きで描く。曲線=細分済の点列で渡す。
  function dashPolyline(pts, pat, width, mat, grp) {
    if (!pat || pts.length < 2) { for (let i = 0; i < pts.length - 1; i++) { const m = cylSeg(pts[i], pts[i + 1], width, mat); if (m) grp.add(m); } return; }
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + pts[i].distanceTo(pts[i - 1]);
    const L = cum[cum.length - 1]; if (L < 1e-9) return;
    const pointAt = s => { if (s <= 0) return pts[0].clone(); if (s >= L) return pts[pts.length - 1].clone(); let i = 1; while (cum[i] < s) i++; const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1]); return pts[i - 1].clone().lerp(pts[i], t); };
    let s = 0, k = 0, guard = 0;
    while (s < L - 1e-9 && guard++ < 20000) {
      const seg = pat[k % pat.length]; const s2 = Math.min(s + seg, L);
      if (k % 2 === 0 && seg > 0) {                      // 描く区間：頂点で分割して曲率を保つ
        let a = pointAt(s), i = 1; while (i < pts.length && cum[i] <= s) i++;
        while (i < pts.length && cum[i] < s2) { const m = cylSeg(a, pts[i], width, mat); if (m) grp.add(m); a = pts[i]; i++; }
        const m = cylSeg(a, pointAt(s2), width, mat); if (m) grp.add(m);
      }
      s = s2; k++;
    }
  }
  // 寸法の実測表示文字（上書きが無いときに出る値）。種別ごと：平行=数値／半径=R＋値／直径=φ＋値／角度=度／引出=注記
  function dimMeasuredStr(a, b, style) {
    const kind = (style && style.dimKind) || 'parallel';
    const mm = Math.round(a.distanceTo(b) * 1000);
    if (kind === 'angle') {
      const V = a, P1 = b, P2 = (style && style.angP2) ? new V3(style.angP2[0], style.angP2[1], style.angP2[2]) : b;
      const d1 = P1.clone().sub(V), d2 = P2.clone().sub(V);
      let deg = (d1.lengthSq() > 1e-12 && d2.lengthSq() > 1e-12) ? d1.angleTo(d2) * 180 / Math.PI : 0;
      if (style && style.angReflex) deg = 360 - deg;
      return deg.toFixed(1) + '°';
    }
    if (kind === 'radius') return 'R' + mm;
    if (kind === 'diameter') return 'φ' + mm;
    if (kind === 'leader' || kind === 'text') return '';   // 引出・文字は既定文字なし（入力した文字だけ表示）
    return String(mm);
  }
  // 角度寸法の幾何（頂点V・両方向の単位ベクトル・円弧半径R・円弧点列）を返す。buildAnn と当たり判定で共用。
  function angleArcGeom(a, b, style, N) {
    const V = a.clone(), P1 = b.clone(), P2 = (style && style.angP2) ? new V3(style.angP2[0], style.angP2[1], style.angP2[2]) : b.clone();
    let d1 = P1.clone().sub(V), d2 = P2.clone().sub(V);
    const l1 = d1.length(), l2 = d2.length();
    if (l1 > 1e-9) d1.multiplyScalar(1 / l1); else d1.set(1, 0, 0);
    if (l2 > 1e-9) d2.multiplyScalar(1 / l2); else d2.set(0, 0, 1);
    const R = (style && style.arcR != null) ? style.arcR : Math.min(l1, l2) * 0.6;
    let nrm = d1.clone().cross(d2);
    if (nrm.lengthSq() < 1e-9) { nrm = d1.clone().cross(new V3(0, 1, 0)); if (nrm.lengthSq() < 1e-9) nrm = d1.clone().cross(new V3(1, 0, 0)); }
    nrm.normalize();
    const ang0 = Math.acos(Math.max(-1, Math.min(1, d1.dot(d2))));
    const sweep = (style && style.angReflex) ? (2 * Math.PI - ang0) : ang0;
    const sgn = (style && style.angReflex) ? -1 : 1;
    N = N || Math.max(10, Math.round(sweep / (Math.PI / 90)));
    const arc = [];
    for (let i = 0; i <= N; i++) { const q = new THREE.Quaternion().setFromAxisAngle(nrm, sgn * sweep * (i / N)); arc.push(V.clone().addScaledVector(d1.clone().applyQuaternion(q), R)); }
    return { V, d1, d2, l1, l2, R, arc, N };
  }
  function buildAnn(type, a, b, style) {
    style = style || styleFor(type);
    const grp = new THREE.Group();
    const col = style.color;
    if (type === 'xline') {
      let dir = new V3().subVectors(b, a);
      if (dir.lengthSq() < 1e-9) dir.set(1, 0, 0);
      dir.normalize();
      const L = 12;
      grp.add(xlineSeg(a.clone().addScaledVector(dir, -L), a.clone().addScaledVector(dir, L), style));
    } else if (type === 'dim') {
      // 寸法線：a/b＝測定した2つの起点。style.dimOff/dimDir があれば逃げた位置に寸法線を引き、
      // 起点から補助線（寸法線の2mm先まで）を伸ばす。style.dimSkew(°)があれば補助線を斜めに倒す
      // （スライド寸法）。寸法値は常に起点間距離。
      const kind = style.dimKind || 'parallel';
      const isLeader = kind === 'leader';
      const isText = kind === 'text';
      // 表示する値：任意の値（style.dimText）があれば最優先（引出の注記入力もこれで上書き）、無ければ種別ごとの実測
      const shown = String((style.dimText != null && style.dimText !== '') ? style.dimText : dimMeasuredStr(a, b, style));
      // 寸法線本体（アイテムと並行の線）の両端の矢印：先端が tip、羽根は toward（内側）を向く
      const mkArrow = (tip, toward) => {
        const dir = toward.clone().sub(tip);
        if (dir.lengthSq() < 1e-12) return;
        dir.normalize();
        const len = 0.008, rad = 0.0026;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(rad, len, 10),
          new THREE.MeshBasicMaterial({ color: DIM_YELLOW, depthTest: false, transparent: true, opacity: 0.95 }));
        cone.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.clone().negate());   // 円錐の頂点を tip 側へ
        cone.position.copy(tip.clone().addScaledVector(dir, len / 2));
        cone.userData.baseColor = DIM_YELLOW;
        cone.renderOrder = 998;
        grp.add(cone);
      };
      // 補助線・寸法線本体＝発光する黄色（レーザー調：光暈＋明るい芯）
      const glowSeg = (p0, p1) => {
        const g = new THREE.Group();
        g.add(laserTube(p0, p1, 0.0008, DIM_YELLOW, 0.18));   // 光暈（細め）
        g.add(laserTube(p0, p1, 0.00026, 0xfff6a8, 0.95));    // 芯（極細）
        return g;
      };
      if (isText) {
        // 文字：a=配置点。線は引かず、点aに常に正立した文字だけを置く（空なら何も描かない）。色・飾りはstyle。
        if (shown !== '') grp.add(dimTextSprite(shown, a, a.clone(), new V3(0, 1, 0), { color: style.textColor, deco: style.textDeco }));
      } else if (isLeader) {
        // 引出線：a=矢印先端（指す点）／b=肘(knee)。bから水平に棚（横線）を自動で伸ばし、その上に注記文字を置く。
        grp.add(glowSeg(a, b));            // 斜めの引出線
        mkArrow(a, b);                      // 先端aに矢印（bからaを向く）
        // 棚の向き＝肘の水平変位の向きへ自動。水平成分がほぼ無い（ほぼ真上）時は画面の横方向(カメラ右)を水平化して使う
        let h = new V3(b.x - a.x, 0, b.z - a.z);
        if (h.lengthSq() < 1e-6) {
          const cr = new V3().setFromMatrixColumn(activeCam().matrixWorld, 0); cr.y = 0;
          h = (cr.lengthSq() > 1e-9) ? cr : new V3(1, 0, 0);
        }
        h.normalize();
        const sp = (shown !== '') ? dimTextSprite(shown, b, b.clone().add(h), new V3(0, 1, 0)) : null;   // 文字（空なら作らない）
        const w = Math.max(sp ? sp.scale.x : 0, 0.04);   // 棚の長さ＝文字幅（空でも最小幅で表示）
        const shelfEnd = b.clone().addScaledVector(h, w);
        grp.add(glowSeg(b, shelfEnd));     // 水平棚（文字の下線）
        if (sp) {
          const dt = sp.userData.dimText; dt.a.copy(b); dt.b.copy(shelfEnd);   // 文字を棚に沿わせ中央上に
          sp.position.copy(b.clone().add(shelfEnd).multiplyScalar(0.5)).addScaledVector(new V3(0, 1, 0), dt.h / 2 + 0.004);
          grp.add(sp);
        }
      } else if (kind === 'angle') {
        // 角度寸法：a=頂点V／b=P1／style.angP2=P2。Vから両方向へ補助線を出し、半径 arcR の円弧＋矢印＋度数を描く。
        const g = angleArcGeom(a, b, style);
        const V = g.V, d1 = g.d1, d2 = g.d2, R = g.R, arc = g.arc, N = g.N;
        // 補助線：対象直線と重なる区間(頂点〜直線の到達距離 angReach)は描かず、その外側〜円弧の少し外だけ描く
        const reach = style.angReach || [0, 0];
        const ext = (dir, rch) => { const s = Math.max(rch || 0, 0), e = R * 1.08; if (e > s + 1e-4) grp.add(glowSeg(V.clone().addScaledVector(dir, s), V.clone().addScaledVector(dir, e))); };
        ext(d1, reach[0]); ext(d2, reach[1]);
        for (let i = 0; i < N; i++) grp.add(glowSeg(arc[i], arc[i + 1]));   // 円弧本体
        mkArrow(arc[0], arc[1]); mkArrow(arc[N], arc[N - 1]);               // 円弧両端に矢印
        const mid = arc[Math.floor(N / 2)];
        const outward = mid.clone().sub(V); if (outward.lengthSq() > 1e-9) outward.normalize(); else outward.set(0, 1, 0);
        const tan = arc[Math.min(N, Math.floor(N / 2) + 1)].clone().sub(arc[Math.max(0, Math.floor(N / 2) - 1)]);
        if (tan.lengthSq() > 1e-9) tan.normalize(); else tan.copy(d1);
        const Tp = mid.clone().addScaledVector(outward, 0.006);
        grp.add(dimTextSprite(shown, Tp.clone().addScaledVector(tan, -0.004), Tp.clone().addScaledVector(tan, 0.004), outward));
      } else if (kind === 'radius' || kind === 'diameter') {
        // 円/楕円の半径(R)・直径(φ)。radius: a=中心,b=縁／diameter: a,b=中心を通る両縁。
        // style.dimLead＝中心から値までの距離。縁より外なら補助線(リーダー)を縁から値まで伸ばす。
        const C = (kind === 'radius') ? a.clone() : a.clone().add(b).multiplyScalar(0.5);
        const E = b.clone();
        const dir = E.clone().sub(C); const Rdir = dir.length();
        if (Rdir > 1e-9) dir.multiplyScalar(1 / Rdir); else dir.set(1, 0, 0);
        const lead = (style.dimLead != null) ? style.dimLead : Rdir * 0.55;
        const P = C.clone().addScaledVector(dir, lead);          // 値の位置（中心から dir 方向に lead）
        if (kind === 'radius') { grp.add(glowSeg(C, E)); mkArrow(E, C); }            // 中心→縁＋縁に外向き矢印
        else { grp.add(glowSeg(a, b)); mkArrow(a, b); mkArrow(b, a); }                // 両縁＋両端矢印
        if (lead > Rdir + 1e-6) grp.add(glowSeg(E, P));          // 外側＝縁から値まで補助線（リーダー）を伸ばす
        let vUp = new V3(0, 1, 0).addScaledVector(dir, -dir.y);
        if (vUp.lengthSq() < 1e-6) vUp.set(-dir.z, 0, dir.x);
        if (vUp.lengthSq() < 1e-6) vUp.set(1, 0, 0);
        vUp.normalize();
        const eps = 0.004;
        grp.add(dimTextSprite(shown, P.clone().addScaledVector(dir, -eps), P.clone().addScaledVector(dir, eps), vUp));
      } else {
      const ends = dimLineEnds(a, b, style);
      if (ends) {
        const A2 = ends.A2, B2 = ends.B2;
        const e1 = A2.clone().sub(a).normalize().multiplyScalar(0.002);
        const e2 = B2.clone().sub(b).normalize().multiplyScalar(0.002);
        grp.add(glowSeg(a, A2.clone().add(e1)));             // 補助線（起点1）
        grp.add(glowSeg(b, B2.clone().add(e2)));             // 補助線（起点2）
        grp.add(glowSeg(A2, B2));                            // 寸法線本体（矢印の付く線）
        mkArrow(A2, B2); if (!isLeader) mkArrow(B2, A2);     // 両端の矢印（引出は指す側=A2のみ）
        const dd2 = style.dimDir;
        const vUp = new V3(dd2.x, dd2.y, dd2.z).multiplyScalar((style.dimOff || 0) >= 0 ? 1 : -1).normalize();
        grp.add(dimTextSprite(shown, A2, B2, vUp));
      } else {
        grp.add(glowSeg(a, b));
        mkArrow(a, b); if (!isLeader) mkArrow(b, a);          // 直書きでも両端に矢印（引出は片側のみ）
        const uN = b.clone().sub(a);
        if (uN.lengthSq() > 1e-12) uN.normalize(); else uN.set(1, 0, 0);
        let vUp = new V3(0, 1, 0).addScaledVector(uN, -uN.y);   // uに直交する上向き
        if (vUp.lengthSq() < 1e-6) vUp.set(-uN.z, 0, uN.x);     // 垂直線はクロス水平方向
        if (vUp.lengthSq() < 1e-6) vUp.set(1, 0, 0);
        vUp.normalize();
        grp.add(dimTextSprite(shown, a, b, vUp));
      }
      }
    } else if (type === 'circle') {
      // 円/楕円：a=中心。半径(rx=X半径, rz=Z半径)＋向き(quat)で配置。真円は rx=rz・既定は水平。
      // 線種・色は線分と同じ書式（style.ltype/color）に従う。
      const { rx, rz } = circleRadii(style, a, b);
      const q = quatFromStyle(style);
      const mat = new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.98 });
      const N = 160, pts = [];
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * Math.PI * 2;
        pts.push(a.clone().add(new V3(Math.cos(t) * rx, 0, Math.sin(t) * rz).applyQuaternion(q)));
      }
      dashPolyline(pts, (LTYPES[style.ltype] || LTYPES.solid).pat, style.width || 0.0006, mat, grp);
    } else {
      grp.add(styledSeg(a, b, style));
    }
    grp.userData.annType = type;
    return grp;
  }
  // 寸法線本体の両端（逃げ dimOff/dimDir ＋ スライド dimSkew 込み）。逃げ無しなら null
  function dimLineEnds(a, b, style) {
    const off = (style && style.dimOff) || 0;
    const dd = style && style.dimDir;
    if (!off || !dd) return null;
    const dv = new V3(dd.x, dd.y, dd.z).multiplyScalar(off);
    const ab = b.clone().sub(a), l = ab.length();
    const u = l > 1e-9 ? ab.multiplyScalar(1 / l) : new V3(1, 0, 0);
    const skew = ((style.dimSkew || 0) * Math.PI) / 180;
    const k = Math.abs(skew) > 1e-6 ? Math.abs(off) * Math.tan(skew) : 0;   // 斜めの分だけAB方向へ滑らせる
    return { A2: a.clone().add(dv).addScaledVector(u, k), B2: b.clone().add(dv).addScaledVector(u, k) };
  }
  function addAnnotation(type, a, b, style) {
    const st = style ? { color: style.color, ltype: style.ltype, width: style.width, dimOff: style.dimOff, dimDir: style.dimDir, dimSkew: style.dimSkew, dimText: style.dimText, dimKind: style.dimKind, dimLead: style.dimLead, angP2: style.angP2 ? style.angP2.slice() : undefined, arcR: style.arcR, angReflex: style.angReflex, angReach: style.angReach ? style.angReach.slice() : undefined, textColor: style.textColor, textDeco: style.textDeco, textRot: style.textRot, rx: style.rx, rz: style.rz, quat: style.quat } : styleFor(type);
    const grp = buildAnn(type, a, b, st);
    annGroup.add(grp);
    annStore.push({ type, a: a.clone(), b: b.clone(), style: st, obj: grp });
    if (type === 'xline') updateXlinePts();
  }
  function clearAnnotations() {
    for (const r of annStore) { annGroup.remove(r.obj); disposeObj(r.obj); }
    annStore.length = 0;
    updateXlinePts();
  }

  // ---- 構築線どうしの交点（CADの交点スナップ）。同一EL（±0.5mm）で交差する2線の交点を
  //      黄色マーカーで常時表示し、作図・移動のスナップ候補にも加える ----
  const XPT_COLOR = 0xffd84d;
  const xptGroup = new THREE.Group();
  modelGroup.add(xptGroup);
  let xlinePts = [];                          // 交点（modelローカル）の一覧
  function xlineIntersections() {
    const xs = annStore.filter(r => r.type === 'xline');
    const out = [];
    const L = 12, tolY = 0.0005;              // 描画範囲±12m／EL一致とみなす許容0.5mm
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
      const r1 = xs[i], r2 = xs[j];
      if (Math.abs(r1.a.y - r2.a.y) > tolY) continue;       // ELが違う＝交わらない
      const d1 = r1.b.clone().sub(r1.a), d2 = r2.b.clone().sub(r2.a);
      const l1 = Math.hypot(d1.x, d1.z), l2 = Math.hypot(d2.x, d2.z);
      if (l1 < 1e-9 || l2 < 1e-9) continue;                 // 水平成分なし（垂直）は対象外
      const u1x = d1.x / l1, u1z = d1.z / l1, u2x = d2.x / l2, u2z = d2.z / l2;
      const den = u1x * u2z - u1z * u2x;
      if (Math.abs(den) < 1e-9) continue;                   // 平行
      const wx = r2.a.x - r1.a.x, wz = r2.a.z - r1.a.z;
      const t = (wx * u2z - wz * u2x) / den;                // r1中心からの符号付き距離
      const u = (wx * u1z - wz * u1x) / den;                // r2中心からの符号付き距離（範囲判定のみに使用）
      if (Math.abs(t) > L || Math.abs(u) > L) continue;     // レーザーの描画範囲外
      out.push(new V3(r1.a.x + u1x * t, (r1.a.y + r2.a.y) / 2, r1.a.z + u1z * t));
    }
    return out;
  }
  function updateXlinePts() {
    while (xptGroup.children.length) { const c = xptGroup.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
    xlinePts = xlineIntersections();
    for (const p of xlinePts) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 12, 10),
        new THREE.MeshBasicMaterial({ color: XPT_COLOR, depthTest: false, transparent: true, opacity: 0.95 }));
      m.position.copy(p); m.renderOrder = 998; xptGroup.add(m);
    }
  }

  // ---- 描画モードの状態 ----
  //  first=起点 / cur=現在の終点 / vert=Y方向(Shift) / locked=確定待ち(脚入力編集中) / editRec=確定済みで編集中の注釈
  const drawState = { mode: null, first: null, cur: null, vert: false, locked: false, editRec: null, snapped: false, preview: null };
  function drawActive() { return !!drawState.mode; }
  function clearPreview() {
    if (drawState.preview) { annGroup.remove(drawState.preview); disposeObj(drawState.preview); drawState.preview = null; }
  }
  function cancelDraw() {
    drawState.mode = null;
    if (typeof clearDrawTemp === 'function') clearDrawTemp();
    renderer.domElement.style.cursor = '';
    updateDrawButtons();
  }
  window.__exitDrawMode = () => { if (drawActive()) cancelDraw(); };   // 外部（部品配置開始時）から描画モードを解除
  function setDrawMode(mode) {
    const turningOff = (drawState.mode === mode);
    drawState.mode = null;
    if (typeof clearDrawTemp === 'function') clearDrawTemp();
    if (!turningOff) {
      stopFollow();
      selectPart(null);
      drawState.mode = mode;
      renderer.domElement.style.cursor = DRAW_CURSOR;
    } else {
      renderer.domElement.style.cursor = '';
    }
    updateDrawButtons();
  }
  function updateDrawButtons() {
    [['line', 'cmdLine'], ['xline', 'cmdXline'], ['circle', 'cmdCircle'], ['dim', 'cmdDim'], ['text', 'cmdText']].forEach(([m, id]) => {
      const b = $(id); if (b) b.classList.toggle('active', drawState.mode === m);
    });
    syncTouchOrbit();
  }
  // タッチ操作：作図モード中／Ctrl ON 中は1本指の視点回転を無効化（1本指＝作図・窓選択／2本指＝パン・ズームは維持）
  function syncTouchOrbit() { if (controls && controls.touches) controls.touches.ONE = (drawActive() || touchCtrl) ? null : THREE.TOUCH.ROTATE; }
  window.__syncTouchOrbit = syncTouchOrbit;
  // ---- 描画用スナップ＆点決め ----
  // 注釈レコードのスナップ点（起点）。線分＝端点＋中点／円＝中心＋四半円点(±X,±Z)／寸法ほか＝両端。
  // 構築線は対象外（交点のみ別途）。
  function annSnapPoints(rec) {
    if (rec.type === 'xline') return [];
    if (rec.type === 'circle') {
      const c = rec.a, { rx, rz } = circleRadii(rec.style, rec.a, rec.b), q = quatFromStyle(rec.style);
      const P = (lx, lz) => c.clone().add(new V3(lx, 0, lz).applyQuaternion(q));
      return [c.clone(), P(rx, 0), P(-rx, 0), P(0, rz), P(0, -rz)];   // 中心＋四半円点(±X,±Z・向き込み)
    }
    if (rec.type === 'line') return [rec.a.clone(), rec.b.clone(), rec.a.clone().add(rec.b).multiplyScalar(0.5)];   // 端点＋中点
    return [rec.a.clone(), rec.b.clone()];
  }
  // 半径/直径寸法用：カーソル光線が「乗っている円/楕円」を探す。
  // 返り値 {rec, edgeWorld, inside}（edgeWorld=カーソル方向の縁／inside=カーソルが円の内側か） or null。
  function pickCircleForDim(cx, cy) {
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    placeNdc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    placeNdc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    placeRay.setFromCamera(placeNdc, cam);
    const O = modelGroup.worldToLocal(placeRay.ray.origin.clone());
    const D = modelGroup.worldToLocal(placeRay.ray.origin.clone().addScaledVector(placeRay.ray.direction, 1)).sub(O).normalize();
    let best = null, bestD = Infinity;
    for (const rec of annStore) {
      if (rec.type !== 'circle') continue;
      const { rx, rz } = circleRadii(rec.style, rec.a, rec.b), q = quatFromStyle(rec.style);
      const n = new V3(0, 1, 0).applyQuaternion(q);               // 円の面の法線
      const denom = D.dot(n); if (Math.abs(denom) < 1e-9) continue;
      const t = rec.a.clone().sub(O).dot(n) / denom; if (t <= 0) continue;
      const hit = O.clone().addScaledVector(D, t);                // 円の面上の交点（modelローカル）
      const local = hit.clone().sub(rec.a).applyQuaternion(q.clone().invert());
      const lx = local.x, lz = local.z;
      const rho = Math.hypot(lx / rx, lz / rz);                   // 1=縁・<1内側・>1外側
      if (rho > 1.35) continue;                                   // 円から離れすぎ＝対象外
      const sc = modelGroup.localToWorld(rec.a.clone()).project(cam);
      const sd = Math.hypot(rect.left + (sc.x * .5 + .5) * rect.width - cx, rect.top + (-sc.y * .5 + .5) * rect.height - cy);
      if (sd < bestD) {
        const tt = Math.atan2(lz / rz, lx / rx);                  // カーソル方向の離心角
        const edgeWorld = rec.a.clone().add(new V3(Math.cos(tt) * rx, 0, Math.sin(tt) * rz).applyQuaternion(q));
        best = { rec, edgeWorld, inside: rho <= 1.0 };
        bestD = sd;
      }
    }
    return best;
  }
  // ロック済みの円 rec に対し、カーソル位置から半径/直径寸法の a,b,lead を求める。
  // 向き＝中心→カーソル方向（四半円方向へスナップ）／lead＝値の位置（中心・四半円点・機点・縁へスナップ）。
  function circleDimFromCursor(rec, cx, cy) {
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    placeNdc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    placeNdc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    placeRay.setFromCamera(placeNdc, cam);
    const O = modelGroup.worldToLocal(placeRay.ray.origin.clone());
    const D = modelGroup.worldToLocal(placeRay.ray.origin.clone().addScaledVector(placeRay.ray.direction, 1)).sub(O).normalize();
    const { rx, rz } = circleRadii(rec.style, rec.a, rec.b), q = quatFromStyle(rec.style);
    const qi = q.clone().invert();
    const C = rec.a.clone(), n = new V3(0, 1, 0).applyQuaternion(q);
    const denom = D.dot(n); if (Math.abs(denom) < 1e-9) return null;
    const t = C.clone().sub(O).dot(n) / denom; if (t <= 0) return null;
    const hit = O.clone().addScaledVector(D, t);                 // 円の面上のカーソル点
    // スナップ点（機点・中心・四半円点・交点）をカーソル近傍から拾う
    const snap = drawSnapPoint(cx, cy);
    const isCenterSnap = snap && snap.distanceTo(C) < 1e-4;
    // 向きの基準点：スナップ点（中心以外）優先、無ければカーソルの面上点
    const dirRef = (snap && !isCenterSnap) ? snap : hit;
    let local = dirRef.clone().sub(C).applyQuaternion(qi);
    let tt = Math.atan2(local.z / rz, local.x / rx);
    if (dirRef === hit) {                                        // 自由カーソル時のみ四半円方向（0/90/180/270°）へスナップ
      const k = Math.round(tt / (Math.PI / 2)) * (Math.PI / 2);
      let diff = tt - k; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
      if (Math.abs(diff) < 9 * Math.PI / 180) tt = k;
    }
    const E = C.clone().add(new V3(Math.cos(tt) * rx, 0, Math.sin(tt) * rz).applyQuaternion(q));   // その方向の縁（四半円点）
    const dir = E.clone().sub(C); const Rdir = dir.length(); if (Rdir > 1e-9) dir.multiplyScalar(1 / Rdir); else dir.set(1, 0, 0);
    // lead（値の位置）：スナップ点があればその射影、無ければカーソル射影＋縁スナップ
    const refPt = snap ? snap : hit;
    let lead = refPt.clone().sub(C).dot(dir);
    if (!snap && Math.abs(lead - Rdir) < 0.006) lead = Rdir;     // 縁の近くは縁へ吸着
    lead = Math.max(0.001, lead);
    const a = (dimKind === 'radius') ? C : C.clone().addScaledVector(dir, -Rdir);   // 直径は反対側の縁
    const st = Object.assign({}, styleFor('dim'), { dimKind, dimLead: lead });
    return { a, b: E, st, snapPt: snap || null };
  }
  // ===== 角度寸法（3点間／2直線間）=====
  const ANG_PICK_COLOR = 0x39ff8a;   // 角度の対象として選択した直線のハイライト色（緑）
  // カーソル光線と「点Vを通り法線nの平面」の交点（modelローカル）
  function rayPlanePoint(Vp, n, cx, cy) {
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    placeNdc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    placeNdc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    placeRay.setFromCamera(placeNdc, cam);
    const O = modelGroup.worldToLocal(placeRay.ray.origin.clone());
    const D = modelGroup.worldToLocal(placeRay.ray.origin.clone().addScaledVector(placeRay.ray.direction, 1)).sub(O).normalize();
    const denom = D.dot(n); if (Math.abs(denom) < 1e-9) return null;
    const t = Vp.clone().sub(O).dot(n) / denom; if (t <= 0) return null;
    return O.addScaledVector(D, t);
  }
  // V,P1,P2 が張る平面上のカーソル点（平面が決まらなければ水平面）
  function angleCursorPt(Vp, P1, P2, cx, cy) {
    let n = P1.clone().sub(Vp).cross(P2.clone().sub(Vp));
    if (n.lengthSq() < 1e-9) n.set(0, 1, 0); n.normalize();
    return rayPlanePoint(Vp, n, cx, cy) || Vp.clone();
  }
  // 2直線（無限延長）の最接近点の中点＝交点とみなす
  function lineLineClosest(p1, p2, p3, p4) {
    const d1 = p2.clone().sub(p1), d2 = p4.clone().sub(p3), r = p1.clone().sub(p3);
    const a = d1.dot(d1), b = d1.dot(d2), c = d2.dot(d2), d = d1.dot(r), e = d2.dot(r);
    const den = a * c - b * b;
    const s = Math.abs(den) < 1e-9 ? 0 : (b * e - c * d) / den;
    const t = Math.abs(c) < 1e-9 ? 0 : (b * s + e) / c;
    return p1.clone().addScaledVector(d1, s).add(p3.clone().addScaledVector(d2, t)).multiplyScalar(0.5);
  }
  // 線レコード上の、カーソルに最も近い点（向きの基準に使う）
  function clickPtOnLine(rec, cx, cy) {
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    const [Ae, Be] = annPickEnds(rec);
    const pr = p => { const n = modelGroup.localToWorld(p.clone()).project(cam); return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height }; };
    const sa = pr(Ae), sb = pr(Be), vx = sb.x - sa.x, vy = sb.y - sa.y, vv = vx * vx + vy * vy;
    const t = vv > 1e-9 ? ((cx - sa.x) * vx + (cy - sa.y) * vy) / vv : 0;
    return Ae.clone().lerp(Be, t);
  }
  // カーソル近傍の線分/構築線レコード（角度の対象オブジェクト用）
  function pickAnnLineAt(cx, cy) { const r = pickAnnAt(cx, cy); return (r && (r.type === 'line' || r.type === 'xline')) ? r : null; }
  // 確定済みの半径/直径/角度寸法を再選択して、逃げ（リーダー長／円弧半径・優劣角）をカーソルで再調整する
  function dimReadjustApply(rec, cx, cy) {
    const s = rec.style, kind = s.dimKind;
    const snap = drawSnapPoint(cx, cy);
    if (kind === 'radius' || kind === 'diameter') {
      const C = kind === 'radius' ? rec.a.clone() : rec.a.clone().add(rec.b).multiplyScalar(0.5);
      const dir = rec.b.clone().sub(C); const Rd = dir.length(); if (Rd > 1e-9) dir.multiplyScalar(1 / Rd); else dir.set(1, 0, 0);
      const ref = snap ? snap.clone() : axisStretchPoint(cx, cy, C, dir);
      if (ref) { let lead = ref.clone().sub(C).dot(dir); if (!snap && Math.abs(lead - Rd) < 0.006) lead = Rd; s.dimLead = Math.max(0.001, lead); }
    } else if (kind === 'angle') {
      const V = rec.a.clone(), P1 = rec.b.clone(), P2 = new V3(s.angP2[0], s.angP2[1], s.angP2[2]);
      const cur = snap ? snap.clone() : angleCursorPt(V, P1, P2, cx, cy);
      s.arcR = Math.max(0.005, cur.distanceTo(V));
      const d1 = P1.clone().sub(V).normalize(), d2 = P2.clone().sub(V).normalize();
      const bis = d1.clone().add(d2); if (bis.lengthSq() > 1e-9) { bis.normalize(); const cd = cur.clone().sub(V); if (cd.lengthSq() > 1e-9) s.angReflex = cd.normalize().dot(bis) < 0; }
    }
    rebuildAnn(rec); refreshAnnHi();
    return snap;
  }
  // 頂点Vから方向dirへ、対象直線recが届く距離（＝補助線でこの距離までは直線と重なるので描かない）
  function lineReach(rec, V, dir) {
    const e = annPickEnds(rec);
    return Math.max(0, e[0].clone().sub(V).dot(dir), e[1].clone().sub(V).dot(dir));
  }
  // 収集中の角度状態＋カーソルから、寸法レコードの a(=V),b(=P1),style を作る
  function angleDimFrom(ang, cx, cy) {
    if (ang.mode === 'obj') {
      // 2直線間：頂点Vと各直線の向き u1,u2。カーソルのある象限に合わせて各直線の「カーソル側の半直線」を選ぶ
      // → その2半直線のなす角（θ または 180−θ）を測る（AutoCAD と同じ）。
      const V = ang.V, u1 = ang.u1, u2 = ang.u2;
      const snap = drawSnapPoint(cx, cy);              // 機点・端点・交点・中点へスナップ
      const cur = snap ? snap.clone() : angleCursorPt(V, V.clone().add(u1), V.clone().add(u2), cx, cy);
      const R = Math.max(0.005, cur.distanceTo(V));
      const cv = cur.clone().sub(V);
      const s1 = (cv.dot(u1) < 0) ? -1 : 1;            // カーソル側へ向く半直線
      const s2 = (cv.dot(u2) < 0) ? -1 : 1;
      const d1 = u1.clone().multiplyScalar(s1), d2 = u2.clone().multiplyScalar(s2);
      const P1 = V.clone().addScaledVector(d1, R), P2 = V.clone().addScaledVector(d2, R);
      const reach = [lineReach(ang.lines[0], V, d1), lineReach(ang.lines[1], V, d2)];   // 補助線で重なりを隠す境界
      const st = Object.assign({}, styleFor('dim'), { dimKind: 'angle', angP2: [P2.x, P2.y, P2.z], arcR: R, angReflex: false, angReach: reach });
      return { a: V.clone(), b: P1, st, snapPt: snap || null };
    }
    // 3点間：V=頂点・P1・P2＝指定2方向。カーソルが劣角側か優角側かで挟角/優角を測る
    const V = ang.pts[0], P1 = ang.pts[1], P2 = ang.pts[2];
    if (!V || !P1 || !P2) return null;
    const cur = angleCursorPt(V, P1, P2, cx, cy);
    const R = Math.max(0.005, cur.distanceTo(V));
    const d1 = P1.clone().sub(V), d2 = P2.clone().sub(V);
    let reflex = false;
    const bis = d1.clone().normalize().add(d2.clone().normalize());
    if (bis.lengthSq() > 1e-9) { bis.normalize(); const cd = cur.clone().sub(V); if (cd.lengthSq() > 1e-9) reflex = cd.normalize().dot(bis) < 0; }
    const st = Object.assign({}, styleFor('dim'), { dimKind: 'angle', angP2: [P2.x, P2.y, P2.z], arcR: R, angReflex: reflex });
    return { a: V.clone(), b: P1.clone(), st };
  }
  // 部品の機点＋既存の線/寸法線の両端点（画面距離 SNAP_PX 以内の最近傍）
  function drawSnapPoint(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const cam = activeCam();
    let best = null, bestD = SNAP_PX;
    const test = mpos => {
      const ndc = modelGroup.localToWorld(mpos.clone()).project(cam);
      if (ndc.z >= 1) return;
      const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) { bestD = d; best = mpos.clone(); }
    };
    for (const p of placedParts) {
      if (!p.userData.faceLocal) continue;
      for (const local of connsOf(p)) test(connModelPos(p, local));
    }
    for (const r of annStore) { if (r === drawState.editRec) continue; for (const sp of annSnapPoints(r)) test(sp); }   // 線分=端点+中点／円=中心+四半円点／寸法=両端（構築線は交点のみ）
    for (const p of xlinePts) test(p);   // 構築線どうしの交点（CADの交点スナップ）
    return best;
  }
  // 起点 P1 から水平面上の点に角度刻み angleStep を適用（0=自由）
  function applyAngleSnap(P1, pt) {
    if (!angleStep) return pt;
    const dx = pt.x - P1.x, dz = pt.z - P1.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return pt;
    const step = angleStep * Math.PI / 180;
    const ang = Math.round(Math.atan2(dz, dx) / step) * step;
    return new V3(P1.x + Math.cos(ang) * len, pt.y, P1.z + Math.sin(ang) * len);
  }
  // Shift＝鉛直面内に引く。水平成分は主要軸(X か Z)へ寄せ、仰角に角度刻みを適用。
  // → 真上(Y)だけでなく、X方向やZ方向へ指定角度で傾けて引ける。
  function vertPoint(clientX, clientY, P1) {
    const rect = renderer.domElement.getBoundingClientRect();
    placeNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    placeNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    placeRay.setFromCamera(placeNdc, activeCam());
    const P1w = modelGroup.localToWorld(P1.clone());
    const n = new V3().subVectors(activeCam().position, P1w); n.y = 0;
    if (n.lengthSq() < 1e-9) n.set(0, 0, 1);
    n.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, P1w);
    const hit = new V3();
    if (!placeRay.ray.intersectPlane(plane, hit)) return null;
    modelGroup.worldToLocal(hit);
    const hx = hit.x - P1.x, hz = hit.z - P1.z;
    const useX = Math.abs(hx) >= Math.abs(hz);          // 水平成分は主要軸へ寄せる（直交ラン）
    const signed = useX ? hx : hz, sH = Math.sign(signed) || 1;
    let h = Math.abs(signed), hy = hit.y - P1.y;
    if (angleStep && (h > 1e-9 || Math.abs(hy) > 1e-9)) {  // 鉛直面内の仰角に角度スナップ
      const len = Math.hypot(h, hy);
      const step = angleStep * Math.PI / 180;
      const ang = Math.round(Math.atan2(hy, h) / step) * step;
      h = Math.max(0, Math.cos(ang)) * len; hy = Math.sin(ang) * len;
    }
    const hv = h * sH;
    return useX ? new V3(P1.x + hv, P1.y + hy, P1.z) : new V3(P1.x, P1.y + hy, P1.z + hv);
  }
  // {p, snapped} を返す（スナップ印の表示判定に使う）
  function pickFirstPoint(clientX, clientY) {
    const snap = drawSnapPoint(clientX, clientY);
    if (snap) return { p: snap, snapped: true };
    const t = resolveTarget(clientX, clientY, null, 0);
    return { p: t ? t.point.clone() : null, snapped: false };
  }
  // 2点目：スナップ最優先 → Shiftでvert(Y方向) → 水平面+角度スナップ
  function pickSecondPoint(clientX, clientY, P1, vert) {
    const snap = drawSnapPoint(clientX, clientY);
    if (snap) return { p: snap, snapped: true };
    if (vert) return { p: vertPoint(clientX, clientY, P1), snapped: false };
    const t = resolveTarget(clientX, clientY, null, P1.y);
    return { p: t ? applyAngleSnap(P1, t.point.clone()) : null, snapped: false };
  }

  // ---- 線分ガイド（専用グループ：補助三角形・スナップ印。markerGroup とは別管理） ----
  const lineGuideGroup = new THREE.Group();
  modelGroup.add(lineGuideGroup);
  function clearLineGuide() {
    while (lineGuideGroup.children.length) {
      const c = lineGuideGroup.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
  }
  function guideSeg(a, b, color) {
    const g = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const ln = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
    ln.renderOrder = 997; lineGuideGroup.add(ln);
  }
  function guideDot(p, color, r) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
    m.position.copy(p); m.renderOrder = 999; lineGuideGroup.add(m);
  }
  // 起点 a→終点 b の補助線。成分(X→Z→Y)を段状に分け、存在する脚ごとに補助線＋斜辺を引く。
  // これで X/Z/Y/L の入力欄に対応した補助線（X脚・Z脚・Y脚）がそれぞれ出る。
  function drawTriangle3D(a, b, vert, snapped) {
    clearLineGuide();
    if (snapped && b) guideDot(b, 0x39ff8a, 0.0042);                 // 吸着中＝緑で強調
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const cX = new V3(a.x + dx, a.y, a.z);           // X到達
    const cXZ = new V3(a.x + dx, a.y, a.z + dz);     // X→Z到達（水平面上）
    const fillTri = (p0, p1, p2) => {
      const g = new THREE.BufferGeometry().setFromPoints([p0.clone(), p1.clone(), p2.clone()]);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffcc33, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.14 }));
      m.renderOrder = 996; lineGuideGroup.add(m);
    };
    const hX = Math.abs(dx) > 1e-6, hZ = Math.abs(dz) > 1e-6, hY = Math.abs(dy) > 1e-6;
    if ((hX ? 1 : 0) + (hZ ? 1 : 0) + (hY ? 1 : 0) < 2) return;   // 軸方向のみ＝脚が線分と重なるので補助線は描かない
    if (hX && hZ) fillTri(a, cX, cXZ);               // 水平面の三角形（X×Z）
    if (hY && (hX || hZ)) fillTri(a, cXZ, b);        // 鉛直の三角形（水平到達×Y）
    if (hX) guideSeg(a, cX, 0xffcc33);               // X脚
    if (hZ) guideSeg(cX, cXZ, 0xffcc33);             // Z脚
    if (hY) guideSeg(cXZ, b, 0xffcc33);              // Y脚
    if (hX && hZ && hY) guideSeg(a, cXZ, 0xffcc33);  // 起点→水平到達点の対角線（L・X起点→Y・Z起点：水平の走りが分かる）
    // 斜辺（a→b）は実際の線分と重なって見苦しいので描かない
  }

  // ---- 脚の数値入力欄（X方向・Z方向・Y方向）＋本線の距離。部品移動と同じ placeLegInput を流用 ----
  const lnXBox = $('lnXBox'), lnX = $('lnX'), lnZBox = $('lnZBox'), lnZ = $('lnZ'),
        lnYBox = $('lnYBox'), lnY = $('lnY'), lnDBox = $('lnDBox'), lnD = $('lnD');
  function hideLineBoxes() { [lnXBox, lnZBox, lnYBox, lnDBox].forEach(b => { if (b) b.style.display = 'none'; }); hideXlineAngle(); hideDimOffLabel(); if (typeof hideCircleR === 'function') hideCircleR(); }
  function showLeg(box, inp, mid, outDir, mm) { placeLegInput(box, inp, mid, outDir, mm); }
  // ---- 構築線の角度ラベル（寸法は出さず、置いた方位角だけ表示） ----
  const xlineAngleEl = document.createElement('div');
  xlineAngleEl.id = 'xlineAngle';
  xlineAngleEl.style.cssText = 'position:fixed;z-index:60;display:none;padding:1px 6px;font:bold 12px Meiryo,sans-serif;color:#aaffcc;background:rgba(8,24,14,.82);border:1px solid #2e7d4f;border-radius:4px;pointer-events:none;white-space:nowrap';
  document.body.appendChild(xlineAngleEl);
  function hideXlineAngle() { xlineAngleEl.style.display = 'none'; }
  function xlineAngleDeg(a, b) {   // 水平面の方位角（+X=0°）。線は無向きなので0〜180°で表す
    const dx = b.x - a.x, dz = b.z - a.z;
    if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 0;
    let d = Math.atan2(-dz, dx) * 180 / Math.PI;
    d = ((d % 180) + 180) % 180;
    return d;
  }
  function showXlineAngle(a, b) {
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const p = a.clone().add(b).multiplyScalar(0.5).project(cam);
    if (p.z >= 1) { hideXlineAngle(); return; }
    const sx = rect.left + (p.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
    xlineAngleEl.textContent = '方位 ' + xlineAngleDeg(a, b).toFixed(1) + '°';   // 方位角スピナーと同じ表記・同じ値（0〜180°）
    xlineAngleEl.style.display = 'block';
    xlineAngleEl.style.left = Math.round(sx - xlineAngleEl.offsetWidth / 2) + 'px';
    xlineAngleEl.style.top = Math.round(sy - 26) + 'px';
  }
  // ---- 寸法線の逃げ量ラベル（調整中に寸法線本体の中点脇へ表示） ----
  const dimOffEl = document.createElement('div');
  dimOffEl.id = 'dimOffLabel';
  dimOffEl.style.cssText = 'position:fixed;z-index:60;display:none;padding:1px 6px;font:bold 12px Meiryo,sans-serif;color:#ffd9a0;background:rgba(26,18,6,.82);border:1px solid #8a6a2e;border-radius:4px;pointer-events:none;white-space:nowrap';
  document.body.appendChild(dimOffEl);
  function hideDimOffLabel() { dimOffEl.style.display = 'none'; }
  function showDimOffLabel() {
    if (!drawState.dimAdjust || !drawState.dimDir) { hideDimOffLabel(); return; }
    const a = drawState.dimAdjust.a, b = drawState.dimAdjust.b;
    const dd = drawState.dimDir, off = drawState.dimOff || 0;
    const mid = a.clone().add(b).multiplyScalar(0.5).add(new V3(dd.x, dd.y, dd.z).multiplyScalar(off));
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const p = mid.project(cam);
    if (p.z >= 1) { hideDimOffLabel(); return; }
    const sx = rect.left + (p.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
    dimOffEl.textContent = '逃げ ' + Math.round(Math.abs(off) * 1000) + ' mm';
    dimOffEl.style.display = 'block';
    dimOffEl.style.left = Math.round(sx - dimOffEl.offsetWidth / 2) + 'px';
    dimOffEl.style.top = Math.round(sy - 26) + 'px';
  }
  function placeDistanceBox(a, b) {   // 本線（斜辺）の距離 mm を中点に表示
    if (lnDBox) placeLegInput(lnDBox, lnD, a.clone().add(b).multiplyScalar(0.5), new V3(0, 1, 0), Math.round(a.distanceTo(b) * 1000));
  }
  // ---- 円の半径ラベル（描画中・編集中に R○mm を追従表示） ----
  const circleREl = document.createElement('div');
  circleREl.id = 'circleRLabel';
  circleREl.style.cssText = 'position:fixed;z-index:60;display:none;padding:1px 6px;font:bold 12px Meiryo,sans-serif;color:#dbe4f3;background:rgba(20,28,51,.86);border:1px solid #3a4a6e;border-radius:4px;pointer-events:none;white-space:nowrap';
  document.body.appendChild(circleREl);
  function hideCircleR() { circleREl.style.display = 'none'; }
  function showCircleR(center, edge) {
    const r = center.distanceTo(edge);
    if (r < 1e-4) { hideCircleR(); return; }
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const mid = center.clone().add(edge).multiplyScalar(0.5).project(cam);
    if (mid.z >= 1) { hideCircleR(); return; }
    const sx = rect.left + (mid.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-mid.y * 0.5 + 0.5) * rect.height;
    circleREl.textContent = 'R ' + Math.round(r * 1000) + ' mm';
    circleREl.style.display = 'block';
    circleREl.style.left = Math.round(sx - circleREl.offsetWidth / 2) + 'px';
    circleREl.style.top = Math.round(sy - 24) + 'px';
  }
  // 毎フレーム：脚入力欄を三角形の脚の位置へ追従（カメラ移動対応）。描画/確定待ち時のみ表示。
  function positionLineBoxes() {
    // 線・集団の直行（水平）移動中：移動量 X/Z と距離 L を脚位置に表示
    if (lineDrag && lineDrag.mode === 'sel' && !lineDrag.free && lineDrag.moved && lineDrag._delta) {
      const o = lineDrag.origin, y = lineDrag.planeY, dx = lineDrag._delta.x, dz = lineDrag._delta.z;
      if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) { hideLineBoxes(); return; }
      const start = new V3(o.x, y, o.z), end = new V3(o.x + dx, y, o.z + dz), corner = new V3(end.x, y, start.z);
      if (Math.abs(dx) > 1e-4) showLeg(lnXBox, lnX, new V3((start.x + corner.x) / 2, y, start.z), new V3(0, 0, -(Math.sign(dz) || 1)), Math.abs(Math.round(dx * 1000)));
      else if (lnXBox) lnXBox.style.display = 'none';
      if (Math.abs(dz) > 1e-4) showLeg(lnZBox, lnZ, new V3(corner.x, y, (start.z + end.z) / 2), new V3(Math.sign(dx) || 1, 0, 0), Math.abs(Math.round(dz * 1000)));
      else if (lnZBox) lnZBox.style.display = 'none';
      if (lnYBox) lnYBox.style.display = 'none';
      if (Math.abs(dx) > 1e-4 && Math.abs(dz) > 1e-4) placeDistanceBox(start, end);   // 斜め時だけ距離L。軸方向のみの時は重なるので隠す
      else if (lnDBox) lnDBox.style.display = 'none';
      return;
    }
    if (lineDrag && lineDrag.mode === 'circleaxis') {   // 円/楕円の半径変更中：掴んだ軸の半径ラベルを表示
      const rec = lineDrag.rec, c = rec.a, { rx, rz } = circleRadii(rec.style, rec.a, rec.b);
      const v = lineDrag.axis === 'x' ? rx : rz;
      [lnXBox, lnZBox, lnYBox, lnDBox].forEach(b => { if (b) b.style.display = 'none'; }); hideXlineAngle(); hideDimOffLabel();
      showCircleR(c, c.clone().addScaledVector(lineDrag.dir, v));
      return;
    }
    if (drawState.dimAdjust) { hideLineBoxes(); showDimOffLabel(); return; }   // 寸法線の逃げ調整中は入力フォームを出さず、逃げ量ラベルだけ追従表示
    if (drawState.mode === 'dim') { hideLineBoxes(); return; }   // 寸法線の1→2点目中も小窓（脚入力欄）は出さない（2026-06-13 社長指示）
    // 円：脚X/Z/Yは出さず、中心→半径点の半径ラベルだけ追従表示
    if (drawState.mode === 'circle' || (drawState.editRec && drawState.editRec.type === 'circle')) {
      [lnXBox, lnZBox, lnYBox, lnDBox].forEach(b => { if (b) b.style.display = 'none'; }); hideXlineAngle(); hideDimOffLabel();
      if (drawState.first && drawState.cur && drawState.first.distanceTo(drawState.cur) >= 0.003) showCircleR(drawState.first, drawState.cur);
      else hideCircleR();
      return;
    }
    if (!drawState.first || !drawState.cur) { hideLineBoxes(); return; }
    // 構築線（無限長）は距離Lが無意味なので脚X/Z/Yのみ出し、距離Lは隠す。中心(a)からの向き入力に使う
    const isXlineNow = drawState.mode === 'xline' || (drawState.editRec && drawState.editRec.type === 'xline');
    // 1点目を置いただけ（ほぼ動いていない）うちは脚ボックスを出さない。動き出してから表示
    if (drawState.first.distanceTo(drawState.cur) < 0.003) { hideLineBoxes(); return; }
    const a = drawState.first, b = drawState.cur;
    if (isXlineNow) { hideLineBoxes(); showXlineAngle(a, b); return; }   // 構築線は寸法を出さず角度のみ
    if (drawState.vert) {
      const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y, useX = Math.abs(dx) >= Math.abs(dz);
      const corner = new V3(b.x, a.y, b.z);
      if (useX && Math.abs(dx) > 1e-4) { showLeg(lnXBox, lnX, new V3((a.x + b.x) / 2, a.y, a.z), new V3(0, -1, 0), Math.abs(Math.round(dx * 1000))); if (lnZBox) lnZBox.style.display = 'none'; }
      else if (!useX && Math.abs(dz) > 1e-4) { showLeg(lnZBox, lnZ, new V3(a.x, a.y, (a.z + b.z) / 2), new V3(0, -1, 0), Math.abs(Math.round(dz * 1000))); if (lnXBox) lnXBox.style.display = 'none'; }
      else { if (lnXBox) lnXBox.style.display = 'none'; if (lnZBox) lnZBox.style.display = 'none'; }
      if (Math.abs(dy) > 1e-4) showLeg(lnYBox, lnY, new V3(corner.x, (a.y + b.y) / 2, corner.z), new V3(useX ? (Math.sign(dx) || 1) : 0, 0, useX ? 0 : (Math.sign(dz) || 1)), Math.abs(Math.round(dy * 1000)));
      else if (lnYBox) lnYBox.style.display = 'none';
      // 水平成分とY成分の両方があり斜めのときだけ距離を表示。鉛直一直線＝Y脚と同値なので隠す
      const hasH = useX ? Math.abs(dx) > 1e-4 : Math.abs(dz) > 1e-4;
      if (!isXlineNow && hasH && Math.abs(dy) > 1e-4) placeDistanceBox(a, b);
      else if (lnDBox) lnDBox.style.display = 'none';
      return;
    }
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y, y = a.y, corner = new V3(b.x, y, a.z);
    if (Math.abs(dx) > 1e-4) showLeg(lnXBox, lnX, new V3((a.x + corner.x) / 2, y, a.z), new V3(0, 0, -(Math.sign(dz) || 1)), Math.abs(Math.round(dx * 1000)));
    else if (lnXBox) lnXBox.style.display = 'none';
    if (Math.abs(dz) > 1e-4) showLeg(lnZBox, lnZ, new V3(corner.x, y, (a.z + b.z) / 2), new V3(Math.sign(dx) || 1, 0, 0), Math.abs(Math.round(dz * 1000)));
    else if (lnZBox) lnZBox.style.display = 'none';
    // 3D斜め線（X/Z＋Y）の伸縮対応：水平到達点(b.x,a.y,b.z)から b までのY脚も出す
    if (Math.abs(dy) > 1e-4) {
      const yOut = Math.abs(dx) > 1e-4 ? new V3(Math.sign(dx) || 1, 0, 0) : new V3(0, 0, Math.sign(dz) || 1);
      showLeg(lnYBox, lnY, new V3(b.x, (a.y + b.y) / 2, b.z), yOut, Math.abs(Math.round(dy * 1000)));
    } else if (lnYBox) lnYBox.style.display = 'none';
    // 2軸以上に成分がある（斜め）ときだけ斜辺の距離Lを表示。1軸のみ＝脚と同値なので隠す
    const nAxes = (Math.abs(dx) > 1e-4 ? 1 : 0) + (Math.abs(dz) > 1e-4 ? 1 : 0) + (Math.abs(dy) > 1e-4 ? 1 : 0);
    if (!isXlineNow && nAxes >= 2) placeDistanceBox(a, b);
    else if (lnDBox) lnDBox.style.display = 'none';
  }
  window.__posLineGuide = positionLineBoxes;   // 描画ループ（外側）から毎フレーム呼ぶ

  // ---- 確定・取消・後始末 ----
  function rebuildAnn(rec) {   // 編集中レコードの見た目を作り直す
    annGroup.remove(rec.obj); disposeObj(rec.obj);
    rec.obj = buildAnn(rec.type, rec.a, rec.b, rec.style);
    annGroup.add(rec.obj);
    if (rec.type === 'xline') updateXlinePts();   // 構築線が動いたら交点を引き直す
  }
  window.__rebuildAllAnns = () => { for (const r of annStore) rebuildAnn(r); refreshAnnHi(); };   // テーマ切替で合成方式を反映
  function clearDrawTemp() {    // 描画途中の状態を全消去（線は残す）
    drawState.first = null; drawState.cur = null; drawState.vert = false;
    drawState.locked = false; drawState.editRec = null; drawState.snapped = false;
    drawState.dimAdjust = null; drawState.dimOff = 0; drawState.dimDir = null;   // 寸法線の逃げ調整状態も解除
    drawState.circDim = null;   // 半径/直径：ロック中の円も解除
    drawState.dimReadjust = null;   // 寸法の逃げ再調整も解除
    if (drawState.angle && drawState.angle.lines) for (const ln of drawState.angle.lines) paintAnn(ln, selAnns.has(ln));   // 角度の選択ハイライト(緑)を戻す
    drawState.angle = null;     // 角度：収集中の点/直線も解除
    clearPreview();
    if (typeof clearLineGuide === 'function') clearLineGuide();
    if (typeof hideLineBoxes === 'function') hideLineBoxes();
  }
  const abortDrawPoint = clearDrawTemp;   // 起点取消（未確定なので線は作られない）
  const finishGuide = clearDrawTemp;      // 確定待ちを終える（線は確定済みなので残る）
  function commitGuideToStore() {         // first→cur を実体の注釈として作成し、そのレコードを返す
    if (!drawState.first || !drawState.cur || drawState.cur.distanceTo(drawState.first) <= 1e-6) return null;
    if (drawState.mode === 'circle') {    // 円：半径＝中心→カーソルの水平距離。真円(rx=rz)で起票
      const r = Math.hypot(drawState.cur.x - drawState.first.x, drawState.cur.z - drawState.first.z);
      if (r < 1e-4) return null;
      const st = Object.assign({}, styleFor('circle'), { rx: r, rz: r });
      addAnnotation('circle', drawState.first.clone(), drawState.cur.clone(), st);
      return annStore[annStore.length - 1];
    }
    addAnnotation(drawState.mode, drawState.first, drawState.cur);
    return annStore[annStore.length - 1];
  }
  // 脚入力 → 確定済みレコードの終点を更新（向きは現状を踏襲）。finalize=Enterで編集終了
  function applyLineLegs(finalize) {
    const rec = drawState.editRec; if (!rec) return;
    const a = rec.a;
    let b;
    if (drawState.vert) {                       // 鉛直：水平脚(X か Z) ＋ Y脚
      const dxs = rec.b.x - a.x, dzs = rec.b.z - a.z, useX = Math.abs(dxs) >= Math.abs(dzs);
      const yv = (Math.abs(parseFloat(lnY.value)) || 0) / 1000 * (Math.sign(rec.b.y - a.y) || 1);
      if (useX) b = new V3(a.x + (Math.abs(parseFloat(lnX.value)) || 0) / 1000 * (Math.sign(dxs) || 1), a.y + yv, a.z);
      else      b = new V3(a.x, a.y + yv, a.z + (Math.abs(parseFloat(lnZ.value)) || 0) / 1000 * (Math.sign(dzs) || 1));
    } else {                                    // 水平：X脚 ＋ Z脚（＋3D斜め線ならY脚も）
      const sx = Math.sign(rec.b.x - a.x) || 1, sz = Math.sign(rec.b.z - a.z) || 1;
      const dyNow = rec.b.y - a.y;
      const yv = Math.abs(dyNow) > 1e-4 ? (Math.abs(parseFloat(lnY.value)) || 0) / 1000 * (Math.sign(dyNow) || 1) : 0;
      b = new V3(a.x + (Math.abs(parseFloat(lnX.value)) || 0) / 1000 * sx, a.y + yv, a.z + (Math.abs(parseFloat(lnZ.value)) || 0) / 1000 * sz);
    }
    rec.b.copy(b); rebuildAnn(rec);
    drawState.cur = rec.b.clone();
    drawTriangle3D(a, rec.b, drawState.vert, false);
    if (lineSel === rec) { showLineHandles(rec); refreshAnnHi(); }
    if (finalize) finishGuide();
  }
  // 距離入力 → 現在の向きを保ったまま、その長さに終点を伸縮
  function applyLineDistance(finalize) {
    const rec = drawState.editRec; if (!rec) return;
    const a = rec.a, dir = rec.b.clone().sub(a), len = dir.length();
    if (len < 1e-9) return;
    dir.divideScalar(len);
    const D = Math.max(0, (parseFloat(lnD.value) || 0) / 1000);
    rec.b.copy(a).addScaledVector(dir, D); rebuildAnn(rec);
    drawState.cur = rec.b.clone();
    drawTriangle3D(a, rec.b, drawState.vert, false);
    if (lineSel === rec) { showLineHandles(rec); refreshAnnHi(); }
    if (finalize) finishGuide();
  }
  [lnX, lnZ, lnY].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('input', () => applyLineLegs(false));    // スピナー長押し・連続増減でも追従
    inp.addEventListener('change', () => applyLineLegs(false));
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); applyLineLegs(true); }
      else if (e.key === 'Escape') { e.preventDefault(); inp.blur(); }
    });
  });
  if (lnD) {
    lnD.addEventListener('input', () => applyLineDistance(false));   // スピナー長押しでも追従
    lnD.addEventListener('change', () => applyLineDistance(false));
    lnD.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); applyLineDistance(true); }
      else if (e.key === 'Escape') { e.preventDefault(); lnD.blur(); }
    });
  }
  // 脚入力欄の上にカーソルがあるか（プレビュー凍結用）
  function overLineBox(x, y) {
    for (const bx of [lnXBox, lnZBox, lnYBox, lnDBox]) {
      if (bx && bx.style.display !== 'none') {
        const r = bx.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
      }
    }
    return false;
  }

  // ---- ポインタ横取り（window キャプチャ段：既存ハンドラより先に処理） ----
  // 描き方は2通り併存：
  //  ① クリック→クリック（CAD標準）：1回目クリックで起点が決まり残る／2回目クリックで終点確定。
  //  ② 押す→ドラッグ→離す：1ジェスチャで起点～終点を確定。
  // どちらも確定後は確定待ち(locked)になり、脚入力で寸法を編集できる。
  let drawDown = null, drawRDown = null;
  // ---- 寸法線の「逃げ」（補助線の長さ）調整 ----
  // 2点目確定後、カーソル移動で寸法線を起点から離す距離を決め、3回目のクリックで確定する。
  function startDimAdjust() {
    if (!drawState.first || !drawState.cur || drawState.cur.distanceTo(drawState.first) <= 1e-6) { abortDrawPoint(); return; }
    drawState.dimAdjust = { a: drawState.first.clone(), b: drawState.cur.clone() };
    drawState.dimOff = 0; drawState.dimDir = null;
    hideLineBoxes(); clearLineGuide();
  }
  // カーソル位置 → 逃げ量(off, m)と方向(dir)。
  //  平面の寸法（ABに水平成分あり）：通常＝ABの水平直交へ／Shift＝縦（上下）へ
  //  立面の寸法（ABが垂直）       ：水平へ逃がす。通常＝方向45°刻み／Shift＝斜め（自由角度）
  function dimOffsetFromCursor(cx, cy, A, B, shift) {
    const ab = B.clone().sub(A);
    const isVertAB = ab.x * ab.x + ab.z * ab.z < 1e-9;
    if (!isVertAB && shift) {                     // 平面の寸法＋Shift＝縦方向：カメラに正対する鉛直面で高さを拾う
      const rect = renderer.domElement.getBoundingClientRect();
      placeNdc.x = ((cx - rect.left) / rect.width) * 2 - 1;
      placeNdc.y = -((cy - rect.top) / rect.height) * 2 + 1;
      placeRay.setFromCamera(placeNdc, activeCam());
      const Aw = modelGroup.localToWorld(A.clone());
      const n = new V3().subVectors(activeCam().position, Aw); n.y = 0;
      if (n.lengthSq() < 1e-9) n.set(0, 0, 1);
      n.normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, Aw);
      const hitV = new V3();
      if (!placeRay.ray.intersectPlane(plane, hitV)) return null;
      modelGroup.worldToLocal(hitV);
      return { off: hitV.y - A.y, dir: { x: 0, y: 1, z: 0 } };
    }
    const hit = planeHitAt(cx, cy, A.y);
    if (!hit) return null;
    if (!isVertAB) {                              // 平面の寸法（通常）＝ABの水平直交へ
      const u = new V3(-ab.z, 0, ab.x).normalize();
      const off = (hit.x - A.x) * u.x + (hit.z - A.z) * u.z;
      return { off, dir: { x: u.x, y: 0, z: u.z } };
    }
    const vx = hit.x - A.x, vz = hit.z - A.z;     // 立面の寸法：水平へ逃がす
    const l = Math.hypot(vx, vz);
    if (l < 1e-9) return null;
    if (shift) return { off: l, dir: { x: vx / l, y: 0, z: vz / l } };   // Shift＝斜め（自由角度）
    const step = Math.PI / 4;                     // 通常＝45°刻みでスナップ
    const ang = Math.round(Math.atan2(vz, vx) / step) * step;
    const ux = Math.cos(ang), uz = Math.sin(ang);
    return { off: Math.max(0, vx * ux + vz * uz), dir: { x: ux, y: 0, z: uz } };
  }
  function commitDimWithOffset() {                      // 3回目クリック＝逃げを確定して寸法線を作る
    const a = drawState.dimAdjust.a, b = drawState.dimAdjust.b;
    const st = Object.assign({}, styleFor('dim'), { dimOff: drawState.dimOff || 0, dimDir: drawState.dimDir || null });
    addAnnotation('dim', a, b, st);
    const rec = annStore[annStore.length - 1];
    clearDrawTemp();
    cancelDraw();   // ツールを抜ける（構築線と同様、以後クリックや窓で再選択できる）
    // 確定直後に逃げ量スピナー（mm・1mm刻み）。立面寸法はその確定後に方位スピナー（0.5°刻み）が続く
    if (rec.style.dimDir) startDimOffSpin(rec);
  }
  function commitLeader() {                             // 引出：a=矢印先端(1点目)・b=肘(2点目)で確定。棚と文字はbから自動生成
    if (!drawState.first || !drawState.cur || drawState.cur.distanceTo(drawState.first) <= 1e-6) { clearDrawTemp(); return; }
    const st = Object.assign({}, styleFor('dim'), { dimKind: 'leader' });
    addAnnotation('dim', drawState.first.clone(), drawState.cur.clone(), st);
    const rec = annStore[annStore.length - 1];
    cancelDraw();   // ツールを抜ける
    // そのまま注記の入力へ：レコードを選択し、入力フォームを開いてフォーカス（新規入力＝ラベル「入力」）
    selectLine(rec);
    if (window.__openDimValueForm) window.__openDimValueForm(false);
    if (window.__focusDimValueInput) window.__focusDimValueInput();
  }
  function commitGuide() {                              // first→cur を確定し、確定待ち(locked)へ
    const rec = commitGuideToStore();
    if (rec) {
      if (rec.type === 'xline') {                    // 構築線：ツールを抜けて選択 → まずEL入力(フォーカス済) → Enterで方位角 → Enterで閉じる
        cancelDraw();                                // ツールを抜ける（以後クリックで再選択できる）
        selectLine(rec);
        focusElInputSoon();                          // EL欄へ即フォーカス（2026-06-13 社長指示：EL→角度の順）
      } else if (rec.type === 'circle') {             // 円：確定したら脚編集に入らず、その場で次の円を描けるようにする
        clearDrawTemp();
      } else { drawState.editRec = rec; drawState.locked = true; clearPreview(); }
    }
    return rec;
  }
  window.addEventListener('pointerdown', e => {
    if (!drawActive()) return;
    if (e.button === 2) { drawRDown = { x: e.clientX, y: e.clientY }; return; }   // 右=視点パン（横取りしない）
    if (e.button !== 0) return;
    if (e.target !== renderer.domElement) return;       // 脚入力など画面上のUIは通す
    // 書式メニューが開いていたら、このクリックは「閉じるだけ」で消費（次のクリックから描画）
    if (typeof maybeCloseFmtMenu === 'function' && maybeCloseFmtMenu()) { e.stopImmediatePropagation(); drawDown = null; return; }
    const rect = renderer.domElement.getBoundingClientRect();
    if (inGizmo(e.clientX - rect.left, e.clientY - rect.top)) return;   // ビューキューブは通す
    if (drawState.mode === 'text') {                          // 文字：点をクリックして配置→そのまま入力
      const r = pickFirstPoint(e.clientX, e.clientY);
      if (r.p) {
        const st = Object.assign({}, styleFor('dim'), { dimKind: 'text', textColor: textOpts.color, textDeco: textOpts.deco });
        addAnnotation('dim', r.p.clone(), r.p.clone(), st);
        const rec = annStore[annStore.length - 1];
        cancelDraw();
        selectLine(rec);
        if (window.__openDimValueForm) window.__openDimValueForm(false);
        if (window.__focusDimValueInput) window.__focusDimValueInput();
      }
      drawDown = null; e.stopImmediatePropagation();
      return;
    }
    if (drawState.mode === 'dim' && dimKind === 'angle') {   // 角度：2直線をそれぞれ選択して測る（直線オブジェクト以外は無視）
      const ang = drawState.angle;
      const placing = ang && ang.V;
      if (placing) {                                    // 確定クリック（円弧位置で確定）
        const r = angleDimFrom(ang, e.clientX, e.clientY);
        if (r) addAnnotation('dim', r.a, r.b, r.st);
        cancelDraw();                                   // ツールを抜ける（clearDrawTempでプレビュー消去・緑ハイライト復元・状態解除）
      } else if (!ang) {                                // 1本目：直線をクリックで選択（緑ハイライト）。空間クリックは何もしない
        const ln = pickAnnLineAt(e.clientX, e.clientY);
        if (ln) { drawState.angle = { mode: 'obj', lines: [ln] }; paintAnn(ln, true, ANG_PICK_COLOR); }
      } else {                                          // 2本目の直線 → 交点を頂点に・各直線の向きを保持
        const ln = pickAnnLineAt(e.clientX, e.clientY);
        if (ln && ln !== ang.lines[0]) {
          ang.lines.push(ln); paintAnn(ln, true, ANG_PICK_COLOR);
          const e0 = annPickEnds(ang.lines[0]), e1 = annPickEnds(ang.lines[1]);
          ang.V = lineLineClosest(e0[0], e0[1], e1[0], e1[1]);
          ang.u1 = e0[1].clone().sub(e0[0]).normalize();
          ang.u2 = e1[1].clone().sub(e1[0]).normalize();
        }
      }
      drawDown = null; e.stopImmediatePropagation();
      return;
    }
    if (drawState.mode === 'dim' && (dimKind === 'radius' || dimKind === 'diameter')) {
      if (drawState.circDim) {                          // 2クリック目＝この位置（内外・補助線長）で確定
        const r = circleDimFromCursor(drawState.circDim.rec, e.clientX, e.clientY);
        if (r) addAnnotation('dim', r.a, r.b, r.st);
        drawState.circDim = null; clearPreview();
        cancelDraw();                                   // ツールを抜ける（以後クリックで選択・値クリックで編集できる）
      } else {                                          // 1クリック目＝対象の円/楕円をロックし、その場で寸法を出す
        const hit = pickCircleForDim(e.clientX, e.clientY);
        if (hit) {
          drawState.circDim = { rec: hit.rec };
          const r = circleDimFromCursor(hit.rec, e.clientX, e.clientY);
          if (r) { clearPreview(); drawState.preview = buildAnn('dim', r.a, r.b, r.st); drawState.preview.traverse(o => { if (o.material) o.material.opacity = 0.6; }); annGroup.add(drawState.preview); }
        }
      }
      drawDown = null; e.stopImmediatePropagation();
      return;
    }
    if (drawState.mode === 'dim' && drawState.dimAdjust) {   // 寸法線：3回目クリック＝補助線の長さ（逃げ）を確定
      commitDimWithOffset();
      drawDown = null;
      e.stopImmediatePropagation();
      return;
    }
    if (drawState.locked) finishGuide();                // 直前の確定待ちを終え、新しい線を始める
    const hadFirst = !!drawState.first;
    if (!hadFirst) {                                    // ①の1回目／②の押下＝起点を決める
      const r = pickFirstPoint(e.clientX, e.clientY);
      if (r.p) {
        drawState.first = r.p; drawState.cur = r.p.clone(); drawState.vert = (e.shiftKey || touchShift) && drawState.mode !== 'xline' && drawState.mode !== 'circle';   // 構築線・円はShift勾配なし
        drawState.snapped = r.snapped; drawState.locked = false; drawState.editRec = null;
        clearPreview();
        if (drawState.mode !== 'circle') drawTriangle3D(drawState.first, drawState.cur, drawState.vert, drawState.snapped);   // 円は脚三角形を出さない
      }
    } else {                                            // ①の2回目＝終点を現在位置に合わせる（離す時に確定）
      const sh = (e.shiftKey || touchShift) && drawState.mode !== 'xline' && drawState.mode !== 'circle';   // 構築線・円はShift勾配なし
      const r = pickSecondPoint(e.clientX, e.clientY, drawState.first, sh);
      if (r.p && drawState.mode === 'xline') r.p.y = drawState.first.y;   // スナップ先のELにも引っ張られず水平を保つ
      if (r.p) { drawState.cur = r.p; drawState.vert = sh; drawState.snapped = r.snapped; }
    }
    drawDown = { x: e.clientX, y: e.clientY, armed: !hadFirst };   // armed=この押下で起点を立てた
    e.stopImmediatePropagation();
  }, true);
  window.addEventListener('pointerup', e => {
    if (!drawActive() || e.button !== 0 || !drawDown) return;
    const moved = Math.hypot(e.clientX - drawDown.x, e.clientY - drawDown.y);
    const armed = drawDown.armed;
    drawDown = null;
    e.stopImmediatePropagation();
    if (!drawState.first) return;
    if (armed) {                                        // 起点を立てた押下
      if (moved > 6) {
        if (drawState.mode === 'dim' && dimKind === 'leader') commitLeader();   // 引出＝肘で確定（2点）
        else if (drawState.mode === 'dim') startDimAdjust();      // 平行寸法は確定せず逃げ調整へ
        else if (!commitGuide()) abortDrawPoint();                // ②ドラッグして離した＝確定
      }
      // ドラッグ無し（単純クリック）＝①の1回目。起点は残し、2回目クリックを待つ
    } else {                                            // ①の2回目クリック＝終点で確定
      if (drawState.mode === 'dim' && dimKind === 'leader') commitLeader();     // 引出＝肘で確定（2点）
      else if (drawState.mode === 'dim') startDimAdjust();        // 平行寸法は確定せず逃げ調整へ
      else commitGuide();                               // 同一点でゼロ長なら確定されず、起点を保持して継続
    }
  }, true);
  window.addEventListener('pointermove', e => {
    if (!drawActive()) return;
    if (overLineBox(e.clientX, e.clientY)) return;      // 脚入力欄の上ではプレビュー凍結（方向を保つ）
    if (drawState.locked) return;                       // 確定待ちは固定（脚入力で編集）
    if (drawState.mode === 'dim' && dimKind === 'angle') {   // 角度：2本目を取った後だけ円弧プレビューを出す（選択前は何も出さない）
      clearPreview(); clearLineGuide();
      const ang = drawState.angle;
      if (ang && ang.V) {
        const r = angleDimFrom(ang, e.clientX, e.clientY);
        if (r) {
          drawState.preview = buildAnn('dim', r.a, r.b, r.st); drawState.preview.traverse(o => { if (o.material) o.material.opacity = 0.6; }); annGroup.add(drawState.preview);
          if (r.snapPt) guideDot(r.snapPt, 0x39ff8a, 0.0042);   // スナップ中＝緑印
        }
      } else if (pickAnnLineAt(e.clientX, e.clientY)) {   // 直線をホバー中＝スナップ印（半径/直径と同じ操作感）
        const sp = drawSnapPoint(e.clientX, e.clientY); if (sp) guideDot(sp, 0x39ff8a, 0.0042);
      }
      return;
    }
    if (drawState.mode === 'dim' && (dimKind === 'radius' || dimKind === 'diameter')) {   // 半径/直径：ロック後のみ、カーソルで向き・内外・補助線長を調整するプレビュー
      clearPreview(); clearLineGuide();
      if (drawState.circDim) {
        const r = circleDimFromCursor(drawState.circDim.rec, e.clientX, e.clientY);
        if (r) {
          drawState.preview = buildAnn('dim', r.a, r.b, r.st);
          drawState.preview.traverse(o => { if (o.material) o.material.opacity = 0.6; });
          annGroup.add(drawState.preview);
          if (r.snapPt) guideDot(r.snapPt, 0x39ff8a, 0.0042);   // スナップ中＝緑印
        }
      } else {                                            // ロック前：円/楕円に来たらスナップ印（中心・四半円点・機点）を出す
        if (pickCircleForDim(e.clientX, e.clientY)) {
          const snap = drawSnapPoint(e.clientX, e.clientY);
          if (snap) guideDot(snap, 0x39ff8a, 0.0042);
        }
      }
      return;
    }
    if (drawState.mode === 'dim' && drawState.dimAdjust) {   // 寸法線：カーソルで補助線の長さ（逃げ）を調整
      const a = drawState.dimAdjust.a, b = drawState.dimAdjust.b;
      const r = dimOffsetFromCursor(e.clientX, e.clientY, a, b, e.shiftKey || touchShift);   // Shift／鉛直＝縦方向へ逃げる
      if (r) { drawState.dimOff = r.off; drawState.dimDir = r.dir; }
      clearPreview();
      const st = Object.assign({}, styleFor('dim'), { dimOff: drawState.dimOff, dimDir: drawState.dimDir });
      drawState.preview = buildAnn('dim', a, b, st);
      drawState.preview.traverse(o => { if (o.material) o.material.opacity = 0.6; });
      annGroup.add(drawState.preview);
      return;
    }
    if (!drawState.first) {                             // ホバー中：スナップ印だけ出す（吸着可視化）
      clearLineGuide();
      const r = pickFirstPoint(e.clientX, e.clientY);
      if (r.snapped && r.p) guideDot(r.p, 0x39ff8a, 0.0042);
      return;
    }
    const sh = (e.shiftKey || touchShift) && drawState.mode !== 'xline' && drawState.mode !== 'circle';   // 構築線・円はShift勾配なし（常に水平）
    const r = pickSecondPoint(e.clientX, e.clientY, drawState.first, sh);
    if (!r.p) return;
    if (drawState.mode === 'xline') r.p.y = drawState.first.y;
    if (drawState.mode === 'circle') r.p.y = drawState.first.y;   // 半径点も中心の高さに合わせる（水平な円）
    drawState.cur = r.p; drawState.vert = sh; drawState.snapped = r.snapped;
    clearPreview();
    drawState.preview = buildAnn(drawState.mode, drawState.first, r.p, styleFor(drawState.mode));
    drawState.preview.traverse(o => { if (o.material) o.material.opacity = 0.6; });
    annGroup.add(drawState.preview);
    if (drawState.mode !== 'circle') drawTriangle3D(drawState.first, r.p, drawState.vert, drawState.snapped);   // 円は脚三角形を出さない
  }, true);
  window.addEventListener('contextmenu', e => {
    if (!drawActive()) return;
    if (e.target !== renderer.domElement) return;       // リボンのアイコン等は通す（書式メニューを開けるように）
    e.preventDefault(); e.stopImmediatePropagation();
    const moved = drawRDown ? Math.hypot(e.clientX - drawRDown.x, e.clientY - drawRDown.y) : 0;
    drawRDown = null;
    if (moved > 6) return;                               // 右ドラッグ＝視点パン → 取消しない
    if (drawState.locked) finishGuide();                 // 確定待ちを終える（線は残す）
    else if (drawState.first || drawState.circDim || drawState.angle) abortDrawPoint();   // 描画中の起点／半径直径ロック／角度収集を取消
    else cancelDraw();                                   // モード解除
  }, true);
  window.addEventListener('keydown', e => {
    if (!drawActive()) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;   // 入力中は無視
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      if (drawState.locked) finishGuide();
      else if (drawState.first || drawState.circDim || drawState.angle) abortDrawPoint();
      else cancelDraw();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !drawState.first && annStore.length) {
      e.stopImmediatePropagation();
      const r = annStore.pop(); annGroup.remove(r.obj); disposeObj(r.obj);   // 直近の注釈を取消
      if (r.type === 'xline') updateXlinePts();   // 構築線なら交点も引き直す
    }
  }, true);

  // ===================================================================
  //  描画後の線分：再選択 / 移動 / 端点ドラッグで長さ変更（描画モード外で動作）
  // ===================================================================
  window.__annSnapPoints = () => { const a = []; for (const r of annStore) { if (r === drawState.editRec) continue; if (annMoveSnap && selAnns.has(r)) continue; for (const sp of annSnapPoints(r)) a.push(sp); } for (const p of xlinePts) a.push(p); return a; };   // 線分=端点+中点／円=中心+四半円点（構築線は交点のみ）
  const lineSelGroup = new THREE.Group();   // 選択中の線の端点ハンドル（青球）
  modelGroup.add(lineSelGroup);
  let lineSel = null, lineDrag = null;
  const annRay2 = new THREE.Raycaster();
  annRay2.params.Line.threshold = 0.02;
  let gRec = null, gEnd = -1;   // 起点(grip)：どの線のどちらの端を「動かす起点」として大きく強調するか
  let _vAxis = null;            // Shift鉛直回転の軸（線が垂直になっても回し続けるため保持）
  let _tipAxis = null;          // 垂直線を右クリックで倒す軸（Shift軸に直交＝クロス方向）
  let _tipMode = false;         // 垂直線を右クリックで倒し始めた＝以降の右クリックも鉛直回転を継続
  function gripPt() { return (gRec && gEnd >= 0) ? (gEnd === 0 ? gRec.a : gRec.b) : null; }
  function clearGrip() { gRec = null; gEnd = -1; _vAxis = null; _tipAxis = null; _tipMode = false; }
  function clearLineHandles() {
    while (lineSelGroup.children.length) { const c = lineSelGroup.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
  }
  // 選択中の全線の端点を小さく表示し、起点(grip)に選ばれた端だけ大きく強調
  function refreshHandles() {
    clearLineHandles();
    const gp = gripPt();
    const moving = !!(lineDrag && lineDrag.mode === 'sel' && lineDrag.moved);   // 平行移動(sel)中のみ橙に戻す。伸縮(end)は緑のまま
    // 既定・平行移動中＝橙(0xff8a3c)・小。端を選択した静止状態／伸縮中の起点＝緑(0x39ff8a)・少し大。部品マーカーと同色・同形
    // 構築線は起点マーカー不要（2026-06-12 社長指示）。線分のみ両端を表示
    for (const rec of selAnns) {
      // 円/楕円は中心＋四半円点(±X,±Z)をハンドル表示。線分は両端。構築線は無し。
      const pts = rec.type === 'xline' ? [] : rec.type === 'circle' ? annSnapPoints(rec) : [rec.a, rec.b];
      for (const p of pts) {
        const chosen = (p === gp) && !moving;
        const m = new THREE.Mesh(new THREE.SphereGeometry(chosen ? 0.0028 : 0.0015, 16, 12),
          new THREE.MeshBasicMaterial({ color: chosen ? 0x39ff8a : 0xff8a3c, depthTest: false, transparent: true, opacity: 0.92 }));
        m.position.copy(p); m.renderOrder = 999; lineSelGroup.add(m);
      }
    }
  }
  function showLineHandles() { refreshHandles(); }   // 旧呼び出し互換（引数は無視）
  // 掴んだ線の、カーソルに近い端点の情報（点・端番号0/1・端の近くを押したか）
  function nearestEndpointInfo(rec, cx, cy) {
    if (rec.type === 'xline') return { pt: rec.a, end: 0, near: false };   // 構築線は中心(a)を移動起点に・端点掴みなし
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    const scr = p => { const n = modelGroup.localToWorld(p.clone()).project(cam); return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height }; };
    const sa = scr(rec.a), sb = scr(rec.b);
    const da = Math.hypot(sa.x - cx, sa.y - cy), db = Math.hypot(sb.x - cx, sb.y - cy);
    const end = da <= db ? 0 : 1;
    return { pt: end === 0 ? rec.a : rec.b, end, near: Math.min(da, db) < (SNAP_PX + 6) };
  }
  // 円の四半円点ハンドル（±X, ±Z）のうちカーソル近傍のもの。{axis:'x'|'z', sign, pt, dir} or null（dir=その軸のワールド単位ベクトル）
  function circleHandleAt(rec, cx, cy) {
    if (rec.type !== 'circle') return null;
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    const scr = p => { const n = modelGroup.localToWorld(p.clone()).project(cam); return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height, z: n.z }; };
    const { rx, rz } = circleRadii(rec.style, rec.a, rec.b), c = rec.a, q = quatFromStyle(rec.style);
    const ax = new V3(1, 0, 0).applyQuaternion(q), az = new V3(0, 0, 1).applyQuaternion(q);   // X・Z軸のワールド向き
    const cands = [
      { axis: 'x', dir: ax, pt: c.clone().addScaledVector(ax, rx) }, { axis: 'x', dir: ax, pt: c.clone().addScaledVector(ax, -rx) },
      { axis: 'z', dir: az, pt: c.clone().addScaledVector(az, rz) }, { axis: 'z', dir: az, pt: c.clone().addScaledVector(az, -rz) },
    ];
    let best = null, bestD = SNAP_PX + 6;
    for (const h of cands) { const s = scr(h.pt); if (s.z >= 1) continue; const d = Math.hypot(s.x - cx, s.y - cy); if (d < bestD) { bestD = d; best = h; } }
    return best;
  }
  let dimValOpen = false;                      // 値フォームを開くのは「値クリック」時のみ（オブジェクト選択では出さない）
  let dimValEditing = false;                   // true＝既存値の編集（引出ラベル「編集」）／false＝新規入力（引出ラベル「入力」）
  function selectLine(rec, additive) {
    selectPart(null);                          // 部品選択を解除（部品クリックと同じ排他。__annClearSelも走る）
    if (!additive) selAnns.clear();
    selAnns.add(rec); lineSel = rec;
    clearGrip();                               // 選択しただけ＝起点未選択（端点は小さいまま）
    dimValOpen = false;                        // オブジェクトをクリックして選択＝値フォームは出さない（Delで削除できる）
    drawState.dimReadjust = null;              // 別アイテム選択で再調整は解除
    if (!additive && rec.groupId != null) {    // グループの一員を選んだら、同グループの注釈・部品も一緒に選択
      for (const r of annStore) if (r.groupId === rec.groupId) selAnns.add(r);
      if (window.__selectPartsGroup) window.__selectPartsGroup(rec.groupId);
    }
    refreshAnnHi(); refreshHandles();
    if (typeof updateForm === 'function') updateForm();   // EL入力フォームを起点側に表示
  }
  function deselectLine() { lineSel = null; clearLineHandles(); selAnns.clear(); clearAnnHi(); clearGrip(); dimValOpen = false; drawState.dimReadjust = null; if (typeof updateForm === 'function') updateForm(); }
  window.__openDimValueForm = (editing) => { dimValOpen = true; dimValEditing = !!editing; };   // 値クリック/再編集=true、新規入力=false

  // ---- 線分の複数選択（Ctrl+クリック／窓選択）。部品の selectedParts と並行管理 ----
  // 選択表示は部品と同じく「青く発光」させる＝線そのものの色を SEL_COLOR に塗り替え、解除で元色へ戻す
  const selAnns = new Set();                 // 選択中の注釈レコード集合
  function paintAnn(rec, on, color) {
    const fallback = rec.style ? rec.style.color : 0xffffff;
    const onCol = (color != null) ? color : SEL_COLOR;
    const isTextAnn = rec.style && rec.style.dimKind === 'text';
    rec.obj.traverse(o => {
      if (o.type === 'Sprite') {
        if (isTextAnn && o.material && o.material.color) o.material.color.setHex(on ? onCol : 0xffffff);   // 文字注釈は選択時に着色して選択を可視化
        return;
      }
      if (!o.material || !o.material.color) return;
      // on＝指定色（既定は青の選択発光）。解除時は各メッシュ固有の色（レーザーの芯/暈）へ、無ければ線色へ戻す
      o.material.color.setHex(on ? onCol : (o.userData.baseColor != null ? o.userData.baseColor : fallback));
    });
  }
  function refreshAnnHi() { for (const rec of annStore) paintAnn(rec, selAnns.has(rec)); }
  function clearAnnHi() { for (const rec of annStore) paintAnn(rec, false); }
  // 2線分(ax,ay-bx,by)と(cx,cy-dx,dy)が交差するか（画面座標）
  function segSeg(ax, ay, bx, by, cx, cy, dx, dy) {
    const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
    const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }
  function segRectCross(ax, ay, bx, by, x0, y0, x1, y1) {   // 線分が矩形の縁を横切るか
    return segSeg(ax, ay, bx, by, x0, y0, x1, y0) || segSeg(ax, ay, bx, by, x1, y0, x1, y1)
        || segSeg(ax, ay, bx, by, x1, y1, x0, y1) || segSeg(ax, ay, bx, by, x0, y1, x0, y0);
  }
  // 矩形(client座標)に掛かる線分を選択へ積み増す。返り値＝選択総数
  window.__annSelectInRect = (x0, y0, x1, y1) => {
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    cam.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(cam.matrixWorld).invert();
    let added = 0;
    for (const rec of annStore) {
      const seg = annScreenSeg(rec, rect, cam, inv);   // ニアプレーンクリップ済（構築線も正しく判定）
      if (!seg) continue;
      const { pa, pb } = seg;
      const inA = pa.x >= x0 && pa.x <= x1 && pa.y >= y0 && pa.y <= y1;
      const inB = pb.x >= x0 && pb.x <= x1 && pb.y >= y0 && pb.y <= y1;
      if (inA || inB || segRectCross(pa.x, pa.y, pb.x, pb.y, x0, y0, x1, y1)) {
        if (!selAnns.has(rec)) { selAnns.add(rec); added++; }
      }
    }
    if (added) refreshAnnHi();
    if (added) { refreshHandles(); if (typeof updateForm === 'function') updateForm(); }
    return selAnns.size;
  };
  window.__annHasSel = () => selAnns.size > 0;
  // ---- グループ化用（注釈側） ----
  window.__annSelCount = () => selAnns.size;
  window.__annSetGroup = (gid) => { for (const r of selAnns) r.groupId = gid; };   // 選択中の注釈にグループID付与
  window.__annSelGroupIds = () => { const s = new Set(); for (const r of selAnns) if (r.groupId != null) s.add(r.groupId); return [...s]; };
  window.__annClearGroupIds = (gidSet) => { for (const r of annStore) if (r.groupId != null && gidSet.has(r.groupId)) r.groupId = null; };
  window.__annAddGroupToSel = (gid) => { let add = false; for (const r of annStore) if (r.groupId === gid && !selAnns.has(r)) { selAnns.add(r); add = true; } if (add) { refreshAnnHi(); refreshHandles(); } };
  // 単独選択中の文字注釈（シーン右クリックで書式メニューを出す判定用）
  window.__selSingleTextRec = () => (selAnns.size === 1 && lineSel && lineSel.type === 'dim' && lineSel.style && lineSel.style.dimKind === 'text') ? lineSel : null;
  // 文字書式：選択中の文字注釈に色・飾りを適用（リボン文字右クリックメニューから）
  window.__applyTextFmtToSel = (color, deco) => {
    let any = false;
    for (const r of selAnns) if (r.style && r.style.dimKind === 'text') { r.style.textColor = color; r.style.textDeco = deco; rebuildAnn(r); any = true; }
    if (any) refreshAnnHi();
  };
  window.__annDeselect = () => deselectLine();   // 構築線のEL→角度連鎖の「閉じ」用
  window.__annSelectRec = (rec) => { if (annStore.includes(rec)) selectLine(rec); };   // 寸法確定後に選択して「値」フォームを出す用
  window.__annDeleteRec = (rec) => {              // 特定の注釈を1件削除（スピナー中のDelete用）
    const i = annStore.indexOf(rec); if (i < 0) return;
    annStore.splice(i, 1); annGroup.remove(rec.obj); disposeObj(rec.obj);
    if (lineSel === rec) { lineSel = null; clearLineHandles(); clearGrip(); }
    selAnns.delete(rec); refreshAnnHi(); refreshHandles();
    if (rec.type === 'xline') updateXlinePts();
    if (typeof updateForm === 'function') updateForm();
  };
  // 部品選択時などの線選択全解除。lineSel も必ず消す（残っているとパイプ端クリックを
  // 寸法線の起点掴みが横取りする等の事故源になる・2026-06-13 修正）
  window.__annClearSel = () => {
    if (selAnns.size || lineSel) {
      lineSel = null; clearLineHandles(); clearGrip();
      selAnns.clear(); clearAnnHi(); refreshHandles();
      if (typeof updateForm === 'function') updateForm();
    }
  };
  // Ctrl+クリック：カーソル下の線を選択へ出し入れ（部品の個別トグルと同じ感覚）。線が無ければ false
  window.__annToggleAt = (cx, cy) => {
    const rec = pickAnnAt(cx, cy);
    if (!rec) return false;
    if (selAnns.has(rec)) { selAnns.delete(rec); if (lineSel === rec) { lineSel = null; clearLineHandles(); } }
    else { selAnns.add(rec); lineSel = rec; showLineHandles(rec); }
    refreshAnnHi();
    if (typeof updateForm === 'function') updateForm();
    return true;
  };
  // EL基準点（起点側）：選んだ起点があればその端、無ければ主選択線のa端。modelGroupローカル点 or null
  function lineElRefPt() {
    if (!selAnns.size) return null;
    const gp = gripPt();
    if (gp) return gp;
    if (lineSel) return lineSel.a;
    for (const r of selAnns) return r.a;
    return null;
  }
  window.__lineElRef = () => {
    if (lineSel && lineSel.type === 'dim' && selAnns.size === 1) return null;    // 寸法線はEL機能なし（2026-06-13 社長指示）
    if (drawState.editRec) return null;                                          // 端点編集中はEL非表示（脚=Z欄に切替）
    if (lineDrag && lineDrag.mode === 'sel' && !lineDrag.free && lineDrag.moved) return null;   // 直行(水平)移動中はEL非表示（X/Z/L欄）
    const p = lineElRefPt(); return p ? p.clone() : null;
  };
  // EL入力→高さ調整。起点(片端)を選んでいる時はその端だけ上下（傾く）。起点未選択なら選択中の全線を一緒に上下
  window.__lineApplyEl = (mm) => {
    const isX = lineSel && lineSel.type === 'xline';   // 構築線は中心グリップでも傾けず、線全体を平行に上下
    const gp = isX ? null : gripPt();
    if (gp) {                                         // 起点指定済み＝その端だけY移動
      const dy = mm / 1000 - gp.y;
      if (Math.abs(dy) < 1e-9) return;
      gp.y += dy;
      for (const r of selAnns) { if (r.a === gp || r.b === gp) { rebuildAnn(r); break; } }
    } else {                                          // 起点未選択＝全体を上下（傾き保持）
      const ref = lineElRefPt(); if (!ref) return;
      const dy = mm / 1000 - ref.y;
      if (Math.abs(dy) < 1e-9) return;
      for (const r of selAnns) { r.a.y += dy; r.b.y += dy; rebuildAnn(r); }
    }
    refreshAnnHi(); refreshHandles();
  };
  // 右クリック：選択中の線を起点(grip)まわりに45°回転。通常＝水平面(Y軸)まわり、Shift＝鉛直面まわり（どちらも回り続ける）
  // 直径寸法は a,b が中心を挟む両縁なので、回転の支点は円の中心（中点）にする
  function dimRotPivot() {
    if (selAnns.size === 1 && lineSel && lineSel.type === 'dim' && lineSel.style && lineSel.style.dimKind === 'diameter') {
      return lineSel.a.clone().add(lineSel.b).multiplyScalar(0.5);
    }
    return null;
  }
  window.__annRotate = (shift) => {
    if (!selAnns.size) return;
    // 文字（単独選択）：右クリック＝画面内で45°回転（Shiftで逆回り）
    if (selAnns.size === 1 && lineSel && lineSel.type === 'dim' && lineSel.style && lineSel.style.dimKind === 'text') {
      lineSel.style.textRot = (((lineSel.style.textRot || 0) + (shift ? -45 : 45)) % 360 + 360) % 360;
      refreshAnnHi();
      return;
    }
    let pivot = dimRotPivot() || gripPt() || (lineSel ? lineSel.a : null);
    if (!pivot) { for (const r of selAnns) { pivot = r.a; break; } }
    if (!pivot) return;
    const ang = Math.PI / 4;
    // 起点→他端の方向（垂直判定・鉛直軸の決定用）
    let dirRef = lineSel ? (lineSel.a === pivot ? lineSel.b : lineSel.a).clone().sub(pivot) : null;
    if (!dirRef) for (const r of selAnns) { dirRef = (r.a === pivot ? r.b : r.a).clone().sub(pivot); break; }
    const isVertical = dirRef && (dirRef.x * dirRef.x + dirRef.z * dirRef.z) < 1e-6 && Math.abs(dirRef.y) > 1e-6;
    const baseAxis = () => (dirRef && (dirRef.x * dirRef.x + dirRef.z * dirRef.z) > 1e-9) ? new V3(-dirRef.z, 0, dirRef.x).normalize() : new V3(1, 0, 0);
    let axis, signed = ang;
    if (shift) {                                     // Shift＝鉛直面まわり（軸は固定）
      _tipMode = false; if (!_vAxis) _vAxis = baseAxis(); axis = _vAxis;
    } else if (isVertical || _tipMode) {             // 垂直線の右クリック＝Shift面に直交する鉛直面（クロス方向）で倒す。倒し始めたら継続（一周）
      _tipMode = true;
      if (!_tipAxis) { const b = _vAxis || baseAxis(); _tipAxis = new V3(-b.z, 0, b.x).normalize(); }   // Shift軸に直交する水平軸
      axis = _tipAxis;
    } else {                                         // 通常の右クリック＝水平面まわり（Y軸）
      _vAxis = null; _tipAxis = null; axis = new V3(0, 1, 0);
    }
    const q = new THREE.Quaternion().setFromAxisAngle(axis, signed);
    const rot = p => { const v = p.clone().sub(pivot).applyQuaternion(q); p.copy(pivot).add(v); };
    for (const r of selAnns) {
      if (r.type === 'circle') {                       // 円/楕円：中心まわりの向き(quat)を合成して回す。中心が起点でなければ中心も公転
        r.style = r.style || {};
        const cq = q.clone().multiply(quatFromStyle(r.style));
        r.style.quat = { x: cq.x, y: cq.y, z: cq.z, w: cq.w };
        if (r.a !== pivot) rot(r.a);
        const ax = new V3(1, 0, 0).applyQuaternion(cq);
        r.b.copy(r.a.clone().addScaledVector(ax, circleRadii(r.style, r.a, r.b).rx));   // bを+X四半円点へ
        rebuildAnn(r);
      } else {
        if (r.a !== pivot) rot(r.a); if (r.b !== pivot) rot(r.b);
        if (r.style && r.style.angP2) { const p2 = new V3(r.style.angP2[0], r.style.angP2[1], r.style.angP2[2]); rot(p2); r.style.angP2 = [p2.x, p2.y, p2.z]; }
        rebuildAnn(r);
      }
    }
    refreshAnnHi(); refreshHandles();
    if (typeof updateForm === 'function') updateForm();
  };
  // 角度スピナー回転：開始時にスナップ＋軸を固定し、任意角度で回す（右クリック長押し用）
  let _rotSpin = null;
  window.__annRotateSpinStart = (shift) => {
    if (!selAnns.size) return false;
    if (selAnns.size === 1 && lineSel && lineSel.type === 'dim' && lineSel.style && lineSel.style.dimKind === 'text') {
      _rotSpin = { textRec: lineSel, startRot: lineSel.style.textRot || 0, pivot: lineSel.a.clone() };   // 文字：画面内回転
      return true;
    }
    let pivot = dimRotPivot() || gripPt() || (lineSel ? lineSel.a : null);
    if (!pivot) { for (const r of selAnns) { pivot = r.a; break; } }
    if (!pivot) return false;
    let dirRef = lineSel ? (lineSel.a === pivot ? lineSel.b : lineSel.a).clone().sub(pivot) : null;
    if (!dirRef) for (const r of selAnns) { dirRef = (r.a === pivot ? r.b : r.a).clone().sub(pivot); break; }
    const horiz = dirRef ? (dirRef.x * dirRef.x + dirRef.z * dirRef.z) : 0;
    const isVertical = dirRef && horiz < 1e-6 && Math.abs(dirRef.y) > 1e-6;
    const base = horiz > 1e-9 ? new V3(-dirRef.z, 0, dirRef.x).normalize() : new V3(1, 0, 0);
    let axis;
    if (shift) axis = base;                                      // 鉛直面まわり
    else if (isVertical) axis = new V3(-base.z, 0, base.x).normalize();   // 垂直線はクロス方向
    else axis = new V3(0, 1, 0);                                 // 通常は水平面（Y軸）
    _rotSpin = { pivot: pivot.clone(), axis, snap: [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone(), quat: r.type === 'circle' ? quatFromStyle(r.style) : null, ap: (r.style && r.style.angP2) ? r.style.angP2.slice() : null })) };
    return true;
  };
  window.__annRotateSpinApply = (deg) => {
    if (!_rotSpin) return;
    if (_rotSpin.textRec) { _rotSpin.textRec.style.textRot = (((_rotSpin.startRot + deg) % 360) + 360) % 360; return; }   // 文字：画面内角度
    const q = new THREE.Quaternion().setFromAxisAngle(_rotSpin.axis, deg * Math.PI / 180);
    for (const s of _rotSpin.snap) {
      const va = s.a.clone().sub(_rotSpin.pivot).applyQuaternion(q); s.r.a.copy(_rotSpin.pivot).add(va);
      if (s.r.type === 'circle') {                     // 円/楕円：snapshotの向きにqを合成。bは+X四半円点へ
        s.r.style = s.r.style || {};
        const cq = q.clone().multiply(s.quat);
        s.r.style.quat = { x: cq.x, y: cq.y, z: cq.z, w: cq.w };
        const ax = new V3(1, 0, 0).applyQuaternion(cq);
        s.r.b.copy(s.r.a.clone().addScaledVector(ax, circleRadii(s.r.style, s.r.a, s.r.b).rx));
      } else {
        const vb = s.b.clone().sub(_rotSpin.pivot).applyQuaternion(q); s.r.b.copy(_rotSpin.pivot).add(vb);
        if (s.ap) { const p2 = new V3(s.ap[0], s.ap[1], s.ap[2]).sub(_rotSpin.pivot).applyQuaternion(q).add(_rotSpin.pivot); s.r.style.angP2 = [p2.x, p2.y, p2.z]; }
      }
      rebuildAnn(s.r);
    }
    refreshAnnHi(); refreshHandles();
    if (typeof updateForm === 'function') updateForm();
  };
  window.__annRotateSpinEnd = () => { _rotSpin = null; };
  window.__annRotateSpinCancel = () => {
    if (!_rotSpin) return;
    if (_rotSpin.textRec) { _rotSpin.textRec.style.textRot = _rotSpin.startRot; _rotSpin = null; return; }
    for (const s of _rotSpin.snap) { s.r.a.copy(s.a); s.r.b.copy(s.b); if (s.r.type === 'circle' && s.quat) s.r.style.quat = { x: s.quat.x, y: s.quat.y, z: s.quat.z, w: s.quat.w }; if (s.ap) s.r.style.angP2 = s.ap.slice(); rebuildAnn(s.r); }
    _rotSpin = null; refreshAnnHi(); refreshHandles();
  };
  window.__annRotateSpinActive = () => !!_rotSpin;
  window.__annRotateSpinPivot = () => _rotSpin ? _rotSpin.pivot.clone() : null;
  // 選択中の注釈に構築線が含まれるか（右クリック微調整の分岐用）
  window.__annSelIsXline = () => { for (const r of selAnns) if (r.type === 'xline') return true; return false; };
  // 平行移動スピナー：構築線を、その向きに直交する水平方向へ mm 単位で平行移動（右クリック長押し・無Shift用）
  let _annMoveSpin = null;
  window.__annMoveSpinStart = () => {
    if (!selAnns.size) return false;
    const base = lineSel || [...selAnns][0];
    const d = base.b.clone().sub(base.a), horiz = d.x * d.x + d.z * d.z;
    const dir = horiz > 1e-9 ? new V3(-d.z, 0, d.x).normalize() : new V3(1, 0, 0);   // 水平向きに直交。垂直線はX方向
    _annMoveSpin = { dir, snap: [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone() })) };
    return true;
  };
  window.__annMoveSpinApply = (mm) => {
    if (!_annMoveSpin) return;
    const off = _annMoveSpin.dir.clone().multiplyScalar(mm / 1000);
    for (const s of _annMoveSpin.snap) { s.r.a.copy(s.a).add(off); s.r.b.copy(s.b).add(off); rebuildAnn(s.r); }
    refreshAnnHi(); refreshHandles();
    if (typeof updateForm === 'function') updateForm();
  };
  window.__annMoveSpinEnd = () => { _annMoveSpin = null; };
  window.__annMoveSpinCancel = () => {
    if (!_annMoveSpin) return;
    for (const s of _annMoveSpin.snap) { s.r.a.copy(s.a); s.r.b.copy(s.b); rebuildAnn(s.r); }
    _annMoveSpin = null; refreshAnnHi(); refreshHandles();
  };
  window.__annMoveSpinActive = () => !!_annMoveSpin;
  window.__annMoveSpinPivot = () => { const base = lineSel || [...selAnns][0]; return base ? base.a.clone() : null; };
  // 方位角スピナー：構築線を中心まわり（水平面・Y軸）に、絶対角度(°)で向ける（配置直後の角度調整・Shift右クリック長押し用）
  let _headingSpin = null;
  function xlineHeadingDeg(rec) { const d = rec.b.clone().sub(rec.a); let a = Math.atan2(-d.z, d.x) * 180 / Math.PI; return ((a % 180) + 180) % 180; }
  window.__annHeadingSpinStart = () => {
    if (!selAnns.size) return false;
    const base = lineSel || [...selAnns][0];
    const d = base.b.clone().sub(base.a);
    if (d.x * d.x + d.z * d.z < 1e-9) return false;   // 水平成分が無い（垂直）線は方位回転しない
    _headingSpin = { start: xlineHeadingDeg(base), pivot: base.a.clone(), snap: [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone() })) };
    return true;
  };
  window.__annHeadingSpinStartDeg = () => _headingSpin ? _headingSpin.start : 0;
  window.__annHeadingSpinApply = (absDeg) => {
    if (!_headingSpin) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), (absDeg - _headingSpin.start) * Math.PI / 180);
    for (const s of _headingSpin.snap) {
      const va = s.a.clone().sub(_headingSpin.pivot).applyQuaternion(q); s.r.a.copy(_headingSpin.pivot).add(va);
      const vb = s.b.clone().sub(_headingSpin.pivot).applyQuaternion(q); s.r.b.copy(_headingSpin.pivot).add(vb);
      rebuildAnn(s.r);
    }
    refreshAnnHi(); refreshHandles();
    if (typeof updateForm === 'function') updateForm();
  };
  window.__annHeadingSpinEnd = () => { _headingSpin = null; };
  window.__annHeadingSpinCancel = () => {
    if (!_headingSpin) return;
    for (const s of _headingSpin.snap) { s.r.a.copy(s.a); s.r.b.copy(s.b); rebuildAnn(s.r); }
    _headingSpin = null; refreshAnnHi(); refreshHandles();
  };
  window.__annHeadingSpinActive = () => !!_headingSpin;
  window.__annHeadingSpinPivot = () => _headingSpin ? _headingSpin.pivot.clone() : null;
  // ---- 立面寸法線の逃げ方位スピナー（確定直後に方位を数値指定・0.5°刻み・0〜360°） ----
  let _dimDirSpin = null;
  function dimDirFromDeg(deg) { const r = deg * Math.PI / 180; return { x: Math.cos(r), y: 0, z: -Math.sin(r) }; }
  window.__dimDirSpinStart = (rec) => {
    if (!rec || rec.type !== 'dim' || !rec.style || !rec.style.dimDir || !rec.style.dimOff) return false;
    const d = rec.style.dimDir;
    let deg = Math.atan2(-d.z, d.x) * 180 / Math.PI;
    deg = ((deg % 360) + 360) % 360;
    _dimDirSpin = { rec, start: deg };
    return true;
  };
  window.__dimDirSpinStartDeg = () => _dimDirSpin ? _dimDirSpin.start : 0;
  window.__dimDirSpinApply = (absDeg) => {
    if (!_dimDirSpin) return;
    _dimDirSpin.rec.style.dimDir = dimDirFromDeg(absDeg);
    rebuildAnn(_dimDirSpin.rec);
  };
  window.__dimDirSpinEnd = () => { _dimDirSpin = null; };
  window.__dimDirSpinCancel = () => {
    if (!_dimDirSpin) return;
    _dimDirSpin.rec.style.dimDir = dimDirFromDeg(_dimDirSpin.start);
    rebuildAnn(_dimDirSpin.rec);
    _dimDirSpin = null;
  };
  window.__dimDirSpinActive = () => !!_dimDirSpin;
  window.__dimDirSpinPivot = () => {
    if (!_dimDirSpin) return null;
    const s = _dimDirSpin.rec.style, dd = s.dimDir;
    const dv = new V3(dd.x, dd.y, dd.z).multiplyScalar(s.dimOff || 0);
    return _dimDirSpin.rec.a.clone().add(_dimDirSpin.rec.b).multiplyScalar(0.5).add(dv);   // 寸法線本体の中点
  };
  // ---- 寸法線の逃げ量スピナー（確定直後に逃げの長さを mm で指定・1mm刻み） ----
  let _dimOffSpin = null;
  window.__dimOffSpinStart = (rec) => {
    if (!rec || rec.type !== 'dim' || !rec.style || !rec.style.dimDir) return false;
    _dimOffSpin = { rec, start: rec.style.dimOff || 0 };
    return true;
  };
  window.__dimOffSpinStartMm = () => _dimOffSpin ? Math.round((_dimOffSpin.start || 0) * 1000) : 0;
  window.__dimOffSpinApply = (mm) => {
    if (!_dimOffSpin) return;
    _dimOffSpin.rec.style.dimOff = (mm || 0) / 1000;
    rebuildAnn(_dimOffSpin.rec);
  };
  window.__dimOffSpinEnd = () => { _dimOffSpin = null; };
  window.__dimOffSpinCancel = () => {
    if (!_dimOffSpin) return;
    _dimOffSpin.rec.style.dimOff = _dimOffSpin.start;
    rebuildAnn(_dimOffSpin.rec);
    _dimOffSpin = null;
  };
  window.__dimOffSpinActive = () => !!_dimOffSpin;
  window.__dimOffSpinPivot = () => {
    if (!_dimOffSpin) return null;
    const s = _dimOffSpin.rec.style, dd = s.dimDir;
    const dv = new V3(dd.x, dd.y, dd.z).multiplyScalar(s.dimOff || 0);
    return _dimOffSpin.rec.a.clone().add(_dimOffSpin.rec.b).multiplyScalar(0.5).add(dv);
  };
  // ---- スライド寸法（補助線を斜めに倒す）。右クリックで +45°⇄−45°、スピナーで微調整 ----
  window.__annSelIsSingleDim = () => selAnns.size === 1 && !!(lineSel && lineSel.type === 'dim' && lineSel.style && lineSel.style.dimDir && lineSel.style.dimOff);
  window.__dimSkewToggle = () => {
    if (!window.__annSelIsSingleDim()) return null;
    const rec = lineSel;
    const cur = rec.style.dimSkew || 0;
    rec.style.dimSkew = cur > 0 ? -45 : (cur < 0 ? 0 : 45);   // 1回目=+45°→2回目=−45°→3回目=0（元に戻る）→繰り返し
    rebuildAnn(rec); refreshAnnHi(); refreshHandles();
    return rec;
  };
  // ---- 逃げ方向の回転（Shift+右クリック）：AB軸まわりに45°刻みで回す（水平→斜め→上下→…） ----
  function dimRollRefs(rec) {
    const ab = rec.b.clone().sub(rec.a), l = ab.length();
    const u = l > 1e-9 ? ab.multiplyScalar(1 / l) : new V3(1, 0, 0);
    let r1 = new V3(-u.z, 0, u.x);                      // ABの水平直交（基準0°）
    if (r1.lengthSq() < 1e-9) r1.set(1, 0, 0);          // ABが垂直ならX方向を基準に
    r1.normalize();
    const r2 = new V3().crossVectors(u, r1).normalize();
    return { r1, r2 };
  }
  function dimRollDeg(rec) {
    const refs = dimRollRefs(rec);
    const d = rec.style.dimDir, v = new V3(d.x, d.y, d.z);
    let deg = Math.atan2(v.dot(refs.r2), v.dot(refs.r1)) * 180 / Math.PI;
    return ((deg % 360) + 360) % 360;
  }
  function setDimRoll(rec, deg) {
    const refs = dimRollRefs(rec);
    const rad = deg * Math.PI / 180;
    const v = refs.r1.clone().multiplyScalar(Math.cos(rad)).addScaledVector(refs.r2, Math.sin(rad));
    rec.style.dimDir = { x: v.x, y: v.y, z: v.z };
    rebuildAnn(rec); refreshAnnHi(); refreshHandles();
  }
  window.__dimRollStep = () => {
    if (!window.__annSelIsSingleDim()) return null;
    const rec = lineSel;
    setDimRoll(rec, (Math.round(dimRollDeg(rec) / 45) * 45 + 45) % 360);
    return rec;
  };
  let _dimRollSpin = null;
  window.__dimRollSpinStart = (rec) => { if (!rec || rec.type !== 'dim') return false; _dimRollSpin = { rec, start: dimRollDeg(rec) }; return true; };
  window.__dimRollSpinStartDeg = () => _dimRollSpin ? _dimRollSpin.start : 0;
  window.__dimRollSpinApply = (deg) => { if (_dimRollSpin) setDimRoll(_dimRollSpin.rec, deg); };
  window.__dimRollSpinEnd = () => { _dimRollSpin = null; };
  window.__dimRollSpinCancel = () => { if (!_dimRollSpin) return; setDimRoll(_dimRollSpin.rec, _dimRollSpin.start); _dimRollSpin = null; };
  window.__dimRollSpinActive = () => !!_dimRollSpin;
  window.__dimRollSpinPivot = () => {
    if (!_dimRollSpin) return null;
    const r = _dimRollSpin.rec;
    const ends = dimLineEnds(r.a, r.b, r.style);
    return ends ? ends.A2.clone().add(ends.B2).multiplyScalar(0.5) : r.a.clone().add(r.b).multiplyScalar(0.5);
  };
  // ---- 寸法の「値」上書き（任意の値）。単独選択中の寸法線に対して hForm（値欄）で入力 ----
  window.__dimValueSel = () => (selAnns.size === 1 && lineSel && lineSel.type === 'dim') ? lineSel : null;
  window.__dimValueGet = () => {
    const r = window.__dimValueSel(); if (!r) return '';
    return (r.style.dimText != null && r.style.dimText !== '') ? r.style.dimText : dimMeasuredStr(r.a, r.b, r.style);
  };
  window.__dimValueApply = (v) => {
    const r = window.__dimValueSel(); if (!r) return;
    const meas = dimMeasuredStr(r.a, r.b, r.style);
    const s = String(v).trim();
    r.style.dimText = (s !== '' && s !== meas) ? s : null;   // 実測表示と同じ／空なら上書き解除
    rebuildAnn(r); refreshAnnHi();
  };
  // 寸法の値（赤文字）の表示位置。種別ごとに値テキストの実位置に合わせる。
  function dimValueAnchor(rec) {
    const s = rec.style || {}, kind = s.dimKind || 'parallel';
    if (kind === 'leader') { let h = new V3(rec.b.x - rec.a.x, 0, rec.b.z - rec.a.z); if (h.lengthSq() < 1e-9) h.set(1, 0, 0); h.normalize(); return rec.b.clone().addScaledVector(h, 0.02).addScaledVector(new V3(0, 1, 0), 0.005); }
    if (kind === 'angle') { const g = angleArcGeom(rec.a, rec.b, s, 24); return g.arc[Math.floor(g.N / 2)] || rec.a.clone(); }
    if (kind === 'radius' || kind === 'diameter') {
      const C = kind === 'radius' ? rec.a.clone() : rec.a.clone().add(rec.b).multiplyScalar(0.5);
      const dir = rec.b.clone().sub(C); const Rd = dir.length(); if (Rd > 1e-9) dir.multiplyScalar(1 / Rd);
      const lead = s.dimLead != null ? s.dimLead : Rd * 0.55;
      return C.addScaledVector(dir, lead);
    }
    const ends = dimLineEnds(rec.a, rec.b, s);
    return ends ? ends.A2.clone().add(ends.B2).multiplyScalar(0.5) : rec.a.clone().add(rec.b).multiplyScalar(0.5);
  }
  window.__dimValuePivot = () => { const r = window.__dimValueSel(); return r ? dimValueAnchor(r) : null; };
  // ---- 寸法値の上書き入力フォーム（自由テキスト可・補助線や実測はそのまま） ----
  const dimValForm = document.createElement('div');
  dimValForm.id = 'dimValForm';
  dimValForm.style.cssText = 'position:fixed;z-index:70;display:none;align-items:center;gap:4px;padding:2px 6px;font:12px Meiryo,sans-serif;color:#ffd9d9;background:rgba(40,12,12,.85);border:1px solid #a04040;border-radius:4px';
  const dimValLabel = document.createElement('span');
  dimValLabel.textContent = '値';
  dimValForm.appendChild(dimValLabel);
  const dimValInput = document.createElement('input');
  dimValInput.type = 'text';
  dimValInput.style.cssText = 'width:96px;font:bold 12px Meiryo,sans-serif;color:#ff6a5a;background:#1a0e0e;border:1px solid #7a3030;border-radius:3px;padding:1px 4px';
  dimValForm.appendChild(dimValInput);
  document.body.appendChild(dimValForm);
  const applyDimVal = () => {
    const r = window.__dimValueSel(); if (!r) return;
    const meas = dimMeasuredStr(r.a, r.b, r.style);
    const s = dimValInput.value.trim();
    r.style.dimText = (s !== '' && s !== meas) ? s : null;   // 空欄 or 実測と同じ＝上書き解除（実測表示へ）
    rebuildAnn(r); refreshAnnHi();
  };
  dimValInput.addEventListener('input', applyDimVal);
  dimValInput.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); applyDimVal(); dimValInput.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); dimValInput.blur(); }
  });
  dimValInput.addEventListener('blur', () => { dimValOpen = false; });   // 編集終了＝フォームを閉じる（以後はDelで削除可）
  // 寸法の値（赤文字）の画面上の当たり判定。クリックされた寸法線レコードを返す
  function pickDimTextAt(cx, cy) {
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    cam.updateMatrixWorld();
    const camRight = new V3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const camUp = new V3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const scr = wp => { const n = wp.clone().project(cam); return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height, z: n.z }; };
    for (const rec of annStore) {
      if (rec.type !== 'dim') continue;
      let hit = false;
      rec.obj.traverse(o => {
        if (hit || !o.userData.dimText) return;
        const cW = modelGroup.localToWorld(o.position.clone());
        const pc = scr(cW); if (pc.z >= 1) return;
        const px = scr(cW.clone().addScaledVector(camRight, o.scale.x / 2));
        const py = scr(cW.clone().addScaledVector(camUp, o.scale.y / 2));
        const rx = Math.hypot(px.x - pc.x, px.y - pc.y) + 4;   // 画面半幅＋余裕
        const ry = Math.hypot(py.x - pc.x, py.y - pc.y) + 4;
        const th = (o.material && o.material.rotation) || 0;   // 文字の画面回転に合わせた座標系で矩形判定
        const dxs = cx - pc.x, dys = cy - pc.y;
        const along = dxs * Math.cos(th) - dys * Math.sin(th);
        const across = dxs * Math.sin(th) + dys * Math.cos(th);
        if (Math.abs(along) <= rx && Math.abs(across) <= ry) hit = true;
      });
      if (hit) return rec;
    }
    return null;
  }
  window.__pickDimTextAt = pickDimTextAt;
  // 値フォームを開いてフォーカス（文字クリック時）
  window.__focusDimValueInput = () => {
    setTimeout(() => {
      if (window.__positionDimValueForm) window.__positionDimValueForm();
      if (dimValForm.style.display !== 'none') { dimValInput.focus(); dimValInput.select(); }
    }, 30);
  };
  // 毎フレーム：選択中の寸法線の本体中点脇に「値」フォームを追従（スピナー表示中・未選択は隠す）
  window.__positionDimValueForm = () => {
    const rotVisible = rotForm && rotForm.style.display === 'flex';
    const rmbDown = typeof rDownPos !== 'undefined' && rDownPos;   // 右クリック操作中（スライド切替等）は一瞬でも出さない
    const r = (!selectedPart && selectedParts.size === 0) ? window.__dimValueSel() : null;
    const mirroring = window.__mirrorActive && window.__mirrorActive();
    if (!r || !dimValOpen || rotVisible || rmbDown || lineDrag || mirroring) { dimValForm.style.display = 'none'; return; }   // 値クリックで開いた時のみ表示（オブジェクト選択中は出さない）
    const piv = dimValueAnchor(r);
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const ndc = modelGroup.localToWorld(piv).project(cam);
    if (ndc.z >= 1) { dimValForm.style.display = 'none'; return; }
    const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    dimValForm.style.display = 'flex';
    dimValLabel.textContent = (r.style && (r.style.dimKind === 'leader' || r.style.dimKind === 'text')) ? (dimValEditing ? '編集' : '入力') : '値';   // 引出・文字＝編集/入力・他は値
    if (document.activeElement !== dimValInput) {
      dimValInput.value = (r.style.dimText != null && r.style.dimText !== '') ? String(r.style.dimText) : dimMeasuredStr(r.a, r.b, r.style);
    }
    const fw = dimValForm.offsetWidth || 120, fh = dimValForm.offsetHeight || 24;
    dimValForm.style.left = Math.round(Math.max(rect.left + 4, Math.min(sx + 14, rect.right - fw - 4))) + 'px';
    dimValForm.style.top = Math.round(Math.max(rect.top + 4, Math.min(sy + 12, rect.bottom - fh - 4))) + 'px';
  };
  let _dimSkewSpin = null;
  window.__dimSkewSpinStart = (rec) => {
    if (!rec || rec.type !== 'dim') return false;
    _dimSkewSpin = { rec, start: rec.style.dimSkew || 0 };
    return true;
  };
  window.__dimSkewSpinStartDeg = () => _dimSkewSpin ? _dimSkewSpin.start : 0;
  window.__dimSkewSpinApply = (deg) => {
    if (!_dimSkewSpin) return;
    _dimSkewSpin.rec.style.dimSkew = deg;
    rebuildAnn(_dimSkewSpin.rec); refreshAnnHi();
  };
  window.__dimSkewSpinEnd = () => { _dimSkewSpin = null; };
  window.__dimSkewSpinCancel = () => {
    if (!_dimSkewSpin) return;
    _dimSkewSpin.rec.style.dimSkew = _dimSkewSpin.start;
    rebuildAnn(_dimSkewSpin.rec);
    _dimSkewSpin = null;
  };
  window.__dimSkewSpinActive = () => !!_dimSkewSpin;
  window.__dimSkewSpinPivot = () => {
    if (!_dimSkewSpin) return null;
    const r = _dimSkewSpin.rec;
    const ends = dimLineEnds(r.a, r.b, r.style);
    return ends ? ends.A2.clone().add(ends.B2).multiplyScalar(0.5) : r.a.clone().add(r.b).multiplyScalar(0.5);
  };
  window.__annDeleteSelected = () => {              // 選択中の線をまとめて削除。返り値＝削除数
    if (!selAnns.size) return 0;
    let n = 0;
    for (const rec of selAnns) {
      const i = annStore.indexOf(rec);
      if (i >= 0) annStore.splice(i, 1);
      annGroup.remove(rec.obj); disposeObj(rec.obj);
      if (lineSel === rec) { lineSel = null; }
      n++;
    }
    selAnns.clear(); clearAnnHi();
    lineSel = null; clearGrip(); clearLineHandles();   // 起点(grip)参照と残った端点ハンドル(起点マーカー)を消す
    if (typeof clearMarkers === 'function') clearMarkers();   // 移動中マーカーの取り残しも消す
    updateXlinePts();                                  // 構築線が消えたら交点も引き直す
    if (typeof updateForm === 'function') updateForm();
    return n;
  };
  // 部品の集団移動に追従して、選択中の線も同じ分だけ平行移動
  let annMoveSnap = null;
  window.__annMoveStart = () => { annMoveSnap = [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone(), ap: (r.style && r.style.angP2) ? r.style.angP2.slice() : null })); };
  window.__annMoveApply = (dx, dy, dz) => {
    if (!annMoveSnap) return;
    for (const s of annMoveSnap) { s.r.a.set(s.a.x + dx, s.a.y + dy, s.a.z + dz); s.r.b.set(s.b.x + dx, s.b.y + dy, s.b.z + dz); if (s.ap) s.r.style.angP2 = [s.ap[0] + dx, s.ap[1] + dy, s.ap[2] + dz]; rebuildAnn(s.r); }
    refreshAnnHi();
    refreshHandles();   // 全選択線の端点ハンドルを現在位置へ（窓選択で lineSel 無しでも置き去りにしない）
  };
  window.__annMoveEnd = () => { annMoveSnap = null; };
  // 選択中の線をまとめて (dx,dy,dz) だけ平行移動（高さ/EL一括変更で部品と一緒に動かす用）
  window.__annShiftSelected = (dx, dy, dz) => {
    if (!selAnns.size) return;
    for (const r of selAnns) { r.a.set(r.a.x + dx, r.a.y + dy, r.a.z + dz); r.b.set(r.b.x + dx, r.b.y + dy, r.b.z + dz); if (r.style && r.style.angP2) r.style.angP2 = [r.style.angP2[0] + dx, r.style.angP2[1] + dy, r.style.angP2[2] + dz]; rebuildAnn(r); }
    refreshAnnHi(); refreshHandles();
  };
  window.__annMoveCancel = () => {
    if (!annMoveSnap) return;
    for (const s of annMoveSnap) { s.r.a.copy(s.a); s.r.b.copy(s.b); if (s.ap) s.r.style.angP2 = s.ap.slice(); rebuildAnn(s.r); }
    annMoveSnap = null; refreshAnnHi();
  };
  // 線本体クリックの許容画面距離(px)。大きいほど緩く（離れていても）選べる
  const ANN_PICK_PX = 8;
  // 点(px,py)と線分(ax,ay)-(bx,by)の画面上の最短距離(px)
  function segPixelDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
    const vv = vx * vx + vy * vy;
    let t = vv > 1e-9 ? (wx * vx + wy * vy) / vv : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
    return Math.hypot(dx, dy);
  }
  // 当たり判定に使う線の両端（構築線は描画範囲±Lまで延ばす）
  function annPickEnds(rec) {
    if (rec.type === 'xline') {
      let dir = new V3().subVectors(rec.b, rec.a);
      if (dir.lengthSq() < 1e-9) dir.set(1, 0, 0);
      dir.normalize();
      const L = 12;
      return [rec.a.clone().addScaledVector(dir, -L), rec.a.clone().addScaledVector(dir, L)];
    }
    if (rec.type === 'dim') {   // 逃げた寸法線は見えている本体の位置で当てる（斜めスライドも考慮）
      const ends = dimLineEnds(rec.a, rec.b, rec.style);
      if (ends) return [ends.A2, ends.B2];
    }
    return [rec.a, rec.b];
  }
  // 線レコードの画面投影セグメント（ニアプレーンクリップ済）。両端ともカメラ背後なら null。
  // 構築線（±12mの長い線）は片端がカメラ背後に回ると project() の投影が反転して
  // クリック・窓選択の判定が壊れるため、視点空間でニアプレーンにクリップしてから投影する。
  function annScreenSeg(rec, rect, cam, inv) {
    const [Ae, Be] = annPickEnds(rec);
    return clipProjectSeg(Ae, Be, rect, cam, inv);
  }
  // 任意の3D線分をニアプレーンクリップして画面座標へ投影
  function clipProjectSeg(Ae, Be, rect, cam, inv) {
    const toView = p => modelGroup.localToWorld(p.clone()).applyMatrix4(inv);   // カメラ視点空間（前方= -z）
    let A = toView(Ae), B = toView(Be);
    if (cam.isPerspectiveCamera) {
      const nearZ = -((cam.near || 0.01) + 1e-4);
      if (A.z > nearZ && B.z > nearZ) return null;   // 両端ともカメラ背後
      if (A.z > nearZ) A.lerp(B, (nearZ - A.z) / (B.z - A.z));        // 背後側の端をニアプレーンへ
      else if (B.z > nearZ) B.lerp(A, (nearZ - B.z) / (A.z - B.z));
    }
    const toScr = v => {
      const n = v.clone().applyMatrix4(cam.projectionMatrix);
      return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height };
    };
    return { pa: toScr(A), pb: toScr(B) };
  }
  // カーソル最寄りの線を画面距離(px)で拾う。近くに線が無ければ null（=部品クリックへ委ねる）
  function pickAnnAt(cx, cy) {
    if (!annStore.length) return null;
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    cam.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(cam.matrixWorld).invert();
    let best = null, bestD = ANN_PICK_PX, bestExt = false;
    const testSeg = (rec, seg, isExt) => {
      if (!seg) return;
      const d = segPixelDist(cx, cy, seg.pa.x, seg.pa.y, seg.pb.x, seg.pb.y);
      if (d <= bestD) { bestD = d; best = rec; bestExt = !!isExt; }
    };
    for (const rec of annStore) {
      if (rec.type === 'circle') {                       // 円/楕円：外周をクリックで選べるよう、周を多角形に分けて当てる
        const { rx, rz } = circleRadii(rec.style, rec.a, rec.b), q = quatFromStyle(rec.style);
        const N = 64; let prev = null;
        for (let i = 0; i <= N; i++) {
          const t = (i / N) * Math.PI * 2;
          const p = rec.a.clone().add(new V3(Math.cos(t) * rx, 0, Math.sin(t) * rz).applyQuaternion(q));
          if (prev) testSeg(rec, clipProjectSeg(prev, p, rect, cam, inv), false);
          prev = p;
        }
        continue;
      }
      if (rec.type === 'dim' && rec.style && rec.style.dimKind === 'angle') {   // 角度：円弧と両辺（V→各方向）をクリックで選べる
        const g = angleArcGeom(rec.a, rec.b, rec.style, 24);
        for (let i = 0; i < g.arc.length - 1; i++) testSeg(rec, clipProjectSeg(g.arc[i], g.arc[i + 1], rect, cam, inv), false);
        testSeg(rec, clipProjectSeg(g.V, g.V.clone().addScaledVector(g.d1, g.R), rect, cam, inv), false);
        testSeg(rec, clipProjectSeg(g.V, g.V.clone().addScaledVector(g.d2, g.R), rect, cam, inv), false);
        continue;
      }
      testSeg(rec, annScreenSeg(rec, rect, cam, inv), false);
      if (rec.type === 'dim') {                          // 寸法線は補助線（起点→寸法線）クリックでも選択できる
        const ends = dimLineEnds(rec.a, rec.b, rec.style);
        if (ends) {
          testSeg(rec, clipProjectSeg(rec.a, ends.A2, rect, cam, inv), true);
          testSeg(rec, clipProjectSeg(rec.b, ends.B2, rect, cam, inv), true);
        }
      }
    }
    // 補助線は部品（フランジ等）の真上を通ることが多い。補助線だけの当たりで、
    // その場所に部品がある時は部品選択を優先する（部品のEL等を塞がない）
    if (best && bestExt && typeof pickPlacedAt === 'function' && pickPlacedAt(cx, cy)) return null;
    return best;
  }
  // カーソル近傍の端点（0=a,1=b）。無ければ null。
  function endpointAt(rec, cx, cy) {
    if (rec.type === 'xline') return null;   // 構築線は端点伸縮しない（中心グリップで全体移動のみ）
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    const scr = p => { const n = modelGroup.localToWorld(p.clone()).project(cam); return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height, z: n.z }; };
    const sa = scr(rec.a), sb = scr(rec.b), TH = SNAP_PX + 6;
    const da = Math.hypot(sa.x - cx, sa.y - cy), db = Math.hypot(sb.x - cx, sb.y - cy);
    if (rec.type === 'circle') return (db < TH && sb.z < 1) ? 1 : null;   // 円は半径ハンドル(b)だけ掴める（中心aは移動グリップ）
    if (da <= db && da < TH && sa.z < 1) return 0;
    if (db < TH && sb.z < 1) return 1;
    return null;
  }
  // 掴んだ端を b に正規化（線の見た目は a↔b 入替で不変）→ 反対端 a 固定で描画と同じ要領に
  function startEndpointEdit(rec, end) {
    if (end === 0) { const t = rec.a; rec.a = rec.b; rec.b = t; }
    drawState.first = rec.a.clone(); drawState.cur = rec.b.clone();
    drawState.vert = false; drawState.editRec = rec; drawState.locked = false; drawState.snapped = false;
    const dl = rec.b.distanceTo(rec.a);   // 伸縮は元の軸方向に沿わせる（斜め・Y方向も保持）
    drawState.editAxis = dl > 1e-6 ? rec.b.clone().sub(rec.a).multiplyScalar(1 / dl) : new V3(1, 0, 0);
    gRec = rec; gEnd = 1; _vAxis = null; _tipAxis = null; _tipMode = false;   // 掴んだ端(=b)を起点として大きく強調・鉛直回転軸も再計算
    refreshHandles();
    if (typeof updateForm === 'function') updateForm();   // 起点が変わったのでEL表記を更新
  }
  // 端点の伸縮：固定端 P1 から軸 dir 方向に、カーソル光線へ最も近い点までの距離を取り、その点を返す
  function axisStretchPoint(clientX, clientY, P1, dir) {
    const rect = renderer.domElement.getBoundingClientRect();
    placeNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    placeNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    placeRay.setFromCamera(placeNdc, activeCam());
    const O = modelGroup.worldToLocal(placeRay.ray.origin.clone());                                  // カメラ光線（modelローカル）
    const R = modelGroup.worldToLocal(placeRay.ray.origin.clone().addScaledVector(placeRay.ray.direction, 1)).sub(O);
    const rl = R.length(); if (rl < 1e-9) return null; R.multiplyScalar(1 / rl);
    const w0 = P1.clone().sub(O);
    const b = dir.dot(R), d = dir.dot(w0), e = R.dot(w0);
    const denom = 1 - b * b;
    let s = Math.abs(denom) < 1e-6 ? -d : (b * e - d) / denom;   // 軸に沿った符号付き距離
    s = Math.max(0, s);
    return P1.clone().addScaledVector(dir, s);
  }
  // 移動の起点（grip）がカーソル付近で吸い付ける機点を探す。移動中の選択自身は除外。返り値＝3D点 or null
  function moveSnapForGrip(cx, cy, exParts, exAnns) {
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    let best = null, bestD = SNAP_PX;
    const test = mpos => {
      const ndc = modelGroup.localToWorld(mpos.clone()).project(cam);
      if (ndc.z >= 1) return;
      const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < bestD) { bestD = d; best = mpos.clone(); }
    };
    for (const p of placedParts) { if (exParts.has(p) || !p.userData.faceLocal) continue; for (const local of connsOf(p)) test(connModelPos(p, local)); }
    for (const r of annStore) { if (exAnns.has(r)) continue; for (const sp of annSnapPoints(r)) test(sp); }   // 線分=端点+中点／円=中心+四半円点（構築線は交点のみ）
    for (const pt of xlinePts) test(pt);   // 構築線どうしの交点へも吸着
    return best;
  }
  // 移動中の起点(橙)・他アイテムの機点(青/吸着は緑)マーカー。部品の showInteractionMarkers と同じ見た目
  function showLineMoveMarkers(gripPt, exParts, exAnns, snapPoint) {
    clearMarkers();
    addMarker(gripPt, 0xff8a3c, markerRadiusFor(null, false));
    const mark = (pt, rN, rB) => { const isSnap = snapPoint && pt.distanceTo(snapPoint) < 1e-6; addMarker(pt, isSnap ? 0x39ff8a : 0x7fd1ff, isSnap ? rB : rN); };
    for (const p of placedParts) { if (exParts.has(p) || !p.userData.faceLocal) continue; const rN = markerRadiusFor(p, false), rB = markerRadiusFor(p, true); for (const local of connsOf(p)) mark(connModelPos(p, local), rN, rB); }
    const lN = markerRadiusFor(null, false), lB = markerRadiusFor(null, true);
    for (const r of annStore) { if (exAnns.has(r)) continue; for (const sp of annSnapPoints(r)) mark(sp, lN, lB); }   // 線分=端点+中点／円=中心+四半円点（構築線は交点のみ）
    for (const p of xlinePts) mark(p, lN, lB);
  }
  let _lnLastT = 0, _lnLastX = 0, _lnLastY = 0, _lnLastRec = null;   // ダブルクリック検出（自由移動）
  window.addEventListener('pointerdown', e => {
    if (drawActive() || e.button !== 0) return;
    if (drawState.dimReadjust && e.target === renderer.domElement) {   // 再調整中のクリック＝確定（このクリックは消費）
      drawState.dimReadjust = null; clearLineGuide();
      e.stopImmediatePropagation(); return;
    }
    if (followTool || movingPart) return;                // 部品の配置/移動中は線分操作を横取りしない（スナップ先の線を掴んで配置を止める不具合対策）
    if (e.target !== renderer.domElement) return;        // 脚入力などUIは通す
    if (e.ctrlKey || e.metaKey || touchCtrl) return;                  // Ctrl＝部品の複数選択へ委ねる
    const rect = renderer.domElement.getBoundingClientRect();
    if (inGizmo(e.clientX - rect.left, e.clientY - rect.top)) return;
    if (drawState.editRec) clearDrawTemp();              // 直前の確定待ち編集を終える
    // 重なり時のアイテム起点優先：選択中アイテムの機点(起点候補)の近くを掴もうとした時は、線分より部品を優先（部品ハンドラに譲る）
    {
      const selForGrip = (selectedParts && selectedParts.size) ? [...selectedParts] : (selectedPart ? [selectedPart] : []);
      for (const sp of selForGrip) {
        if (sp.userData && sp.userData.faceLocal && nearestConnLocal(sp, e.clientX, e.clientY)) return;
      }
    }
    // 寸法の値（赤文字）をクリック＝その寸法線を選択して「値」入力を開く（文字の編集）
    {
      const recT = pickDimTextAt(e.clientX, e.clientY);
      if (recT && recT.style && recT.style.dimKind === 'text') {
        // 文字：シングルクリック＝選択（移動・削除）／ダブルクリック＝編集フォーム
        const isDbl = (e.timeStamp - _lnLastT < 350) && Math.hypot(e.clientX - _lnLastX, e.clientY - _lnLastY) < 6 && _lnLastRec === recT;
        _lnLastT = e.timeStamp; _lnLastX = e.clientX; _lnLastY = e.clientY; _lnLastRec = recT;
        if (!selAnns.has(recT)) selectLine(recT);
        if (isDbl) { if (window.__openDimValueForm) window.__openDimValueForm(true); if (window.__focusDimValueInput) window.__focusDimValueInput(); }
        else {                                            // シングル＝ドラッグで移動できるよう sel を仕込む
          const origin = recT.a.clone();
          lineDrag = { mode: 'sel', free: false, origin, planeY: origin.y, gRec: recT, gEnd: 0, nearEnd: false,
                       downX: e.clientX, downY: e.clientY, moved: false,
                       annSnap: [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone(), ap: null })),
                       partSnap: window.__partSelSnapshot ? window.__partSelSnapshot() : [] };
        }
        e.stopImmediatePropagation(); return;
      }
      if (recT) {
        selectLine(recT);
        if (window.__openDimValueForm) window.__openDimValueForm(true);   // 値クリック＝編集フォームを開く（編集）
        if (window.__focusDimValueInput) window.__focusDimValueInput();
        e.stopImmediatePropagation(); return;
      }
    }
    if (lineSel && selAnns.has(lineSel)) {               // 実際に選択中の線の端点を掴む → 長さ変更/付け替え
      if (lineSel.type === 'circle') {                   // 円：四半円点ハンドルを掴む → 半径変更（Shift＝その軸だけ＝楕円）
        const h = circleHandleAt(lineSel, e.clientX, e.clientY);
        if (h) {
          lineDrag = { mode: 'circleaxis', rec: lineSel, axis: h.axis, dir: h.dir.clone(), downX: e.clientX, downY: e.clientY, moved: false };
          e.stopImmediatePropagation(); return;
        }
      } else {
        const end = endpointAt(lineSel, e.clientX, e.clientY);
        if (end !== null) {
          if (lineSel.type === 'dim') {                  // 寸法線：起点をつかんで別の機点へ付け替える
            lineDrag = { mode: 'dimend', rec: lineSel, end, downX: e.clientX, downY: e.clientY, moved: false };
            e.stopImmediatePropagation(); return;
          }
          startEndpointEdit(lineSel, end);
          lineDrag = { mode: 'end', downX: e.clientX, downY: e.clientY, moved: false };
          e.stopImmediatePropagation(); return;
        }
      }
    }
    const rec = pickAnnAt(e.clientX, e.clientY);          // 線の本体 → 選択＋移動（部品と同じ操作系）
    if (rec) {
      const isDbl = (e.timeStamp - _lnLastT < 350) && Math.hypot(e.clientX - _lnLastX, e.clientY - _lnLastY) < 6 && _lnLastRec === rec;
      _lnLastT = e.timeStamp; _lnLastX = e.clientX; _lnLastY = e.clientY; _lnLastRec = rec;
      if (!selAnns.has(rec)) selectLine(rec);              // 未選択の線を掴んだ＝単独選択。既選択ならグループ維持
      const info = nearestEndpointInfo(rec, e.clientX, e.clientY);   // 起点アンカー＋端の近くを押したか
      const origin = info.pt.clone();
      lineDrag = { mode: 'sel', free: isDbl, origin, planeY: origin.y, gRec: rec, gEnd: info.end, nearEnd: info.near,
                   downX: e.clientX, downY: e.clientY, moved: false,
                   annSnap: [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone(), ap: (r.style && r.style.angP2) ? r.style.angP2.slice() : null })),
                   partSnap: window.__partSelSnapshot ? window.__partSelSnapshot() : [] };
      if (info.near) { gRec = rec; gEnd = info.end; _vAxis = null; _tipAxis = null; _tipMode = false; refreshHandles(); if (typeof updateForm === 'function') updateForm(); }   // 端の近くを掴んだ＝起点を選択（大きく・ELを更新・鉛直軸再計算）
      e.stopImmediatePropagation(); return;
    }
    // 何もない所を押した時だけ線選択を解除。部品の上を押した時は線選択を保持し、部品ハンドラに委ねる
    // （部品と線を一緒に窓選択している場合、集団移動で線も追従させるため）。新規単独選択なら selectPart 側で線が解除される。
    if ((lineSel || selAnns.size) && !pickPlacedAt(e.clientX, e.clientY)) deselectLine();
  }, true);
  window.addEventListener('pointermove', e => {
    if (drawActive() || !lineDrag) return;
    if (Math.hypot(e.clientX - lineDrag.downX, e.clientY - lineDrag.downY) > 3) lineDrag.moved = true;
    if (lineDrag.mode === 'circleaxis') {                // 円：四半円点を掴んで半径変更。通常＝真円・Shift＝その軸だけ＝楕円
      const rec = lineDrag.rec, c = rec.a;
      const sp = axisStretchPoint(e.clientX, e.clientY, c, lineDrag.dir);   // 軸（向き込み）に沿ってカーソルへ最も近い点
      if (!sp) return;
      const r = Math.max(0.001, Math.round(sp.distanceTo(c) * 1000) / 1000);   // 中心からの距離＝半径。1mm刻み・最小1mm
      rec.style = rec.style || {};
      if (e.shiftKey || touchShift) { if (lineDrag.axis === 'x') rec.style.rx = r; else rec.style.rz = r; }   // Shift＝楕円（その軸のみ）
      else { rec.style.rx = r; rec.style.rz = r; }                                              // 通常＝真円（両軸そろえる）
      const ax = new V3(1, 0, 0).applyQuaternion(quatFromStyle(rec.style));
      rec.b.copy(c.clone().addScaledVector(ax, rec.style.rx != null ? rec.style.rx : r));   // bは+X四半円点に正規化（移動グリップ用）
      rebuildAnn(rec); refreshAnnHi(); refreshHandles();
      e.stopImmediatePropagation();
      return;
    }
    if (lineDrag.mode === 'sel') {                       // 選択（線＋部品）の移動。部品と同じ：通常=直行(45°/指定角)・ダブル=自由
      const exParts = lineDrag._exParts || (lineDrag._exParts = new Set(lineDrag.partSnap.map(s => s.p)));
      let dx = 0, dy = 0, dz = 0, snappedPt = null;
      if (lineDrag.free) {                               // 自由移動（ダブルクリックドラッグ）：起点を他アイテムの機点へスナップ
        const snap = moveSnapForGrip(e.clientX, e.clientY, exParts, selAnns);
        if (snap) { dx = snap.x - lineDrag.origin.x; dy = snap.y - lineDrag.origin.y; dz = snap.z - lineDrag.origin.z; snappedPt = snap; }
        else { const hit = planeHitAt(e.clientX, e.clientY, lineDrag.planeY); if (!hit) return; dx = hit.x - lineDrag.origin.x; dz = hit.z - lineDrag.origin.z; }
      } else {                                           // 直行移動：角度を45°（または指定角）にスナップ＋投影距離
        const hit = planeHitAt(e.clientX, e.clientY, lineDrag.planeY);
        if (!hit) return;
        const vx = hit.x - lineDrag.origin.x, vz = hit.z - lineDrag.origin.z;
        const step = angleStep ? angleStep * Math.PI / 180 : Math.PI / 4;
        const ang = Math.round(Math.atan2(vz, vx) / step) * step;
        const cdx = Math.cos(ang), cdz = Math.sin(ang);
        const dist = Math.max(0, vx * cdx + vz * cdz);
        dx = cdx * dist; dz = cdz * dist;
      }
      // 構築線のみの移動は、線に直交する横方向だけに制限（斜め移動なし・2026-06-13 社長指示）
      if (!lineDrag.partSnap.length && lineDrag.annSnap.length &&
          lineDrag.annSnap.every(s => s.r.type === 'xline')) {
        const s0 = lineDrag.annSnap[0];
        const ddx = s0.b.x - s0.a.x, ddz = s0.b.z - s0.a.z;
        const hl = Math.hypot(ddx, ddz);
        if (hl > 1e-9) {
          const px = -ddz / hl, pz = ddx / hl;       // 線の向きに直交する水平単位ベクトル
          const t = dx * px + dz * pz;
          dx = px * t; dz = pz * t; dy = 0; snappedPt = null;
        }
      }
      for (const s of lineDrag.annSnap) { s.r.a.set(s.a.x + dx, s.a.y + dy, s.a.z + dz); s.r.b.set(s.b.x + dx, s.b.y + dy, s.b.z + dz); if (s.ap) s.r.style.angP2 = [s.ap[0] + dx, s.ap[1] + dy, s.ap[2] + dz]; rebuildAnn(s.r); }
      if (window.__partSelApply) window.__partSelApply(lineDrag.partSnap, dx, dy, dz);
      lineDrag._delta = { x: dx, z: dz };                // 直行移動のX/Z/L欄表示用
      refreshAnnHi();
      refreshHandles();                                  // 端点を追従（移動中は橙・小、置き去り防止）
      if (typeof updateForm === 'function') updateForm();  // EL値を追従（直行移動中はX/Z/Lへ切替）
      const gpos = new V3(lineDrag.origin.x + dx, lineDrag.origin.y + dy, lineDrag.origin.z + dz);
      showLineMoveMarkers(gpos, exParts, selAnns, snappedPt);   // 起点・機点・吸着マーカー（部品と同じ）
      if (!lineDrag.free && (Math.abs(dx) > 1e-6 || Math.abs(dz) > 1e-6))   // 直行は部品と同じ黄色ガイド三角形
        addGuideTriangle(new V3(lineDrag.origin.x, lineDrag.planeY, lineDrag.origin.z), new V3(lineDrag.origin.x + dx, lineDrag.planeY, lineDrag.origin.z + dz), 0xffcc33);
      e.stopImmediatePropagation();
    } else if (lineDrag.mode === 'dimend') {             // 寸法線の起点付け替え：機点・交点へスナップ（無ければ水平面）
      const rec = lineDrag.rec;
      const cur = lineDrag.end === 0 ? rec.a : rec.b;
      const ex = new Set([rec]);
      const snap = moveSnapForGrip(e.clientX, e.clientY, new Set(), ex);
      let pos = snap;
      if (!pos) { const hit = planeHitAt(e.clientX, e.clientY, cur.y); if (!hit) return; pos = hit; }
      cur.copy(pos);
      rebuildAnn(rec);
      refreshAnnHi(); refreshHandles();
      showLineMoveMarkers(cur.clone(), new Set(), ex, snap);
      e.stopImmediatePropagation();
    } else {                                             // end：反対端固定で、線の軸方向に沿って伸び縮み（斜め・Y方向も保持）
      // アイテム（部品の機点）や他の線の端点・構築線交点が近くにあれば吸着（軸から外れても機点に合わせる）
      const snapPt = moveSnapForGrip(e.clientX, e.clientY, new Set(), new Set([drawState.editRec]));
      let p;
      if (snapPt) {
        p = snapPt.clone();
        const dl = p.distanceTo(drawState.first);
        if (dl > 1e-6) drawState.editAxis = p.clone().sub(drawState.first).multiplyScalar(1 / dl);   // 以後の伸縮軸も吸着先の向きへ
        drawState.snapped = true;
      } else {
        const sp = axisStretchPoint(e.clientX, e.clientY, drawState.first, drawState.editAxis);
        if (!sp) return;
        const dist = Math.round(sp.distanceTo(drawState.first) * 1000) / 1000;   // 固定端からの距離を1mm刻みに
        p = drawState.first.clone().addScaledVector(drawState.editAxis, dist);
        drawState.snapped = false;
      }
      drawState.cur = p; drawState.vert = false;
      if (drawState.editRec.type === 'circle') p.y = drawState.first.y;   // 円の半径変更は水平を保つ
      drawState.editRec.b.copy(p); rebuildAnn(drawState.editRec);
      // Y成分がある斜め線は水平到達点を角にしてつぶれない三角形に（Z＋Yでも表示される）。円は脚三角形なし
      const hasY = Math.abs(p.y - drawState.first.y) > 1e-4;
      if (drawState.editRec.type !== 'circle') drawTriangle3D(drawState.first, p, hasY, drawState.snapped);
      showLineHandles(drawState.editRec); refreshAnnHi();
      if (typeof updateForm === 'function') updateForm();   // 伸縮で起点側ELが変われば追従
      e.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener('pointerup', e => {
    if (drawActive() || e.button !== 0 || !lineDrag) return;
    const mode = lineDrag.mode, moved = lineDrag.moved, nearEnd = lineDrag.nearEnd;
    lineDrag = null;
    e.stopImmediatePropagation();
    if (mode === 'circleaxis') {                   // 円/楕円の半径変更を確定（選択は維持・ハンドル再表示）
      if (typeof hideCircleR === 'function') hideCircleR();
      refreshHandles(); refreshAnnHi();
      if (typeof updateForm === 'function') updateForm();
    } else if (mode === 'end') {
      if (moved && drawState.editRec && drawState.editRec.type === 'circle') { clearDrawTemp(); }   // 円は半径変更したら即確定（脚入力なし）
      else if (moved) drawState.locked = true;     // 確定待ち：脚/距離入力で微調整可（Enterで確定）
      else { clearDrawTemp(); if (typeof updateForm === 'function') updateForm(); }   // 端クリックのみ→編集解除しELを戻す
    } else if (mode === 'dimend') {
      clearMarkers();                          // 付け替え完了（選択は維持・寸法値は自動更新済）
      if (typeof updateForm === 'function') updateForm();
    } else if (mode === 'sel') {
      clearMarkers(); hideLineBoxes();         // 移動ガイド三角形・X/Z/L欄を消す（選択・位置は維持）
      if (!moved && !nearEnd) { clearGrip(); refreshHandles(); }   // 本体クリックのみ＝起点未選択（端点は小さく）
      if (typeof updateForm === 'function') updateForm();   // 移動後はELフォームを戻す
      // 構築線の再選択（クリックのみ）＝EL欄へ即フォーカス → Enterで角度 → Enterで閉じの連鎖を開始
      if (!moved && lineSel && lineSel.type === 'xline') focusElInputSoon();
      // 寸法線の再選択（クリックのみ）＝逃げ量スピナーを開く（EL機能は廃止）。引出は値（文字）クリックのみ編集なのでここでは何もしない
      else if (!moved && lineSel && lineSel.type === 'dim' && lineSel.style && lineSel.style.dimDir) startDimOffSpin(lineSel);
      // 半径/直径/角度の再選択（クリックのみ）＝逃げ（リーダー長・円弧半径/位置）の再調整に入る
      else if (!moved && lineSel && lineSel.type === 'dim' && lineSel.style && ['radius', 'diameter', 'angle'].includes(lineSel.style.dimKind)) drawState.dimReadjust = { rec: lineSel };
    }
  }, true);
  // 再調整中：カーソルで逃げ（リーダー長・円弧半径/位置）を更新。スナップ＝緑印
  window.addEventListener('pointermove', e => {
    if (!drawState.dimReadjust || drawActive() || lineDrag) return;
    clearLineGuide();
    const snap = dimReadjustApply(drawState.dimReadjust.rec, e.clientX, e.clientY);
    if (snap) guideDot(snap, 0x39ff8a, 0.0042);
    refreshHandles();
  }, true);
  window.addEventListener('keydown', e => {
    if (drawActive() || !lineSel) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape' && drawState.dimReadjust) { e.stopImmediatePropagation(); drawState.dimReadjust = null; clearLineGuide(); return; }   // 再調整だけ抜ける（選択は維持）
    if (e.key === 'Escape') { e.stopImmediatePropagation(); clearDrawTemp(); deselectLine(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopImmediatePropagation();
      const i = annStore.indexOf(lineSel);
      if (i >= 0) annStore.splice(i, 1);
      annGroup.remove(lineSel.obj); disposeObj(lineSel.obj);
      clearDrawTemp(); deselectLine();
    }
  }, true);

  // ================= ボタン結線 =================
  $('cmdSave').onclick = save;
  $('cmdOpen').onclick = load;
  $('cmdPrint').onclick = printSheet;
  $('cmdPng').onclick = exportPng;
  $('cmdLine').onclick = () => setDrawMode('line');
  $('cmdXline').onclick = () => setDrawMode('xline');
  $('cmdCircle').onclick = () => setDrawMode('circle');
  $('cmdDim').onclick = () => setDrawMode('dim');
  $('cmdText').onclick = () => setDrawMode('text');
  $('cmdTheme').onclick = () => setLightMode(!lightMode);
  $('cmdDup').onclick = duplicate;
  $('cmdMirror').onclick = mirror;
  $('cmdGroup').onclick = groupSelection;
  $('cmdUngroup').onclick = ungroupSelection;
  $('cmdUndo').onclick = () => { if (window.__undo) window.__undo(); };
  $('cmdRedo').onclick = () => { if (window.__redo) window.__redo(); };
  // 削除・ホームのリボンボタンは廃止（2026-06-13 社長指示）。削除＝Deleteキー、ホーム＝右上の家アイコン
  const zoomBtn = document.getElementById('zoomBtn');   // 範囲ズームは右上ホームの真下へ移設
  if (zoomBtn) zoomBtn.onclick = zoomExtents;

  // ================= ヘルプ（使い方ガイド）の開閉 =================
  const helpPanel = $('helpPanel'), helpBackdrop = $('helpBackdrop'), cmdHelp = $('cmdHelp');
  function setHelp(open) {
    helpPanel.style.display = open ? 'flex' : 'none';
    helpBackdrop.style.display = open ? 'block' : 'none';
    cmdHelp.classList.toggle('active', open);
  }
  cmdHelp.onclick = () => setHelp(helpPanel.style.display !== 'flex');
  $('helpClose').onclick = () => setHelp(false);
  helpBackdrop.onclick = () => setHelp(false);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && helpPanel.style.display === 'flex') setHelp(false);
  });

  // ===================================================================
  //  既定書式メニュー（リボンの 線分/構築線/寸法線 アイコンを右クリックで開く）
  //  ・選んだ色・線種・太さは、その後に引く線へ適用される（既存の線は変えない）
  // ===================================================================
  let fmtToolType = 'line';                       // 設定中のツール種別

  // ---- メニューDOMを動的生成（線種を選ぶだけ。色は線種で固定・太さ極細・角度45°固定） ----
  const fmtMenu = document.createElement('div');
  fmtMenu.id = 'lineFmtMenu';
  fmtMenu.innerHTML =
    '<div class="fm-ttl">線種を選択</div>' +
    '<div class="fm-row fm-wrap">' +
      MENU_LTYPES.map(k => `<button class="fm-bt" data-act="ltype" data-val="${k}" style="color:${hexCss(ltypeColor(k))}">${LTYPES[k].name}</button>`).join('') +
    '</div>';
  document.body.appendChild(fmtMenu);

  function markFmtActive() {
    const st = toolStyle[fmtToolType]; if (!st) return;
    fmtMenu.querySelectorAll('[data-act="ltype"]').forEach(b => b.classList.toggle('on', b.dataset.val === st.ltype));
  }
  function openToolFmtMenu(type, ax, atop) {
    fmtToolType = type;
    const sel = [...selAnns].filter(r => r.type === type);    // 選択中の同種オブジェクト（線分/円）
    if (sel.length) {                                         // 選択中＝ツールを起動せず（選択維持）、その書式をメニューに反映
      const s = sel[0].style; const st = toolStyle[type];
      if (st && s) { if (s.ltype) st.ltype = s.ltype; if (s.color != null) st.color = s.color; }
    } else if (drawState.mode !== type) setDrawMode(type);    // 選択が無い時だけツール起動（閉じたらすぐ描ける）
    fmtMenu.classList.toggle('is-xline', type === 'xline');   // 構築線は太さ非対応
    const ttl = fmtMenu.querySelector('.fm-ttl');
    if (ttl) ttl.textContent = (type === 'dim' ? '寸法線' : type === 'xline' ? '構築線' : type === 'circle' ? '円' : '線分') + 'の既定書式';
    fmtMenu.style.display = 'block';
    markFmtActive();
    const mw = fmtMenu.offsetWidth, mh = fmtMenu.offsetHeight;
    let px = ax;
    if (px + mw > window.innerWidth - 6) px = window.innerWidth - mw - 6;
    let py = atop - mh - 6;                        // リボンは画面下端なのでアイコンの上に出す
    if (py < 6) py = atop + 30;                    // 上に入らなければ下へ
    fmtMenu.style.left = Math.max(6, px) + 'px';
    fmtMenu.style.top = Math.max(6, py) + 'px';
  }
  function closeFmtMenu() { fmtMenu.style.display = 'none'; }

  // ---- 寸法の種別メニュー（リボン「寸法」を右クリックで開く：平行/角度/半径/直径/引出） ----
  const DIM_KINDS = [
    ['parallel', '平行', '2点間の距離'],
    ['angle',    '角度', '水平からの傾き'],
    ['radius',   '半径', '中心→縁＝R'],
    ['diameter', '直径', '差し渡し＝⌀'],
    ['leader',   '引出', '注記の引出線'],
  ];
  const dimKindMenu = document.createElement('div');
  dimKindMenu.id = 'dimKindMenu';
  dimKindMenu.innerHTML = '<div class="dk-ttl">寸法の種別</div>' +
    DIM_KINDS.map(([k, n, d]) => `<button class="dk-bt" data-kind="${k}">${n}<small>${d}</small></button>`).join('');
  document.body.appendChild(dimKindMenu);
  function markDimKindActive() {
    dimKindMenu.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('on', b.dataset.kind === dimKind));
  }
  function updateDimBtnTitle() {
    const b = $('cmdDim'); if (b) b.title = `寸法：${DIM_KIND_LABEL[dimKind] || '平行'}（右クリックで 平行/角度/半径/直径/引出 を選択）`;
  }
  function closeDimKindMenu() { dimKindMenu.style.display = 'none'; }
  function openDimKindMenu(ax, atop) {
    if (drawState.mode !== 'dim') setDrawMode('dim');     // 種別を選んだらすぐ描けるよう寸法ツールを起動
    markDimKindActive();
    dimKindMenu.style.display = 'block';
    const mw = dimKindMenu.offsetWidth, mh = dimKindMenu.offsetHeight;
    let px = ax; if (px + mw > window.innerWidth - 6) px = window.innerWidth - mw - 6;
    let py = atop - mh - 6; if (py < 6) py = atop + 30;   // リボンは画面下端なのでアイコンの上に出す
    dimKindMenu.style.left = Math.max(6, px) + 'px';
    dimKindMenu.style.top = Math.max(6, py) + 'px';
  }
  dimKindMenu.addEventListener('click', e => {
    const el = e.target.closest('[data-kind]'); if (!el) return;
    dimKind = el.dataset.kind;                            // 以後に引く寸法へ適用（既存の寸法は変えない）
    markDimKindActive(); updateDimBtnTitle();
    if (drawState.mode !== 'dim') setDrawMode('dim');
    closeDimKindMenu();
  });
  updateDimBtnTitle();

  // ---- 文字の書式メニュー（リボン「文字」右クリック：色＋飾り） ----
  const TEXT_COLORS = [['シアン', 0x00ffff], ['白', 0xffffff], ['黒', 0x000000], ['赤', 0xff4040]];
  const TEXT_DECOS = [['none', '枠なし'], ['box', '枠あり'], ['underline', '下線'], ['double', '二重下線']];
  const textMenu = document.createElement('div');
  textMenu.id = 'textMenu';
  textMenu.innerHTML = '<div class="dk-ttl">文字の色</div><div class="tm-cols">' +
    TEXT_COLORS.map(([n, c]) => `<button class="tm-sw" data-color="${c}" title="${n}" style="background:${hexCss(c)}"></button>`).join('') + '</div>' +
    '<div class="dk-ttl" style="margin-top:8px">飾り</div>' +
    TEXT_DECOS.map(([k, n]) => `<button class="dk-bt" data-deco="${k}">${n}</button>`).join('');
  document.body.appendChild(textMenu);
  function markTextActive() {
    textMenu.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', Number(b.dataset.color) === textOpts.color));
    textMenu.querySelectorAll('[data-deco]').forEach(b => b.classList.toggle('on', b.dataset.deco === textOpts.deco));
  }
  function closeTextMenu() { textMenu.style.display = 'none'; }
  function openTextMenu(ax, atop, keepSel) {
    const tsel = (selAnns.size === 1 && lineSel && lineSel.type === 'dim' && lineSel.style && lineSel.style.dimKind === 'text') ? lineSel : null;
    if (tsel) { if (tsel.style.textColor != null) textOpts.color = tsel.style.textColor; textOpts.deco = tsel.style.textDeco || 'none'; }   // 選択中の文字の現在書式を表示
    if (!keepSel && !tsel && drawState.mode !== 'text') setDrawMode('text');   // 選択が無い時だけ文字ツール起動（選択中は維持して変更）
    markTextActive();
    textMenu.style.display = 'block';
    const mw = textMenu.offsetWidth, mh = textMenu.offsetHeight;
    let px = ax; if (px + mw > window.innerWidth - 6) px = window.innerWidth - mw - 6;
    let py = atop - mh - 6; if (py < 6) py = atop + 30;
    textMenu.style.left = Math.max(6, px) + 'px';
    textMenu.style.top = Math.max(6, py) + 'px';
  }
  // 配置済み文字の再選択→右クリックで開く（選択維持・現在の色/飾りを表示し、変更は選択中の文字へ反映）
  window.__openTextFmtMenu = (x, y, rec) => {
    if (rec && rec.style) { if (rec.style.textColor != null) textOpts.color = rec.style.textColor; textOpts.deco = rec.style.textDeco || 'none'; }
    openTextMenu(x, y, true);
  };
  textMenu.addEventListener('click', e => {
    const cs = e.target.closest('[data-color]'); const ds = e.target.closest('[data-deco]');
    if (cs) textOpts.color = Number(cs.dataset.color);
    else if (ds) textOpts.deco = ds.dataset.deco;
    else return;
    markTextActive();
    if (window.__applyTextFmtToSel) window.__applyTextFmtToSel(textOpts.color, textOpts.deco);   // 選択中の文字にも反映
  });

  function maybeCloseFmtMenu() {
    let closed = false;
    if (fmtMenu.style.display === 'block') { closeFmtMenu(); closed = true; }
    if (dimKindMenu.style.display === 'block') { closeDimKindMenu(); closed = true; }
    if (textMenu.style.display === 'block') { closeTextMenu(); closed = true; }
    return closed;
  }
  function applyFmt(act, val) {
    const st = toolStyle[fmtToolType]; if (!st) return;
    if (act === 'ltype') { st.ltype = val; st.color = ltypeColor(val); st.width = 0.0006; }   // 色は線種で決定・太さは極細固定
    markFmtActive();
    // 選択中の同種オブジェクト（線分/円）にも反映＝再選択して書式変更
    let any = false;
    for (const r of selAnns) if (r.type === fmtToolType) { r.style.ltype = st.ltype; r.style.color = st.color; r.style.width = st.width; rebuildAnn(r); any = true; }
    if (any) refreshAnnHi();
  }
  fmtMenu.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    applyFmt(el.dataset.act, el.dataset.val);
  });

  // リボンの線分アイコンを右クリック → 既定書式メニュー（線種選択）
  // 構築線(xline)はレーザー一種類なので書式メニューを持たない（右クリック対象外）
  {
    const b = $('cmdLine');
    if (b) b.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      const r = b.getBoundingClientRect();
      openToolFmtMenu('line', r.left, r.top);
    });
  }
  // リボンの円アイコンを右クリック → 既定書式メニュー（線種選択・線分と共通の仕組み）
  {
    const b = $('cmdCircle');
    if (b) b.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      const r = b.getBoundingClientRect();
      openToolFmtMenu('circle', r.left, r.top);
    });
  }
  // リボンの寸法アイコンを右クリック → 種別メニュー（平行/角度/半径/直径/引出）
  {
    const b = $('cmdDim');
    if (b) b.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      const r = b.getBoundingClientRect();
      closeFmtMenu();
      openDimKindMenu(r.left, r.top);
    });
  }
  // リボンの文字アイコンを右クリック → 文字の書式メニュー（色・飾り）
  {
    const b = $('cmdText');
    if (b) b.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      const r = b.getBoundingClientRect();
      closeFmtMenu(); closeDimKindMenu();
      openTextMenu(r.left, r.top);
    });
  }
  // メニュー外クリック / Esc / ホイールで閉じる
  window.addEventListener('pointerdown', e => {
    if (fmtMenu.style.display === 'block' && !fmtMenu.contains(e.target)) closeFmtMenu();
    if (dimKindMenu.style.display === 'block' && !dimKindMenu.contains(e.target)) closeDimKindMenu();
    if (textMenu.style.display === 'block' && !textMenu.contains(e.target)) closeTextMenu();
  }, true);
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (fmtMenu.style.display === 'block') closeFmtMenu();
    if (dimKindMenu.style.display === 'block') closeDimKindMenu();
    if (textMenu.style.display === 'block') closeTextMenu();
  });
  window.addEventListener('wheel', () => {
    if (fmtMenu.style.display === 'block') closeFmtMenu();
    if (dimKindMenu.style.display === 'block') closeDimKindMenu();
    if (textMenu.style.display === 'block') closeTextMenu();
  }, { passive: true });
})();

// ===================================================================
//  アイテムリストの折りたたみ（ヘッダークリックで表を開閉。図面情報欄は常時表示）
// ===================================================================
(function setupItemListCollapse() {
  const head = document.getElementById('ilHead');
  const body = document.getElementById('ilBodyWrap');
  const caret = document.getElementById('ilCaret');
  if (!head || !body) return;
  let collapsed = false;
  head.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
    if (caret) caret.textContent = collapsed ? '▸' : '▾';
    head.title = collapsed ? 'クリックで展開' : 'クリックで折りたたみ';
  });
  // 図面仕様パネル（アイテムリストの横）の開閉
  const specHead = document.getElementById('specHead');
  const specBody = document.getElementById('specBodyWrap');
  const specCaret = document.getElementById('specCaret');
  if (specHead && specBody) {
    let specCollapsed = false;
    specHead.addEventListener('click', () => {
      specCollapsed = !specCollapsed;
      specBody.style.display = specCollapsed ? 'none' : '';
      if (specCaret) specCaret.textContent = specCollapsed ? '▸' : '▾';
      specHead.title = specCollapsed ? 'クリックで展開' : 'クリックで折りたたみ';
    });
  }
})();
