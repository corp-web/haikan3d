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
const grid = new THREE.GridHelper(20, 40, 0x4a5a8a, 0x2a3a5c);
grid.material.opacity = 0.6; grid.material.transparent = true;
modelGroup.add(grid);
// 座標軸は原点ではなく画面左下隅に小さく描く（axisGizmo・下部で構築/描画）

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
  gScene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const gl = new THREE.DirectionalLight(0xffffff, 0.55);
  gl.position.set(2, 4, 5); gScene.add(gl);

  const globe = new THREE.Group();
  const cubeSize = 1.5;

  function faceTexture(text) {
    const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#eef1f6'); g.addColorStop(1, '#d2d7e0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#aab2c2'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, s - 6, s - 6);
    ctx.fillStyle = '#566072';
    ctx.font = '116px "Hiragino Kaku Gothic ProN","Meiryo","Segoe UI",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, s / 2, s / 2 + 6);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter; tex.anisotropy = 4;
    return tex;
  }
  const faceMat = t => new THREE.MeshStandardMaterial({ map: faceTexture(t), color: 0xffffff, roughness: 1.0 });
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize),
    [faceMat('右'), faceMat('左'), faceMat('上'), faceMat('下'), faceMat('前'), faceMat('後')]
  );
  globe.add(cube);
  gizmo.cube = cube;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize)),
    new THREE.LineBasicMaterial({ color: 0x9aa2b2 })
  );
  globe.add(edges);

  function chevron() {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0.11); sh.lineTo(-0.10, -0.06); sh.lineTo(0.10, -0.06); sh.closePath();
    return new THREE.Mesh(new THREE.ShapeGeometry(sh),
      new THREE.MeshBasicMaterial({ color: 0x8fbfe6, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  }
  const half = cubeSize / 2;
  [new THREE.Vector3(0,0,1), new THREE.Vector3(0,0,-1), new THREE.Vector3(1,0,0), new THREE.Vector3(-1,0,0)]
    .forEach(n => {
      const ch = chevron();
      ch.position.copy(n.clone().multiplyScalar(half + 0.001));
      ch.position.y = -half - 0.16;
      ch.lookAt(ch.position.clone().add(n));
      globe.add(ch);
    });

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

  function dirPlane(text, rotZ) {
    const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = '#cdd5e2';
    ctx.font = 'bold 96px "Hiragino Kaku Gothic ProN","Meiryo","Segoe UI",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, s / 2, s / 2 + 4);
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.anisotropy = 4;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    pl.rotation.x = -Math.PI / 2; pl.rotation.z = rotZ; return pl;
  }
  const RL = (ringInner + ringOuter) / 2;
  [{ t:'北', x:0, z:-RL, rz:0 }, { t:'南', x:0, z:RL, rz:Math.PI },
   { t:'東', x:RL, z:0, rz:-Math.PI/2 }, { t:'西', x:-RL, z:0, rz:Math.PI/2 }]
    .forEach(m => { const pl = dirPlane(m.t, m.rz); pl.position.set(m.x, 0.01, m.z); compass.add(pl); });

  gScene.add(globe);
  gizmo.scene = gScene;
  gizmo.cam = gCam;
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
  renderer.setClearColor(0x141c33, 1);
  renderer.clear(true, true, false);
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
    // 断面プロファイル(外側を上→先端→内側を戻る)で中空のWN首を一体成形
    const prof = [
      [rootOR, back],          // 根元 外周（板側）
      [tipOR,  yTip],          // 先端 外周（テーパで細る）
      [innerR, yTip],          // 先端 内縁
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
  prof.push(new THREE.Vector2(outR, yEnd));   // 管外周→端
  prof.push(new THREE.Vector2(inR, yEnd));    // 端面
  prof.push(new THREE.Vector2(inR, yFace));   // ボア→面側
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
  for (const p of placedParts) {
    if (p === part || !p.userData.faceLocal) continue;
    for (const local of connsOf(p)) {
      const mpos = connModelPos(p, local);
      const v = mpos.clone().sub(anchorW);
      const along = v.dot(axis);                 // 固定端からの軸方向距離
      if (along <= 0.003) continue;              // 固定端より手前/同位置は対象外
      const perp = v.clone().sub(axis.clone().multiplyScalar(along)).length();
      if (perp > perpTol) continue;              // 軸線から外れている＝同じ通りでない→拾わない
      const ndc = modelGroup.localToWorld(mpos.clone()).project(cam);
      if (ndc.z >= 1) continue;
      const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);   // 画面距離（移動スナップと同基準）
      if (d < bestD) { bestD = d; best = along; }
    }
  }
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
  orientRotation(movingPart, movingOrient, movingRoll);
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
  if (rotForm && rotForm.style.display === 'flex') { hForm.style.display = 'none'; return; }   // 角度スピナー中はEL非表示
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
    if (e.key === 'Enter') {
      if (dirActive()) { applyDistInput(); dirDrag = null; clearMarkers(); updateForm(); }   // 距離確定→ロック解除・補助線消去
      else if (lineElRef()) { window.__lineApplyEl(parseFloat(hYInput.value) || 0); updateForm(); }   // 線分EL確定（起点指定の有無で全体/片側）
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
  updateForm();
  refreshItemList();   // 3D空間での選択/解除を一覧へ反映
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
      const add = e.ctrlKey || e.metaKey;
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
  if (e.ctrlKey || e.metaKey) return;      // Ctrl+クリックは複数選択トグル（移動ドラッグを開始しない）→ pointerup で処理
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
  if (e.ctrlKey || e.metaKey) { viewDown = null; return; }   // Ctrl は窓選択/個別トグル側で一括処理
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
  if (!(e.ctrlKey || e.metaKey)) return;
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
function nudgeApply(v) {
  if (_nudgeMode === 'move') { if (window.__annMoveSpinApply) window.__annMoveSpinApply(v); }
  else if (_nudgeMode === 'heading') { if (window.__annHeadingSpinApply) window.__annHeadingSpinApply(v); }
  else rotSpinApply(v);
}
function nudgeActive() {
  if (_nudgeMode === 'move') return !!(window.__annMoveSpinActive && window.__annMoveSpinActive());
  if (_nudgeMode === 'heading') return !!(window.__annHeadingSpinActive && window.__annHeadingSpinActive());
  return rotSpinActive();
}
function nudgePivot() {
  if (_nudgeMode === 'move') return window.__annMoveSpinPivot && window.__annMoveSpinPivot();
  if (_nudgeMode === 'heading') return window.__annHeadingSpinPivot && window.__annHeadingSpinPivot();
  return rotSpinPivot();
}
function nudgeStep() { return _nudgeMode === 'move' ? 1 : 0.5; }   // 移動=1mm刻み／角度・方位=0.5°刻み
function setNudgeLabel() {                                          // フォームの見出し・単位をモードで切替
  const lab = document.getElementById('rotLabel'), unit = document.getElementById('rotUnit');
  if (lab) lab.textContent = _nudgeMode === 'move' ? '移動' : _nudgeMode === 'heading' ? '方位' : '角度';
  if (unit) unit.textContent = _nudgeMode === 'move' ? 'mm' : '°';
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
  if (_nudgeMode === 'move') { if (commit) { if (window.__annMoveSpinEnd) window.__annMoveSpinEnd(); } else if (window.__annMoveSpinCancel) window.__annMoveSpinCancel(); }
  else if (_nudgeMode === 'heading') { if (commit) { if (window.__annHeadingSpinEnd) window.__annHeadingSpinEnd(); } else if (window.__annHeadingSpinCancel) window.__annHeadingSpinCancel(); }
  else { if (commit) rotSpinEnd(); else rotSpinCancel(); }
  if (rotForm) rotForm.style.display = 'none';
  _nudgeMode = 'angle';
  if (typeof updateForm === 'function') updateForm();   // スピナーを閉じたらEL入力等を出し直す
}
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 2) return;
  rDownPos = { x: e.clientX, y: e.clientY }; rLongFired = false; clearRLong();
  if (canRotSpin()) {                          // 線またはパイプを選択中＝長押しで角度スピナー
    const sh = e.shiftKey, cx = e.clientX, cy = e.clientY;
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
  orientStep(e.shiftKey);             // Shift+右クリック＝ひねり(roll)切替
});
// 向きの送り（右クリック相当）。タッチのコントローラーからも同じ処理を呼ぶ。
function orientStep(shift) {
  if (followTool) cycleFollowOrientation(shift);
  else if (movingPart) cycleMoveOrientation(shift);
  else if (isFreeRotPart(selectedPart)) pipeRotate(shift);   // パイプ・エルボは線分と同じ回転（起点まわり45°）
  else if (selectedPart) cycleSelectedOrientation(shift);   // その他の部品は従来の向き送り
  else if (window.__annHasSel && window.__annHasSel()) {
    // 構築線は短い右クリックでは回転させない（微調整は右クリック長押し＝平行移動/Shiftで角度）。線分は従来どおり45°回転
    if (!(window.__annSelIsXline && window.__annSelIsXline())) window.__annRotate(shift);
  }
}
if (rotAInput) {
  // 角度=0〜360未満/方位=0〜180未満（いずれも0.5°刻みで折り返し）／移動=mm整数（折り返し無し・負値可）
  const wrap = a => _nudgeMode === 'move' ? Math.round(a)
    : _nudgeMode === 'heading' ? (Math.round((((a % 180) + 180) % 180) * 2) / 2)
    : (Math.round((((a % 360) + 360) % 360) * 2) / 2);
  const setRot = v => { rotAInput.value = v; nudgeApply(v); };
  const applyRot = () => { setRot(wrap(parseFloat(rotAInput.value) || 0)); };
  rotAInput.addEventListener('change', applyRot);   // 手入力の確定で折り返し
  rotAInput.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); applyRot(); endRotSpin(true); }
    else if (e.key === 'Escape') { e.preventDefault(); endRotSpin(false); }
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
  bindHold('tcZoomIn',  () => zoomStep(0.88), true);
  bindHold('tcZoomOut', () => zoomStep(1.0 / 0.88), true);
  bindHold('tcOrient',  () => orientStep(false), false);
  bindHold('tcTwist',   () => orientStep(true),  false);
  bindHold('tcEsc',     () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), false);
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
  if (window.__posLineGuide) window.__posLineGuide();   // 線分描画中、三角形の脚にX/Z/Y入力欄を追従
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
    if (!src.length) return;
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
    if (copies.length) selectMany(copies);
  }

  // ================= 編集：鏡（左右反転） =================
  // 選択範囲の中心を通る「世界X軸に垂直な平面」で反転する。幾何学的に正確な鏡像。
  // ※反転後のアイテムを後から回転/移動すると向き情報(dir/roll)で再計算され鏡像が解けるため、暫定仕様。
  function mirror() {
    const src = [...selectedParts];
    if (!src.length) return;
    const box = new THREE.Box3();
    for (const s of src) box.expandByObject(s);
    if (box.isEmpty()) return;
    const cx = box.getCenter(new V3()).x;
    const refl = new THREE.Matrix4().makeTranslation(cx, 0, 0)
      .multiply(new THREE.Matrix4().makeScale(-1, 1, 1))
      .multiply(new THREE.Matrix4().makeTranslation(-cx, 0, 0));
    const copies = [];
    for (const s of src) {
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
    if (copies.length) selectMany(copies);
  }

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
  function serialize() {
    return {
      app: '配管3D', version: 1,
      drawing: { date: $('dwgDate').value, place: $('dwgPlace').value, name: $('dwgName').value, no: $('dwgNo').value },
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
      })),
      annotations: annStore.map(a => ({ type: a.type, a: a.a.toArray(), b: a.b.toArray(), style: a.style })),
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
      obj.userData.placed = true;
      modelGroup.add(obj);
      placedParts.push(obj);
    }
    const d = data.drawing || {};
    $('dwgDate').value = d.date || ''; $('dwgPlace').value = d.place || '';
    $('dwgName').value = d.name || ''; $('dwgNo').value = d.no || '';
    if (Array.isArray(data.annotations)) {
      for (const a of data.annotations) addAnnotation(a.type, new V3().fromArray(a.a), new V3().fromArray(a.b), a.style);
    }
    selectPart(null); refreshItemList();
  }
  function load() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { applyData(JSON.parse(r.result)); } catch (err) { alert('読込に失敗しました：' + err.message); } };
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
  function exportPng() {
    const url = snapshot();
    let nm = ($('dwgNo').value || '配管図').trim().replace(/[\\/:*?"<>|]/g, '_') || '配管図';
    const a = document.createElement('a'); a.href = url; a.download = nm + '.png'; a.click();
  }
  function listRowsHtml() {
    const trs = [...document.querySelectorAll('#ilBody tr')];
    let html = '';
    for (const tr of trs) {
      if (tr.classList.contains('il-empty')) continue;
      const tds = [...tr.children];
      const get = i => { const td = tds[i]; if (!td) return ''; const inp = td.querySelector('input'); return inp ? inp.value : td.textContent; };
      html += `<tr><td>${get(0)}</td><td>${get(1)}</td><td>${get(2)}</td><td>${get(3)}</td><td>${get(4)}</td><td style="text-align:right">${get(5)}</td><td>${get(6)}</td></tr>`;
    }
    return html || '<tr><td colspan="7" style="text-align:center">（部品なし）</td></tr>';
  }
  function esc(s) { return String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function printSheet() {
    const img = snapshot();
    const rows = listRowsHtml();
    const date = esc($('dwgDate').value), place = esc($('dwgPlace').value),
      name = esc($('dwgName').value), no = esc($('dwgNo').value);
    const w = window.open('', '_blank');
    if (!w) { alert('ポップアップがブロックされました。印刷を許可してください。'); return; }
    w.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>配管図 ${no || name}</title>
<style>
  body { font-family:"Meiryo","Hiragino Kaku Gothic ProN",sans-serif; margin:14mm; color:#111; }
  h1 { font-size:16px; margin:0 0 6px; }
  .head { display:flex; justify-content:space-between; border-bottom:2px solid #333; padding-bottom:6px; margin-bottom:10px; }
  .head .info div { font-size:12px; line-height:1.6; }
  .head .info b { display:inline-block; width:78px; color:#555; }
  img { width:100%; max-height:135mm; object-fit:contain; border:1px solid #bbb; }
  table { width:100%; border-collapse:collapse; margin-top:10px; font-size:11px; }
  th,td { border:1px solid #999; padding:3px 6px; }
  th { background:#eef1f7; }
  @media print { @page { size:A4 landscape; margin:10mm; } }
</style></head><body>
  <div class="head">
    <div><h1>配管図 ${no ? '図番 ' + no : ''}</h1></div>
    <div class="info">
      <div><b>名称</b>${name || '—'}</div>
      <div><b>場所</b>${place || '—'}</div>
      <div><b>作成年月日</b>${date || '—'}</div>
    </div>
  </div>
  <img src="${img}">
  <table>
    <thead><tr><th>#</th><th>種別</th><th>タイプ</th><th>サイズ</th><th>クラス</th><th>数量</th><th>材質</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
</body></html>`);
    w.document.close();
  }

  // ===================================================================
  //  描画：線分 / 構築線（レーザー）/ 寸法線
  // ===================================================================
  const annGroup = new THREE.Group();
  modelGroup.add(annGroup);
  const annStore = [];   // {type,a,b,obj}
  const COL = { line: 0x7fd1ff, xline: 0xff6bd0, dim: 0xffd24a };
  const XLINE_COLOR = 0x33ff55;   // 構築線（レーザー）の発光色＝緑。線種・色の選択は無し（一種類）

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
    const ltype = (type === 'xline') ? 'dashed' : (type === 'dim') ? 'solid' : 'dashdot';   // 線分の既定＝一点鎖線（赤）
    const color = (type === 'xline') ? XLINE_COLOR : ltypeColor(ltype);   // 構築線はレーザー色固定
    return { color, ltype, width: 0.0006 };   // 太さ＝極細固定・色＝線種で決定
  }
  // 描画ツールごとの既定書式（リボンのアイコン右クリックで設定）。新規に引く線はこれを継承。
  const toolStyle = { line: defaultStyle('line'), xline: defaultStyle('xline'), dim: defaultStyle('dim') };
  function styleFor(type) {
    const s = toolStyle[type] || defaultStyle(type);
    return { color: s.color, ltype: s.ltype, width: s.width };
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
  function laserTube(A, B, radius, color, opacity) {
    const len = A.distanceTo(B);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8, 1, true), mat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new V3(0, 1, 0), B.clone().sub(A).normalize());
    m.userData.baseColor = color;   // 選択解除時にこの色へ戻す（paintAnnが参照）
    m.renderOrder = 998;
    return m;
  }
  function xlineSeg(A, B, style) {
    const grp = new THREE.Group();
    grp.add(laserTube(A, B, 0.0016, XLINE_COLOR, 0.16));    // 外側の光暈（極細）
    grp.add(laserTube(A, B, 0.0007, XLINE_COLOR, 0.38));    // 中間の光暈
    grp.add(laserTube(A, B, 0.00032, 0xd8ffd8, 0.95));      // 白緑に光る芯
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
      grp.add(styledSeg(a, b, style));
      const mm = Math.round(a.distanceTo(b) * 1000);
      const sp = labelSprite(mm + ' mm', hexCss(col));
      sp.position.copy(a.clone().add(b).multiplyScalar(0.5));
      grp.add(sp);
    } else {
      grp.add(styledSeg(a, b, style));
    }
    grp.userData.annType = type;
    return grp;
  }
  function addAnnotation(type, a, b, style) {
    const st = style ? { color: style.color, ltype: style.ltype, width: style.width } : styleFor(type);
    const grp = buildAnn(type, a, b, st);
    annGroup.add(grp);
    annStore.push({ type, a: a.clone(), b: b.clone(), style: st, obj: grp });
  }
  function clearAnnotations() {
    for (const r of annStore) { annGroup.remove(r.obj); disposeObj(r.obj); }
    annStore.length = 0;
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
      renderer.domElement.style.cursor = 'crosshair';
    } else {
      renderer.domElement.style.cursor = '';
    }
    updateDrawButtons();
  }
  function updateDrawButtons() {
    [['line', 'cmdLine'], ['xline', 'cmdXline'], ['dim', 'cmdDim']].forEach(([m, id]) => {
      const b = $(id); if (b) b.classList.toggle('active', drawState.mode === m);
    });
  }
  // ---- 描画用スナップ＆点決め ----
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
    for (const r of annStore) { if (r === drawState.editRec) continue; test(r.a); test(r.b); }   // 他の線・寸法線の両端（編集中の線自身は除外＝自己吸着で飛ぶのを防ぐ）
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
  function hideLineBoxes() { [lnXBox, lnZBox, lnYBox, lnDBox].forEach(b => { if (b) b.style.display = 'none'; }); hideXlineAngle(); }
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
    xlineAngleEl.textContent = '∠ ' + xlineAngleDeg(a, b).toFixed(1) + '°';
    xlineAngleEl.style.display = 'block';
    xlineAngleEl.style.left = Math.round(sx - xlineAngleEl.offsetWidth / 2) + 'px';
    xlineAngleEl.style.top = Math.round(sy - 26) + 'px';
  }
  function placeDistanceBox(a, b) {   // 本線（斜辺）の距離 mm を中点に表示
    if (lnDBox) placeLegInput(lnDBox, lnD, a.clone().add(b).multiplyScalar(0.5), new V3(0, 1, 0), Math.round(a.distanceTo(b) * 1000));
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
  }
  function clearDrawTemp() {    // 描画途中の状態を全消去（線は残す）
    drawState.first = null; drawState.cur = null; drawState.vert = false;
    drawState.locked = false; drawState.editRec = null; drawState.snapped = false;
    clearPreview();
    if (typeof clearLineGuide === 'function') clearLineGuide();
    if (typeof hideLineBoxes === 'function') hideLineBoxes();
  }
  const abortDrawPoint = clearDrawTemp;   // 起点取消（未確定なので線は作られない）
  const finishGuide = clearDrawTemp;      // 確定待ちを終える（線は確定済みなので残る）
  function commitGuideToStore() {         // first→cur を実体の注釈として作成し、そのレコードを返す
    if (!drawState.first || !drawState.cur || drawState.cur.distanceTo(drawState.first) <= 1e-6) return null;
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
  function commitGuide() {                              // first→cur を確定し、確定待ち(locked)へ
    const rec = commitGuideToStore();
    if (rec) {
      if (rec.type === 'xline') {                    // 構築線：ツールを抜けて選択（中心1点）→角度スピナー→決定後にEL入力
        cancelDraw();                                // ツールを抜ける（以後クリックで再選択できる）
        selectLine(rec);
        const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
        const n = modelGroup.localToWorld(rec.a.clone()).project(cam);
        const sx = rect.left + (n.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-n.y * 0.5 + 0.5) * rect.height;
        startRotSpin(true, sx, sy);                  // 構築線選択中の Shift 相当＝方位角スピナー。閉じるとEL入力が出る
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
    if (drawState.locked) finishGuide();                // 直前の確定待ちを終え、新しい線を始める
    const hadFirst = !!drawState.first;
    if (!hadFirst) {                                    // ①の1回目／②の押下＝起点を決める
      const r = pickFirstPoint(e.clientX, e.clientY);
      if (r.p) {
        drawState.first = r.p; drawState.cur = r.p.clone(); drawState.vert = e.shiftKey;
        drawState.snapped = r.snapped; drawState.locked = false; drawState.editRec = null;
        clearPreview();
        drawTriangle3D(drawState.first, drawState.cur, drawState.vert, drawState.snapped);
      }
    } else {                                            // ①の2回目＝終点を現在位置に合わせる（離す時に確定）
      const r = pickSecondPoint(e.clientX, e.clientY, drawState.first, e.shiftKey);
      if (r.p) { drawState.cur = r.p; drawState.vert = e.shiftKey; drawState.snapped = r.snapped; }
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
      if (moved > 6) { if (!commitGuide()) abortDrawPoint(); }   // ②ドラッグして離した＝確定
      // ドラッグ無し（単純クリック）＝①の1回目。起点は残し、2回目クリックを待つ
    } else {                                            // ①の2回目クリック＝終点で確定
      commitGuide();                                    // 同一点でゼロ長なら確定されず、起点を保持して継続
    }
  }, true);
  window.addEventListener('pointermove', e => {
    if (!drawActive()) return;
    if (overLineBox(e.clientX, e.clientY)) return;      // 脚入力欄の上ではプレビュー凍結（方向を保つ）
    if (drawState.locked) return;                       // 確定待ちは固定（脚入力で編集）
    if (!drawState.first) {                             // ホバー中：スナップ印だけ出す（吸着可視化）
      clearLineGuide();
      const r = pickFirstPoint(e.clientX, e.clientY);
      if (r.snapped && r.p) guideDot(r.p, 0x39ff8a, 0.0042);
      return;
    }
    const r = pickSecondPoint(e.clientX, e.clientY, drawState.first, e.shiftKey);
    if (!r.p) return;
    drawState.cur = r.p; drawState.vert = e.shiftKey; drawState.snapped = r.snapped;
    clearPreview();
    drawState.preview = buildAnn(drawState.mode, drawState.first, r.p, styleFor(drawState.mode));
    drawState.preview.traverse(o => { if (o.material) o.material.opacity = 0.6; });
    annGroup.add(drawState.preview);
    drawTriangle3D(drawState.first, r.p, drawState.vert, drawState.snapped);
  }, true);
  window.addEventListener('contextmenu', e => {
    if (!drawActive()) return;
    if (e.target !== renderer.domElement) return;       // リボンのアイコン等は通す（書式メニューを開けるように）
    e.preventDefault(); e.stopImmediatePropagation();
    const moved = drawRDown ? Math.hypot(e.clientX - drawRDown.x, e.clientY - drawRDown.y) : 0;
    drawRDown = null;
    if (moved > 6) return;                               // 右ドラッグ＝視点パン → 取消しない
    if (drawState.locked) finishGuide();                 // 確定待ちを終える（線は残す）
    else if (drawState.first) abortDrawPoint();          // 描画中の起点を取消
    else cancelDraw();                                   // モード解除
  }, true);
  window.addEventListener('keydown', e => {
    if (!drawActive()) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;   // 入力中は無視
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      if (drawState.locked) finishGuide();
      else if (drawState.first) abortDrawPoint();
      else cancelDraw();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !drawState.first && annStore.length) {
      e.stopImmediatePropagation();
      const r = annStore.pop(); annGroup.remove(r.obj); disposeObj(r.obj);   // 直近の注釈を取消
    }
  }, true);

  // ===================================================================
  //  描画後の線分：再選択 / 移動 / 端点ドラッグで長さ変更（描画モード外で動作）
  // ===================================================================
  window.__annSnapPoints = () => { const a = []; for (const r of annStore) { if (r === drawState.editRec) continue; if (annMoveSnap && selAnns.has(r)) continue; a.push(r.a, r.b); } return a; };
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
    // 構築線は起点を中心(a)ひとつだけ表示（向き点bはハンドルにしない）
    for (const rec of selAnns) for (const p of (rec.type === 'xline' ? [rec.a] : [rec.a, rec.b])) {
      const chosen = (p === gp) && !moving;
      const m = new THREE.Mesh(new THREE.SphereGeometry(chosen ? 0.0028 : 0.0015, 16, 12),
        new THREE.MeshBasicMaterial({ color: chosen ? 0x39ff8a : 0xff8a3c, depthTest: false, transparent: true, opacity: 0.92 }));
      m.position.copy(p); m.renderOrder = 999; lineSelGroup.add(m);
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
  function selectLine(rec, additive) {
    selectPart(null);                          // 部品選択を解除（部品クリックと同じ排他。__annClearSelも走る）
    if (!additive) selAnns.clear();
    selAnns.add(rec); lineSel = rec;
    clearGrip();                               // 選択しただけ＝起点未選択（端点は小さいまま）
    refreshAnnHi(); refreshHandles();
    if (typeof updateForm === 'function') updateForm();   // EL入力フォームを起点側に表示
  }
  function deselectLine() { lineSel = null; clearLineHandles(); selAnns.clear(); clearAnnHi(); clearGrip(); if (typeof updateForm === 'function') updateForm(); }

  // ---- 線分の複数選択（Ctrl+クリック／窓選択）。部品の selectedParts と並行管理 ----
  // 選択表示は部品と同じく「青く発光」させる＝線そのものの色を SEL_COLOR に塗り替え、解除で元色へ戻す
  const selAnns = new Set();                 // 選択中の注釈レコード集合
  function paintAnn(rec, on) {
    const fallback = rec.style ? rec.style.color : 0xffffff;
    rec.obj.traverse(o => {
      if (o.type === 'Sprite') return;
      if (!o.material || !o.material.color) return;
      // 選択中は青く発光。解除時は各メッシュ固有の色（レーザーの芯/暈）へ、無ければ線色へ戻す
      o.material.color.setHex(on ? SEL_COLOR : (o.userData.baseColor != null ? o.userData.baseColor : fallback));
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
    const proj = p => { const n = modelGroup.localToWorld(p.clone()).project(cam);
      return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height, z: n.z }; };
    let added = 0;
    for (const rec of annStore) {
      const [A, B] = annPickEnds(rec);
      const pa = proj(A), pb = proj(B);
      if (pa.z >= 1 && pb.z >= 1) continue;
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
  window.__annClearSel = () => { if (selAnns.size) { selAnns.clear(); clearAnnHi(); refreshHandles(); if (typeof updateForm === 'function') updateForm(); } };
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
  window.__annRotate = (shift) => {
    if (!selAnns.size) return;
    let pivot = gripPt() || (lineSel ? lineSel.a : null);
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
    for (const r of selAnns) { if (r.a !== pivot) rot(r.a); if (r.b !== pivot) rot(r.b); rebuildAnn(r); }
    refreshAnnHi(); refreshHandles();
    if (typeof updateForm === 'function') updateForm();
  };
  // 角度スピナー回転：開始時にスナップ＋軸を固定し、任意角度で回す（右クリック長押し用）
  let _rotSpin = null;
  window.__annRotateSpinStart = (shift) => {
    if (!selAnns.size) return false;
    let pivot = gripPt() || (lineSel ? lineSel.a : null);
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
    _rotSpin = { pivot: pivot.clone(), axis, snap: [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone() })) };
    return true;
  };
  window.__annRotateSpinApply = (deg) => {
    if (!_rotSpin) return;
    const q = new THREE.Quaternion().setFromAxisAngle(_rotSpin.axis, deg * Math.PI / 180);
    for (const s of _rotSpin.snap) {
      const va = s.a.clone().sub(_rotSpin.pivot).applyQuaternion(q); s.r.a.copy(_rotSpin.pivot).add(va);
      const vb = s.b.clone().sub(_rotSpin.pivot).applyQuaternion(q); s.r.b.copy(_rotSpin.pivot).add(vb);
      rebuildAnn(s.r);
    }
    refreshAnnHi(); refreshHandles();
    if (typeof updateForm === 'function') updateForm();
  };
  window.__annRotateSpinEnd = () => { _rotSpin = null; };
  window.__annRotateSpinCancel = () => {
    if (!_rotSpin) return;
    for (const s of _rotSpin.snap) { s.r.a.copy(s.a); s.r.b.copy(s.b); rebuildAnn(s.r); }
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
    if (typeof updateForm === 'function') updateForm();
    return n;
  };
  // 部品の集団移動に追従して、選択中の線も同じ分だけ平行移動
  let annMoveSnap = null;
  window.__annMoveStart = () => { annMoveSnap = [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone() })); };
  window.__annMoveApply = (dx, dy, dz) => {
    if (!annMoveSnap) return;
    for (const s of annMoveSnap) { s.r.a.set(s.a.x + dx, s.a.y + dy, s.a.z + dz); s.r.b.set(s.b.x + dx, s.b.y + dy, s.b.z + dz); rebuildAnn(s.r); }
    refreshAnnHi();
    refreshHandles();   // 全選択線の端点ハンドルを現在位置へ（窓選択で lineSel 無しでも置き去りにしない）
  };
  window.__annMoveEnd = () => { annMoveSnap = null; };
  // 選択中の線をまとめて (dx,dy,dz) だけ平行移動（高さ/EL一括変更で部品と一緒に動かす用）
  window.__annShiftSelected = (dx, dy, dz) => {
    if (!selAnns.size) return;
    for (const r of selAnns) { r.a.set(r.a.x + dx, r.a.y + dy, r.a.z + dz); r.b.set(r.b.x + dx, r.b.y + dy, r.b.z + dz); rebuildAnn(r); }
    refreshAnnHi(); refreshHandles();
  };
  window.__annMoveCancel = () => {
    if (!annMoveSnap) return;
    for (const s of annMoveSnap) { s.r.a.copy(s.a); s.r.b.copy(s.b); rebuildAnn(s.r); }
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
    return [rec.a, rec.b];
  }
  // カーソル最寄りの線を画面距離(px)で拾う。近くに線が無ければ null（=部品クリックへ委ねる）
  // 構築線（±12mの長い線）は片端がカメラ背後に回ると project() の投影が反転して
  // 当たり判定が壊れるため、視点空間でニアプレーンにクリップしてから投影する。
  function pickAnnAt(cx, cy) {
    if (!annStore.length) return null;
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    cam.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(cam.matrixWorld).invert();
    const toView = p => modelGroup.localToWorld(p.clone()).applyMatrix4(inv);   // カメラ視点空間（前方= -z）
    const toScr = v => {
      const n = v.clone().applyMatrix4(cam.projectionMatrix);
      return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height };
    };
    const persp = !!cam.isPerspectiveCamera;
    const nearZ = persp ? -((cam.near || 0.01) + 1e-4) : null;
    let best = null, bestD = ANN_PICK_PX;
    for (const rec of annStore) {
      const [Ae, Be] = annPickEnds(rec);
      let A = toView(Ae), B = toView(Be);
      if (persp) {
        if (A.z > nearZ && B.z > nearZ) continue;   // 両端ともカメラ背後
        if (A.z > nearZ) A.lerp(B, (nearZ - A.z) / (B.z - A.z));        // 背後側の端をニアプレーンへ
        else if (B.z > nearZ) B.lerp(A, (nearZ - B.z) / (A.z - B.z));
      }
      const pa = toScr(A), pb = toScr(B);
      const d = segPixelDist(cx, cy, pa.x, pa.y, pb.x, pb.y);
      if (d <= bestD) { bestD = d; best = rec; }
    }
    return best;
  }
  // カーソル近傍の端点（0=a,1=b）。無ければ null。
  function endpointAt(rec, cx, cy) {
    if (rec.type === 'xline') return null;   // 構築線は端点伸縮しない（中心グリップで全体移動のみ）
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    const scr = p => { const n = modelGroup.localToWorld(p.clone()).project(cam); return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height, z: n.z }; };
    const sa = scr(rec.a), sb = scr(rec.b), TH = SNAP_PX + 6;
    const da = Math.hypot(sa.x - cx, sa.y - cy), db = Math.hypot(sb.x - cx, sb.y - cy);
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
    for (const r of annStore) { if (exAnns.has(r)) continue; test(r.a); test(r.b); }
    return best;
  }
  // 移動中の起点(橙)・他アイテムの機点(青/吸着は緑)マーカー。部品の showInteractionMarkers と同じ見た目
  function showLineMoveMarkers(gripPt, exParts, exAnns, snapPoint) {
    clearMarkers();
    addMarker(gripPt, 0xff8a3c, markerRadiusFor(null, false));
    const mark = (pt, rN, rB) => { const isSnap = snapPoint && pt.distanceTo(snapPoint) < 1e-6; addMarker(pt, isSnap ? 0x39ff8a : 0x7fd1ff, isSnap ? rB : rN); };
    for (const p of placedParts) { if (exParts.has(p) || !p.userData.faceLocal) continue; const rN = markerRadiusFor(p, false), rB = markerRadiusFor(p, true); for (const local of connsOf(p)) mark(connModelPos(p, local), rN, rB); }
    const lN = markerRadiusFor(null, false), lB = markerRadiusFor(null, true);
    for (const r of annStore) { if (exAnns.has(r)) continue; mark(r.a, lN, lB); mark(r.b, lN, lB); }
  }
  let _lnLastT = 0, _lnLastX = 0, _lnLastY = 0, _lnLastRec = null;   // ダブルクリック検出（自由移動）
  window.addEventListener('pointerdown', e => {
    if (drawActive() || e.button !== 0) return;
    if (followTool || movingPart) return;                // 部品の配置/移動中は線分操作を横取りしない（スナップ先の線を掴んで配置を止める不具合対策）
    if (e.target !== renderer.domElement) return;        // 脚入力などUIは通す
    if (e.ctrlKey || e.metaKey) return;                  // Ctrl＝部品の複数選択へ委ねる
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
    if (lineSel) {                                       // 選択中の線の端点を掴む → 長さ変更
      const end = endpointAt(lineSel, e.clientX, e.clientY);
      if (end !== null) {
        startEndpointEdit(lineSel, end);
        lineDrag = { mode: 'end', downX: e.clientX, downY: e.clientY, moved: false };
        e.stopImmediatePropagation(); return;
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
                   annSnap: [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone() })),
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
      for (const s of lineDrag.annSnap) { s.r.a.set(s.a.x + dx, s.a.y + dy, s.a.z + dz); s.r.b.set(s.b.x + dx, s.b.y + dy, s.b.z + dz); rebuildAnn(s.r); }
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
    } else {                                             // end：反対端固定で、線の軸方向に沿って伸び縮み（斜め・Y方向も保持）
      const sp = axisStretchPoint(e.clientX, e.clientY, drawState.first, drawState.editAxis);
      if (!sp) return;
      const dist = Math.round(sp.distanceTo(drawState.first) * 1000) / 1000;   // 固定端からの距離を1mm刻みに
      const p = drawState.first.clone().addScaledVector(drawState.editAxis, dist);
      drawState.cur = p; drawState.vert = false; drawState.snapped = false;
      drawState.editRec.b.copy(p); rebuildAnn(drawState.editRec);
      // Y成分がある斜め線は水平到達点を角にしてつぶれない三角形に（Z＋Yでも表示される）
      const hasY = Math.abs(p.y - drawState.first.y) > 1e-4;
      drawTriangle3D(drawState.first, p, hasY, false);
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
    if (mode === 'end') {
      if (moved) drawState.locked = true;     // 確定待ち：脚/距離入力で微調整可（Enterで確定）
      else { clearDrawTemp(); if (typeof updateForm === 'function') updateForm(); }   // 端クリックのみ→編集解除しELを戻す
    } else if (mode === 'sel') {
      clearMarkers(); hideLineBoxes();         // 移動ガイド三角形・X/Z/L欄を消す（選択・位置は維持）
      if (!moved && !nearEnd) { clearGrip(); refreshHandles(); }   // 本体クリックのみ＝起点未選択（端点は小さく）
      if (typeof updateForm === 'function') updateForm();   // 移動後はELフォームを戻す
    }
  }, true);
  window.addEventListener('keydown', e => {
    if (drawActive() || !lineSel) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
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
  $('cmdDim').onclick = () => setDrawMode('dim');
  $('cmdDup').onclick = duplicate;
  $('cmdMirror').onclick = mirror;
  $('cmdDel').onclick = () => deleteSelected();
  $('cmdZoom').onclick = zoomExtents;
  $('cmdHome').onclick = resetView;

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
    if (drawState.mode !== type) setDrawMode(type);           // 設定対象のツールを起動（閉じたらすぐ描ける）
    fmtMenu.classList.toggle('is-xline', type === 'xline');   // 構築線は太さ非対応
    const ttl = fmtMenu.querySelector('.fm-ttl');
    if (ttl) ttl.textContent = (type === 'dim' ? '寸法線' : type === 'xline' ? '構築線' : '線分') + 'の既定書式';
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
  function maybeCloseFmtMenu() { if (fmtMenu.style.display === 'block') { closeFmtMenu(); return true; } return false; }
  function applyFmt(act, val) {
    const st = toolStyle[fmtToolType]; if (!st) return;
    if (act === 'ltype') { st.ltype = val; st.color = ltypeColor(val); st.width = 0.0006; }   // 色は線種で決定・太さは極細固定
    markFmtActive();
  }
  fmtMenu.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    applyFmt(el.dataset.act, el.dataset.val);
  });

  // リボンのアイコンを右クリック → そのツールの既定書式メニューを開く
  // 構築線(xline)はレーザー一種類なので書式メニューは持たない（右クリック対象外）
  [['cmdLine', 'line'], ['cmdDim', 'dim']].forEach(([id, type]) => {
    const b = $(id); if (!b) return;
    b.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      const r = b.getBoundingClientRect();
      openToolFmtMenu(type, r.left, r.top);
    });
  });
  // メニュー外クリック / Esc / ホイールで閉じる
  window.addEventListener('pointerdown', e => {
    if (fmtMenu.style.display === 'block' && !fmtMenu.contains(e.target)) closeFmtMenu();
  }, true);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && fmtMenu.style.display === 'block') closeFmtMenu(); });
  window.addEventListener('wheel', () => { if (fmtMenu.style.display === 'block') closeFmtMenu(); }, { passive: true });
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
})();
