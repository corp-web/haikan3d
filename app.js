/* 配管3D — 3Dモデル空間 + 格子舞台の視点操作子
   ・床下も回れる視点 / 床グリッド・座標軸（modelGroup）
   ・右上の格子舞台：方位文字タップで正対＋平行投影、床タップ=真上、角タップ=等角
   ・ホーム＝初期視点、円弧矢印＝平行投影時のみ画面90°ロール
   ・視点切替はトゥイーンでなめらかに移行
   制御方針：平行投影(ortho)中はOrbitControlsを止め、こちらでカメラを所有する。
            画面をドラッグしたら up を(0,1,0)に戻してから OrbitControls を再開する
            （OrbitControls に Y以外の up を絶対に渡さない＝フリーズ防止）。 */

// 版数表示：app.js 側に置くことで Date.now() 取得で毎回最新になり、普通の再読込で版数も更新される
// （index.html はキャッシュされるので版数を埋めない）。左上ブランドへ動的に付与し、古い版数spanは掃除する。
const APP_VER = 'v0804-E';
(function showVer() {
  const brand = document.querySelector('.brand');
  if (!brand) return;
  brand.querySelectorAll('span').forEach(s => { if (/^v\d{4}-/.test((s.textContent || '').trim())) s.remove(); });   // 旧版数spanを除去
  const tag = document.createElement('span');
  tag.className = 'appver';
  tag.style.cssText = 'font-size:11px;opacity:.65;margin-left:7px;font-weight:normal;letter-spacing:.5px;';
  tag.textContent = APP_VER;
  brand.appendChild(tag);
})();

const vp = document.getElementById('viewport');

// ---- レンダラ ----
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.autoClear = false;
vp.appendChild(renderer.domElement);

// ---- シーン ----
const scene = new THREE.Scene();
// 統一カラーモード（2026-07-19 社長決定：ダーク/ホワイト切替を廃止し、昼夜・屋内外で共通に見やすい
// CAD標準風の中間グレー1本に統一。UIパネルも明るい配色＝背景と調和（2026-07-20 社長要望））
// 背景＝真っ白（2026-08-02 社長「透明がダメなら真っ白で」）。演出なしの#ffffff一色。
// 起動下地（index.htmlのbody background）も同色＝立ち上がりから白。
// パールメタリック＝車のパール塗装のように、上から下へ色がわずかに移ろう階調
// （2026-08-03 社長提案・見比べで③「虹色の移ろい」を選択）。
// 天頂＝青みのパール／少し下＝暖かいパール／地平あたり＝ほんのり紫／足元＝沈む。
// 図面の邪魔にならない淡さに留める。印刷は従来どおり真っ白で撮る。
function makePearlBg() {
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
  const g = cv.getContext('2d'), lg = g.createLinearGradient(0, 0, 0, 256);
  lg.addColorStop(0, '#ddecfc');      // 天頂＝青
  lg.addColorStop(0.34, '#ecf1f8');   // 少し下＝明るい銀
  lg.addColorStop(0.62, '#dde6f4');   // 地平あたり＝青紫
  lg.addColorStop(1, '#cdd9ec');      // 足元＝濃い青灰
  g.fillStyle = lg; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(cv);
  if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
scene.background = makePearlBg();
// 霞（フォグ）なし＝遠くの配管も端まで濁らない（2026-08-01 社長「クリアなイメージ」）。
// 遠近感は格子（buildGrid）と外形線が受け持つ。印刷も同じ条件で澄む。
scene.fog = null;
document.body.classList.add('light');   // UIは明るい配色で固定（旧ホワイトモードのUIスタイルを常時適用）

// ---- 既定EL＝アイテムの配置・線の描き始めの基準の高さ（mm） ----
// スナップが無いときの水平面がこの高さになる。設定⚙「既定EL」で変更・記憶
// （2026-08-02 社長指示。配管はGLより上を走るのが普通なので既定+1000）。
// ホーム視点もこの高さを見る＝描き始めがいつも画面の中心に来る。
let defaultEl = 1000;
try { const _dv = parseFloat(localStorage.getItem('p3d_default_el')); if (isFinite(_dv)) defaultEl = _dv; } catch (e) {}
const defaultElY = () => defaultEl / 1000;   // mm→m（3D空間の単位）

// ---- カメラ ----
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
const HOME = { pos: new THREE.Vector3(0.9, 0.75 + defaultElY(), 1.2), target: new THREE.Vector3(0, defaultElY(), 0) };
camera.position.copy(HOME.pos);

// ---- 視点操作 (OrbitControls) ----
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.copy(HOME.target);
controls.minDistance = 0.08;
controls.maxDistance = 80;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
// 視点回転の遊び＝押した所から9px動くまでは回さない（2026-08-02 社長指摘：
// ダブルタップの指ブレで画面が動き過ぎる。Ctrl＋ダブルタップで窓を作る時など）。
controls.rotateDeadZone = 9;
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

// ---- ライト（2026-07-19 社長要望：全体を明るく・立体感を強く） ----
// ※2026-07-26：環境マップ（下）が全方位の明かりを兼ねるようになったため、
//   環境光・空地光は大きく下げた。下げないと金属が白く飛んで、明るい背景と見分けがつかなくなる。
scene.add(new THREE.AmbientLight(0xffffff, 0.16));
scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x434b59, 0.22));   // 空/地の自然グラデ＝面の向きで明るさが変わる
const key = new THREE.DirectionalLight(0xffffff, 1.05);
key.position.set(8, 12, 6); scene.add(key);
const fill = new THREE.DirectionalLight(0x88aaff, 0.3);
fill.position.set(-8, 4, -6); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.28);           // 逆側からの輪郭光＝金属の締まり
rim.position.set(2, -6, -9); scene.add(rim);

// ---- 環境マップ＝金属の映り込み（2026-07-26） ----
// MeshStandardMaterial は「映り込む先」が無いと金属が灰色の粘土のように見える。
// 空・地面・太陽を描いた全天球を1枚だけ作って scene.environment に渡すと、
// 全部品（FLANGE_MAT・バルブ等はすべて Standard 系）が自動で反射を拾い、鋼らしい艶が出る。
// ※PMREM のテクスチャは生成したレンダラ専用＝パレットのサムネイル（別レンダラ）用には
//   makeEnvMapFor(palRenderer) で同じものを別途生成して渡す（色味を本編と揃える）。
// ※印刷は MeshBasicMaterial に差し替えて撮るので、この映り込みは図面には出ない。
function makeEnvMapFor(rnd) {
  const W = 256, H = 128;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const gr = c.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#dfe8f8');      // 天頂
  gr.addColorStop(0.42, '#ffffff');   // 地平線＝いちばん明るい（管の腹に横一文字のハイライトが乗る）
  gr.addColorStop(0.50, '#ffffff');
  gr.addColorStop(0.54, '#9aa2ad');   // 地平線の下＝地面（暗く落として明暗差＝艶を強める）
  gr.addColorStop(1, '#5f656e');      // 足元
  c.fillStyle = gr; c.fillRect(0, 0, W, H);
  // 太陽＝キーライト(8,12,6)の方角にひとつ。これが金属のハイライトの芯になる。
  const sun = c.createRadialGradient(W * 0.40, H * 0.22, 0, W * 0.40, H * 0.22, W * 0.14);
  sun.addColorStop(0, 'rgba(255,255,255,1)'); sun.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = sun; c.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  try {
    const pm = new THREE.PMREMGenerator(rnd);
    const rt = pm.fromEquirectangular(tex);
    pm.dispose(); tex.dispose();
    return rt.texture;
  } catch (e) { return null; }        // 非対応環境では映り込みなしで続行（見た目が従来に戻るだけ）
}
scene.environment = makeEnvMapFor(renderer);

// ---- 画面の外形線＋陰（2026-07-26） ----
// 印刷で使っている「深度差から輪郭を抜く」パスを画面でも回す。輪郭が入ると部品の形が締まり、
// 明るい背景の中でも配管が背景に溶けない。中身は後半の drawSilhouette（定義後にここへ入る）。
const SCREEN_EDGE_COLOR = 0x1a2029;   // 画面の外形線＝墨色（紙の真っ黒より軽く）
// 効き具合。edgeAlpha=外形線の濃さ／ao=くぼみの陰の濃さ（0で陰なし）
// 屋外の日光下でも形が読めるよう、線・陰ともやや強めを既定にする（弱いと反射に負ける）
const SCREEN_EDGE_OPT = { edgeColor: SCREEN_EDGE_COLOR, edgeAlpha: 0.85, ao: 0.62, aoRadius: 5.0 };
window.__edgeTune = (o) => Object.assign(SCREEN_EDGE_OPT, o);   // 見比べ・テスト用
let screenSilhouette = null;
// 常時ON（2026-07-27 社長判断：切る場面が無いので設定から外した）。
// 変数とフックは検証用に残す＝重い端末で切り分けたい時は __edgeSet(false) で消せる。
let showEdges = true;
window.__edgeOn = () => showEdges;
window.__edgeSet = (v) => { showEdges = !!v; };

// ---- モデル空間（配管はここに入れる） ----
const modelGroup = new THREE.Group();
scene.add(modelGroup);
let grid = null;
// 格子＝20m四方・50cm目盛りのシンプルな格子（v0731-I の姿。2026-08-02 社長指示で復帰）。
// フェード（放射／チェビシェフ）・外枠線は入れない＝素の GridHelper 1枚だけ。
function buildGrid(c1, c2) {
  if (grid) { modelGroup.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
  grid = new THREE.GridHelper(20, 40, c1, c2);
  grid.material.opacity = 0.6; grid.material.transparent = true;
  modelGroup.add(grid);
}
buildGrid(0x848c96, 0xaeb4bd);   // グリッド＝地面と同系の青みグレー（濃線/淡線）
// 床の陰・艶（floorSheen）＝v0802-D で廃止（2026-08-02 社長「背景が真っ白になっていない」）。
// ホーム視点は見下ろしで画面全体が床＝14m四方の薄灰色がそのまま「背景が灰色」に見えていた（画素実測220/255）。
// 変数は印刷パスの参照互換のため null のまま残す。
let floorSheen = null;
// ---- 地面（GL＝EL0 の半透明スラブ）＝地上と地下をひと目で区別（2026-07-19 社長要望・BIMビューア風） ----
// 半透明なので地下（EL<0）の配管もスラブ越しにうっすら見える。設定⚙「地面の表示」でON/OFF。印刷には出さない。
let showGround = false;   // 既定OFF（2026-07-20 社長指示。設定でONにすると記憶）
try { showGround = localStorage.getItem('p3d_show_ground') === '1'; } catch (e) {}
const GROUND_SIZE = 40;                 // 40m四方（20mグリッドより一回り広く）
let groundGroup = null;
function buildGround(fillC, rimC) {
  if (groundGroup) {
    modelGroup.remove(groundGroup);
    groundGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  groundGroup = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshBasicMaterial({ color: fillC, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.002;             // グリッド(y=0)とのz-fight回避に2mmだけ下げる
  groundGroup.add(mesh);
  const h = GROUND_SIZE / 2;
  const rim = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-h, 0, -h), new THREE.Vector3(h, 0, -h),
      new THREE.Vector3(h, 0, h), new THREE.Vector3(-h, 0, h)]),
    new THREE.LineBasicMaterial({ color: rimC, transparent: true, opacity: 0.8 }));
  groundGroup.add(rim);                 // スラブの縁取り＝GLの端をくっきり見せる
  groundGroup.visible = showGround;
  modelGroup.add(groundGroup);
}
buildGround(0xafb5be, 0x6f7784);   // 地面＝v0720-C系の青みグレー（社長の好み）。空はハイトーンのまま＝上下の明暗で分離
function applyGround() {
  if (groundGroup) groundGroup.visible = showGround;
  try { localStorage.setItem('p3d_show_ground', showGround ? '1' : '0'); } catch (e) {}
}
// ---- 明暗テーマは廃止（2026-07-19 社長決定）＝上の統一グレーに一本化。UIは従来のダーク調固定 ----
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

// ---- 入力欄のフォーカス＝タッチ端末では「全選択」をしない（2026-07-19 社長報告） ----
// select() で全選択すると iPad はカット/コピー/ペーストのメニュー（コールアウト）が出て邪魔になる。
// タッチ端末＝カーソルを末尾に置き、最初の1文字入力で全置換（＝全選択と同じ使い勝手でメニューなし）。
// PC（マウス）＝従来どおり全選択。
const IS_TOUCH_DEV = (navigator.maxTouchPoints || 0) > 0;
function focusSelectAll(inp) {
  if (!inp) return;
  inp.focus();
  if (!IS_TOUCH_DEV) { try { inp.select(); } catch (e) {} return; }
  const n = String(inp.value || '').length;
  try { inp.setSelectionRange(n, n); } catch (e) {}   // type=number は非対応ブラウザあり＝失敗しても末尾フォーカスで続行
  inp.dataset.replaceNext = '1';                       // 次の文字入力で全置換
}
window.addEventListener('beforeinput', e => {
  const t = e.target;
  if (t && t.dataset && t.dataset.replaceNext === '1') {
    delete t.dataset.replaceNext;
    if (/^insert/.test(e.inputType || '')) t.value = '';   // 最初の入力＝古い値を置き換え（削除系はそのまま）
  }
}, true);
window.addEventListener('pointerdown', e => {   // 欄をタップしてカーソルを置き直した＝置換モード解除
  const t = e.target;
  if (t && t.dataset && t.dataset.replaceNext) delete t.dataset.replaceNext;
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
//  格子舞台ギズモ（画面右上の独立ギズモ・別シーン）
//  キューブに代わる視点操作子（2026-07-29 社長案・案A「四角舞台」）。
//  半透明の四角い格子床＝空間の縮図。中心に座標（東=赤・北=緑・上=青の矢）。
//  方位文字タップ=その方角から正対、床タップ=真上、角タップ=等角。
//  外枠は中の格子と同じ線材質＝同じ太さ（2026-07-29 社長指示）。
// ===================================================================
const GIZMO_CAM_DIST = 7.4;
const gizmo = {};
(function buildGizmo() {
  const gScene = new THREE.Scene();
  const gCam = new THREE.PerspectiveCamera(40, 1, 0.1, 30);
  gCam.position.set(0, 0, GIZMO_CAM_DIST);
  gCam.lookAt(0, 0, 0);

  const globe = new THREE.Group();
  const HALF = 1.15, TH = 0.12;   // 舞台の半幅・板の厚み（真横視点でも板として見える）

  // 明暗テーマの色
  const GIZ_THEME = {
    dark:  { line: 0x9fc0e8, fill: 0x5aa8ff, text: '#dbe7ff' },
    light: { line: 0x5f7396, fill: 0x7c96c0, text: '#2a3344' },
  };
  let gizPal = GIZ_THEME.light;

  // ---- 舞台（半透明の板＋格子） ----
  const fillMat = new THREE.MeshBasicMaterial({ color: gizPal.fill, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
  const plateTop = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), fillMat);
  plateTop.rotation.x = -Math.PI / 2;
  plateTop.renderOrder = 1;
  plateTop.userData.snapDir = new THREE.Vector3(0, 1, 0);   // 床タップ＝真上（平面図）
  plateTop.userData.flipBelow = true;                       // 下から見ている時は真下（見上げ）へ
  globe.add(plateTop);
  const slabMat = new THREE.MeshBasicMaterial({ color: gizPal.fill, transparent: true, opacity: 0.10, depthWrite: false });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, TH, HALF * 2), slabMat);
  slab.position.y = -TH / 2 - 0.002;
  globe.add(slab);
  // 格子（外枠を含む全線を1本の材質で描く＝外枠と格子の太さが揃う）
  const gridPts = [];
  for (let i = 0; i <= 4; i++) {
    const t = -HALF + (HALF * 2 / 4) * i;
    gridPts.push(new THREE.Vector3(t, 0, -HALF), new THREE.Vector3(t, 0, HALF));
    gridPts.push(new THREE.Vector3(-HALF, 0, t), new THREE.Vector3(HALF, 0, t));
  }
  const gridMat = new THREE.LineBasicMaterial({ color: gizPal.line, transparent: true, opacity: 0.85 });
  const gridLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPts), gridMat);
  gridLines.renderOrder = 2;
  globe.add(gridLines);
  // 板の底の外周（薄め＝厚みの表現）
  const bY = -TH;
  const botPts = [
    [-HALF, bY, -HALF], [HALF, bY, -HALF], [HALF, bY, -HALF], [HALF, bY, HALF],
    [HALF, bY, HALF], [-HALF, bY, HALF], [-HALF, bY, HALF], [-HALF, bY, -HALF],
  ].map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const botMat = new THREE.LineBasicMaterial({ color: gizPal.line, transparent: true, opacity: 0.4 });
  globe.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(botPts), botMat));

  // ---- 中心の座標（三本の矢）＝左下の座標軸インジケータと同じ流儀に揃える（2026-07-29 社長指示）
  //      X=赤(+X) / Y=緑(+Y=上) / Z=青(+Z)。細い線の矢（ArrowHelper）＋X/Y/Zの文字。
  const AXES_DEF = [
    { name: 'x', dir: new THREE.Vector3(1, 0, 0), color: 0xff5a5a },
    { name: 'y', dir: new THREE.Vector3(0, 1, 0), color: 0x00b23c },
    { name: 'z', dir: new THREE.Vector3(0, 0, 1), color: 0x5a8aff },
  ];
  function axisDotSprite(colorHex) {   // 軸がこちらを向いて潰れた時のCAD流「⊙」記号
    const s = 64, cv2 = document.createElement('canvas'); cv2.width = cv2.height = s;
    const c2 = cv2.getContext('2d');
    c2.strokeStyle = c2.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
    c2.lineWidth = 6;
    c2.beginPath(); c2.arc(s / 2, s / 2, 22, 0, 7); c2.stroke();
    c2.beginPath(); c2.arc(s / 2, s / 2, 7, 0, 7); c2.fill();
    const tex = new THREE.CanvasTexture(cv2); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.setScalar(0.34); sp.visible = false; sp.renderOrder = 6;
    return sp;
  }
  gizmo.axes = [];
  const AXIS_L = 1.0;
  AXES_DEF.forEach(a => {
    const arrow = new THREE.ArrowHelper(a.dir, new THREE.Vector3(0, 0, 0), AXIS_L, a.color, 0.26, 0.16);
    if (arrow.line) arrow.line.renderOrder = 3;
    if (arrow.cone) arrow.cone.renderOrder = 3;
    globe.add(arrow);
    const dot = axisDotSprite(a.color);
    globe.add(dot);
    gizmo.axes.push({ name: a.name, dir: a.dir.clone(), arrow, dot });
  });
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x666e7e })));

  // ---- 方位とXYZの文字（常にこちらを向くスプライト。タップで視点スナップ） ----
  // 方位（北南東西・上下）は太字にしない・北も他と同じ色（2026-07-30 社長指示）。XYZだけ軸色の太字。
  function labelTexture(text, colCss, bold) {
    const s = 128, cv2 = document.createElement('canvas'); cv2.width = cv2.height = s;
    const c2 = cv2.getContext('2d');
    c2.fillStyle = colCss;
    c2.font = (bold ? 'bold ' : '') + '92px "Hiragino Kaku Gothic ProN","Meiryo","Segoe UI",sans-serif';
    c2.textAlign = 'center'; c2.textBaseline = 'middle';
    c2.fillText(text, s / 2, s / 2 + 4);
    const tex = new THREE.CanvasTexture(cv2); tex.minFilter = THREE.LinearFilter; tex.anisotropy = 4;
    return tex;
  }
  const LR = 2.0;   // 方位文字は舞台の角（HALF√2≒1.63）より外＝重ならない
  const AXL = AXIS_L + 0.30;   // XYZ文字は矢の先（左下のインジケータと同じ流儀）
  const LABEL_DEFS = [
    { t: '北', pos: [0, 0.02, -LR], dir: [0, 0, -1] },
    { t: '南', pos: [0, 0.02, LR],  dir: [0, 0, 1] },
    { t: '東', pos: [LR, 0.02, 0],  dir: [1, 0, 0] },
    { t: '西', pos: [-LR, 0.02, 0], dir: [-1, 0, 0] },
    // 上下＝真横（北南東西）の正対中だけ表示（2026-07-30 社長要望：立面で上下が読めるように）
    { t: '上', pos: [0, 1.95, 0],  dir: [0, 1, 0],  sideOnly: true },
    { t: '下', pos: [0, -1.95, 0], dir: [0, -1, 0], sideOnly: true },
    { t: 'X', pos: [AXL, 0.05, 0], dir: [1, 0, 0], axis: 0xff5a5a },
    { t: 'Y', pos: [0, AXL, 0],    dir: [0, 1, 0], axis: 0x00b23c },
    { t: 'Z', pos: [0, 0.05, AXL], dir: [0, 0, 1], axis: 0x5a8aff },
  ];
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const labelColOf = L => L.axis ? ('#' + L.axis.toString(16).padStart(6, '0')) : gizPal.text;
  gizmo.labels = [];
  gizmo.hitObjs = [plateTop];
  LABEL_DEFS.forEach(L => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(L.t, labelColOf(L), !!L.axis), transparent: true, depthTest: false }));
    sp.scale.setScalar(L.axis ? 0.52 : 0.82);
    sp.renderOrder = 5;
    sp.position.set(L.pos[0], L.pos[1], L.pos[2]);
    if (L.sideOnly) sp.visible = false;
    globe.add(sp);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(L.axis ? 0.32 : 0.44, 8, 6), hitMat);
    hit.position.copy(sp.position);
    hit.userData.snapDir = new THREE.Vector3(L.dir[0], L.dir[1], L.dir[2]);
    if (L.sideOnly) hit.userData.enabled = false;
    globe.add(hit);
    gizmo.hitObjs.push(hit);
    gizmo.labels.push({ text: L.t, dir: hit.userData.snapDir.clone(), sprite: sp, hit, axis: L.axis, sideOnly: !!L.sideOnly });
  });
  // 舞台の四隅タップ＝その方角の等角視点（キューブの角タップに相当）
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), hitMat);
    hit.position.set(sx * HALF, 0, sz * HALF);
    hit.userData.snapDir = new THREE.Vector3(sx, 1, sz).normalize();
    hit.userData.flipBelow = true;   // 下から見ている時は下側の等角へ
    globe.add(hit);
    gizmo.hitObjs.push(hit);
  });

  // 正対で潰れる要素の出し分け：軸がこちらを向いたら⊙記号、方位文字は中央に重なるため隠す。
  // 上下の文字は真横（北南東西）の正対中だけ出す。
  gizmo.updateDegenerate = (viewDir) => {
    for (const a of gizmo.axes) {
      const collapsed = Math.abs(a.dir.dot(viewDir)) > 0.985;
      a.arrow.visible = !collapsed;
      a.dot.visible = collapsed;
    }
    const sideOn = Math.abs(viewDir.y) < 0.08 && (Math.abs(viewDir.x) > 0.985 || Math.abs(viewDir.z) > 0.985);
    for (const L of gizmo.labels) {
      if (L.sideOnly) { L.sprite.visible = sideOn; L.hit.userData.enabled = sideOn; continue; }
      const hide = Math.abs(L.dir.dot(viewDir)) > 0.985;
      L.sprite.visible = !hide;
      L.hit.userData.enabled = !hide;
    }
  };

  gScene.add(globe);
  gizmo.scene = gScene;
  gizmo.cam = gCam;
  gizmo.stage = globe;
  gizmo.gridMat = gridMat;
  gizmo.half = HALF;
  // 明暗テーマの適用（背景は透明＝3D背景に乗るので、線と文字の色を切替）
  gizmo.applyTheme = (light) => {
    gizPal = light ? GIZ_THEME.light : GIZ_THEME.dark;
    gridMat.color.setHex(gizPal.line);
    botMat.color.setHex(gizPal.line);
    fillMat.color.setHex(gizPal.fill);
    slabMat.color.setHex(gizPal.fill);
    for (const L of gizmo.labels) {
      const m = L.sprite.material;
      if (m.map) m.map.dispose();
      m.map = labelTexture(L.text, labelColOf(L), !!L.axis);
      m.needsUpdate = true;
    }
  };
  gizmo.applyTheme(true);   // 統一グレー背景＝明るい背景用の配色（2026-07-19）
})();

// （左下の座標軸インジケータは v0729-X で廃止＝右上の格子舞台がXYZ・方位を兼ねる。2026-07-30 社長指示）

// ---- リサイズ ----
function resize() {
  const w = vp.clientWidth, h = vp.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
// iPad：縦横回転の直後は resize イベント時点で古いサイズが返り、画面が伸びたままになることがある。
// ①ビューポート要素の実サイズ変化を ResizeObserver で監視（回転・Split View・キーボードにも追従）
// ②回転イベント後に遅延再計算（レイアウト確定待ちの保険）
if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(vp);
window.addEventListener('orientationchange', () => { setTimeout(resize, 300); setTimeout(resize, 900); });
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
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
  ['1:1', 1], ['1:2', 0.5], ['1:3', 1 / 3], ['1:4', 0.25], ['1:5', 0.2], ['1:6', 1 / 6], ['1:7', 1 / 7],
  ['1:8', 0.125], ['1:9', 1 / 9], ['1:10', 0.1], ['1:16', 0.0625],
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

// ---- 舞台の方位タップ → 正対＋平行投影（なめらかに移行） ----
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
// ortho解除の判定：pointerdown開始時点で「何か選択中」だったかを最初に記録する
// （後段の deselect より前に走るよう、window capture で早く登録）。
let _orthoHadSel = false;
window.addEventListener('pointerdown', () => {
  _orthoHadSel = !!(selectedPart || (selectedParts && selectedParts.size)
                 || (window.__annHasSel && window.__annHasSel()));
}, true);

renderer.domElement.addEventListener('pointerdown', e => {
  const rect = renderer.domElement.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  if (inGizmo(px, py)) {
    gizmoDown = { x: e.clientX, y: e.clientY };
    return;
  }
  // ギズモ外の「空きスペース」ドラッグでだけ平行投影を抜けて自由操作へ。
  //   ・何か選択中（部品/線/寸法を編集中）＝抜けない（編集中に3D空間が動くのを防ぐ）
  //   ・部品や線/寸法の上＝抜けない（選択・掴みなので視点を動かさない）
  //   空きスペースで視点を回したい時は、一度タップして選択を解除してからドラッグ。
  if (useOrtho && !tween && !_orthoHadSel
      && !(typeof pickPlacedAt === 'function' && pickPlacedAt(e.clientX, e.clientY))
      && !(window.__pickAnnAt && window.__pickAnnAt(e.clientX, e.clientY))) {
    exitOrtho();
  }
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
  const hits = gizmoRay.intersectObjects(gizmo.hitObjs, false)
    .filter(h => h.object.userData.enabled !== false && h.object.userData.snapDir);
  if (!hits.length) return;
  const dSnap = hits[0].object.userData.snapDir.clone();
  // 舞台を下から見上げている時に床・角をタップしたら、上側ではなく下側の視点へ（2026-07-30 社長指摘）
  if (hits[0].object.userData.flipBelow && gizmo.cam.position.y < -0.01 && dSnap.y > 0) {
    dSnap.y = -dSnap.y; dSnap.normalize();
  }
  snapToDir(dSnap);
});

// ---- 正対ビューの札（2026-07-29 社長採用：真上/真下/北南東西の正対中、どちらから見ているかを文字で言い切る） ----
const VIEW_BADGES = [
  { d: new THREE.Vector3(0, 1, 0),  t: '上から（平面）' },
  { d: new THREE.Vector3(0, -1, 0), t: '下から（見上げ）' },
  { d: new THREE.Vector3(0, 0, -1), t: '北から' },
  { d: new THREE.Vector3(0, 0, 1),  t: '南から' },
  { d: new THREE.Vector3(1, 0, 0),  t: '東から' },
  { d: new THREE.Vector3(-1, 0, 0), t: '西から' },
];
let _viewBadgeEl = null, _viewBadgeTxt = '';
function updateViewBadge(viewDir) {
  let txt = '';
  for (const b of VIEW_BADGES) { if (b.d.dot(viewDir) > 0.985) { txt = b.t; break; } }
  if (!txt) {
    if (_viewBadgeEl && _viewBadgeTxt) { _viewBadgeEl.style.display = 'none'; _viewBadgeTxt = ''; }
    return;
  }
  if (!_viewBadgeEl) {
    _viewBadgeEl = document.createElement('div');
    _viewBadgeEl.id = 'viewBadge';
    _viewBadgeEl.style.cssText = 'position:fixed;z-index:60;padding:3px 10px;border-radius:10px;'
      + 'background:rgba(31,90,180,.94);color:#fff;font:bold 11px "Hiragino Kaku Gothic ProN","Meiryo",sans-serif;'
      + 'pointer-events:none;transform:translateX(-50%);white-space:nowrap;display:none;';
    document.body.appendChild(_viewBadgeEl);
  }
  const rc = renderer.domElement.getBoundingClientRect();
  const r = gizmoRect();
  const left = Math.round(rc.left + r.x0 + r.size / 2) + 'px';
  const top = Math.round(rc.top + r.y0 + r.size + 2) + 'px';
  if (txt !== _viewBadgeTxt) { _viewBadgeEl.textContent = txt; _viewBadgeTxt = txt; }
  if (_viewBadgeEl.style.left !== left) _viewBadgeEl.style.left = left;
  if (_viewBadgeEl.style.top !== top) _viewBadgeEl.style.top = top;
  if (_viewBadgeEl.style.display !== 'block') _viewBadgeEl.style.display = 'block';
}

// ---- ギズモを画面右上に描く ----
function renderGizmo() {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  if (gizmo.updateDegenerate) gizmo.updateDegenerate(dir);
  updateViewBadge(dir);
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

// （renderAxisGizmo は v0729-X で廃止）

// ===================================================================
//  部品の3D形状ビルダー
// ===================================================================
// 鋳鋼フランジ風マテリアル（濃いチャコール・つや消し気味）
const FLANGE_MAT = new THREE.MeshStandardMaterial({
  color: 0x51575f, metalness: 0.62, roughness: 0.42,   // ひとまわり明るいチャコール（2026-07-19 全体の明るさ改善）
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
  { code: 'RDF', name: 'レジューシング(RF)' },   // 大径のフランジ板に小径のボア＝径違いを1枚で受ける
];
// クラスごとに規格上存在するタイプ（淡路マテリアカタログ各ページの規定より）。
// 高圧クラス(JIS40K/JPI2500LB)は差込み形(SOP/LJ)が無く、WN/SW/BLのみ。
const TYPES_BY_CLASS = {
  'JIS 5K':     ['SOP','SW','WN','LJ','BL','RDF'],
  'JIS 10K':    ['SOP','SW','WN','LJ','BL','RDF'],
  'JIS 20K':    ['SOP','SW','WN','LJ','BL','RDF'],
  'JIS 40K':    ['SW','WN','BL'],
  'JPI 150LB':  ['SOP','SW','WN','BL','RDF'],
  'JPI 300LB':  ['SOP','SW','WN','BL','RDF'],
  'JPI 600LB':  ['SOP','SW','WN','BL','RDF'],
};
function typesForClass(cls) {
  const ok = TYPES_BY_CLASS[cls] || ['SOP','SW','WN','LJ','BL','RDF'];
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

// ===== 配管化③：溶接の控え・ルートギャップ（切寸計算用）2026-07-29 社長要望 =====
// SOP控え＝差し込んだ管の先端をフランジのフェイス面から何mm控えるか（内側の溶接しろ）。
// ルートギャップ＝BW突合せの開先の隙間。どちらも呼び径×Schで設定できる（⚙設定→溶接・切寸の設定）。
// 既定値（2026-07-29 社長の流儀）：
//   SOP控え＝肉厚×√2（45°分＝1.414）＋3mm（0.1mm丸め）。例：25A SGP 肉厚3.2→7.5mm
//   ルートギャップ＝肉厚<4→2.5・<8→3.0・以上→4.0（表で自由に変更可）
// 切寸でのBW控除は「ギャップの半分」（例：3mm→1.5mm引く）。ギャップ0mmは縮み代として+0.5mm。
// 設定した値は localStorage p3d_weld_tbl（既定と違う分だけ）に記憶する。
let weldTbl = {};
try { weldTbl = JSON.parse(localStorage.getItem('p3d_weld_tbl') || '{}') || {}; } catch (e) { weldTbl = {}; }
function weldDefaults(sizeA, sch) {
  const t = pipeWall(sizeA, sch);
  return { sop: Math.round((t * Math.SQRT2 + 3) * 10) / 10, gap: t < 4 ? 2.5 : (t < 8 ? 3 : 4), swc: 2 };   // swc＝SWクリアランス（既定2mm・2026-07-31 社長指示）
}
function weldValsOf(sizeA, sch) {
  const d = weldDefaults(sizeA, sch), o = weldTbl[sizeA + '|' + sch] || {};
  return { sop: (o.sop > 0 ? o.sop : d.sop), gap: (o.gap >= 0 ? o.gap : d.gap), swc: (o.swc >= 0 ? o.swc : d.swc) };
}
function setWeldVal(sizeA, sch, key, v) {
  const k = sizeA + '|' + sch, d = weldDefaults(sizeA, sch);
  const cur = weldTbl[k] || {};
  const n = parseFloat(v);
  if (!isFinite(n) || n < 0 || Math.abs(n - d[key]) < 0.001) delete cur[key];   // 既定と同じ＝上書きを消す
  else cur[key] = Math.round(n * 10) / 10;
  if (Object.keys(cur).length) weldTbl[k] = cur; else delete weldTbl[k];
  try { localStorage.setItem('p3d_weld_tbl', JSON.stringify(weldTbl)); } catch (e) {}
}
window.__weldValsOf = weldValsOf;
window.__setWeldVal = setWeldVal;

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
  // レジューシングフランジ（RDF）＝板・ボルト穴は大径(sizeA)のまま、ボアとハブだけ小径(sizeB)。
  // 偏心(ecc)＝小径ボアを+X側の外面が揃う位置へ寄せる（偏心レジューサと同じ流儀。2026-08-03 社長要望）
  const isRDF = o.type === 'RDF';
  const rdfB = isRDF ? (o.sizeB || o.sizeA) : null;
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
  // ボルト穴の中心＝機点（起点候補・スナップ対象。フェイス側の板面上）。2026-07-19 社長要望。
  // ※extraLocalsには入れない＝自動集計(connPointsForStats)が溶接口として誤カウントするため専用配列（boltLocals）。
  //   plateWithHolesはrotateX(-90°)で組むため 2Dの(x,y)→ローカル(x, y=板面, -y)
  g.userData.boltLocals = holes.map(hl => new THREE.Vector3(hl.x, thk / 2, -hl.y));
  // 中心ボア。SWは「背面から座ぐり＋奥に細い流路穴」、BLは穴なし、他は貫通。
  const isBlind = o.type === 'BL';
  const isSW = o.type === 'SW';
  const isWN = o.type === 'WN';
  // 中心穴の内径。WN/SWは肉厚(スケジュール)を持つので管内径＝外径-2×肉厚。他はボアそのまま。
  const wallM = pipeWall(o.sizeA, o.sch) / 1000;          // 管肉厚(m)
  const flowR = (isSW || isWN) ? Math.max(boreR - wallM, boreR * 0.4)
              : (o.type === 'LJ' ? boreR + 0.0008 : boreR);   // LJは管に遊嵌＝ボアを少し広げる
  // レジューシング：小径の管が入るボア。偏心なら+X側の外面が大径と揃う位置へ
  // 小径の穴＝SOP（スリップオン）の中心穴と同じ径（＝小径の管外径）。2026-08-03 社長指示
  const rdfOutR = isRDF ? (FLG_BORE[rdfB] || 34) / 2 / 1000 : 0;
  const rdfX = (isRDF && o.ecc) ? (boreR - rdfOutR) : 0;
  if (isRDF) holes.push({ x: rdfX, y: 0, r: rdfOutR });
  else if (!isBlind) holes.push({ x: 0, y: 0, r: flowR });

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
  if (isRDF) {
    // レジューシング＝ブラインドに小径の穴をあけた形（首なし・Schも要らない。2026-08-03 社長指示）
    if (o.ecc) {   // 偏心の「フラット側」(+X)に見分け用の目印
      const markR = Math.max(rdfOutR * 0.06, 0.0012);
      const mk = new THREE.Mesh(new THREE.CylinderGeometry(markR, markR, thk * 1.02, 8),
        new THREE.MeshBasicMaterial({ color: 0x1f3a93 }));
      mk.position.set(R * 0.94, 0, 0); g.add(mk);
    }
  } else if (o.type === 'SOP') {
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
  const rfOn = (o.face === 'RF' && o.type !== 'LJ');
  const rfH = rfOn ? Math.max(0.0015, thk * 0.12) : 0;   // ガスケット座の高さ（機点＝座の面に置くため外へ出す）
  if (rfOn) {
    // RF（ガスケット座）外径＝規格の座径 g（JIS B2220 / JPI・ASME）。規格値を最優先で使う。
    // 規格 g は必ずボルト穴の内縁より内側に収まるため、穴かぶりは原理的に起きない。
    // 規格値が無いクラス（JPI 600 等）のみ、ボルト穴内縁の内側に収める安全式でフォールバック。
    const gDia = rfFaceDia(o.cls, o.sizeA);
    const rfOR = gDia != null ? (gDia / 2 / 1000)
                              : Math.max(boreR + 0.002, bcR - holeR - 0.003);
    // レジューシングはブラインドと同じで「座面が全体にある」＝小径の穴だけを抜いた円板
    // （2026-08-03 社長指示。旧＝大径のボアまで抜けた輪だったので座が足りなかった）
    const rf = isBlind
      ? plateWithHoles(rfOR, rfH, [])
      : isRDF ? plateWithHoles(rfOR, rfH, [{ x: rdfX, y: 0, r: rdfOutR }])
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
  if (isRDF) {
    // 機点のフェイス＝**ガスケット座の面**（他のフランジと同じ高さ）。板面のままだと
    // ガスケット自動挿入で座と重なる（2026-08-03 社長報告）。背面は小径の穴の中心。
    const fy = front + rfH;
    g.userData.faceLocal = new THREE.Vector3(0, fy, 0);
    g.userData.backLocal = new THREE.Vector3(rdfX, back, 0);
    // 小径の穴の「フェイス側」にも機点＝表からパイプを合わせる時のスナップ先（偏心は寄った位置）
    g.userData.extraLocals = [new THREE.Vector3(rdfX, fy, 0)];
  }
  return g;
}

// 現在パレットで選択中のフランジ仕様
const flangeOpts = { sizeA: '25A', type: 'SOP', cls: 'JIS 10K', face: 'RF', sch: 'Sch40', pair: '1', sizeB: '20A', ecc: false };   // sizeB/ecc＝レジューシング(RDF)用   // pair: '1'=片フランジ／'2'=合いフランジ(挿入時にガスケットを挟んで2枚)

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
// 被り付き（枝管）の切り欠き寸法：母管の合わせ半径R・枝管の外半径r から
// 「母管の芯から測った長さL」に対する切寸の最短・最長(mm)を返す（2026-08-02 社長要望）
function branchCutInfo(Lmm, Rmm, rOutMm) {
  const R = Math.max(Rmm || 0, 0), r = Math.max(rOutMm || 0, 0);
  const deep = R;                                   // いちばん食い込む所（枝の腹＝母管の芯に近い側）
  const shallow = R > r ? Math.sqrt(R * R - r * r) : 0;   // いちばん浅い所（枝の脇）
  return { min: Lmm - deep, max: Lmm - shallow };
}
function makePipe(opts) {
  const o = Object.assign({ sizeA: '25A', sch: 'Sch40', length: 1000 }, opts || {});
  const outR = (FLG_BORE[o.sizeA] || 114) / 2 / 1000;       // 管外半径(m)
  const w = pipeWall(o.sizeA, o.sch) / 1000;                 // 肉厚(m)
  const inR = Math.max(outR - w, outR * 0.2);                // 管内半径(m)
  const L = Math.max((o.length || 1000) / 1000, 0.01);       // 全長(m)
  // 被り付き＝背面側の端を母管の丸みに合わせて切る（2026-08-02 社長要望）。
  //   o.branch = { hostR: 合わせ半径(mm), side:'inner'|'outer', axis:{x,y,z} 母管の軸（この管のローカル系） }
  //   length は「母管の芯から先端まで」。背面の機点＝母管の芯に置く。
  const br = (o.branch && o.branch.hostR > 0) ? o.branch : null;
  let boredSmooth = false;   // 貫通穴を開けた時に元の法線を引き継げたか
  // 端面の斜め切り（開先角ではなく「管を斜めに切る」角度・度）。0=直角。±60°まで
  const angF = Math.max(-60, Math.min(60, Number(o.cutAngFace) || 0));   // フェイス側(+Y)
  const angB = Math.max(-60, Math.min(60, Number(o.cutAngBack) || 0));   // 背面側(-Y)
  // 断面(r,y)を一周＝中空筒。両端に溶接開先（ルートフェイス＋面取り。斜めに切る側・被り付き側は開先なし）
  let prof = weldHollowProfile(outR, inR, -L / 2, L / 2, !angF, !br && !angB);
  // 貫通穴を開ける管は、穴の周りだけ壁を細かく割っておく。
  // 壁は既定だと「長さ方向に1枚」なので、そのままだと面を抜いても穴にならない（2026-08-03）。
  if (o.bores && o.bores.length) {
    const ys = [];
    for (const bo of o.bores) {
      const R = (bo.r || 0) / 1000, at = (bo.at || 0) / 1000;
      if (R <= 0) continue;
      const span = R * 1.7, n = 28;
      for (let i = 0; i <= n; i++) ys.push(at - span + (2 * span) * i / n);
    }
    if (ys.length) {
      const out = [];
      for (let i = 0; i < prof.length; i++) {
        out.push(prof[i]);
        const a2 = prof[i], b2 = prof[i + 1];
        if (!b2 || Math.abs(a2.x - b2.x) > 1e-9) continue;      // 半径が変わる所＝壁ではない
        const lo = Math.min(a2.y, b2.y), hi = Math.max(a2.y, b2.y);
        const mids = ys.filter(y => y > lo + 1e-9 && y < hi - 1e-9)
                       .sort((p2, q2) => (a2.y < b2.y ? p2 - q2 : q2 - p2));
        for (const y of mids) out.push(new THREE.Vector2(a2.x, y));
      }
      prof = out;
    }
  }
  let geo = new THREE.LatheGeometry(prof, 64);
  // 斜め切り＝端の輪をそのまま傾ける（＝軸に対して斜めの平らな切り口。管を斜めに切ったのと同じ）。
  // 芯の長さ length は変えず、外周が ±r·tanθ だけ伸び縮みする。
  if (angF || angB) {
    const pos = geo.attributes.position;
    const tF = Math.tan(angF * Math.PI / 180), tB = Math.tan(angB * Math.PI / 180);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      if (angF && Math.abs(y - L / 2) < 1e-6) pos.setY(i, y + x * tF);
      else if (angB && Math.abs(y + L / 2) < 1e-6) pos.setY(i, y + x * tB);
    }
    pos.needsUpdate = true;
  }
  if (br) {
    // 背面端の輪を、母管（半径R・軸ax）の面まで持ち上げる＝鞍形の切り口。90°以外の斜めでも効く。
    // CSGだと切り取った円筒の面が中に残り、選択枠や範囲ズームの箱が狂うのでこの方式にした。
    // 枝の表面 p=(r·cosθ, y, r·sinθ)、母管の芯は(0,−L/2,0)を通り向きax。u=y+L/2 として
    //   |q|²−(q·ax)² = R²  →  (1−ay²)u² − 2A·ay·u + (r²−A²−R²) = 0   （A = r·cosθ·ax + r·sinθ·az）
    const R = br.hostR / 1000;
    const ax = new THREE.Vector3(br.axis ? br.axis.x : 1, br.axis ? br.axis.y : 0, br.axis ? br.axis.z : 0);
    if (ax.lengthSq() < 1e-9) ax.set(1, 0, 0);
    ax.normalize();
    const aq = 1 - ax.y * ax.y;
    if (aq > 1e-6) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) + L / 2) > 1e-6) continue;
        const x = pos.getX(i), z = pos.getZ(i);
        const A = x * ax.x + z * ax.z;
        const bq = -2 * A * ax.y, cq = x * x + z * z - A * A - R * R;
        const disc = bq * bq - 4 * aq * cq;
        const u = disc > 0 ? (-bq + Math.sqrt(disc)) / (2 * aq) : 0;
        pos.setY(i, -L / 2 + Math.max(u, 0));
      }
      pos.needsUpdate = true;
    }
  }
  // 母管側の貫通穴＝枝が通る所の面を取り除く（2026-08-03 社長指示）。
  // o.bores = [{ r:枝の外半径(mm), ax:{x,y,z} 枝の向き（この管のローカル系）, at: 芯上の位置y(mm) }]
  // CSG（ブーリアン演算）だと母管が壊れた形になり、切った枝と一つの塊になってしまった（社長report）。
  // 「枝の円筒の中に入る三角形を捨てる」方式に変更＝壊れない・余分な面も残らない。
  if (o.bores && o.bores.length) {
    const bs = o.bores.map(bo => {
      const ax = new THREE.Vector3(bo.ax ? bo.ax.x : 1, bo.ax ? bo.ax.y : 0, bo.ax ? bo.ax.z : 0);
      if (ax.lengthSq() < 1e-9) ax.set(1, 0, 0);
      return { r: (bo.r || 0) / 1000, ax: ax.normalize(), at: (bo.at || 0) / 1000 };
    }).filter(bo => bo.r > 0);
    if (bs.length) {
      const g2 = geo.index ? geo.toNonIndexed() : geo;
      const pos = g2.attributes.position, nor = g2.attributes.normal;
      // 穴の中に入る頂点は、そのまま捨てるとフチがギザギザになる（2026-08-03 社長指摘）。
      // 同じ回り角θのまま、交線（枝の円筒と母管の壁の交わり）まで軸方向へ寄せてからフチにする。
      //   壁の点 p=(x, y, z)、枝の芯は(0,at,0)を通り向きax・半径r。u=y−at として
      //   (1−ay²)u² − 2A·ay·u + (x²+z²−A²−r²) = 0   （A = x·ax.x + z·ax.z）
      const snapped = new Float32Array(pos.count);        // 1=穴の中だった（＝フチへ寄せた）
      const ys = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        ys[i] = y;
        for (const bo of bs) {
          const u = y - bo.at, A = x * bo.ax.x + z * bo.ax.z;
          const s = A + u * bo.ax.y;
          if (s < -0.001) continue;                       // 枝が伸びる側だけ
          const d2 = x * x + z * z + u * u - s * s;
          if (d2 >= bo.r * bo.r) continue;                // 穴の外
          const aq = 1 - bo.ax.y * bo.ax.y;
          if (aq < 1e-9) continue;
          const bq = -2 * A * bo.ax.y, cq = x * x + z * z - A * A - bo.r * bo.r;
          const disc = bq * bq - 4 * aq * cq;
          if (disc <= 0) continue;
          const sq = Math.sqrt(disc);
          const u1 = (-bq - sq) / (2 * aq), u2 = (-bq + sq) / (2 * aq);
          ys[i] = bo.at + (Math.abs(u - u1) <= Math.abs(u - u2) ? u1 : u2);   // 近い側のフチへ
          snapped[i] = 1;
          break;
        }
      }
      const outP = [], outN = [];
      for (let i = 0; i < pos.count; i += 3) {
        if (snapped[i] && snapped[i + 1] && snapped[i + 2]) continue;   // 3頂点とも穴の中＝この面は要らない
        for (let k = 0; k < 3; k++) {
          const j = i + k;
          outP.push(pos.getX(j), ys[j], pos.getZ(j));
          if (nor) outN.push(nor.getX(j), nor.getY(j), nor.getZ(j));
        }
      }
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3));
      if (nor) ng.setAttribute('normal', new THREE.Float32BufferAttribute(outN, 3));   // 元の滑らかな法線を保つ
      if (g2 !== geo) g2.dispose();
      geo.dispose();
      geo = ng;
      boredSmooth = !!nor;
    }
  }
  if (!boredSmooth) geo.computeVertexNormals();   // 穴あけで法線を引き継いだ時は掛け直さない（面がカクつく）
  const mat = FLANGE_MAT.clone(); mat.side = THREE.DoubleSide; mat.needsUpdate = true;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat));
  g.userData.partType = 'pipe';
  g.userData.pipe = { ...o };
  if (br || angF || angB) {   // 切った端は箱から機点を取れないので明示（芯線上の点＝設計長さの端）
    g.userData.faceLocal = new THREE.Vector3(0, L / 2, 0);
    g.userData.backLocal = new THREE.Vector3(0, -L / 2, 0);
  }
  return g;
}
// 単品で置いたパイプの端が、既にある母管の「途中」に乗っていたら被り付きにする（2026-08-03 社長指示）。
//  ・枝＝母管の芯から先端までの1本にして、根元を母管の内面に合わせて鞍形カット
//  ・母管＝重なった所を演算で抜く（貫通）
//  ・90°でなくてもよい（斜めの枝も同じ式で切れる）
function applyBranchIfOnPipe(br) {
  const u = br.userData;
  if (!br || u.partType !== 'pipe' || !u.pipe || u.pipe.branch) return false;
  if (u.pipe.bores && u.pipe.bores.length) return false;      // 既に枝を受けている＝母管なので枝にはしない
  const brOut = (FLG_BORE[u.pipe.sizeA] || 34) / 2;
  const ends = [connModelPos(br, u.backLocal), connModelPos(br, u.faceLocal)];
  for (const host of placedParts) {
    const hu = host.userData;
    if (host === br || hu.partType !== 'pipe' || !hu.pipe || !hu.placed || hu.hidden) continue;
    // 枝は母管より太くないこと（太い管が細い管の枝になるのを防ぐ）。同径・近い径もそのまま被り付く。
    // 合わせ面＝母管の内面。枝が太くて内面に入らない時は外面合わせにする（2026-08-03 社長報告の対策）
    const hOutR = (FLG_BORE[hu.pipe.sizeA] || 114) / 2;
    const hInR = Math.max(hOutR - pipeWall(hu.pipe.sizeA, hu.pipe.sch), 1);
    if (brOut > hOutR + 0.01) continue;
    const fitR = (brOut < hInR - 0.01) ? hInR : hOutR;
    const fitSide = (brOut < hInR - 0.01) ? 'inner' : 'outer';
    const ha = connModelPos(host, hu.backLocal), hb = connModelPos(host, hu.faceLocal);
    const hd = hb.clone().sub(ha); const hL = hd.length();
    if (hL < 1e-6) continue;
    hd.multiplyScalar(1 / hL);
    const hOut = (FLG_BORE[hu.pipe.sizeA] || 114) / 2 / 1000;
    for (let k = 0; k < 2; k++) {
      const root = ends[k], far = ends[1 - k];                        // 母管に乗っている側／反対の先端
      const d = far.clone().sub(root);
      if (d.lengthSq() < 1e-9) continue;
      d.normalize();
      if (Math.abs(hd.dot(d)) > 0.985) continue;                      // ほぼ同軸＝直列やジャケット管
      const t = root.clone().sub(ha).dot(hd);
      if (t < 0.002 || t > hL - 0.002) continue;                      // 母管の端＝被り付きではない
      const axisPt = ha.clone().addScaledVector(hd, t);
      if (root.distanceTo(axisPt) > hOut * 1.2) continue;             // 母管の外面より外＝乗っていない
      const dir = far.clone().sub(axisPt);                            // 母管の芯→先端
      const newL = dir.length();
      if (newL < 0.001) continue;
      dir.normalize();
      // 枝＝母管の芯から先端までの1本にして、根元を母管の内面で鞍形カット（先端は動かさない）
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const axLocal = hd.clone().applyQuaternion(q.clone().invert());
      u.pipe.length = newL * 1000;
      u.pipe.branch = { hostR: fitR, side: fitSide, axis: { x: axLocal.x, y: axLocal.y, z: axLocal.z } };
      while (br.children.length) { const c = br.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
      const np = makePipe(u.pipe); while (np.children.length) br.add(np.children.pop());
      const half = newL / 2;
      u.faceLocal = new THREE.Vector3(0, half, 0);
      u.backLocal = new THREE.Vector3(0, -half, 0);
      br.quaternion.copy(q);
      br.position.copy(axisPt).addScaledVector(dir, half);            // 背面端＝母管の芯
      // 母管に貫通穴を開ける（枝の外径・枝の向き・母管ローカルの位置）
      const hq = host.quaternion.clone().invert();
      const bLocalDir = dir.clone().applyQuaternion(hq);
      const atY = axisPt.clone().sub(host.position).applyQuaternion(hq).y * 1000;
      hu.pipe.bores = (hu.pipe.bores || []).concat([{ r: (FLG_BORE[u.pipe.sizeA] || 34) / 2,
                                                      ax: { x: bLocalDir.x, y: bLocalDir.y, z: bLocalDir.z }, at: atY }]);
      rebuildPipe(host, hu.pipe.length, 'face');
      // 母管と枝は別々の部品のまま扱う＝一緒に選ばれる・一緒に動くことがないようにする
      // （2026-08-03 社長報告「一つになってしまう」）
      u.groupId = null; hu.groupId = null;
      if (typeof selectedParts !== 'undefined') { selectedParts.delete(host); setEmissive(host, 0x000000); }
      if (typeof selPivot !== 'undefined') selPivot = null;
      return true;
    }
  }
  return false;
}
window.__applyBranchIfOnPipe = applyBranchIfOnPipe;   // e2e検証用
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
  // ※平行判定を外積の大きさ(1e-9)だけに頼ると、接線が有限差分で僅かに非平行になる180°でも交点が「ある」と
  //   判定され、数百m彼方のゴミ交点が corner/grip/機点に入っていた（2026-07-14 社長指摘：180°エルボの
  //   面間が242552mm等になる不具合の原因）。角度そのもので明示的に除外する。
  if (angleDeg < 179.5) {
    const p1 = g.userData.backLocal, d1 = g.userData.backNormal;
    const p2 = g.userData.faceLocal, d2 = g.userData.faceNormal;
    const cx = d1.clone().cross(d2);
    if (cx.lengthSq() > 1e-9) {                          // 平行でなければ交点が定まる
      const s = p2.clone().sub(p1).cross(d2).dot(cx) / cx.lengthSq();
      g.userData.cornerLocal = p1.clone().addScaledVector(d1, s);
      g.userData.extraLocals = [g.userData.cornerLocal];   // 機点・スナップ・起点候補に加える
      g.userData.gripLocal = g.userData.cornerLocal;       // 挿入時の起点＝工作点(角)。配置後はユーザーが機点クリックで変更可
    }
  }
  return g;
}

// エルボ生成。opts={sizeA, sch, kind:'90L'|'90S'|'45L'|'45S'|'180L'|'180S', cutAngle}
// cutAngle(度・kindの角度未満)＝「切断エルボ」。実際の施工と同じく母材(kind)を切って使う想定で、
// 曲げ半径Rは母材のまま弧の角度だけ変える（中心-端は R·tan(角/2) になり、工作点も正しく出る）。
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
  if (o.cutAngle > 0 && o.cutAngle < angle) angle = o.cutAngle;   // 切断エルボ（180°母材の切断にも対応）
  const g = makeBendCore(R, angle, ro, ri, mat);
  g.userData.partType = 'elbow';
  g.userData.elbow = { ...o };
  return g;
}

// R曲げパイプ（円/円弧のスイープ用・2026-07-30 社長要望）。opts={sizeA, sch, R(m・中心線半径), angleDeg}
// 実際のパイプベンダーによるR曲げ加工品を表す。管口は円弧の接線に直角（＝切断面が中心からの放射面）で、
// makeBendCore が backLocal/faceLocal と接線の法線を設定するので、フランジ等をそのまま末端に配置できる。
function makeBentPipe(opts) {
  const o = Object.assign({ sizeA: '25A', sch: 'Sch40', R: 0.3, angleDeg: 90 }, opts || {});
  const ro = (FLG_BORE[o.sizeA] || 114) / 2 / 1000;
  const ri = Math.max(ro - pipeWall(o.sizeA, o.sch) / 1000, ro * 0.3);
  const mat = FLANGE_MAT.clone(); mat.side = THREE.DoubleSide; mat.needsUpdate = true;
  const g = makeBendCore(o.R, Math.min(Math.max(o.angleDeg, 1), 360), ro, ri, mat);
  g.userData.partType = 'bentpipe';
  g.userData.bent = { ...o };
  g.userData.gripLocal = g.userData.backLocal.clone();   // 起点＝始端（工作点は遠方になるため既定にしない）
  // 背面端の法線を外向きへ反転（makeBendCoreは進行方向＝管の内向きで返す・エルボの流儀）。
  // 直管の端と同じ「端の法線は管の外へ向く」に揃え、末端フランジの向き合わせ（mate）が
  // 両端とも正しくなる（背側だけ片フランジが逆向き・合いフランジから管がはみ出す不具合の真因。2026-07-30 社長報告）
  g.userData.backNormal = g.userData.backNormal.clone().negate();
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
// ティーの中心-端 C：規格のインチ寸法を正確にミリ換算した値（0.1mm）。エルボ・キャップの表と同じ基準
// （2026-07-14 社長指摘：例 50A＝2 1/2"＝63.5。規格書のミリ丸め欄の64ではなくインチ換算を正とする）
const TEE_C = {'15A':25.4,'20A':28.6,'25A':38.1,'32A':47.6,'40A':57.2,'50A':63.5,'65A':76.2,'80A':85.7,
  '90A':95.3,'100A':104.8,'125A':123.8,'150A':142.9,'200A':177.8,'250A':215.9,'300A':254.0,'350A':279.4,
  '400A':304.8,'450A':342.9,'500A':381.0};
// 径違いティー（BW・ASME B16.9/JIS B2312）の枝 中心-端 M(mm)。run径→{枝径:M}。
// ランのCは等径と同じ（TEE_C）。この表に無い組合せは規格外＝選択できない（2026-07-14 社長指摘で全面見直し。
// 従来は枝MにランのCを流用しており径違いの枝寸法が規格と不一致だった）。
// 値は規格のインチ寸法の正確なミリ換算（例：50A×25A＝2"＝50.8、50A×40A＝2 3/8"＝60.3）
const TEE_RT_M = {
  '20A': { '15A': 28.6 },
  '25A': { '20A': 38.1, '15A': 38.1 },
  '32A': { '25A': 47.6, '20A': 47.6, '15A': 47.6 },
  '40A': { '32A': 57.2, '25A': 57.2, '20A': 57.2, '15A': 57.2 },
  '50A': { '40A': 60.3, '32A': 57.2, '25A': 50.8, '20A': 44.5 },
  '65A': { '50A': 69.9, '40A': 66.7, '32A': 63.5, '25A': 57.2 },
  '80A': { '65A': 82.6, '50A': 76.2, '40A': 73.0, '32A': 69.9 },
  '90A': { '80A': 92.1, '65A': 88.9, '50A': 82.6, '40A': 79.4 },
  '100A': { '90A': 101.6, '80A': 98.4, '65A': 95.3, '50A': 88.9, '40A': 85.7 },
  '125A': { '100A': 117.5, '90A': 114.3, '80A': 111.1, '65A': 108.0, '50A': 104.8 },
  '150A': { '125A': 136.5, '100A': 130.2, '90A': 127.0, '80A': 123.8, '65A': 120.7 },
  '200A': { '150A': 168.3, '125A': 161.9, '100A': 155.6, '90A': 152.4 },
  '250A': { '200A': 203.2, '150A': 193.7, '125A': 190.5, '100A': 184.2 },
  '300A': { '250A': 241.3, '200A': 228.6, '150A': 219.1, '125A': 215.9 },
  '350A': { '300A': 269.9, '250A': 257.2, '200A': 247.7, '150A': 238.1 },
  '400A': { '350A': 304.8, '300A': 295.3, '250A': 282.6, '200A': 273.1, '150A': 263.5 },
  '450A': { '400A': 330.2, '350A': 330.2, '300A': 320.7, '250A': 308.0, '200A': 298.5 },
  '500A': { '450A': 368.3, '400A': 355.6, '350A': 355.6, '300A': 346.1, '250A': 333.4, '200A': 323.9 },
};
// RTで選べる枝径（規格の組合せのみ・小→大）／枝径の妥当化（表に無ければ最大の枝へ）
function teeBranchSizes(a) { return SIZE_ORDER.filter(s => TEE_RT_M[a] && TEE_RT_M[a][s] != null); }
function clampTeeSizeB(a) {
  const list = teeBranchSizes(a);
  if (!list.length) return a;
  return list.includes(fittingOpts.sizeB) ? fittingOpts.sizeB : list[list.length - 1];
}
// レジューサの端-端 H も同基準（インチ寸法の正確なミリ換算。例：50A＝3"＝76.2、150A＝5 1/2"＝139.7）
const REDUCER_H = {'15A':38.1,'20A':38.1,'25A':50.8,'32A':50.8,'40A':63.5,'50A':76.2,'65A':88.9,'80A':88.9,
  '90A':88.9,'100A':101.6,'125A':127.0,'150A':139.7,'200A':152.4,'250A':177.8,'300A':203.2,'350A':330.2,
  '400A':355.6,'450A':381.0,'500A':508.0};
// レジューサ（BW・ASME B16.9/JIS B2312）の規格にある大径×小径の組合せ。大径→[小径]（大きい順）。
// この表に無い組合せは規格外＝選択できない（2026-08-04 社長指示。ティーのTEE_RT_Mと同じ流儀）。
const REDUCER_B = {
  '20A': ['15A'],
  '25A': ['20A', '15A'],
  '32A': ['25A', '20A', '15A'],
  '40A': ['32A', '25A', '20A', '15A'],
  '50A': ['40A', '32A', '25A', '20A'],
  '65A': ['50A', '40A', '32A', '25A'],
  '80A': ['65A', '50A', '40A', '32A'],
  '90A': ['80A', '65A', '50A', '40A'],
  '100A': ['90A', '80A', '65A', '50A', '40A'],
  '125A': ['100A', '90A', '80A', '65A', '50A'],
  '150A': ['125A', '100A', '90A', '80A', '65A'],
  '200A': ['150A', '125A', '100A', '90A'],
  '250A': ['200A', '150A', '125A', '100A'],
  '300A': ['250A', '200A', '150A', '125A'],
  '350A': ['300A', '250A', '200A', '150A'],
  '400A': ['350A', '300A', '250A', '200A'],
  '450A': ['400A', '350A', '300A', '250A'],
  '500A': ['450A', '400A', '350A', '300A'],
};
// レジューサで選べる小径（規格の組合せのみ・小→大＝ティーのteeBranchSizesと同じ並び）
function reducerSizeBs(a) { return SIZE_ORDER.filter(s => REDUCER_B[a] && REDUCER_B[a].includes(s)); }
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
// ティの本管（ラン）：中空管（両端開先）の外壁・内壁に、枝管ボア（+Z側・半径holeR）の
// サドル曲線どおりの穴を開け、穴縁は壁厚ぶんのカラー（ザグリ面）でつなぐ（2026-07-19 社長指摘：
// 枝管の内部から本管の壁が見えて貫通していなかった）。開先・ルートフェイスは従来の形状を踏襲。
function teeRunBoredGeo(ro, ri, C, holeR) {
  const t = ro - ri;
  const f = Math.min(WELD_ROOT_FACE, t * 0.5);
  const h = Math.max(t - f, 0) * Math.tan(WELD_BEVEL_DEG * Math.PI / 180);
  const hiOut = C - h, loOut = -C + h;
  const seg = 64, pos = [];
  const quad = (a, b, c2, d) => { pos.push(...a, ...b, ...c2, ...a, ...c2, ...d); };
  // 円筒壁（半径r・y0〜y1）。+Z側は枝穴の範囲 |y| < √(holeR²−r²cos²φ) を抜いて上下2帯にする
  const wall = (r, y0, y1) => {
    const col = pAng => {
      const c = Math.cos(pAng), s = Math.sin(pAng);
      const yh = s > 0 ? Math.sqrt(Math.max(0, holeR * holeR - r * r * c * c)) : 0;
      return { x: r * c, z: r * s, yh };
    };
    for (let i = 0; i < seg; i++) {
      const A = col(i / seg * Math.PI * 2), B = col((i + 1) / seg * Math.PI * 2);
      quad([A.x, y0, A.z], [B.x, y0, B.z], [B.x, -B.yh, B.z], [A.x, -A.yh, A.z]);   // 下帯
      quad([A.x, A.yh, A.z], [B.x, B.yh, B.z], [B.x, y1, B.z], [A.x, y1, A.z]);     // 上帯
    }
  };
  // 回転リング/コーン（(r1,y1)→(r2,y2)を一周）＝端部の開先・ルートフェイス
  const rev = (r1, y1, r2, y2) => {
    for (let i = 0; i < seg; i++) {
      const p0 = i / seg * Math.PI * 2, p1 = (i + 1) / seg * Math.PI * 2;
      const c0 = Math.cos(p0), s0 = Math.sin(p0), c1 = Math.cos(p1), s1 = Math.sin(p1);
      quad([r1 * c0, y1, r1 * s0], [r1 * c1, y1, r1 * s1], [r2 * c1, y2, r2 * s1], [r2 * c0, y2, r2 * s0]);
    }
  };
  wall(ro, loOut, hiOut);                                   // 外壁（枝穴あき）
  wall(ri, -C, C);                                          // 内壁（枝穴あき）
  rev(ro, hiOut, ri + f, C); rev(ri + f, C, ri, C);         // 上端：開先＋ルートフェイス
  rev(ro, loOut, ri + f, -C); rev(ri + f, -C, ri, -C);      // 下端
  // ※穴縁のザグリ面は枝管側のボア壁（teeBranchGeo の内壁が本管内面まで届く）が兼ねる
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
// ティの枝管：外壁は本管の外面サドルまで・ボア壁（内壁）は本管の内面サドルまで＝
// 本管の中へ一切飛び出さず、壁厚部はボア壁が貫通してザグリ面になる（2026-07-19 社長指摘：
// 枝管が母管内に飛び出していた＝旧・平面カット(√(riR²−roB²))では中央付近が出っ張る）。
// 枝軸＝ローカル+Z、外端 z=M に開先＋ルートフェイス（従来の見た目を踏襲）。
function teeBranchGeo(roB, riB, M, roR, riR) {
  const t = roB - riB;
  const f = Math.min(WELD_ROOT_FACE, t * 0.5);
  const h = Math.max(t - f, 0) * Math.tan(WELD_BEVEL_DEG * Math.PI / 180);
  const seg = 40, pos = [];
  const quad = (a, b, c2, d) => { pos.push(...a, ...b, ...c2, ...a, ...c2, ...d); };
  // 円筒壁（半径r・上端zTop）。下端は本管半径 cutR の面のサドル z=√(cutR²−r²cos²ψ)
  const wall = (r, zTop, cutR) => {
    const col = p => {
      const c = Math.cos(p), s = Math.sin(p);
      const z0 = Math.min(Math.sqrt(Math.max(cutR * cutR - r * r * c * c, 0)), zTop - 1e-4);
      return { x: r * c, y: r * s, z0 };
    };
    for (let i = 0; i < seg; i++) {
      const A = col(i / seg * Math.PI * 2), B = col((i + 1) / seg * Math.PI * 2);
      quad([A.x, A.y, A.z0], [B.x, B.y, B.z0], [B.x, B.y, zTop], [A.x, A.y, zTop]);
    }
  };
  const rev = (r1, z1, r2, z2) => {
    for (let i = 0; i < seg; i++) {
      const p0 = i / seg * Math.PI * 2, p1 = (i + 1) / seg * Math.PI * 2;
      const c0 = Math.cos(p0), s0 = Math.sin(p0), c1 = Math.cos(p1), s1 = Math.sin(p1);
      quad([r1 * c0, r1 * s0, z1], [r1 * c1, r1 * s1, z1], [r2 * c1, r2 * s1, z2], [r2 * c0, r2 * s0, z2]);
    }
  };
  wall(roB, M - h, roR);                                    // 外壁＝本管外面まで
  wall(riB, M, riR);                                        // ボア壁＝本管内面まで（壁厚部がザグリ面）
  rev(roB, M - h, riB + f, M);                              // 外端：開先
  rev(riB + f, M, riB, M);                                  // 外端：ルートフェイス
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
function makeTee(opts) {
  const o = Object.assign({ sizeA: '25A', sizeB: '25A', sch: 'Sch10S' }, opts || {});
  const mat = FLANGE_MAT.clone(); mat.side = THREE.DoubleSide; mat.needsUpdate = true;
  const roR = (FLG_BORE[o.sizeA] || 114) / 2 / 1000;
  const riR = Math.max(roR - pipeWall(o.sizeA, o.sch) / 1000, roR * 0.3);
  const roB = (FLG_BORE[o.sizeB] || 60) / 2 / 1000;
  const riB = Math.max(roB - pipeWall(o.sizeB, o.sch) / 1000, roB * 0.3);
  const C = (TEE_C[o.sizeA] || 38) / 1000;         // run 中心-端（等径・径違いとも同じ）
  // outlet 中心-端 M：等径＝C と同値／径違い＝規格表 TEE_RT_M（run×枝の組合せで決まる）。
  // 表に無い組合せ（旧図面の規格外データ等）は等径のCで代用して描画だけは成立させる。
  const M = ((o.sizeB && o.sizeB !== o.sizeA && TEE_RT_M[o.sizeA] && TEE_RT_M[o.sizeA][o.sizeB] != null)
    ? TEE_RT_M[o.sizeA][o.sizeB] : (TEE_C[o.sizeA] || 38)) / 1000;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(teeRunBoredGeo(roR, riR, C, Math.min(riB, riR * 0.999)), mat));   // run（Y軸・両端開先・枝ボアのザグリ穴あき）
  // branch（外端のみ開先）。内端は本管の外面/内面サドルでカット＝ボア内へ飛び出さない
  g.add(new THREE.Mesh(teeBranchGeo(roB, riB, M, roR, riR), mat));
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

// ===== ガスケット（2026-07-14 社長要望） =====
// 呼び径×クラスで決まるRF座面径（RF_FACE_DIA＝フランジと同じ実寸表）を外径、管外径を内径とする円環板。
// 厚みは任意入力（既定3mm）。軸=Y、back=y0／face=y=t（フランジ面間に挟んで使う）。
const gasketOpts = { sizeA: '25A', cls: 'JIS 10K', t: 3 };
function makeGasket(opts) {
  const o = Object.assign({ sizeA: '25A', cls: 'JIS 10K', t: 3 }, opts || {});
  o.t = (parseFloat(o.t) > 0) ? parseFloat(o.t) : 3;
  const gDia = rfFaceDia(o.cls, o.sizeA) || (FLG_BORE[o.sizeA] || 34) * 1.8;   // 外径＝RF座面径（表に無ければ推定）
  const ro = gDia / 2 / 1000;
  const ri = Math.min((FLG_BORE[o.sizeA] || 34) / 2 / 1000, ro * 0.85);        // 内径＝管外径（外径より必ず小さく）
  const t = o.t / 1000;
  const mat = FLANGE_MAT.clone();
  mat.color = new THREE.Color(0x2f7d5a);   // ジョイントシート風の緑（フランジ等と見分けやすく）
  mat.needsUpdate = true;
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(ringGeo(ro, ri, t), mat);
  mesh.position.y = t / 2;
  g.add(mesh);
  g.userData.partType = 'gasket';
  g.userData.gasket = { ...o };
  g.userData.faceLocal = new THREE.Vector3(0, t, 0);
  g.userData.backLocal = new THREE.Vector3(0, 0, 0);
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

// ===================================================================
//  差込み溶接式（ソケットウェルド SW）管継手  呼び径10A〜50A・Sch80
//  出典＝(株)MIEテクノ「ステンレス鋼製高圧管継手」差込み溶接式（JIS B2316/B0151）
//  寸法は実寸mm：O=外径, S=差込み(ソケット)内径, D=流体ボア, C=ソケット深さ, L=中心-端/全長。
//  差込み部(座ぐり)を表現し、接続タイプ=SW固定。肉厚はカタログ値Dから直接決まる。
// ===================================================================
const SW_S = { '10A':17.8,'15A':22.2,'20A':27.7,'25A':34.5,'32A':43.2,'40A':49.1,'50A':61.1 }; // 差込み(ソケット)内径
const SW_D = { '10A':12.7,'15A':16.1,'20A':21.4,'25A':27.2,'32A':35.5,'40A':41.2,'50A':52.7 }; // 流体ボア
const SW_C_E  = { '10A':10.5,'15A':12.5,'20A':14.0,'25A':15.0,'32A':17.0,'40A':17.5,'50A':22.0 }; // ソケット深さ(90E/T/CROSS/FC/HC/BOSS/UNION 共通)
const SW_C_45 = { '10A':10.5,'15A':11.0,'20A':14.0,'25A':15.0,'32A':17.0,'40A':17.5,'50A':17.5 }; // 45Eのソケット深さ
const SW_C_CAP= { '10A':10.5,'15A':10.5,'20A':15.0,'25A':15.0,'32A':15.0,'40A':15.0,'50A':19.0 }; // CAPのソケット深さ
const SW_O_E  = { '10A':26,'15A':33,'20A':38,'25A':46,'32A':56,'40A':62,'50A':75.5 };  // 外径(90E/45E/T/CROSS)
const SW_O_FC = { '10A':25,'15A':32,'20A':38,'25A':46,'32A':55,'40A':65,'50A':75 };    // 外径(FC/HC/BOSS/CAP)
const SW_O_UN = { '10A':25.9,'15A':31.2,'20A':37.1,'25A':45.5,'32A':54.9,'40A':61.5,'50A':75.2 }; // 外径(UNION)
const SW_L_90 = { '10A':24.0,'15A':28.4,'20A':33.1,'25A':37.2,'32A':44.0,'40A':49.3,'50A':60.1 }; // 中心-端(90E/T/CROSS)
const SW_L_45 = { '10A':18.4,'15A':22.1,'20A':26.7,'25A':29.3,'32A':34.5,'40A':38.1,'50A':42.9 }; // 中心-端(45E)
const SW_L_FC = { '10A':27.4,'15A':34.5,'20A':37.5,'25A':42.7,'32A':46.7,'40A':47.7,'50A':63.1 }; // 全長(FC/FCR)
const SW_L_HC = { '10A':28.0,'15A':34.7,'20A':37.8,'25A':43.6,'32A':47.2,'40A':49.3,'50A':63.3 }; // 全長(HC/BOSS)
const SW_L_CAP= { '10A':20.0,'15A':23.0,'20A':26.0,'25A':28.0,'32A':31.0,'40A':33.0,'50A':39.0 }; // 全長(CAP)
const SW_L_UN = { '10A':46.0,'15A':49.0,'20A':56.9,'25A':62.0,'32A':71.1,'40A':76.5,'50A':86.1 }; // 全長(UNION)
const SW_SIZE_TBL = { '10A':1,'15A':1,'20A':1,'25A':1,'32A':1,'40A':1,'50A':1 };  // 呼び径ドロップダウン用
const SW_SIZE_ORDER = ['10A','15A','20A','25A','32A','40A','50A'];
function swSizesUpTo(a) { const i = SW_SIZE_ORDER.indexOf(a); return i < 0 ? SW_SIZE_ORDER.slice() : SW_SIZE_ORDER.slice(0, i + 1); }
function swClampSizeB(a) { const c = swSizesUpTo(a).slice(0, -1); if (!c.length) return a; return c.includes(fittingOpts.sizeB) ? fittingOpts.sizeB : c[c.length - 1]; }

function swMat() { const m = FLANGE_MAT.clone(); m.side = THREE.DoubleSide; m.needsUpdate = true; return m; }
function swLatheMesh(prof, mat, seg) { const g = new THREE.LatheGeometry(prof, seg || 44); g.computeVertexNormals(); return new THREE.Mesh(g, mat); }
// ソケット脚1本（軸=+Y・中心y=0→面y=L）。面に座ぐり(半径sR,深さC)→ボア(dR)→外径oR。内端(y=0)は開口（中央球で隠す）。
function swLeg(oR, sR, dR, L, C, mat) {
  const V2 = THREE.Vector2;
  const yf = L, yb = 0, ysh = Math.max(L - C, L * 0.12), dr = Math.max(dR, 0.0006);
  const prof = [new V2(oR, yf), new V2(oR, yb), new V2(dr, yb), new V2(dr, ysh), new V2(sR, ysh), new V2(sR, yf), new V2(oR, yf)];
  return swLatheMesh(prof, mat, 40);
}
function swOrient(mesh, dir) { mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()); return mesh; }
function swBall(oR, mat) { return new THREE.Mesh(new THREE.SphereGeometry(oR, 28, 18), mat); }

// 差込み溶接継手の生成。opts={kind, sizeA, sizeB, sch}。kind=90E/45E/T/TR/CROSS/FC/HC/FCR/BOSS/CAP/UNION
function makeSW(opts) {
  const V3 = THREE.Vector3, V2 = THREE.Vector2, mm = v => v / 1000;
  const o = Object.assign({ kind: '90E', sizeA: '25A', sizeB: '20A', sch: 'Sch80' }, opts || {});
  const A = SW_S[o.sizeA] ? o.sizeA : '25A';
  const mat = swMat();
  const g = new THREE.Group();
  const k = o.kind;
  let storeB;

  if (k === '90E' || k === '45E') {
    const bend = (k === '45E') ? 45 : 90;
    const oR = mm(SW_O_E[A]) / 2, sR = mm(SW_S[A]) / 2, dR = mm(SW_D[A]) / 2;
    const C = mm(k === '45E' ? SW_C_45[A] : SW_C_E[A]);
    const L = mm(k === '45E' ? SW_L_45[A] : SW_L_90[A]);
    // BWエルボ(makeBendCore)と同じ向きに揃える：XY平面・面脚=(sinθ,cosθ)・背脚=真下(0,-1,0)・背法線は内向き(0,1,0)
    const th = bend * Math.PI / 180;
    const dirA = new V3(Math.sin(th), Math.cos(th), 0);   // 面脚（＝BWの faceNormal 方向）
    const dirB = new V3(0, -1, 0);                        // 背脚（真下＝BWと一致）
    g.add(swOrient(swLeg(oR, sR, dR, L, C, mat), dirA));
    g.add(swOrient(swLeg(oR, sR, dR, L, C, mat), dirB));
    g.add(swBall(oR, mat));
    g.userData.faceLocal = dirA.clone().multiplyScalar(L - C);   // 起点＝ソケット底（パイプ差込みが止まる位置）
    g.userData.backLocal = dirB.clone().multiplyScalar(L - C);
    g.userData.faceNormal = dirA.clone(); g.userData.backNormal = new V3(0, 1, 0);   // BW流：背法線は内向き
    g.userData.cornerLocal = new V3(0, 0, 0);
    g.userData.extraLocals = [g.userData.cornerLocal];
    g.userData.gripLocal = g.userData.cornerLocal;
  } else if (k === 'T' || k === 'TR') {
    const B = (k === 'TR' && SW_S[o.sizeB]) ? o.sizeB : A; storeB = B;
    const oR = mm(SW_O_E[A]) / 2, sR = mm(SW_S[A]) / 2, dR = mm(SW_D[A]) / 2, C = mm(SW_C_E[A]), L = mm(SW_L_90[A]);
    const oRb = mm(SW_O_E[B]) / 2, sRb = mm(SW_S[B]) / 2, dRb = mm(SW_D[B]) / 2, Cb = mm(SW_C_E[B]), Lb = mm(SW_L_90[B]);
    g.add(swOrient(swLeg(oR, sR, dR, L, C, mat), new V3(0, 1, 0)));
    g.add(swOrient(swLeg(oR, sR, dR, L, C, mat), new V3(0, -1, 0)));
    g.add(swOrient(swLeg(oRb, sRb, dRb, Lb, Cb, mat), new V3(0, 0, 1)));
    g.add(swBall(oR, mat));
    g.userData.faceLocal = new V3(0, L - C, 0); g.userData.backLocal = new V3(0, -(L - C), 0);   // 起点＝各ソケット底
    g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.cornerLocal = new V3(0, 0, 0);
    g.userData.extraLocals = [new V3(0, 0, Lb - Cb), g.userData.cornerLocal];   // 枝端もソケット底
    g.userData.gripLocal = g.userData.cornerLocal;
  } else if (k === 'CROSS') {
    const oR = mm(SW_O_E[A]) / 2, sR = mm(SW_S[A]) / 2, dR = mm(SW_D[A]) / 2, C = mm(SW_C_E[A]), L = mm(SW_L_90[A]);
    [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].forEach(d => g.add(swOrient(swLeg(oR, sR, dR, L, C, mat), new V3(d[0], d[1], d[2]))));
    g.add(swBall(oR, mat));
    g.userData.faceLocal = new V3(0, L - C, 0); g.userData.backLocal = new V3(0, -(L - C), 0);   // 起点＝各ソケット底
    g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.cornerLocal = new V3(0, 0, 0);
    g.userData.extraLocals = [new V3(0, 0, L - C), new V3(0, 0, -(L - C)), g.userData.cornerLocal];
    g.userData.gripLocal = g.userData.cornerLocal;
  } else if (k === 'FC') {
    const oR = mm(SW_O_FC[A]) / 2, sR = mm(SW_S[A]) / 2, dR = mm(SW_D[A]) / 2, C = mm(SW_C_E[A]), L = mm(SW_L_FC[A]);
    const yf = L / 2, yb = -L / 2, shT = yf - C, shB = yb + C;
    const prof = [new V2(oR, yf), new V2(oR, yb), new V2(sR, yb), new V2(sR, shB), new V2(dR, shB), new V2(dR, shT), new V2(sR, shT), new V2(sR, yf), new V2(oR, yf)];
    g.add(swLatheMesh(prof, mat, 48));
    g.userData.faceLocal = new V3(0, shT, 0); g.userData.backLocal = new V3(0, shB, 0);   // 起点＝両ソケット底
    g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.gripLocal = g.userData.faceLocal;
  } else if (k === 'HC' || k === 'BOSS') {
    const oR = mm(SW_O_FC[A]) / 2, sR = mm(SW_S[A]) / 2, dR = mm(SW_D[A]) / 2, C = mm(SW_C_E[A]), L = mm(SW_L_HC[A]);
    const yf = L / 2, yb = -L / 2, shT = yf - C;
    let prof;
    if (k === 'BOSS') { const chf = Math.min(oR - dR, L * 0.4);   // 溶接端(-Y)を45°座面に
      prof = [new V2(oR, yf), new V2(oR, yb + chf), new V2(dR, yb), new V2(dR, shT), new V2(sR, shT), new V2(sR, yf), new V2(oR, yf)];
    } else {
      prof = [new V2(oR, yf), new V2(oR, yb), new V2(dR, yb), new V2(dR, shT), new V2(sR, shT), new V2(sR, yf), new V2(oR, yf)];
    }
    g.add(swLatheMesh(prof, mat, 48));
    g.userData.faceLocal = new V3(0, shT, 0); g.userData.backLocal = new V3(0, yb, 0);   // 起点：ソケット側はソケット底／溶接端はそのまま
    g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.gripLocal = g.userData.faceLocal;
  } else if (k === 'FCR') {
    const B = SW_S[o.sizeB] ? o.sizeB : A; storeB = B;
    const oR = mm(SW_O_FC[A]) / 2;                          // 外径は一定（カタログ＝ストレート外形）
    const sRb = mm(SW_S[A]) / 2, Cb = mm(SW_C_E[A]);        // 大ソケット(−Y)
    const sRs = mm(SW_S[B]) / 2, Cs = mm(SW_C_E[B]);        // 小ソケット(+Y)
    const dRs = Math.max(mm(SW_D[B]) / 2, 0.0006);          // 中央貫通ボア＝小径ボア
    const L = mm(SW_L_FC[A]), yf = L / 2, yb = -L / 2;
    const shB = yb + Cb, shT = yf - Cs;                     // 各ソケット底
    const prof = [new V2(oR, yf), new V2(oR, yb), new V2(sRb, yb), new V2(sRb, shB), new V2(dRs, shB),
      new V2(dRs, shT), new V2(sRs, shT), new V2(sRs, yf), new V2(oR, yf)];
    g.add(swLatheMesh(prof, mat, 48));
    g.userData.faceLocal = new V3(0, shT, 0); g.userData.backLocal = new V3(0, shB, 0);   // 起点＝大小ソケット底
    g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.gripLocal = g.userData.backLocal;
  } else if (k === 'CAP') {
    const oR = mm(SW_O_FC[A]) / 2, sR = mm(SW_S[A]) / 2, C = mm(SW_C_CAP[A]), L = mm(SW_L_CAP[A]);
    const K = Math.max(L - C, L * 0.25);                       // 閉端(ドーム)高さ
    const R = (oR * oR + K * K) / (2 * K), pm = Math.asin(Math.min(oR / R, 1));   // 球面セグメントの頭（鍛造キャップらしい丸み）
    const N = 22, prof = [new V2(oR, 0)];                      // 差込み口の外周
    for (let i = 0; i <= N; i++) { const ph = (1 - i / N) * pm; prof.push(new V2(Math.max(R * Math.sin(ph), 0), (L - R) + R * Math.cos(ph))); }  // (oR,C)→(0,L)
    prof.push(new V2(0, C)); prof.push(new V2(sR, C)); prof.push(new V2(sR, 0)); prof.push(new V2(oR, 0));
    g.add(swLatheMesh(prof, mat, 48));
    g.userData.faceLocal = new V3(0, C, 0); g.userData.backLocal = new V3(0, C, 0);   // 起点＝ソケット底（差込み口は-Y側）
    g.userData.faceNormal = new V3(0, -1, 0);
    g.userData.gripLocal = g.userData.faceLocal;
  } else if (k === 'UNION') {
    const oR = mm(SW_O_UN[A]) / 2, sR = mm(SW_S[A]) / 2, dR = mm(SW_D[A]) / 2, C = mm(SW_C_E[A]), L = mm(SW_L_UN[A]);
    const half = L / 2;
    g.add(swOrient(swLeg(oR, sR, dR, half, C, mat), new V3(0, 1, 0)));
    g.add(swOrient(swLeg(oR, sR, dR, half, C, mat), new V3(0, -1, 0)));
    g.add(swBall(oR, mat));
    const nutR = oR * 1.18, nutLen = Math.min(L * 0.26, half * 0.8);          // 中央のユニオンナット(六角)
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(nutR, nutR, nutLen, 6), mat));
    g.userData.faceLocal = new V3(0, half - C, 0); g.userData.backLocal = new V3(0, -(half - C), 0);   // 起点＝両ソケット底
    g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.gripLocal = g.userData.faceLocal;
  }
  g.userData.partType = 'sw';
  g.userData.sw = { kind: k, sizeA: A, sizeB: storeB, sch: 'Sch80' };
  return g;
}

// ===================================================================
//  一般工業用バルブ  フランジ形(JIS10K/20K・JPI150/300LB)／溶接形(SW Class800)
//  ・両端フランジは FLANGE_DIMS(外径D・厚みt)・RF_FACE_DIA(座径) を流用し規格寸法。
//  ・面間(FtF)は標準寸法の近似（社長から正規表が出れば差し替え）。
//  ・流れ軸=Y、ステム/ハンドル=+Z（ティーの枝と同じ向き）。接続点=両端フランジ面。
// ===================================================================
const VALVE_SIZES = ['15A', '20A', '25A', '32A', '40A', '50A', '65A', '80A', '100A', '125A', '150A', '200A'];
const VALVE_RATINGS = ['JIS 10K', 'JIS 20K', 'JPI 150LB', 'JPI 300LB'];
const _vdn = s => parseInt(s, 10) || 50;
const VMM = v => v / 1000;
function valveBodyMat() { return new THREE.MeshStandardMaterial({ color: 0x97a0ab, metalness: 0.58, roughness: 0.42, side: THREE.DoubleSide }); }
function valveOpMat() { return new THREE.MeshStandardMaterial({ color: 0x5f6873, metalness: 0.62, roughness: 0.40, side: THREE.DoubleSide }); }   // ハンドル・ステム等
// 面間(中心-端の半分=halfL を使う)。標準寸法の近似（mm）。
function valveFtF(kind, sizeA) {
  const dn = _vdn(sizeA);
  if (kind === 'butterfly') return 40 + dn * 0.18;
  if (kind === 'check') return 90 + dn * 1.0;
  if (kind === 'strainer') return 95 + dn * 1.05;
  if (kind === 'swgate' || kind === 'swglobe') return 46 + dn * 0.55;   // 鍛造SW弁はコンパクト：面間を短くして両端ソケットを中央ボディへ寄せる（社長指示・実物カタログに合わせ）
  return 110 + dn * 0.95;   // gate/globe/ball
}
// 規格フランジ端（軸Y・フランジ面 y=0・本体側 -Y）。中空（ボア貫通）＋レイズドフェイス＋ハブ。
//   noHub=true：背面のハブ（首）を付けない。面間が短いバルブ（バタフライ＝ウエハー/ルグ形）用。
//     ハブ長は呼び径比例で伸びるため、面間の短いバルブで付けると大口径で中心を突き抜けて反対側へ飛び出す。
function valveEndFlange(cls, sizeA, mat, noHub) {
  const fd = flangeDim(cls, sizeA);
  const R = VMM(fd.D) / 2, t = VMM(fd.t);
  const RF = VMM(rfFaceDia(cls, sizeA) || fd.D * 0.72) / 2;
  const od = FLG_BORE[sizeA] || 60;
  const boreR = VMM(od * 0.42), neckR = VMM(od / 2 + 2.5), hub = VMM(_vdn(sizeA) * 0.45 + 5), rfH = 0.0018;
  const bcR = VMM(fd.C) / 2, holeR = VMM(fd.h) / 2, nB = fd.n || 4;
  const g = new THREE.Group();
  // 規格通りのボルト穴（数・ピッチ円・穴径）＋中心ボアを開けた板
  const holes = [];
  for (let i = 0; i < nB; i++) { const a = (i / nB) * Math.PI * 2 + Math.PI / nB; holes.push({ x: Math.cos(a) * bcR, y: Math.sin(a) * bcR, r: holeR }); }
  holes.push({ x: 0, y: 0, r: boreR });
  // グループ原点 y=0 ＝ レイズドフェイスの「面」＝ガスケット当たり面。
  // バルブの面間寸法（JIS/ASMEの face-to-face）はガスケット面どうしの距離なので、機点(±halfL)に
  // RFの面が来るようRFぶん内側へ寄せる。（2026-07-21 社長指摘：RFがガスケット・相手フランジと重なっていた）
  const plate = plateWithHoles(R, t, holes); plate.translate(0, -t / 2 - rfH, 0);                 // 板：RF面より内側
  g.add(new THREE.Mesh(plate, mat));
  const rf = ringGeo(RF, boreR, rfH); rf.translate(0, -rfH / 2, 0); g.add(new THREE.Mesh(rf, mat)); // レイズドフェイス（面が y=0）
  if (!noHub) { const hubG = ringGeo(neckR, boreR, hub); hubG.translate(0, -t - rfH - hub / 2, 0); g.add(new THREE.Mesh(hubG, mat)); }  // ハブ（背面）
  return g;
}
// ハンドル車（軸=+Z）。リム＋4本スポーク＋ハブ＋ステムナット。R=リム半径(m)（2026-07-19 リアル化）
function vHandwheel(R, mat) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.11, 10, 32), mat));       // リム（既定でXY平面＝軸Z）
  for (let i = 0; i < 2; i++) {                                                    // 4本スポーク（貫通円柱×2）
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.055, R * 0.055, 2 * R, 8), mat);
    sp.rotation.z = i * Math.PI / 2; g.add(sp);
  }
  const hubm = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.17, R * 0.2, R * 0.32, 14), mat);
  hubm.rotation.x = Math.PI / 2; g.add(hubm);                                      // ハブ（軸Z・わずかにテーパ）
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.1, R * 0.1, R * 0.16, 6), mat);
  nut.rotation.x = Math.PI / 2; nut.position.z = R * 0.22; g.add(nut);             // ステムナット（六角）
  return g;
}
// レバー式バルブ（ボール・バタフライ）の首（ステム）の高さ。
// 社長指示（2026-07-27）＝「各フランジの高さよりほんの少し長いくらい」。
// 軸からフランジの縁までの高さ＝フランジ外径Dの半分。そこへ呼び径に応じた小さな逃げを足す。
// Dは呼び径とクラスで決まるので、どの呼び径・クラスでもレバーが必ずフランジを越える。
function vLeverStemTop(D, sizeA) { return VMM(D) / 2 + VMM(8 + _vdn(sizeA) * 0.06); }
// レバーハンドル（ボール弁・バタフライ弁 共通）。流れ軸(Y)と直角＝「閉」の姿勢で +X 側へ出す。
//   D=フランジ外径(m) を目安に長さを決める／stemZ=ステム頂部のZ／rPipe=管半径(m)
// ※流れ方向に寝かせると長さが面間を越えて両端フランジに食い込む（2026-07-27 社長指摘）
function vLever(D, rPipe, stemZ, opMat) {
  const g = new THREE.Group();
  const len = Math.max(D * 0.85, rPipe * 6);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(len, rPipe * 0.42, rPipe * 0.30), opMat);
  bar.position.set(len / 2 - rPipe * 0.7, 0, stemZ + rPipe * 0.18); g.add(bar);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(rPipe * 0.42, rPipe * 0.42, rPipe * 0.36, 12), opMat);
  hub.rotation.x = Math.PI / 2; hub.position.z = stemZ + rPipe * 0.18; g.add(hub);      // 軸まわりのハブ
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(rPipe * 0.30, rPipe * 0.30, len * 0.30, 12), opMat);
  grip.rotation.z = Math.PI / 2;
  grip.position.set(len * 0.82 - rPipe * 0.7, 0, stemZ + rPipe * 0.18); g.add(grip);    // 先端の握り
  return g;
}
// 2点間を結ぶ丸棒（ヨーク腕など）
function vBar(p1, p2, r, mat) {
  const d = p2.clone().sub(p1);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat);
  m.position.copy(p1).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  return m;
}
// ゲート/グローブ弁の上部ドレスアップ（2026-07-19 社長要望：バルブのリアル化）
// ボンネットフランジのボルト・グランド・門形ヨーク・ヨークスリーブ・ハンドル上のライジングステムを追加。
// 座標系＝フロー軸Y・ステム軸+Z（bonZ=ボンネットフランジのZ位置・bonTop=ボンネット上端・wheelZ=ハンドル位置）
function vDressBonnet(g, bodyR, bonR, bonZ, bonTop, wheelZ, wheelR, stemR, bodyMat, opMat) {
  const bfT = bodyR * 0.16;
  // ※ボンネットのボルト（6本）は廃止（2026-07-27 社長指示：ボルトのような画像は不要）
  const gl = new THREE.Mesh(new THREE.CylinderGeometry(bonR * 0.85, bonR * 0.95, bonR * 0.4, 16), bodyMat);
  gl.rotation.x = Math.PI / 2; gl.position.z = bonTop + bonR * 0.12; g.add(gl);    // グランド押え
  const yokeHub = wheelZ - wheelR * 0.32;                    // ヨークスリーブ（ハンドル直下のハブ）
  const yh = new THREE.Mesh(new THREE.CylinderGeometry(bonR * 0.42, bonR * 0.52, wheelR * 0.4, 14), bodyMat);
  yh.rotation.x = Math.PI / 2; yh.position.z = yokeHub; g.add(yh);
  const V3 = THREE.Vector3;                                   // 門形ヨーク（左右2本の腕）
  g.add(vBar(new V3(bodyR * 0.6, 0, bonZ + bfT * 0.6), new V3(bonR * 0.34, 0, yokeHub), bodyR * 0.09, bodyMat));
  g.add(vBar(new V3(-bodyR * 0.6, 0, bonZ + bfT * 0.6), new V3(-bonR * 0.34, 0, yokeHub), bodyR * 0.09, bodyMat));
  g.add(vCylZ(stemR * 0.85, wheelZ, wheelZ + wheelR * 0.5, opMat));                // ライジングステム（ハンドルの上に出た軸）
}
// +Z 方向の円柱（ステム・ボンネット等）。z0→z1、半径 r。
function vCylZ(r, z0, z1, mat, r2) { const h = z1 - z0; const m = new THREE.Mesh(new THREE.CylinderGeometry(r2 != null ? r2 : r, r, h, 18), mat); m.rotation.x = Math.PI / 2; m.position.z = (z0 + z1) / 2; return m; }
// Y方向の円柱（本管・ネック）。y0→y1、半径 r。
function vCylY(r, y0, y1, mat, r2) { const h = y1 - y0; const m = new THREE.Mesh(new THREE.CylinderGeometry(r2 != null ? r2 : r, r, h, 24), mat); m.position.y = (y0 + y1) / 2; return m; }

// バルブ生成。opts={kind, sizeA, rating}
function makeValve(opts) {
  const V3 = THREE.Vector3;
  const o = Object.assign({ kind: 'gate', sizeA: '50A', rating: 'JIS 10K' }, opts || {});
  const sizeA = VALVE_SIZES.includes(o.sizeA) ? o.sizeA : '50A';
  const cls = VALVE_RATINGS.includes(o.rating) ? o.rating : 'JIS 10K';
  const bodyMat = valveBodyMat(), opMat = valveOpMat();
  const g = new THREE.Group();
  const od = FLG_BORE[sizeA] || 60;            // 管外径(mm)
  const rPipe = VMM(od) / 2;                    // 管半径(m)
  const D = flangeDim(cls, sizeA).D;            // フランジ外径(mm)
  const halfL = VMM(valveFtF(o.kind, sizeA)) / 2;
  const k = o.kind;

  // 中心ボアの半径。valveEndFlange が板に開ける穴と同じ値にして、面から穴がまっすぐ見えるようにする。
  const boreR = VMM(od * 0.42);
  // --- 共通：両端フランジ＋連結ネック ---
  function flangedEnds(neckR) {
    const f1 = valveEndFlange(cls, sizeA, bodyMat); f1.position.y = halfL; g.add(f1);
    const f2 = valveEndFlange(cls, sizeA, bodyMat); f2.position.y = -halfL; f2.rotation.x = Math.PI; g.add(f2);
    // ボア導管＝中空の筒。塞がった円柱にすると端のフタが穴をふさぎ、フランジ面がブラインドに見える
    // （2026-07-27 社長指摘「各面がブラインドの様になっている」の原因）
    g.add(new THREE.Mesh(ringGeo(neckR, boreR, 2 * halfL), bodyMat));
  }

  if (k === 'gate' || k === 'globe' || k === 'ball') {
    const bodyR = VMM(Math.max(od * 0.72, D * 0.30));    // 中央ボディ半径
    flangedEnds(rPipe * 1.12);
    if (k === 'globe') {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(bodyR, 24, 18), bodyMat));   // 球状ボディ
    } else {
      g.add(vCylY(bodyR, -bodyR * 0.9, bodyR * 0.9, bodyMat));                    // 円筒ボディ
    }
    if (k === 'ball') {
      // ボール弁：レバーハンドル（平棒）＋短ステム。
      // レバーは流れ軸(Y)と直角＝「閉」の姿勢を既定にする（2026-07-27 社長指示）。
      // 従来は流れ方向に寝ていたため、長さが面間を越えて両端フランジに食い込んでいた。
      // 首＝フランジの縁よりほんの少し上（2026-07-27 社長要望）。旧＝bodyR + VMM(8 + od*0.18)
      const stemTop = Math.max(vLeverStemTop(D, sizeA), bodyR + VMM(10));
      g.add(vCylZ(rPipe * 0.28, bodyR * 0.7, stemTop, opMat));
      g.add(vLever(VMM(D), rPipe, stemTop, opMat));
    } else {
      // ゲート/グローブ：ボンネット＋ハンドル車
      const bonR = bodyR * 0.52, bonTop = bodyR + halfL * 0.55;
      const bfl = new THREE.Mesh(new THREE.CylinderGeometry(bodyR * 0.7, bodyR * 0.7, VMM(_vdn(sizeA) * 0.12 + 4), 20), bodyMat);
      bfl.rotation.x = Math.PI / 2; bfl.position.z = bodyR * 0.92; g.add(bfl);     // ボンネットフランジ
      g.add(vCylZ(bonR, bodyR * 0.6, bonTop, bodyMat));                            // ボンネット
      const wheelZ = bonTop + bodyR * 0.45, wheelR = Math.max(bodyR * 0.85, halfL * 0.7);
      g.add(vCylZ(rPipe * 0.18, bonTop, wheelZ, opMat));                           // ステム
      const hw = vHandwheel(wheelR, opMat); hw.position.z = wheelZ; g.add(hw);
      vDressBonnet(g, bodyR, bonR, bodyR * 0.92, bonTop, wheelZ, wheelR, rPipe * 0.18, bodyMat, opMat);   // ヨーク・グランド・ボルト（リアル化）
    }
    g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.faceLocal = new V3(0, halfL, 0); g.userData.backLocal = new V3(0, -halfL, 0);
    g.userData.gripLocal = g.userData.faceLocal;
  } else if (k === 'check') {
    const bodyR = VMM(Math.max(od * 0.72, D * 0.30));
    flangedEnds(rPipe * 1.12);
    g.add(vCylY(bodyR, -bodyR * 0.7, bodyR * 0.7, bodyMat));                    // 本体（スイング室）
    const covR = bodyR * 0.62, covZ = bodyR * 0.6 + VMM(_vdn(sizeA) * 0.2 + 6);
    g.add(vCylZ(covR, bodyR * 0.5, covZ, bodyMat));                             // 上カバー（ボルト蓋・ハンドル無し）
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(covR * 1.15, covR * 1.15, VMM(_vdn(sizeA) * 0.1 + 3), 20), bodyMat);
    lid.rotation.x = Math.PI / 2; lid.position.z = covZ; g.add(lid);
    // ※蓋のボルトは廃止（2026-07-27 社長指示）
    g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.faceLocal = new V3(0, halfL, 0); g.userData.backLocal = new V3(0, -halfL, 0);
    g.userData.gripLocal = g.userData.faceLocal;
  } else if (k === 'strainer') {
    const bodyR = VMM(Math.max(od * 0.66, D * 0.28));
    flangedEnds(rPipe * 1.1);
    g.add(vCylY(bodyR, -bodyR * 0.8, bodyR * 0.8, bodyMat));                    // 本体（run）
    // Y脚：主に -Z（既定向きで真下）へ。フロー軸(±Y)の端フランジに干渉しないよう -Y成分は小さく。
    const legDir = new V3(0, -0.2, -0.98).normalize(), legLen = halfL * 0.95, legR = rPipe * 0.9;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR, legLen, 18), bodyMat);
    leg.quaternion.setFromUnitVectors(new V3(0, 1, 0), legDir); leg.position.copy(legDir.clone().multiplyScalar(bodyR * 0.5 + legLen / 2)); g.add(leg);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(legR * 1.18, legR * 0.7, legLen * 0.3, 16), bodyMat);   // ドレンキャップ
    cap.quaternion.setFromUnitVectors(new V3(0, 1, 0), legDir); cap.position.copy(legDir.clone().multiplyScalar(bodyR * 0.5 + legLen)); g.add(cap);
    g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.faceLocal = new V3(0, halfL, 0); g.userData.backLocal = new V3(0, -halfL, 0);
    g.userData.gripLocal = g.userData.faceLocal;
  } else if (k === 'butterfly') {
    const wafer = (o.style === 'wafer');
    const discR = VMM(rfFaceDia(cls, sizeA) || od * 1.1) / 2;                   // ディスク外径≈座径
    g.add(new THREE.Mesh(ringGeo(discR * 1.08, boreR, 2 * halfL), bodyMat));    // 薄い大径ボディ（中空＝面がブラインドにならない）
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(discR * 0.92, discR * 0.92, VMM(_vdn(sizeA) * 0.08 + 3), 36), opMat);
    g.add(disc);                                                                // ディスク（流れに直角＝閉。レバーの姿勢と合わせる）
    if (!wafer) { const f1 = valveEndFlange(cls, sizeA, bodyMat, true); f1.position.y = halfL; g.add(f1); const f2 = valveEndFlange(cls, sizeA, bodyMat, true); f2.position.y = -halfL; f2.rotation.x = Math.PI; g.add(f2); }   // ハブ無し（面間が短く大口径でハブが突き抜けるため）
    // 首はボール弁と同じ＝フランジの縁よりほんの少し上（ウエハー形も相手フランジは同じ大きさなので揃える）
    const stemTop = Math.max(vLeverStemTop(D, sizeA), discR + VMM(10));
    g.add(vCylZ(rPipe * 0.2, discR * 0.9, stemTop, opMat));
    // ハンドルはボール弁と同じレバー（流れに直角＝閉）。ギヤボックス＋ハンドル車は廃止（2026-07-27 社長指示）
    g.add(vLever(VMM(D), rPipe, stemTop, opMat));
    g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.faceLocal = new V3(0, halfL, 0); g.userData.backLocal = new V3(0, -halfL, 0);
    g.userData.gripLocal = g.userData.faceLocal;
  } else if (k === 'safety') {
    const inSize = sizeA, outSize = (VALVE_SIZES.includes(o.sizeB) ? o.sizeB : sizeA);   // 入口(小)×出口(大)
    const inR = VMM(FLG_BORE[inSize] || 34) / 2, outR = VMM(FLG_BORE[outSize] || 60) / 2;
    const inHalf = VMM(40 + _vdn(inSize) * 0.7), outHalf = VMM(45 + _vdn(outSize) * 0.7);
    const bodyR = outR * 1.25;
    const fi = valveEndFlange(cls, inSize, bodyMat); fi.position.y = -inHalf; fi.rotation.x = Math.PI; g.add(fi);       // 入口（下・-Y）
    const fo = valveEndFlange(cls, outSize, bodyMat); fo.position.x = outHalf; fo.rotation.z = -Math.PI / 2; g.add(fo);  // 出口（横・+X）
    // 入口・出口のネックは中空にする（塞ぐとフランジ面がブラインドに見える・2026-07-27 社長指摘）
    const inBore = VMM((FLG_BORE[inSize] || 34) * 0.42), outBore = VMM((FLG_BORE[outSize] || 60) * 0.42);
    const inN = new THREE.Mesh(ringGeo(inR * 1.1, inBore, inHalf), bodyMat); inN.position.y = -inHalf / 2; g.add(inN);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(bodyR, 22, 16), bodyMat));    // 本体
    const on = new THREE.Mesh(ringGeo(outR * 1.1, outBore, outHalf), bodyMat);
    on.rotation.z = Math.PI / 2; on.position.x = outHalf / 2; g.add(on);        // 出口ネック
    const bonR = bodyR * 0.55, bonTop = bodyR + outHalf * 1.3;
    g.add(vCylY(bonR, bodyR * 0.5, bonTop, bodyMat));                           // ボンネット（ばね室・上）
    const capD = new THREE.Mesh(new THREE.SphereGeometry(bonR * 1.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat); capD.position.y = bonTop; g.add(capD);   // ドーム蓋
    // ※リフトレバー（ハンドルのような棒）は廃止（2026-07-27 社長指示）
    g.userData.faceNormal = new V3(1, 0, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.faceLocal = new V3(outHalf, 0, 0); g.userData.backLocal = new V3(0, -inHalf, 0);   // 出口=face／入口=back
    g.userData.cornerLocal = new V3(0, 0, 0); g.userData.extraLocals = [g.userData.cornerLocal];
    g.userData.gripLocal = g.userData.cornerLocal;
  } else if (k === 'swgate' || k === 'swglobe') {
    const sw = ['15A', '20A', '25A', '32A', '40A', '50A'].includes(sizeA) ? sizeA : '25A';
    const sS = VMM(SW_S[sw] || 34.5) / 2, sD = VMM(SW_D[sw] || 27.2) / 2, sC = VMM(SW_C_E[sw] || 15);
    const bodyR = VMM(Math.max(od * 0.6, 22)), hubR = VMM(od / 2 + 5), hl = VMM(valveFtF(k, sizeA)) / 2;
    const leg1 = swLeg(hubR, sS, sD, hl, sC, bodyMat); swOrient(leg1, new V3(0, 1, 0)); g.add(leg1);
    const leg2 = swLeg(hubR, sS, sD, hl, sC, bodyMat); swOrient(leg2, new V3(0, -1, 0)); g.add(leg2);
    if (k === 'swglobe') g.add(new THREE.Mesh(new THREE.SphereGeometry(bodyR, 20, 14), bodyMat));
    else g.add(vCylY(bodyR, -bodyR * 0.8, bodyR * 0.8, bodyMat));
    const bonR = bodyR * 0.55, bonTop = bodyR + hl * 0.9;
    g.add(vCylZ(bonR, bodyR * 0.55, bonTop, bodyMat));
    const wheelZ = bonTop + bodyR * 0.5, wheelR = bodyR * 0.95;
    g.add(vCylZ(VMM(od) * 0.12, bonTop, wheelZ, opMat));
    const hw = vHandwheel(wheelR, opMat); hw.position.z = wheelZ; g.add(hw);
    vDressBonnet(g, bodyR, bonR, bodyR * 0.62, bonTop, wheelZ, wheelR, VMM(od) * 0.12, bodyMat, opMat);   // ヨーク・グランド・ボルト（リアル化）
    g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
    g.userData.faceLocal = new V3(0, hl - sC, 0); g.userData.backLocal = new V3(0, -(hl - sC), 0);   // 起点＝ソケット底
    g.userData.gripLocal = g.userData.faceLocal;
  }

  g.userData.partType = 'valve';
  g.userData.valve = { kind: k, sizeA: sizeA, rating: cls, style: (k === 'butterfly' ? (o.style || 'flange') : undefined), sizeB: (k === 'safety' ? ((VALVE_SIZES.includes(o.sizeB) ? o.sizeB : sizeA)) : undefined) };
  // フランジ形（真っ直ぐ両端）＝端フランジのボルト穴を起点・スナップ対象に（フランジ単体と同様。2026-07-31 社長要望）
  if (['gate', 'globe', 'ball', 'check', 'strainer'].includes(k) || (k === 'butterfly' && o.style !== 'wafer')) {
    g.userData.boltLocals = flangeBoltRing(cls, sizeA, halfL).concat(flangeBoltRing(cls, sizeA, -halfL));
  }
  // 面間センターの機点（2026-07-19 社長要望：バルブ中心にも起点候補。安全弁は工作点=中心が既にある）
  if (g.userData.faceLocal && g.userData.backLocal && !g.userData.cornerLocal) {
    const midC = g.userData.faceLocal.clone().add(g.userData.backLocal).multiplyScalar(0.5);
    g.userData.extraLocals = g.userData.extraLocals || [];
    if (!g.userData.extraLocals.some(e => e.distanceTo(midC) < 1e-6)) g.userData.extraLocals.push(midC);
  }
  return g;
}
// 端フランジのボルト穴中心（ローカル・フランジ面 y 上）＝バルブ・フレキ等の boltLocals 用（makeFlangeと同じ配置角）
function flangeBoltRing(cls, sizeA, y) {
  const fd = flangeDim(cls, sizeA), bcR = fd.C / 2 / 1000, arr = [];
  for (let i = 0; i < fd.n; i++) {
    const a = (i / fd.n) * Math.PI * 2 + Math.PI / fd.n;
    arr.push(new THREE.Vector3(Math.cos(a) * bcR, y, Math.sin(a) * bcR));
  }
  return arr;
}
// バルブ用：呼び径ドロップダウン表／クランプ
const VALVE_SIZE_TBL = (() => { const t = {}; VALVE_SIZES.forEach(s => t[s] = 1); return t; })();
const SW800_SIZE_TBL = { '15A': 1, '20A': 1, '25A': 1, '32A': 1, '40A': 1, '50A': 1 };
function clampValveSize(tbl) { tbl = tbl || VALVE_SIZE_TBL; return tbl[fittingOpts.sizeA] ? fittingOpts.sizeA : (tbl['50A'] ? '50A' : Object.keys(tbl)[0]); }
function valveSizesFrom(a) { const i = VALVE_SIZES.indexOf(a); return i < 0 ? VALVE_SIZES.slice() : VALVE_SIZES.slice(i); }   // a以上（安全弁の出口=入口以上）
function clampValveOutlet(a) { const c = valveSizesFrom(a); return (VALVE_SIZES.indexOf(fittingOpts.sizeB) >= VALVE_SIZES.indexOf(a)) ? fittingOpts.sizeB : (c[Math.min(1, c.length - 1)] || a); }
// バルブのクラス（圧力区分）。フランジ形は JIS10K/20K/JPI150/300 から選ぶ。SW形は Class800 固定。
//   タイプ(接続形)＝variant とは別軸。現在選択中のクラスは valveOpts.cls に保持し、make() が valveCls() で参照する。
const VALVE_CLASSES = VALVE_RATINGS;
const valveOpts = { cls: 'JIS 10K' };
function valveCls() { return VALVE_RATINGS.includes(valveOpts.cls) ? valveOpts.cls : 'JIS 10K'; }

// ===================================================================
//  機器類  フレキシブル／サイドグラス／PG(圧力計)   2026-07-27 社長要望
//  ・フレキシブル・サイドグラスは両端フランジ形＝バルブとまったく同じ作り
//    （valveEndFlange の規格フランジを流用）。面間は規格表を持たないので
//    パレットの「長さ」(mm)＝フランジ面どうしの距離をそのまま使う。
//  ・PGは圧力計＋サイフォン管。接続はネジ1口だけ（下向き）＝溶接もガスケットも計上しない。
// ===================================================================
const EQUIP_SIZES = VALVE_SIZES;                       // 呼び径はバルブと同じ範囲(15A〜200A)
const EQUIP_RF_H = 0.0018;                             // valveEndFlange のレイズドフェイス高さ(m)と合わせる
const flexOpts  = { sizeA: '50A', cls: 'JIS 10K', length: 200 };
const sightOpts = { sizeA: '50A', cls: 'JIS 10K', length: 150 };
const spoolOpts = { sizeA: '50A', cls: 'JIS 10K', type: 'フランジ', length: 100 };
// 両端フランジを付け、フランジ板の内側の端(y)を返す共通処理
function equipFlangedEnds(g, cls, sizeA, halfL, mat) {
  const f1 = valveEndFlange(cls, sizeA, mat, true); f1.position.y = halfL; g.add(f1);            // ハブ無し＝胴体は自前で作る
  const f2 = valveEndFlange(cls, sizeA, mat, true); f2.position.y = -halfL; f2.rotation.x = Math.PI; g.add(f2);
  // 端フランジのボルト穴＝起点・スナップ対象（バルブと同様。2026-07-31 社長要望）
  g.userData.boltLocals = flangeBoltRing(cls, sizeA, halfL).concat(flangeBoltRing(cls, sizeA, -halfL));
  return halfL - VMM(flangeDim(cls, sizeA).t) - EQUIP_RF_H;                                      // 板の背面＝胴体を伸ばせる位置
}
// 両端フランジ形の機点（＝バルブと同一規約：フェイス=+Y端／背面=-Y端／中央にも起点候補）
function equipConns(g, halfL) {
  const V3 = THREE.Vector3;
  g.userData.faceNormal = new V3(0, 1, 0); g.userData.backNormal = new V3(0, -1, 0);
  g.userData.faceLocal = new V3(0, halfL, 0); g.userData.backLocal = new V3(0, -halfL, 0);
  g.userData.gripLocal = g.userData.faceLocal;
  g.userData.extraLocals = [new V3(0, 0, 0)];          // 面間の中央（バルブと同じく起点候補にする）
}

// 編組（ブレード）の網目テクスチャ。斜めの筋を交差させただけの軽い作り。
// ジオメトリを増やさないので、画面では編み目に見え、印刷（線画）ではただの円筒＝図面が汚れない。
let _braidTexBase = null;
function braidTexture(repeatY) {
  if (!_braidTexBase) {
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d');
    c.fillStyle = '#8a9199'; c.fillRect(0, 0, S, S);
    c.lineWidth = S / 11;
    for (const dir of [1, -1]) {
      c.strokeStyle = dir > 0 ? '#c2c8d0' : '#6c727a';   // 手前の筋を明るく・奥の筋を暗く＝編み込みに見える
      for (let i = -S; i < S * 2; i += S / 5) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + dir * S, S); c.stroke(); }
    }
    _braidTexBase = new THREE.CanvasTexture(cv);
    _braidTexBase.wrapS = _braidTexBase.wrapT = THREE.RepeatWrapping;
  }
  const t = _braidTexBase.clone(); t.needsUpdate = true;   // 部品ごとに繰り返し数を変える（長さに応じて網目の大きさを保つ）
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, repeatY);
  return t;
}
// フレキシブル（ブレード付ホース）。opts={sizeA, cls, length[mm]=フランジ面間}
function makeFlex(opts) {
  const o = Object.assign({ sizeA: '50A', cls: 'JIS 10K', length: 200 }, opts || {});
  const sizeA = EQUIP_SIZES.includes(o.sizeA) ? o.sizeA : '50A';
  const cls = VALVE_RATINGS.includes(o.cls) ? o.cls : 'JIS 10K';
  const len = Math.max(Number(o.length) || 200, 60);         // 短すぎると両端フランジがめり込むので下限60mm
  const halfL = VMM(len) / 2;
  const mat = valveBodyMat();
  const g = new THREE.Group();
  const od = FLG_BORE[sizeA] || 60, rPipe = VMM(od) / 2;
  const yIn = equipFlangedEnds(g, cls, sizeA, halfL, mat);
  // 口金（かしめ）＝フランジ背面から編組へ移る部分。編組はその内側に渡す。
  // 筒はすべて中空にする＝塞ぐとフランジ面がブラインドに見える（2026-07-27 社長指摘）
  const boreR = VMM(od * 0.42);
  const ferL = Math.min(VMM(16 + od * 0.14), Math.max(yIn, 0.001) * 0.42);
  const ferR = rPipe * 1.22, braidR = rPipe * 1.06;
  const fer1 = new THREE.Mesh(ringGeo(ferR, boreR, ferL), mat); fer1.position.y = yIn - ferL / 2; g.add(fer1);
  const fer2 = new THREE.Mesh(ringGeo(ferR, boreR, ferL), mat); fer2.position.y = -yIn + ferL / 2; g.add(fer2);
  const braidMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.62, roughness: 0.40 });
  braidMat.map = braidTexture(Math.min(Math.max(Math.round(VMM(len) / 0.05), 2), 24));   // 50mmに1目盛りぶん
  // 編組は「フタの無い円筒」＝網目のUVを保ったまま中が抜ける
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(braidR, braidR, 2 * (yIn - ferL * 0.6), 28, 1, true), braidMat));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(boreR, boreR, 2 * yIn, 24, 1, true), mat));   // 内側のライナ（ボア壁）
  equipConns(g, halfL);
  g.userData.partType = 'flex';
  g.userData.flex = { sizeA, cls, length: Math.round(len) };
  return g;
}
// 仮管（スプール・詰め物）＝バタフライ弁からハンドルと弁を除いたイメージ（2026-07-31 社長要望）。
// タイプ＝フランジ（両端フランジ＋管外径の胴）／スペーサー（ウエハー形＝座面径の無垢リング・中空ボア）。
// 長さ＝フランジ面間(mm)。フランジ形は両端の板厚＋RFが収まる長さが最短（それ未満は自動で最短へ）。
function spoolMinLen(type, cls, sizeA) {
  if (type === 'スペーサー') return 5;
  const fd = flangeDim(VALVE_RATINGS.includes(cls) ? cls : 'JIS 10K', sizeA || '50A');
  return Math.ceil((fd.t + 1.8) * 2 + 2);   // 板厚＋RF(1.8mm) ×両端 ＋ 胴の最小2mm
}
function makeSpool(opts) {
  const o = Object.assign({ sizeA: '50A', cls: 'JIS 10K', type: 'フランジ', length: 100 }, opts || {});
  const sizeA = EQUIP_SIZES.includes(o.sizeA) ? o.sizeA : '50A';
  const cls = VALVE_RATINGS.includes(o.cls) ? o.cls : 'JIS 10K';
  const type = o.type === 'スペーサー' ? 'スペーサー' : 'フランジ';
  const len = Math.max(Number(o.length) || 100, spoolMinLen(type, cls, sizeA));
  const halfL = VMM(len) / 2;
  const mat = valveBodyMat();
  const g = new THREE.Group();
  const od = FLG_BORE[sizeA] || 60;
  const boreR = VMM(od * 0.42);            // 中空ボア＝フランジ面がブラインドに見えない（バルブと同じ規約）
  if (type === 'フランジ') {
    const yIn = equipFlangedEnds(g, cls, sizeA, halfL, mat);
    if (yIn > 0.0005) g.add(new THREE.Mesh(ringGeo(VMM(od) / 2, boreR, 2 * yIn), mat));   // 胴＝管外径の中空筒
  } else {
    const outR = VMM(rfFaceDia(cls, sizeA) || od * 1.1) / 2;
    g.add(new THREE.Mesh(ringGeo(outR, boreR, 2 * halfL), mat));
  }
  equipConns(g, halfL);
  g.userData.partType = 'spool';
  g.userData.spool = { sizeA, cls, type, length: Math.round(len) };
  return g;
}
// サイドグラス（のぞき窓形）。opts={sizeA, cls, length[mm]=フランジ面間}
// ===== CSG（メッシュのブーリアン演算）＝BSP方式・csg.jsのアルゴリズム（2026-07-29 提案3） =====
// 「本当に穴を開ける」ための道具。まずはサイドグラスののぞき窓に使う（今後：分岐管台・開先など）。
// 提供は A−B（差）のみ。両ジオメトリは同じローカル座標系・閉じた立体で渡すこと。
// 頂点法線は補間して保つ＝曲面の滑らかさが消えない。切り口の面は削る側の面（反転）が残る。
const CSG = (() => {
  const EPS = 1e-6;
  class CVert {
    constructor(pos, normal) { this.pos = pos; this.normal = normal; }
    clone() { return new CVert(this.pos.clone(), this.normal.clone()); }
    flip() { this.normal.negate(); }
    interpolate(o, t) { return new CVert(this.pos.clone().lerp(o.pos, t), this.normal.clone().lerp(o.normal, t)); }
  }
  class CPlane {
    constructor(normal, w) { this.normal = normal; this.w = w; }
    clone() { return new CPlane(this.normal.clone(), this.w); }
    flip() { this.normal.negate(); this.w = -this.w; }
    static fromPoints(a, b, c) {
      const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      return new CPlane(n, n.dot(a));
    }
    splitPolygon(poly, coFront, coBack, front, back) {
      const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
      let type = 0; const types = [];
      for (const v of poly.vertices) {
        const t = this.normal.dot(v.pos) - this.w;
        const ty = (t < -EPS) ? BACK : (t > EPS) ? FRONT : COPLANAR;
        type |= ty; types.push(ty);
      }
      switch (type) {
        case COPLANAR: (this.normal.dot(poly.plane.normal) > 0 ? coFront : coBack).push(poly); break;
        case FRONT: front.push(poly); break;
        case BACK: back.push(poly); break;
        case SPANNING: {
          const f = [], b = [];
          for (let i = 0; i < poly.vertices.length; i++) {
            const j = (i + 1) % poly.vertices.length;
            const ti = types[i], tj = types[j];
            const vi = poly.vertices[i], vj = poly.vertices[j];
            if (ti !== BACK) f.push(vi);
            if (ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);
            if ((ti | tj) === SPANNING) {
              const t = (this.w - this.normal.dot(vi.pos)) / this.normal.dot(vj.pos.clone().sub(vi.pos));
              const v = vi.interpolate(vj, t);
              f.push(v); b.push(v.clone());
            }
          }
          if (f.length >= 3) front.push(new CPoly(f));
          if (b.length >= 3) back.push(new CPoly(b));
          break;
        }
      }
    }
  }
  class CPoly {
    constructor(vertices) { this.vertices = vertices; this.plane = CPlane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos); }
    clone() { return new CPoly(this.vertices.map(v => v.clone())); }
    flip() { this.vertices.reverse().forEach(v => v.flip()); this.plane.flip(); }
  }
  class CNode {
    constructor(polys) { this.plane = null; this.front = null; this.back = null; this.polygons = []; if (polys) this.build(polys); }
    invert() {
      for (const p of this.polygons) p.flip();
      if (this.plane) this.plane.flip();
      if (this.front) this.front.invert();
      if (this.back) this.back.invert();
      const t = this.front; this.front = this.back; this.back = t;
    }
    clipPolygons(polys) {
      if (!this.plane) return polys.slice();
      let front = [], back = [];
      for (const p of polys) this.plane.splitPolygon(p, front, back, front, back);
      if (this.front) front = this.front.clipPolygons(front);
      back = this.back ? this.back.clipPolygons(back) : [];
      return front.concat(back);
    }
    clipTo(bsp) {
      this.polygons = bsp.clipPolygons(this.polygons);
      if (this.front) this.front.clipTo(bsp);
      if (this.back) this.back.clipTo(bsp);
    }
    allPolygons() { let p = this.polygons.slice(); if (this.front) p = p.concat(this.front.allPolygons()); if (this.back) p = p.concat(this.back.allPolygons()); return p; }
    build(polys) {
      if (!polys.length) return;
      if (!this.plane) this.plane = polys[0].plane.clone();
      const front = [], back = [];
      for (const p of polys) this.plane.splitPolygon(p, this.polygons, this.polygons, front, back);
      if (front.length) { if (!this.front) this.front = new CNode(); this.front.build(front); }
      if (back.length) { if (!this.back) this.back = new CNode(); this.back.build(back); }
    }
  }
  function geoToPolys(geo) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position, nor = g.attributes.normal;
    const polys = [];
    for (let i = 0; i < pos.count; i += 3) {
      const vs = [];
      for (let k = 0; k < 3; k++) {
        vs.push(new CVert(new THREE.Vector3().fromBufferAttribute(pos, i + k),
                          nor ? new THREE.Vector3().fromBufferAttribute(nor, i + k) : new THREE.Vector3(0, 1, 0)));
      }
      const ab = vs[1].pos.clone().sub(vs[0].pos), ac = vs[2].pos.clone().sub(vs[0].pos);
      if (ab.cross(ac).lengthSq() < 1e-20) continue;             // 退化三角形は捨てる
      polys.push(new CPoly(vs));
    }
    if (g !== geo) g.dispose();
    return polys;
  }
  function polysToGeo(polys) {
    const pos = [], nor = [];
    for (const p of polys) {
      for (let i = 2; i < p.vertices.length; i++) {              // 扇形分割
        for (const v of [p.vertices[0], p.vertices[i - 1], p.vertices[i]]) {
          pos.push(v.pos.x, v.pos.y, v.pos.z);
          nor.push(v.normal.x, v.normal.y, v.normal.z);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return geo;
  }
  return { geoToPolys, polysToGeo, CNode };
})();
// A−B（差）＝csg.jsの手順どおり。戻り値は新しいBufferGeometry。
function csgSubtractGeo(geoA, geoB) {
  const a = new CSG.CNode(CSG.geoToPolys(geoA));
  const b = new CSG.CNode(CSG.geoToPolys(geoB));
  a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
  a.build(b.allPolygons()); a.invert();
  return CSG.polysToGeo(a.allPolygons());
}
window.__csgSubtractGeo = csgSubtractGeo;   // e2e検証用

function makeSightGlass(opts) {
  const o = Object.assign({ sizeA: '50A', cls: 'JIS 10K', length: 150 }, opts || {});
  const sizeA = EQUIP_SIZES.includes(o.sizeA) ? o.sizeA : '50A';
  const cls = VALVE_RATINGS.includes(o.cls) ? o.cls : 'JIS 10K';
  const len = Math.max(Number(o.length) || 150, 60);
  const halfL = VMM(len) / 2;
  const mat = valveBodyMat(), opMat = valveOpMat();
  const g = new THREE.Group();
  const od = FLG_BORE[sizeA] || 60, rPipe = VMM(od) / 2;
  const yIn = equipFlangedEnds(g, cls, sizeA, halfL, mat);
  const bodyR = rPipe * 1.34;                                  // 金属の胴体
  const boreR = VMM(od * 0.42);
  // 左右(±X)の丸のぞき窓＝CSGで胴体（外壁・内壁とも）へ本当に穴を開ける（2026-07-29 提案3）。
  // 従来は部品を重ねて窓に見せていた＝穴は開いていなかった。実穴なので向こう側が見通せ、印刷の線も正しく出る。
  const winR = Math.min(bodyR * 0.60, Math.max(yIn, 0.001) * 0.70);
  {
    const bodyGeo = ringGeo(bodyR, boreR, 2 * yIn);
    const cutter = new THREE.CylinderGeometry(winR, winR, bodyR * 2 + VMM(10), 28);
    cutter.rotateZ(Math.PI / 2);                               // 軸をXへ＝左右へ貫通
    const holed = csgSubtractGeo(bodyGeo, cutter);
    bodyGeo.dispose(); cutter.dispose();
    const bmat = mat.clone(); bmat.side = THREE.DoubleSide;    // 穴から中が見えるので両面
    const body = new THREE.Mesh(holed, bmat);
    body.name = 'sightBody';                                    // e2e検証用（実穴の確認）
    g.add(body);
  }
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfe4f0, metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.34, side: THREE.DoubleSide });
  for (const sx of [1, -1]) {
    const seat = new THREE.Mesh(ringGeo(winR * 1.30, winR, VMM(7)), mat);                        // 座＝環（実穴を塞がない）
    seat.rotation.z = Math.PI / 2; seat.position.x = sx * bodyR; g.add(seat);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(winR, winR, VMM(8), 28), glassMat);
    glass.rotation.z = Math.PI / 2; glass.position.x = sx * (bodyR + VMM(1.5)); g.add(glass);    // のぞきガラス
    const ring = new THREE.Mesh(new THREE.TorusGeometry(winR * 1.06, winR * 0.10, 8, 26), opMat);
    ring.rotation.y = Math.PI / 2; ring.position.x = sx * (bodyR + VMM(4)); g.add(ring);         // 押え環
    for (let i = 0; i < 6; i++) {                                                                 // 押えボルト
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(winR * 0.10, winR * 0.10, VMM(10), 6), opMat);
      b.rotation.z = Math.PI / 2;
      b.position.set(sx * (bodyR + VMM(2)), Math.cos(a) * winR * 1.22, Math.sin(a) * winR * 1.22);
      g.add(b);
    }
  }
  equipConns(g, halfL);
  g.userData.partType = 'sight';
  g.userData.sight = { sizeA, cls, length: Math.round(len) };
  return g;
}

// ---- PG（圧力計）----
// 呼び径＝文字板の径(Φmm・既定100・数値で調整)／ネジ＝3/4・1/2／サイフォン管＝ON/OFF。
// サイフォン管は「管径＝ネジの呼び径・全長200mm・渦の径100Φ」で固定（2026-07-27 社長指示）。
const PG_THREADS = ['3/4', '1/2'];
const PG_THREAD_OD = { '3/4': 27.2, '1/2': 21.7 };     // ネジの呼びに相当する管外径(mm)＝20A / 15A
const PG_SIPHON_LEN = 200;                              // サイフォン管の全長(mm)
const PG_SIPHON_COIL = 100;                             // 渦の径(mm)
const pgOpts = { dia: 100, thread: '3/4', siphon: true };
function makePG(opts) {
  const V3 = THREE.Vector3;
  const o = Object.assign({ dia: 100, thread: '3/4', siphon: true }, opts || {});
  const dia = Math.min(Math.max(Number(o.dia) || 100, 25), 300);
  const th = PG_THREADS.includes(o.thread) ? o.thread : '3/4';
  const siphon = o.siphon !== false;
  const mat = valveBodyMat(), opMat = valveOpMat();
  const g = new THREE.Group();
  const tR = VMM(PG_THREAD_OD[th]) / 2;                 // 管の外半径＝ネジの呼び径
  const coilR = VMM(PG_SIPHON_COIL) / 2;                // 渦の半径
  const SL = siphon ? VMM(PG_SIPHON_LEN) : VMM(60);     // 接続口から計器取付までの高さ
  // 接続ネジ（六角＋ネジ部）。y=0 が管への当たり面で、そこから上へ伸びる。
  const nutH = VMM(14), nutR = tR * 1.45;
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(nutR, nutR, nutH, 6), opMat);
  nut.position.y = nutH / 2; g.add(nut);
  // 管の芯線：立ち上がり → 90°曲げ → 渦（一周半）→ 90°曲げ → 計器までの立ち上がり。
  // **渦の面は縦**（最初の版と同じ向き。2026-07-27 社長指示「向きは最初の通り縦方向」）。
  // 縦の輪で一周半すると、輪の横（管が真上を向く点）から入ると出口が真下を向いてしまう。
  //   → **輪の下端から入り、上端へ抜ける**ことで解決する。出入口はどちらも横向きなので、
  //     前後に90°の曲げを付けて立ち上がりへ繋ぐ。出口は入口の真上＝計器も取付口の真上に載る。
  // 一周半は半周ぶん自分に重なるので、渦の間だけ奥(Z)へ管1本ぶんずらす。
  // なめらかさの要点＝点の間隔をそろえること。直線部と渦で間隔が違うとCatmullRomが折れる
  //   （2026-07-27 社長指摘「曲がりがなめらかでない」の原因）。約4mm間隔で全体を刻む。
  const STEP = 0.004;
  const pts = [];
  const pushLine = (a, b) => {                          // a→b を等間隔に刻む（aは前段が入れている前提で除く）
    const n = Math.max(1, Math.round(a.distanceTo(b) / STEP));
    for (let i = 1; i <= n; i++) pts.push(a.clone().lerp(b, i / n));
  };
  // XY平面の円弧を等間隔に刻む。中心(cx,cy)・半径r・角度a0→a1、Zはz0→z1へ一様に進む
  const pushArc = (cx, cy, r, a0, a1, z0, z1) => {
    const n = Math.max(3, Math.round(Math.abs(a1 - a0) * r / STEP));
    for (let i = 1; i <= n; i++) {
      const t = i / n, a = a0 + (a1 - a0) * t;
      pts.push(new V3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z0 + (z1 - z0) * t));
    }
  };
  let gx = 0, gz = 0;                                   // 計器を載せる位置（取付口の真上）
  pts.push(new V3(0, 0, 0));
  if (siphon) {
    const rb = VMM(20);                                 // 出入口の曲げ半径
    const top = VMM(30);                                // 渦の上から計器までの立ち上がり
    const y1 = Math.max(VMM(10), SL - 2 * rb - 2 * coilR - top);   // 下の立ち上がり
    const dz = tR * 2.8;                                // 渦が自分に重ならないよう奥へずらす量（管1本ぶん以上あける）
    const yC = y1 + rb;                                 // 渦の下端
    const yT = yC + 2 * coilR;                          // 渦の上端
    pushLine(new V3(0, 0, 0), new V3(0, y1, 0));        // ①立ち上がり
    pushArc(rb, y1, rb, Math.PI, Math.PI / 2, 0, 0);    // ②上向き→+X へ90°
    pushArc(rb, yC + coilR, coilR, -Math.PI / 2, -Math.PI / 2 + 3 * Math.PI, 0, dz);   // ③渦 一周半（下端→上端）
    pushArc(rb, yT + rb, rb, -Math.PI / 2, -Math.PI, dz, dz);                          // ④−X→上向きへ90°
    pushLine(new V3(0, yT + rb, dz), new V3(0, SL, dz));                                // ⑤計器までの立ち上がり
    gz = dz;
  } else {
    pushLine(new V3(0, 0, 0), new V3(0, SL, 0));
  }
  // centromedial(centripetal)＝点の詰まった所でも膨らまない。折れ・行き過ぎが出にくい
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(240, pts.length), tR, 18, false), mat);
  tube.name = 'siphon';       // 検証用（渦の径をこのメッシュだけで測れるようにする）
  g.add(tube);
  const topZ = gz;
  // 計器本体（文字板の軸＝+Z＝バルブのハンドルと同じ向き。部品ごと回して読める向きへ向ける）
  const caseR = VMM(dia) / 2, caseT = VMM(dia) * 0.26;
  const cy = SL + caseR;                                 // ステムは計器の下から入る
  const cas = new THREE.Mesh(new THREE.CylinderGeometry(caseR, caseR, caseT, 40), mat);
  cas.rotation.x = Math.PI / 2; cas.position.set(gx, cy, topZ); g.add(cas);
  // 文字板・ベゼル・指針はケース前面より手前へ重ねる。
  // ※ケース前面と同じ高さに置くとz-fightingで放射状のちらつきが出る（2026-07-27 修正）
  const zF = topZ + caseT / 2;
  const face = new THREE.Mesh(new THREE.CylinderGeometry(caseR * 0.90, caseR * 0.90, VMM(1.2), 36),
    new THREE.MeshStandardMaterial({ color: 0xf2f4f7, metalness: 0.0, roughness: 0.85 }));
  face.rotation.x = Math.PI / 2; face.position.set(gx, cy, zF + VMM(0.8)); g.add(face);       // 文字板
  const bez = new THREE.Mesh(new THREE.TorusGeometry(caseR * 0.96, caseR * 0.055, 10, 40), opMat);
  bez.position.set(gx, cy, zF + VMM(1.0)); g.add(bez);                                        // ベゼル（文字板を押さえる環）
  const nd = new THREE.Mesh(new THREE.BoxGeometry(caseR * 0.055, caseR * 0.78, VMM(1.4)),
    new THREE.MeshStandardMaterial({ color: 0x1e2530, metalness: 0.1, roughness: 0.6 }));
  nd.position.set(gx + caseR * 0.27, cy + caseR * 0.27, zF + VMM(2.4));
  nd.rotation.z = -Math.PI / 4; g.add(nd);                                                   // 指針（右上向き）
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(tR * 0.85, tR * 0.85, caseR * 0.6, 14), opMat);
  stem.position.set(gx, SL + caseR * 0.35, topZ); g.add(stem);                                // 計器の取付ステム
  // 機点＝接続ネジの口だけ（下向き）。キャップと同じく face/back を同位置に置く。
  g.userData.faceLocal = new V3(0, 0, 0); g.userData.backLocal = new V3(0, 0, 0);
  g.userData.faceNormal = new V3(0, -1, 0); g.userData.backNormal = new V3(0, -1, 0);
  g.userData.gripLocal = g.userData.faceLocal;
  g.userData.partType = 'pg';
  g.userData.pg = { dia: Math.round(dia), thread: th, siphon };
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

// ツール定義。継手は「形状ごとに1ツール」へ集約し、L/S・BW/SW・同心/偏心 などの違いは
//   各ツールの variants（＝オプション欄の「タイプ」ドロップダウン）で選ぶ。
//   build() は現在選択中のタイプ（this.curType）の make() を呼ぶ。make は fittingOpts(呼び径/Sch/小径)を参照。
const _swBuild = (kind, hasB) => () => { const a = clampFitSize(SW_SIZE_TBL); return makeSW({ kind, sizeA: a, sizeB: hasB ? swClampSizeB(a) : undefined }); };
const TOOLS = [
  { type: 'flange', name: 'フランジ', build: () => makeFlange(flangeOpts) },
  { type: 'gasket', name: 'ガスケット', build: () => makeGasket(gasketOpts) },
  { type: 'pipe', name: 'パイプ', build: () => makePipe(pipeOpts) },
  { type: 'elbow90', name: '90°エルボ', curType: 'BW(L)', build() { return famVariant(this).make(); }, variants: [
    { t: 'BW(L)', sizes: ELBOW_90L, make: () => makeElbow({ sch: fittingOpts.sch, sizeA: clampFitSize(ELBOW_90L), kind: '90L' }) },
    { t: 'BW(S)', sizes: ELBOW_90S, make: () => makeElbow({ sch: fittingOpts.sch, sizeA: clampFitSize(ELBOW_90S), kind: '90S' }) },
    { t: 'SW', sizes: SW_SIZE_TBL, sw: true, make: _swBuild('90E') } ] },
  { type: 'elbow45', name: '45°エルボ', curType: 'BW(L)', build() { return famVariant(this).make(); }, variants: [
    { t: 'BW(L)', sizes: ELBOW_45L, make: () => makeElbow({ sch: fittingOpts.sch, sizeA: clampFitSize(ELBOW_45L), kind: '45L' }) },
    { t: 'BW(S)', sizes: ELBOW_45S, make: () => makeElbow({ sch: fittingOpts.sch, sizeA: clampFitSize(ELBOW_45S), kind: '45S' }) },
    { t: 'SW', sizes: SW_SIZE_TBL, sw: true, make: _swBuild('45E') } ] },
  { type: 'return180', name: '180°エルボ', curType: 'BW(L)', build() { return famVariant(this).make(); }, variants: [
    { t: 'BW(L)', sizes: RETURN_180L, make: () => makeElbow({ sch: fittingOpts.sch, sizeA: clampFitSize(RETURN_180L), kind: '180L' }) },
    { t: 'BW(S)', sizes: RETURN_180S, make: () => makeElbow({ sch: fittingOpts.sch, sizeA: clampFitSize(RETURN_180S), kind: '180S' }) } ] },
  { type: 'tee', name: 'ティー', curType: 'BW(T)', build() { return famVariant(this).make(); }, variants: [
    { t: 'BW(T)', sizes: TEE_C, make: () => { const a = clampFitSize(TEE_C); return makeTee({ sch: fittingOpts.sch, sizeA: a, sizeB: a }); } },
    { t: 'BW(RT)', sizes: TEE_RT_M, hasB: true, bSizesOf: teeBranchSizes,   // 呼び径・小径とも規格(B16.9/B2312)の組合せのみ
      make: () => { const a = clampFitSize(TEE_RT_M); return makeTee({ sch: fittingOpts.sch, sizeA: a, sizeB: clampTeeSizeB(a) }); } },
    { t: 'SW(T)', sizes: SW_SIZE_TBL, sw: true, make: _swBuild('T') },
    { t: 'SW(RT)', sizes: SW_SIZE_TBL, sw: true, hasB: true, make: _swBuild('TR', true) } ] },
  { type: 'cross', name: 'クロス', curType: 'SW', build() { return famVariant(this).make(); }, variants: [
    { t: 'SW', sizes: SW_SIZE_TBL, sw: true, make: _swBuild('CROSS') } ] },
  { type: 'reducer', name: 'レジューサ', curType: 'BW(C)', build() { return famVariant(this).make(); }, variants: [
    // 呼び径・小径とも規格(B16.9/B2312)の組合せのみ（2026-08-04 社長指示。径違いティーと同じ流儀）
    { t: 'BW(C)', sizes: REDUCER_B, hasB: true, bSizesOf: reducerSizeBs, make: () => { const a = clampFitSize(REDUCER_B); return makeReducer({ sch: fittingOpts.sch, sizeA: a, sizeB: clampReducerSizeB(a), ecc: false }); } },
    { t: 'BW(E)', sizes: REDUCER_B, hasB: true, bSizesOf: reducerSizeBs, make: () => { const a = clampFitSize(REDUCER_B); return makeReducer({ sch: fittingOpts.sch, sizeA: a, sizeB: clampReducerSizeB(a), ecc: true }); } } ] },
  { type: 'cap', name: 'キャップ', curType: 'BW', build() { return famVariant(this).make(); }, variants: [
    { t: 'BW', sizes: CAP_E, make: () => makeCap({ sch: fittingOpts.sch, sizeA: clampFitSize(CAP_E) }) },
    { t: 'SW', sizes: SW_SIZE_TBL, sw: true, make: _swBuild('CAP') } ] },
  { type: 'coupling', name: 'カップリング', curType: 'FC', build() { return famVariant(this).make(); }, variants: [
    { t: 'FC', sizes: SW_SIZE_TBL, sw: true, make: _swBuild('FC') },
    { t: 'HC', sizes: SW_SIZE_TBL, sw: true, make: _swBuild('HC') },
    { t: 'FCR', sizes: SW_SIZE_TBL, sw: true, hasB: true, make: _swBuild('FCR', true) } ] },
  { type: 'boss', name: 'ボス', curType: 'SW', build() { return famVariant(this).make(); }, variants: [
    { t: 'SW', sizes: SW_SIZE_TBL, sw: true, make: _swBuild('BOSS') } ] },
  { type: 'union', name: 'ユニオン', curType: 'SW', build() { return famVariant(this).make(); }, variants: [
    { t: 'SW', sizes: SW_SIZE_TBL, sw: true, make: _swBuild('UNION') } ] },
  // 一般工業用バルブ：タイプ(接続形)＝variant、クラス(圧力区分 JIS10K/20K/JPI150/300)＝optFitClass(valveOpts.cls)。
  //   ボール/ゲート/グローブ/チェッキ/ストレーナー/安全弁＝接続形は1種(タイプ欄なし)。バタフライのみ フランジ/ウエハー の2タイプ。
  //   SW形(800)はクラス=Class800固定で rating を使わない。curType='—' は「タイプ無し」を表す内部値。
  { type: 'vBall', name: 'ボールバルブ', curType: '—', valve: true, vclasses: VALVE_CLASSES, build() { return famVariant(this).make(); }, variants: [
    { t: '—', single: true, sizes: VALVE_SIZE_TBL, noSch: true, make: () => makeValve({ kind: 'ball', sizeA: clampValveSize(), rating: valveCls() }) } ] },
  { type: 'vGate', name: 'ゲートバルブ', curType: '—', valve: true, vclasses: VALVE_CLASSES, build() { return famVariant(this).make(); }, variants: [
    { t: '—', single: true, sizes: VALVE_SIZE_TBL, noSch: true, make: () => makeValve({ kind: 'gate', sizeA: clampValveSize(), rating: valveCls() }) } ] },
  { type: 'vGlobe', name: 'グローブバルブ', curType: '—', valve: true, vclasses: VALVE_CLASSES, build() { return famVariant(this).make(); }, variants: [
    { t: '—', single: true, sizes: VALVE_SIZE_TBL, noSch: true, make: () => makeValve({ kind: 'globe', sizeA: clampValveSize(), rating: valveCls() }) } ] },
  { type: 'vCheck', name: 'チェッキバルブ', curType: '—', valve: true, vclasses: VALVE_CLASSES, build() { return famVariant(this).make(); }, variants: [
    { t: '—', single: true, sizes: VALVE_SIZE_TBL, noSch: true, make: () => makeValve({ kind: 'check', sizeA: clampValveSize(), rating: valveCls() }) } ] },
  { type: 'vStrainer', name: 'ストレーナー(Y)', curType: '—', valve: true, vclasses: VALVE_CLASSES, build() { return famVariant(this).make(); }, variants: [
    { t: '—', single: true, sizes: VALVE_SIZE_TBL, noSch: true, make: () => makeValve({ kind: 'strainer', sizeA: clampValveSize(), rating: valveCls() }) } ] },
  { type: 'vButterfly', name: 'バタフライバルブ', curType: 'フランジ', valve: true, vclasses: VALVE_CLASSES, build() { return famVariant(this).make(); }, variants: [
    { t: 'フランジ', sizes: VALVE_SIZE_TBL, noSch: true, make: () => makeValve({ kind: 'butterfly', sizeA: clampValveSize(), rating: valveCls(), style: 'flange' }) },
    { t: 'ウエハー', sizes: VALVE_SIZE_TBL, noSch: true, make: () => makeValve({ kind: 'butterfly', sizeA: clampValveSize(), rating: valveCls(), style: 'wafer' }) } ] },
  { type: 'vSafety', name: '安全弁(アングル)', curType: '—', valve: true, vclasses: VALVE_CLASSES, build() { return famVariant(this).make(); }, variants: [
    { t: '—', single: true, sizes: VALVE_SIZE_TBL, noSch: true, hasB: true, bLarger: true, bLabel: '出口',
      make: () => { const a = clampValveSize(); return makeValve({ kind: 'safety', sizeA: a, sizeB: clampValveOutlet(a), rating: valveCls() }); } } ] },
  // 鍛造SW形(Class800)の小型弁は「コンパクトバルブ」1つにまとめ、タイプでゲート／グローブを選ぶ
  //（2026-07-27 社長要望）。保存される種別(userData.valve.kind)は従来どおり swgate / swglobe なので、
  //  過去の図面もそのまま開ける。
  { type: 'vCompact', name: 'コンパクトバルブ', curType: 'ゲート', valve: true, vclasses: ['Class800'], build() { return famVariant(this).make(); }, variants: [
    { t: 'ゲート',   sizes: SW800_SIZE_TBL, noSch: true, make: () => makeValve({ kind: 'swgate', sizeA: clampValveSize(SW800_SIZE_TBL) }) },
    { t: 'グローブ', sizes: SW800_SIZE_TBL, noSch: true, make: () => makeValve({ kind: 'swglobe', sizeA: clampValveSize(SW800_SIZE_TBL) }) } ] },
  // 機器類（2026-07-27 社長要望）。継手・バルブの variant 方式ではなく専用のオプション欄を持つ。
  { type: 'flex',  name: 'フレキシブル', equip: true, build: () => makeFlex(flexOpts) },
  { type: 'sight', name: 'サイドグラス', equip: true, build: () => makeSightGlass(sightOpts) },
  { type: 'spool', name: '仮管',         equip: true, build: () => makeSpool(spoolOpts) },
  { type: 'pg',    name: 'PG(圧力計)',   build: () => makePG(pgOpts) },
];
// 両端フランジ形の機器（フレキシブル・サイドグラス・仮管）＝呼び径・クラス・長さの共用オプション欄を使う
const EQUIP_TYPES = ['flex', 'sight', 'spool'];
function equipOptsOf(type) { return type === 'sight' ? sightOpts : type === 'spool' ? spoolOpts : flexOpts; }
// 突合せ溶接継手ツールか（パイプ・フランジ以外）／ツール検索／現在選択中のタイプ(variant)
function isFittingType(type) { return type !== 'flange' && type !== 'pipe'; }
function toolByType(type) { return TOOLS.find(t => t.type === type); }
function famVariant(fam) { return (fam.variants && (fam.variants.find(v => v.t === fam.curType) || fam.variants[0])) || null; }
// sizeB(小径/枝径)を sizeA 未満（最大でも一段小さい）にクランプ。fittingOpts.sizeB を尊重しつつ範囲内へ。
function clampSizeB(sizeA) {
  const cand = sizesUpTo(sizeA).slice(0, -1);     // sizeA より小さい呼び径のみ
  if (!cand.length) return sizeA;                 // 最小径なら同径扱い
  return cand.includes(fittingOpts.sizeB) ? fittingOpts.sizeB : cand[cand.length - 1];
}
// レジューサの小径＝規格の組合せ(REDUCER_B)のみ（表に無ければ一段落ちの径へ）
function clampReducerSizeB(sizeA) {
  const cand = reducerSizeBs(sizeA);
  if (!cand.length) return sizeA;
  return cand.includes(fittingOpts.sizeB) ? fittingOpts.sizeB : cand[cand.length - 1];
}

// ===================================================================
//  ツールパレットの3Dサムネイル（各タイルで部品がゆっくり回る）
// ===================================================================
const palThumbs = [];
// サムネイル共用の単一WebGLレンダラ。※タイル毎にWebGLRendererを作るとGLコンテキスト数が
//   ブラウザ上限(約16)を超え、古いコンテキスト(本体ビュー含む)が破棄され画面が白くなる。
//   1つの共用レンダラで各シーンを描き、結果を各タイルの2Dキャンバスへ転写(drawImage)する。
let palRenderer = null;
const PAL_W = 128, PAL_H = 96, PAL_SS = 2;   // タイル表示寸法。PAL_SS=スーパーサンプル(2倍描画→縮小転写で鮮明に)
(function buildPalette() {
  const host = document.getElementById('palItems');
  if (!host) return;
  try {
    palRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    palRenderer.setPixelRatio(1);
    palRenderer.setSize(PAL_W * PAL_SS, PAL_H * PAL_SS, false);
  } catch (err) { console.error('palette renderer init error:', err); }
  // 本編と同じ環境マップをパレット用レンダラでも生成（PMREMはレンダラ専用のため共有できない）
  let _palEnv = null;
  try { if (palRenderer) _palEnv = makeEnvMapFor(palRenderer); } catch (e) { _palEnv = null; }
  TOOLS.forEach(tool => {
    const tile = document.createElement('div');
    tile.className = 'pal-tile';
    tile.dataset.type = tool.type;
    const cv = document.createElement('canvas');
    cv.width = PAL_W; cv.height = PAL_H;
    const ctx = cv.getContext('2d');   // 共用レンダラの描画結果をここへ転写
    tile.appendChild(cv);              // 部品名はドロップダウンに表示するためタイル内には出さない
    host.appendChild(tile);

    // クリックで追従開始（アイテムがマウスについてくる）→ 3D空間でクリックして設置。
    // 同じタイルをもう一度クリックすると追従解除。ドラッグ不要。
    tile.addEventListener('click', e => {
      if (followTool && followTool.tool === tool) { stopFollow(); return; }
      startFollow(tool, tile, e.clientX, e.clientY);
    });

    const tScene = new THREE.Scene();
    // 本編と同じ照明・環境マップ＝パレットの色味を配置後の実物と揃える（2026-07-30 社長指摘）
    tScene.environment = _palEnv;
    tScene.add(new THREE.AmbientLight(0xffffff, 0.16));
    tScene.add(new THREE.HemisphereLight(0xf2f6ff, 0x434b59, 0.22));
    const tl = new THREE.DirectionalLight(0xffffff, 1.05); tl.position.set(8, 12, 6); tScene.add(tl);
    const tl2 = new THREE.DirectionalLight(0x88aaff, 0.3); tl2.position.set(-8, 4, -6); tScene.add(tl2);
    const tl3 = new THREE.DirectionalLight(0xffffff, 0.28); tl3.position.set(2, -6, -9); tScene.add(tl3);
    const tCam = new THREE.PerspectiveCamera(38, PAL_W / PAL_H, 0.01, 10);
    tCam.position.set(0.32, 0.4, 0.5); tCam.lookAt(0, 0, 0);   // 斜め見下ろし（画像の角度）
    const pivot = new THREE.Group();     // 縦表示＋サイズ正規化の入れ物
    tScene.add(pivot);

    // サムネイルの中身を作り直す（口径などが変わっても枠に収める）
    function rebuildThumb() {
      while (pivot.children.length) {
        const c = pivot.children.pop();
        c.traverse && c.traverse(n => { if (n.geometry) n.geometry.dispose(); });
      }
      const obj = tool.build();
      // パレットの絵は「置いたときの形」に合わせる（2026-07-27 社長要望）。
      // ※このIIFEは読み込み途中に走るため、向きの表(DIR_QUATS)がまだ未初期化のことがある。
      //   その時は仮の向きで描き、読み込み完了後の refreshThumbs() で本来の姿勢に描き直される。
      try { const p = defaultPose(tool); orientRotation(obj, p.dir, p.roll); }
      catch (e) { obj.rotation.z = Math.PI / 2; }
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
    palThumbs.push({ scene: tScene, cam: tCam, cv, ctx, obj: pivot, tool, tile, rebuild: rebuildThumb });
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

// ---- 面間寸法の表示（パレット下部・2026-07-14 社長要望） ----
// 現在の仕様で部品を仮生成し、機点間の距離を実測して表示する（ジオメトリはJIS寸法表由来なので実寸と一致）。
// エルボ・ティー＝中心-面（枝があれば中心-枝も）／フランジ＝面-背面／バルブ・継手＝面間／パイプ＝長さと同値。
function updateF2F() {
  const el = document.getElementById('palF2F');
  if (!el) return;
  const sel = document.getElementById('partSelect');
  const tool = sel && sel.value ? toolByType(sel.value) : null;
  const lines = [];
  if (tool) {
    let obj = null;
    try { obj = tool.build(); } catch (err) { obj = null; }
    if (obj) {
      computeConns(obj);
      const u = obj.userData;
      const mm1 = v => { const t = (v * 1000).toFixed(1); return t.endsWith('.0') ? t.slice(0, -2) : t; };   // 小数第一位まで・.0は省略（2026-07-19 社長要望）
      if (u.partType === 'gasket') {
        lines.push(`厚み ${mm1(u.faceLocal.distanceTo(u.backLocal))}mm`);
      } else if (u.partType === 'pg') {
        // PGは接続口が1つ＝面間が無い。取付面からの全高と、サイフォン管の有無を出す。
        const h = new THREE.Box3().setFromObject(obj).max.y;
        lines.push(`全高 ${mm1(h)}mm`);
        lines.push(u.pg && u.pg.siphon === false ? 'サイフォン管なし' : `サイフォン管 ${PG_SIPHON_LEN}mm・渦${PG_SIPHON_COIL}Φ`);
      } else if (u.partType === 'pipe') {
        // パイプは直径（外径）を表示。ジオメトリの管軸に直交する断面幅＝JIS外径そのもの
        const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
        const ax = u.faceLocal.clone().sub(u.backLocal);
        const dom = (Math.abs(ax.x) >= Math.abs(ax.y) && Math.abs(ax.x) >= Math.abs(ax.z)) ? 'x'
                  : (Math.abs(ax.y) >= Math.abs(ax.z)) ? 'y' : 'z';
        const lat = ['x', 'y', 'z'].filter(k => k !== dom).map(k => size[k]);
        lines.push(`外径 ${mm1(Math.max(lat[0], lat[1]))}mm`);
      } else if (u.cornerLocal && u.faceLocal) {
        lines.push(`中心-面 ${mm1(u.cornerLocal.distanceTo(u.faceLocal))}mm`);
        if (u.extraLocals && u.extraLocals[0]) {
          const bd = u.cornerLocal.distanceTo(u.extraLocals[0]);
          if (bd * 1000 > 1) lines.push(`中心-枝 ${mm1(bd)}mm`);   // 中心と同位置のダミー機点（エルボ等）は出さない
        }
      } else if (u.faceLocal && u.backLocal) {
        lines.push(`${u.partType === 'flange' ? '面-背面' : '面間'} ${mm1(u.faceLocal.distanceTo(u.backLocal))}mm`);
      } else if (u.faceLocal && u.extraLocals && u.extraLocals[0]) {
        lines.push(`面-出口 ${mm1(u.faceLocal.distanceTo(u.extraLocals[0]))}mm`);
      }
      obj.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material && n.material.dispose) n.material.dispose(); });
    }
  }
  el.textContent = lines.length ? lines.join('\n') : '面間 —';   // 2値（ティー等）は2段表示（CSS: pre-line）
}
// 仕様変更時にサムネイルを作り直す（全部品）
function refreshThumbs() {
  palThumbs.forEach(t => t.rebuild());
  updateF2F();   // 仕様が変われば面間表示も更新
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
  rebuildRdfSizeOptions();
  updateOptVisibility();
}
// レジューシングの小径＝大径より小さい呼び径だけ並べる
function rebuildRdfSizeOptions() {
  const el = document.getElementById('optRdfSize'); if (!el) return;
  const all = flangeAvailableSizes(flangeOpts.cls, flangeOpts.type);
  const idx = all.indexOf(flangeOpts.sizeA);
  const list = (idx > 0 ? all.slice(0, idx) : all.filter(x => x !== flangeOpts.sizeA));
  const cur = list.includes(flangeOpts.sizeB) ? flangeOpts.sizeB : list[list.length - 1];
  flangeOpts.sizeB = cur || flangeOpts.sizeA;
  while (el.options.length) el.remove(0);
  for (const sname of list) el.add(new Option(sname, sname));
  if (cur) el.value = cur;
  const ee = document.getElementById('optEcc'); if (ee) ee.value = flangeOpts.ecc ? '1' : '0';
}

// 欄の表示／非表示・有効無効（タイプで出し分け）
function updateOptVisibility() {
  // スケジュール欄：WN・SW・LJ（LJはドッキングするスタブエンドの肉厚）で表示
  const isRDF = flangeOpts.type === 'RDF';
  const rw = document.getElementById('optRdfWrap'); if (rw) rw.style.display = isRDF ? '' : 'none';
  const ew = document.getElementById('optEccWrap'); if (ew) ew.style.display = isRDF ? '' : 'none';
  // 枚数（片／合い）＝ブラインド・レジューシングは1枚もので使うので出さない（2026-08-03 社長指示）
  const pw = document.getElementById('optPair');
  const pwLab = pw && pw.closest('label');
  if (pwLab) pwLab.style.display = (isRDF || flangeOpts.type === 'BL') ? 'none' : '';
  if (pw && (isRDF || flangeOpts.type === 'BL')) { pw.value = '1'; flangeOpts.pair = '1'; }
  const schOn = (flangeOpts.type === 'WN' || flangeOpts.type === 'SW' || flangeOpts.type === 'LJ');   // RDFは板に穴だけ＝Sch不要
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
  if (srcId === 'optType' || srcId === 'optSize' || srcId === 'optClass') rebuildRdfSizeOptions();
  const sb = v('optRdfSize'); if (sb) o.sizeB = sb;
  const ec = v('optEcc'); if (ec != null) o.ecc = (ec === '1');
  updateOptVisibility();
  refreshThumbs();
  // パレットの変更は配置済みへは効かせない（2026-07-29 社長指示。仕様変更はプロパティで）
}

// ---- パイプのオプションUI（呼び径・Sch・長さ mm） ----
function buildPipeOptions() {
  fillSelect('optPipeSize', FLANGE_SIZES, pipeOpts.sizeA);
  fillSelect('optPipeSch', PIPE_SCHEDULES, pipeOpts.sch);
  // 長さは小数第一位まで・.0は省略（2026-07-19 社長要望。端ドラッグ伸縮後の選択でfloat誤差の長い端数が出ていた）
  const len = document.getElementById('optPipeLen'); if (len) len.value = +(+pipeOpts.length).toFixed(1);
}
function onPipeOptChange() {
  const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  pipeOpts.sizeA = v('optPipeSize');
  pipeOpts.sch = v('optPipeSch');
  const len = parseFloat(v('optPipeLen')); pipeOpts.length = (len > 0 ? len : 1000);
  refreshThumbs();
  // パレットの変更は配置済みへは効かせない（2026-07-29 社長指示）
}
['optPipeSize', 'optPipeSch', 'optPipeLen'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', onPipeOptChange);
});

// ---- ガスケットのオプションUI（呼び径・クラス・厚み[mm・既定3]） ----
function buildGasketOptions() {
  fillSelect('optGskClass', Object.keys(RF_FACE_DIA), gasketOpts.cls);
  const sizes = SIZE_ORDER.filter(s => rfFaceDia(gasketOpts.cls, s) != null);   // クラスの座面径表にあるサイズのみ
  if (!sizes.includes(gasketOpts.sizeA)) gasketOpts.sizeA = sizes.includes('25A') ? '25A' : sizes[0];
  fillSelect('optGskSize', sizes, gasketOpts.sizeA);
  const t = document.getElementById('optGskT'); if (t) t.value = gasketOpts.t;
}
function onGasketOptChange() {
  const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  gasketOpts.sizeA = v('optGskSize') || gasketOpts.sizeA;
  gasketOpts.cls = v('optGskClass') || gasketOpts.cls;
  const tt = parseFloat(v('optGskT'));
  gasketOpts.t = (tt > 0) ? tt : 3;                 // 不正値は既定3mmへ
  buildGasketOptions();                              // クラス変更でサイズ一覧を組み直し
  refreshThumbs();
  // パレットの変更は配置済みへは効かせない（2026-07-29 社長指示）
}
['optGskSize', 'optGskClass', 'optGskT'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', onGasketOptChange);
});

// ---- 機器類のオプションUI ----
// フレキシブル／サイドグラス＝呼び径・クラス・長さ（1枚のパネルを共用し、値は種別ごとに持つ）
let activeEquipType = 'flex';
function buildEquipOptions() {
  const o = equipOptsOf(activeEquipType);
  const tw = document.getElementById('optEqTypeWrap');
  if (tw) tw.style.display = activeEquipType === 'spool' ? '' : 'none';   // タイプ欄＝仮管だけ
  if (activeEquipType === 'spool') fillSelect('optEqType', ['フランジ', 'スペーサー'], o.type);
  fillSelect('optEqClass', VALVE_RATINGS, o.cls);
  fillSelect('optEqSize', EQUIP_SIZES, o.sizeA);
  const el = document.getElementById('optEqLen'); if (el) el.value = o.length;
}
function onEquipOptChange() {
  const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  const o = equipOptsOf(activeEquipType);
  o.sizeA = v('optEqSize') || o.sizeA;
  o.cls = v('optEqClass') || o.cls;
  if (activeEquipType === 'spool') o.type = v('optEqType') || o.type;
  const L = parseFloat(v('optEqLen'));
  // 短すぎると両端フランジがめり込む（仮管フランジ形＝板厚×2が最短・スペーサーは5mmまで）
  const min = activeEquipType === 'spool' ? spoolMinLen(o.type, o.cls, o.sizeA) : 60;
  o.length = (L >= min) ? Math.round(L) : min;
  buildEquipOptions();
  refreshThumbs();
}
['optEqSize', 'optEqClass', 'optEqLen', 'optEqType'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', onEquipOptChange);
});
// PG＝呼び径(文字板の径Φ・数値)・ネジ・サイフォン管
function buildPgOptions() {
  fillSelect('optPgThread', PG_THREADS, pgOpts.thread);
  const d = document.getElementById('optPgDia'); if (d) d.value = pgOpts.dia;
  const s = document.getElementById('optPgSiphon'); if (s) s.checked = pgOpts.siphon !== false;
}
function onPgOptChange() {
  const el = id => document.getElementById(id);
  const d = parseFloat(el('optPgDia') ? el('optPgDia').value : NaN);
  pgOpts.dia = (d >= 25 && d <= 300) ? Math.round(d) : 100;
  pgOpts.thread = (el('optPgThread') && PG_THREADS.includes(el('optPgThread').value)) ? el('optPgThread').value : pgOpts.thread;
  pgOpts.siphon = el('optPgSiphon') ? !!el('optPgSiphon').checked : true;
  buildPgOptions();
  refreshThumbs();
}
['optPgDia', 'optPgThread', 'optPgSiphon'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', onPgOptChange);
});

// ---- 継手（エルボ・ティー・レジューサ・キャップ・カップリング等）のオプションUI ----
// 「タイプ」ドロップダウン(optFitType)＝その形状の variant（BW(L)/BW(S)/SW/同心偏心 等）。
let activeFittingType = 'elbow90';
function rebuildFittingSize() {
  const tool = toolByType(activeFittingType);
  if (!tool || !tool.variants) return;
  const variant = famVariant(tool);
  const isSW = !!(variant && variant.sw);
  // タイプ(variant)ドロップダウン
  fillSelect('optFitType', tool.variants.map(v => v.t), tool.curType);
  const isValve = !!tool.valve;
  // タイプ欄：継手は常時表示。バルブは接続形が複数ある時だけ表示（ボール/ゲート等は1種=タイプ無しなので隠す）
  const typeWrap = document.getElementById('optFitTypeWrap');
  if (typeWrap) typeWrap.style.display = (!isValve || tool.variants.length > 1) ? '' : 'none';
  // クラス欄：バルブのみ表示（圧力区分 JIS10K/20K/JPI150/300、SW形は Class800 固定）
  const clsWrap = document.getElementById('optFitClassWrap');
  if (clsWrap) clsWrap.style.display = isValve ? '' : 'none';
  if (isValve) {
    const classes = tool.vclasses || VALVE_CLASSES;
    // 多クラス(JIS/JPI)valveへ切替時、現在クラスが範囲外なら先頭へ。SW形(Class800固定)では valveOpts.cls を汚さない
    if (!classes.includes(valveOpts.cls) && VALVE_RATINGS.includes(classes[0])) valveOpts.cls = classes[0];
    fillSelect('optFitClass', classes, classes.includes(valveOpts.cls) ? valveOpts.cls : classes[0]);
  }
  // 呼び径：選択中タイプの規格表に合わせる
  const sizes = Object.keys(variant.sizes);
  if (!sizes.includes(fittingOpts.sizeA)) fittingOpts.sizeA = sizes.includes('25A') ? '25A' : (sizes.includes('50A') ? '50A' : sizes[0]);
  fillSelect('optFitSize', sizes, fittingOpts.sizeA);
  // Sch：SWは Sch80 固定、バルブ(noSch)は非表示、BWは選択式
  const noSch = !!(variant && variant.noSch);
  const schWrap = document.getElementById('optFitSchWrap');
  if (schWrap) schWrap.style.display = noSch ? 'none' : '';
  if (!noSch) {
    if (!isSW && !FITTING_SCHEDULES.includes(fittingOpts.sch)) fittingOpts.sch = 'Sch10S';
    fillSelect('optFitSch', isSW ? ['Sch80'] : FITTING_SCHEDULES, isSW ? 'Sch80' : fittingOpts.sch);
  }
  // 第2サイズ(sizeB)欄：径違い(hasB)のみ表示。bLarger=安全弁の出口(入口以上)、それ以外は小径(sizeA未満)
  const bWrap = document.getElementById('optFitSizeBWrap');
  const hasB = !!(variant && variant.hasB);
  if (bWrap) bWrap.style.display = hasB ? '' : 'none';
  const bLab = document.getElementById('optFitSizeBLabel');
  if (bLab) bLab.textContent = (variant && variant.bLabel) || '小径';
  if (hasB) {
    let bSizes;
    if (variant.bSizesOf) bSizes = variant.bSizesOf(fittingOpts.sizeA);                                   // 規格の組合せ表から（径違いティー等）
    else if (variant.bLarger) bSizes = valveSizesFrom(fittingOpts.sizeA);                                 // sizeA 以上（出口）
    else bSizes = (isSW ? swSizesUpTo(fittingOpts.sizeA) : sizesUpTo(fittingOpts.sizeA)).slice(0, -1);     // sizeA 未満（小径）
    if (!bSizes.length) { fillSelect('optFitSizeB', [fittingOpts.sizeA], fittingOpts.sizeA); fittingOpts.sizeB = fittingOpts.sizeA; }
    else { if (!bSizes.includes(fittingOpts.sizeB)) fittingOpts.sizeB = variant.bLarger ? (bSizes[Math.min(1, bSizes.length - 1)] || bSizes[0]) : bSizes[bSizes.length - 1]; fillSelect('optFitSizeB', bSizes, fittingOpts.sizeB); }
  }
}
function onFitOptChange() {
  const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  const tool = toolByType(activeFittingType);
  const t = v('optFitType'); if (t !== undefined && tool) tool.curType = t;   // タイプ＝variant を記憶（形状ごと）
  fittingOpts.sizeA = v('optFitSize');
  fittingOpts.sch = v('optFitSch');
  const b = v('optFitSizeB'); if (b !== undefined) fittingOpts.sizeB = b;
  const cl = v('optFitClass'); if (cl !== undefined && VALVE_RATINGS.includes(cl)) valveOpts.cls = cl;   // クラスは多クラスvalveのみ記憶（Class800は無視）
  rebuildFittingSize();   // タイプ/クラス/sizeA 変更で 呼び径/Sch/sizeB 候補が変わるため作り直し
  refreshThumbs();
  // パレットの変更は配置済みへは効かせない（2026-07-29 社長指示）
}
['optFitType', 'optFitClass', 'optFitSize', 'optFitSch', 'optFitSizeB'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', onFitOptChange);
});

// 部品種別に応じてオプションパネルを出し分け（フランジ／ガスケット／パイプ／機器類／継手）
function setActivePartType(type) {
  const fl = document.getElementById('flangeOptsUI');
  const gk = document.getElementById('gasketOptsUI');
  const pi = document.getElementById('pipeOptsUI');
  const fi = document.getElementById('fittingOptsUI');
  const eq = document.getElementById('eqOptsUI');
  const pg = document.getElementById('pgOptsUI');
  const isPipe = (type === 'pipe');
  const isFlange = (type === 'flange');
  const isGasket = (type === 'gasket');
  const isEquip = EQUIP_TYPES.includes(type);      // フレキシブル・サイドグラス
  const isPG = (type === 'pg');
  // 継手・バルブ（variant方式）＝専用UIを持つ種別を除いた残り
  const fitting = isFittingType(type) && !isFlange && !isGasket && !isEquip && !isPG;
  if (fl) fl.style.display = isFlange ? '' : 'none';
  if (gk) gk.style.display = isGasket ? '' : 'none';
  if (pi) pi.style.display = isPipe ? '' : 'none';
  if (eq) eq.style.display = isEquip ? '' : 'none';
  if (pg) pg.style.display = isPG ? '' : 'none';
  if (fi) fi.style.display = (fitting && !isPipe) ? '' : 'none';
  if (isEquip) { activeEquipType = type; buildEquipOptions(); }
  if (isPG) buildPgOptions();
  if (fitting && !isPipe) { activeFittingType = type; rebuildFittingSize(); }
  updateF2F();   // 種別切替でも面間表示を更新
}

// ===================================================================
//  配置済み部品の仕様編集（2026-07-12 社長要望）
//  部品を選択するとパレットがその部品の種別・仕様に切り替わり、
//  パレットのオプション（タイプ/呼び径/クラス/Sch/長さ等）を変えると
//  選択中の部品がその場で同じ位置・向きのまま作り替えられる。
// ===================================================================
// 配置済み部品 → パレット種別（TOOLSのtype）。partTypeRank と同じ対応表。
function toolTypeOfPart(p) {
  const u = p && p.userData; if (!u) return null;
  if (u.partType === 'elbow') {
    const k = (u.elbow && u.elbow.kind) || '';
    return k.startsWith('45') ? 'elbow45' : (k.startsWith('180') ? 'return180' : 'elbow90');
  }
  if (u.partType === 'sw') {
    const k = (u.sw && u.sw.kind) || '';
    return ({ '90E': 'elbow90', '45E': 'elbow45', 'T': 'tee', 'TR': 'tee', 'CROSS': 'cross', 'FC': 'coupling', 'HC': 'coupling', 'FCR': 'coupling', 'BOSS': 'boss', 'CAP': 'cap', 'UNION': 'union' })[k] || null;
  }
  if (u.partType === 'valve') {
    const k = (u.valve && u.valve.kind) || '';
    return ({ ball: 'vBall', gate: 'vGate', globe: 'vGlobe', check: 'vCheck', strainer: 'vStrainer', butterfly: 'vButterfly', safety: 'vSafety', swgate: 'vCompact', swglobe: 'vCompact' })[k] || null;
  }
  return ({ flange: 'flange', gasket: 'gasket', pipe: 'pipe', tee: 'tee', reducer: 'reducer', cap: 'cap',
            flex: 'flex', sight: 'sight', spool: 'spool', pg: 'pg' })[u.partType] || null;
}
// 配置済み部品 → タイプ欄(variantのt)。partColumns と同じ対応。該当なし(フランジ/パイプ等)は null。
function variantTOfPart(p) {
  const u = p.userData;
  if (u.partType === 'elbow') return ((u.elbow && u.elbow.kind) || '').endsWith('S') ? 'BW(S)' : 'BW(L)';
  if (u.partType === 'tee') return (u.tee && u.tee.sizeB && u.tee.sizeB !== u.tee.sizeA) ? 'BW(RT)' : 'BW(T)';
  if (u.partType === 'reducer') return (u.reducer && u.reducer.ecc) ? 'BW(E)' : 'BW(C)';
  if (u.partType === 'cap') return 'BW';
  if (u.partType === 'sw') return ({ FC: 'FC', HC: 'HC', FCR: 'FCR', T: 'SW(T)', TR: 'SW(RT)', '90E': 'SW', '45E': 'SW', CROSS: 'SW', BOSS: 'SW', CAP: 'SW', UNION: 'SW' })[(u.sw && u.sw.kind) || ''] || 'SW';
  if (u.partType === 'valve' && u.valve && u.valve.kind === 'butterfly') return u.valve.style === 'wafer' ? 'ウエハー' : 'フランジ';
  // コンパクトバルブ（Class800のSW形）＝タイプでゲート／グローブを選ぶ
  if (u.partType === 'valve' && u.valve && u.valve.kind === 'swgate') return 'ゲート';
  if (u.partType === 'valve' && u.valve && u.valve.kind === 'swglobe') return 'グローブ';
  return null;
}
let _syncingPalette = false;   // 選択→パレット反映中は「パレット→部品」の適用を抑止（多重・逆流防止）
// 選択した配置済み部品の仕様をパレットへ映す
function syncPaletteToPart(p) {
  if (!p || !p.userData || !p.userData.placed) return;
  const t = toolTypeOfPart(p); if (!t) return;
  const u = p.userData;
  _syncingPalette = true;
  try {
    if (u.partType === 'flange') {
      Object.assign(flangeOpts, u.flange || {});
      syncOptionsUI();                              // タイプ/クラス相互整合＋各欄へ値を反映
    } else if (u.partType === 'gasket') {
      Object.assign(gasketOpts, u.gasket || {});
      buildGasketOptions();
    } else if (u.partType === 'pipe') {
      Object.assign(pipeOpts, u.pipe || {});
      buildPipeOptions();
    } else if (u.partType === 'flex' || u.partType === 'sight' || u.partType === 'spool') {
      activeEquipType = u.partType;
      Object.assign(equipOptsOf(u.partType), u[u.partType] || {});
      buildEquipOptions();
    } else if (u.partType === 'pg') {
      Object.assign(pgOpts, u.pg || {});
      buildPgOptions();
    } else {
      const tool = toolByType(t);
      const vt = variantTOfPart(p);
      if (tool && vt && tool.variants && tool.variants.some(v => v.t === vt)) tool.curType = vt;
      if (u.partType === 'valve') {
        if (u.valve.sizeA) fittingOpts.sizeA = u.valve.sizeA;
        if (u.valve.sizeB) fittingOpts.sizeB = u.valve.sizeB;
        if (u.valve.rating && VALVE_RATINGS.includes(u.valve.rating)) valveOpts.cls = u.valve.rating;
      } else {
        const spec = u[u.partType];                 // elbow/tee/reducer/cap/sw
        if (spec) {
          if (spec.sizeA) fittingOpts.sizeA = spec.sizeA;
          if (spec.sizeB) fittingOpts.sizeB = spec.sizeB;
          if (spec.sch && spec.sch !== 'Sch80') fittingOpts.sch = spec.sch;   // SWのSch80固定値でBW用Schを汚さない
        }
      }
    }
    setActivePart(t);                               // 種別ドロップダウン・タイル・オプション欄を切替（継手系は値も反映）
    refreshThumbs();
  } finally { _syncingPalette = false; }
}
// パレットの現オプションで、選択中の配置済み部品を作り替える（位置・向き・材質・グループを保持）
function applyPaletteToSelected() {
  if (_syncingPalette) return;
  const p = selectedPart;
  if (!p || !p.userData || !p.userData.placed || selectedParts.size !== 1) return;
  const sel = document.getElementById('partSelect');
  const t = sel ? sel.value : null;
  if (!t || t !== toolTypeOfPart(p)) return;        // パレットが選択部品と同じ種別の時だけ適用
  const tool = toolByType(t); if (!tool) return;
  const obj = tool.build(); if (!obj) return;
  computeConns(obj);
  // フェイス（起点）位置を保って差し替え：サイズが変わっても接続基準の機点がずれない
  const anchorLocal = p.userData.faceLocal || gripLocalOf(p);
  const anchor = connModelPos(p, anchorLocal);
  obj.quaternion.copy(p.quaternion);
  obj.scale.copy(p.scale);
  obj.userData.placed = true;
  obj.userData.orient = p.userData.orient || 0;
  obj.userData.roll = p.userData.roll || 0;
  if (p.userData.mat) obj.userData.mat = p.userData.mat;
  if (p.userData.groupId != null) obj.userData.groupId = p.userData.groupId;
  obj.position.copy(anchor).sub((obj.userData.faceLocal || new THREE.Vector3()).clone().applyQuaternion(obj.quaternion));
  modelGroup.add(obj);
  const i = placedParts.indexOf(p);
  if (i >= 0) placedParts[i] = obj; else placedParts.push(obj);   // アイテムリストの並びを保つ
  modelGroup.remove(p);
  disposePartDeep(p);
  selectPart(obj);                                  // 再選択（発光・フォーム・リスト更新込み）
  _idleSig = null;
  if (window.__scheduleHistory) window.__scheduleHistory();
}
function disposePartDeep(o) {
  o.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); }
  });
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
let followParked = null;      // タッチ：直近にドラッグして離した位置(client座標)。設置タップはこの位置に置く（タップ座標に引っ張られない）

// ---- 再移動（配置済み部品を掴んで動かす） ----
// ---- 「移動」コマンド（2026-07-15 社長提案・同日改訂）----
// 常駐のON/OFFモードではなく、CAD式の「1回きりのコマンド」：
//   ①移動→オブジェクトを選択→ドラッグで移動（実行）  ②オブジェクトを選択→移動→ドラッグ（実行）
// 1回の移動を終えるとコマンドは自動で終了する。作図ツール・部品配置を始めた時も自動解除（コマンドは排他）。
// 対象は部品・線分・寸法・文字すべて（2026-07-16 線・寸法もゲート）。コマンド外ではドラッグしても動かない
// （部品は視点操作になる。選択・起点選択・パイプ端/線端の伸縮・寸法の逃げ調整・円の半径変更・EL入力は常時可）。
// リボンのコマンドは同時に1つだけ点灯させる（2026-07-27 社長要望）。
// 別のコマンドを押したら前のコマンドは解除し、後から押した方へ切り替える。
// keep には「今から入るコマンド」を渡す。ONにする時だけ呼ぶこと（OFF時に呼ぶと再帰する）。
function clearOtherCommands(keep) {
  if (keep !== 'place') stopFollow();
  if (keep !== 'move' && typeof moveMode !== 'undefined' && moveMode) setMoveMode(false);
  if (keep !== 'move' && typeof movePickOrigin !== 'undefined' && movePickOrigin) endMovePickOrigin();
  if (keep !== 'move' && typeof moveReady !== 'undefined') moveReady = false;
  if (keep !== 'hide' && typeof hideArmed !== 'undefined' && hideArmed) setHideArmed(false);
  if (keep !== 'draw' && window.__exitDrawMode) window.__exitDrawMode();
  if (keep !== 'pending' && window.__clearPendingCmd) window.__clearPendingCmd();
  if (keep !== 'mirror' && window.__mirrorCancel) window.__mirrorCancel();
  if (keep !== 'rotate' && window.__rotateCancel) window.__rotateCancel();
  if (keep !== 'sweep' && window.__sweepCancel) window.__sweepCancel();
  if (keep !== 'detail' && window.__detailFrameEnd) window.__detailFrameEnd();
  if (keep !== 'trim' && window.__trimEnd) window.__trimEnd();
}
let moveMode = false;   // true=「移動」コマンド実行待ち
// 「移動」コマンドで、動かす前に起点（基準にする機点）をタップで選ぶ段階（2026-07-27 社長要望）。
// 起点が決まると、以降は従来どおり ドラッグ＝直線移動／長押し・ダブルタップ＝自由移動。
let movePickOrigin = false;
// 掴んだ点にいちばん近い機点を、その部品の起点にする（4mm以内に無ければ変えない）
function setGripFromPoint(part, pt) {
  if (!part || !pt) return false;
  let best = null, bd = 0.004;
  for (const l of connsOf(part)) { const d = connModelPos(part, l).distanceTo(pt); if (d < bd) { bd = d; best = l; } }
  if (!best) return false;
  part.userData.gripLocal = best;
  if (part.userData.partType === 'pipe') { pipeEndSel = null; pipeLenSticky = false; }   // パイプの端指定より起点を優先
  return true;
}
let movePicking = false;           // 起点の位置決め中（指を置いてから離すまで）
let movePickAwait = false;         // 位置は決まり、確定のタップ待ち（カーソルは出したまま）
let movePickParked = null;         // 離した所（＝これから起点にする点）
let moveReady = false;             // 起点は決まった。次にタッチした所から動かし始める
let movePickCursorShown = false;   // 起点の十字を出したまま指を離すのを待っている
// 決めた起点は、移動だけでなく方位角・立面角・回転の「中心」にもなる（2026-08-02 社長指示）。
// 複数選択なら、選択した部品ぜんぶ＋選択中の線が この点を中心にまとめて回る。
// null＝主選択の起点（grip）を使う＝従来どおり。選択をやり直すと消える。
let selPivot = null;               // modelGroupローカルの点
// 起点を消す時は橙の玉（印）も必ず一緒に片付ける。
// 旧＝呼び元ごとに __originPickClear を併記していて、選択のやり直し・窓選択・機点変更など
// 併記漏れの経路で玉だけが残っていた（2026-08-04 社長報告「まだ残る場合がある」の真因）。
function clearSelPivot() {
  if (selPivot && window.__originPickClear) window.__originPickClear();
  selPivot = null;
}
// 起点が決まったら、そのまま「掴んだ状態」にする＝スライドで動かし、タップで確定（鏡・回転と同じ流れ）
function beginMoveAfterOrigin(cx, cy) {
  const part = selectedPart;
  if (part) {
    // 押しっぱなしにしなくてもスライドで動かせる直線移動（hover）。
    // 45°刻み・距離入力欄・Shiftの鉛直移動は従来どおり使える。タップで確定。
    const o = originModelPos(part);
    const sh = planeHitAt(cx, cy, o.y);
    if (hDirInput) hDirInput.value = '';        // 新しい移動＝向きは「ドラッグの向き」から
    dirDrag = {
      part, sx: cx, sy: cy, startOrigin: o.clone(), startHit: sh ? sh.clone() : o.clone(),
      planeY: o.y, dir: null, dist: 0, started: false, locked: true, hover: true, touching: true,
      group: moveGroupFor(part), primaryStartPos: part.position.clone(), annFollow: false,
    };
    if (window.__annHasSel && window.__annHasSel()) { window.__annMoveStart(); dirDrag.annFollow = true; }
    controls.enabled = false;

  } else if (window.__annHasSel && window.__annHasSel() && typeof startAnnPlace === 'function' && startAnnPlace(true)) {
    // 線・寸法だけの選択も部品と同じ流れ＝まず直線移動、ダブルタップ／長押しで自由移動、タップで確定
    controls.enabled = false;
    if (annPlaceMode) {
      annPlaceMode.startHit = planeHitAt(cx, cy, annPlaceMode.start.y) || annPlaceMode.start.clone();
      annPlaceMode.downX = cx; annPlaceMode.downY = cy;   // 縦寄り／横寄りの判定用（垂直の直線移動）
    }
    _annTap = { t: (window.performance ? performance.now() : 0), x: cx, y: cy };   // 続けてのタップ＝ダブルタップ判定用
    clearTimeout(freeHoldTimer);
    freeHoldTimer = setTimeout(() => { annPlaceFree(cx, cy); }, 500);   // 長押し＝自由移動へ
  }
}
// 起点選びを始める（選択済みの状態で「移動」に入った時と、「移動」を押してから選んだ時の両方から呼ぶ）
function beginMovePickOrigin() {
  movePickOrigin = true; movePickAwait = false; movePicking = false; movePickParked = null; moveReady = false;
  if (window.__toast) window.__toast('移動：起点をタップして選んでください（そのあと ドラッグで直線移動、長押し又はダブルタップで自由移動）');
}
function endMovePickOrigin(keepCursor) {
  if (!movePickOrigin) return;
  movePickOrigin = false; movePickAwait = false; movePicking = false; movePickParked = null;
  if (keepCursor) { movePickCursorShown = true; return; }   // 押している間はカーソルを残す
  if (window.__originPickClear) window.__originPickClear();
}
function setMoveMode(on) {
  moveMode = !!on;
  const b = document.getElementById('cmdMove');
  if (b) b.classList.toggle('active', moveMode);
  if (moveMode) {
    clearOtherCommands('move');                         // 他のコマンドは解除（同時に光らせない）
    const nSel = selectedParts.size + (window.__annSelCount ? window.__annSelCount() : 0);
    if (nSel > 0) beginMovePickOrigin();                // 選択済みなら、まず起点を選んでもらう

  } else {
    endMovePickOrigin();
    if (movingPart) dropMovingPart();                   // 進行中の自由移動は現在位置で確定
    if (dirDrag && !dirDrag.locked) { dirDrag = null; controls.enabled = true; clearMarkers(); updateForm(); }   // 距離入力(locked)中は生かす
  }
}
// 1回の移動が完了した時に呼ぶ＝コマンドを自動終了（distance入力のlocked状態はそのまま使える）
function finishMoveCommand() { if (moveMode) setMoveMode(false); }
let movingPart = null;        // 移動中の配置済み部品（null=移動していない）
let moveStartPt = null;       // 自由移動：掴んだ画面座標（タップ判定用）
let moveStarted = false;      // 自由移動：しきい値を超えて実際に動き始めたか
let moveGrabOff = { x: 0, y: 0 };   // 自由移動：掴んだ位置と起点の画面オフセット（差分移動用）
let movingOrient = 0;         // 移動中部品の方向(dir) index
let movingRoll = 0;           // 移動中部品のひねり(roll) 0/45°
let moveOrig = null;          // 取消用：掴む前の position
let moveGroup = [];           // 集団移動：主選択と一緒に動かす他の選択部品 [{part, startPos}]
let annFollowMove = false;    // 部品の集団移動に、窓選択した線も追従させるか
// 線・寸法・文字だけを掴んで置く状態（部品が無いので movingPart が使えない）。
// コマンドで作った物を複製したあとも、部品と同じように動かして置けるようにする（2026-07-27 社長要望）。
let annPlaceMode = null;      // { ref: V3, free, start, startHit, moved }  掴んだ時点の基準点
let _annTap = { t: -1e9, x: 0, y: 0 };   // 線・寸法の移動中のダブルタップ判定
// constrained=true（移動コマンドで起点を決めた後）＝部品と同じ「直線移動」から始め、
// ダブルタップ／長押しで自由移動へ切り替える。複製の置き直しは従来どおり最初から自由移動。
function startAnnPlace(constrained) {
  if (!(window.__annHasSel && window.__annHasSel())) return false;
  // 決めた起点があればそこを基準にする（旧＝先頭の線の端点a固定で、起点を無視して飛んでいた。
  // 2026-08-02 社長「線分などの移動の機能もおかしい」）
  const c = (selPivot && selPivot.clone())
         || (window.__annSelGrip && window.__annSelGrip())
         || (window.__annSelCenter && window.__annSelCenter());
  if (!c) return false;
  window.__annMoveStart();
  annPlaceMode = { ref: c.clone(), free: !constrained, start: c.clone(), startHit: null, moved: false,
                   cur: c.clone(), grabOff: { x: 0, y: 0 } };
  return true;
}
function annPlaceFree(cx, cy) {   // ダブルタップ／長押し＝自由移動へ切替（今いる位置から。飛ばさない）
  if (!annPlaceMode || annPlaceMode.free) return;
  const cur = (annPlaceMode.cur || annPlaceMode.ref).clone();
  window.__annMoveEnd(); window.__annMoveStart();     // 今の位置を新しい基準にして取り直す
  annPlaceMode.ref = cur; annPlaceMode.start = cur.clone(); annPlaceMode.cur = cur.clone();
  annPlaceMode.free = true; annPlaceMode.moved = false;
  // 掴んだ所と基準点の画面上のずれを覚える＝カーソルへ瞬間移動しない（部品の自由移動と同じ）
  const rect = renderer.domElement.getBoundingClientRect();
  const n = modelGroup.localToWorld(cur.clone()).project(activeCam());
  const sx = rect.left + (n.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-n.y * 0.5 + 0.5) * rect.height;
  annPlaceMode.grabOff = { x: (cx || sx) - sx, y: (cy || sy) - sy };
  if (window.__toast) window.__toast('自由移動：動かしてタップで確定');
}
function moveAnnPlace(cx, cy) {
  if (!annPlaceMode) return;
  if (annPlaceMode.free) {
    // スナップONなら機点・交点などへ吸着させる（2026-07-27 社長要望：複製の移動でもスナップさせたい）。
    const go = annPlaceMode.grabOff || { x: 0, y: 0 };
    const tgt = resolveTarget(cx - go.x, cy - go.y, null, annPlaceMode.ref.y);
    if (!tgt) return;
    const d = tgt.point.clone().sub(annPlaceMode.ref);
    window.__annMoveApply(d.x, d.y, d.z);
    annPlaceMode.cur = tgt.point.clone();
    annPlaceMode.moved = true;
    clearMarkers();
    if (tgt.snapped) addSnapMarker(tgt.point, markerRadiusFor(null, true));   // 吸着した点を見せる
    return;
  }
  // 画面での動きが縦寄りなら「垂直の直線移動」＝起点の真上/真下へまっすぐ
  // （引出し線の肘の伸縮と同じ流儀。水平面の交点では上下に動かせない。2026-08-04 社長要望）
  if (annPlaceMode.downX != null) {
    const dxs = cx - annPlaceMode.downX, dys = cy - annPlaceMode.downY;
    if (Math.abs(dys) > Math.abs(dxs) && Math.hypot(dxs, dys) > 6) {
      const cam2 = activeCam();
      const nrm = new THREE.Vector3(); cam2.getWorldDirection(nrm); nrm.y = 0;
      if (nrm.lengthSq() < 1e-9) nrm.set(0, 0, 1);
      nrm.normalize();
      const rect2 = renderer.domElement.getBoundingClientRect();
      placeNdc.x = ((cx - rect2.left) / rect2.width) * 2 - 1;
      placeNdc.y = -((cy - rect2.top) / rect2.height) * 2 + 1;
      placeRay.setFromCamera(placeNdc, cam2);
      const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, modelGroup.localToWorld(annPlaceMode.start.clone()));
      const hitV = new THREE.Vector3();
      if (placeRay.ray.intersectPlane(pl, hitV)) {
        const y = Math.round(modelGroup.worldToLocal(hitV).y * 1000) / 1000;   // 1mm刻み
        const to = new THREE.Vector3(annPlaceMode.start.x, y, annPlaceMode.start.z);
        const d2 = to.clone().sub(annPlaceMode.ref);
        window.__annMoveApply(d2.x, d2.y, d2.z);
        annPlaceMode.cur = to.clone();
        if (Math.abs(y - annPlaceMode.start.y) > 1e-6) annPlaceMode.moved = true;
        clearMarkers();
        addGuideTriangle(annPlaceMode.start.clone(), to, 0xffcc33);
        return;
      }
    }
  }
  // 直線移動＝部品と同じ。指を置いた所からの差分を45°（または指定角）へ丸め、その向きへ真っ直ぐ
  const hit = planeHitAt(cx, cy, annPlaceMode.start.y);
  if (!hit) return;
  if (!annPlaceMode.startHit) annPlaceMode.startHit = hit.clone();
  const b = annPlaceMode.startHit;
  const vx = hit.x - b.x, vz = hit.z - b.z;
  const step = Math.PI / 4;                                   // 45°刻み（線の角度スナップと同じ）
  const ang = Math.round(Math.atan2(vz, vx) / step) * step;
  const dist = Math.max(0, vx * Math.cos(ang) + vz * Math.sin(ang));
  const to = new THREE.Vector3(annPlaceMode.start.x + Math.cos(ang) * dist, annPlaceMode.start.y, annPlaceMode.start.z + Math.sin(ang) * dist);
  const d = to.clone().sub(annPlaceMode.ref);
  window.__annMoveApply(d.x, d.y, d.z);
  annPlaceMode.cur = to.clone();
  if (dist > 1e-6) annPlaceMode.moved = true;
  clearMarkers();
  addGuideTriangle(annPlaceMode.start.clone(), to, 0xffcc33);   // 部品と同じ黄色ガイド
}
function dropAnnPlace() {
  if (!annPlaceMode) return;
  window.__annMoveEnd(); annPlaceMode = null; clearMarkers();
  clearSelPivot();                // 起点（オレンジの玉）も片付ける（2026-08-03 社長報告）
  if (window.__originPickClear) window.__originPickClear();
  if (window.__scheduleHistory) window.__scheduleHistory();
}
function cancelAnnPlace() {
  if (!annPlaceMode) return;
  window.__annMoveCancel(); annPlaceMode = null;
}
let touchShift = false;       // タッチ用の仮想Shift（画面のShiftボタンON）。e.shiftKey と OR して使う（Y方向作図・楕円化など）
let touchCtrl = false;        // タッチ用の仮想Ctrl（画面のCtrlボタンON）。e.ctrlKey/metaKey と OR して使う（複数選択トグル）
let movingByDrag = false;     // ダブルクリック→押したままドラッグで自由移動中か（pointerupで確定）
let moveHoldTap = false;      // 長押しで自由移動に入った直後か（動かさず離したら「タップで確定」モードへ）
let freeHoldTimer = null;     // 移動コマンド中の長押し(0.5秒)＝自由移動へ切替（2026-07-19 社長要望：ダブルタップより確実）
// PCのCtrl/⌘キー押下状態（Ctrl中＝選択があっても視点操作を許可するため。タッチはtouchCtrl）
let kbCtrl = false;
window.addEventListener('keydown', e => { if (e.key === 'Control' || e.key === 'Meta') kbCtrl = true; });
window.addEventListener('keyup', e => { if (e.key === 'Control' || e.key === 'Meta') kbCtrl = false; });
window.addEventListener('blur', () => { kbCtrl = false; });
let touchSelOnly = false;     // タッチ：未選択の部品/線に触れた1回目は「選択のみ」（移動・視点回転しない）。pointerupで視点を戻す
let _lastDownT = 0, _lastDownX = 0, _lastDownY = 0, _lastDownPart = null;  // ダブルクリック押下検出用
const SNAP_PX = 18;           // 機点スナップが効く画面距離(px)
// 近接スナップ（2026-07-19 社長要望）：線分・構築線の「線上」（端点・中点・交点以外）にも吸着する。
// 誤吸着を避けるため、リボン「近接」トグルでONの時だけ・点スナップが無い時だけ・少し狭い距離で効く
const NEAR_SNAP_PX = 14;
let nearSnapOn = true;   // 既定ON（2026-07-19 社長要望：設定の既定はすべてON）
try { nearSnapOn = localStorage.getItem('p3d_near_snap') !== '0'; } catch (e) {}
// スナップ全体（機点・端点・中点・交点などの点吸着）のON/OFF（リボン「設定」から。既定ON）
let snapOn = true;
try { snapOn = localStorage.getItem('p3d_snap') !== '0'; } catch (e) {}
// 起点・機点マーカー（選択中の点表示）と交点（点表示＋吸着）のON/OFF（2026-07-19 社長要望・設定から）
let showOriginPts = true;
try { showOriginPts = localStorage.getItem('p3d_show_origin') !== '0'; } catch (e) {}
let showXpts = true;
try { showXpts = localStorage.getItem('p3d_show_xpt') !== '0'; } catch (e) {}
// フランジのボルト穴の起点＝既定OFF（2026-07-20 社長。ONにすると起点候補・スナップ対象に）
let showBoltPts = false;
try { showBoltPts = localStorage.getItem('p3d_show_boltpt') === '1'; } catch (e) {}
// 四半円点（部品外径のN/E/S/Wリム点）＝既定OFF（2026-07-20 社長・同日改訂）
let autoGasket = true;    // フランジ面どうしを合わせた時にガスケットを自動で挟む（2026-07-20 社長要望・既定ON）
try {
  // 既定ON（2026-07-30 社長指示で再確認）。過去にOFFへ倒した端末も一度だけONへ戻す（以後の切替は記憶）
  if (!localStorage.getItem('p3d_ag_defon')) { localStorage.setItem('p3d_ag_defon', '1'); localStorage.setItem('p3d_auto_gasket', '1'); }
  autoGasket = localStorage.getItem('p3d_auto_gasket') !== '0';
} catch (e) {}
let showQuadPts = false;
try { showQuadPts = localStorage.getItem('p3d_show_quad') === '1'; } catch (e) {}
const SNAP_RED = 0xff4040;   // 四半円点・ボルト穴に吸着した時の起点マーク＝赤（スナップ接近時のみ表示・2026-07-20 社長）

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
// 端をスライド(ドラッグ)で伸縮した後、離してもCOPに戻さず「長さ」入力モードを維持するフラグ。
// これでスライド→キーボードで長さ微調整、という流れができる。端のクリック(=COP/傾け)や別選択で解除。
let pipeLenSticky = false;
function pipeSelected() {
  return !!(selectedPart && selectedPart.userData.partType === 'pipe' && !dirActive());
}
// いま「長さ」入力モードか（端スライド中 or スライド後のスティッキー）。pipeEndSel が必要。
function pipeLenInputMode() { return pipeSelected() && !!pipeEndSel && (pipeLenSticky || (pipeEndDrag && pipeEndDrag.part === selectedPart)); }
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
// 機器類（フレキシブル・サイドグラス）の長さ（＝フランジ面間）を作り替える。
// 起点（現在つかんでいる機点）の位置は動かさない＝相手の配管を押さない。パイプの rebuildPipe と同じ考え方。
function rebuildEquipLength(part, lengthMm) {
  const u = part.userData;
  const spec = u[u.partType];
  if (!spec || (u.partType !== 'flex' && u.partType !== 'sight' && u.partType !== 'spool')) return;
  const minL = u.partType === 'spool' ? spoolMinLen(spec.type, spec.cls, spec.sizeA) : 60;
  const L = Math.max(Number(lengthMm) || 0, minL);
  const keepLocal = (u.gripLocal === u.backLocal) ? u.backLocal : u.faceLocal;   // つかんでいる端を保持
  const keepIsBack = (keepLocal === u.backLocal);
  const keepPos = connModelPos(part, keepLocal);
  spec.length = Math.round(L);
  while (part.children.length) {
    const c = part.children.pop();
    c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  const np = (u.partType === 'flex') ? makeFlex(spec) : (u.partType === 'spool') ? makeSpool(spec) : makeSightGlass(spec);
  while (np.children.length) part.add(np.children.pop());
  u.boltLocals = np.userData.boltLocals || undefined;   // 端フランジのボルト穴も新しい面間へ追従（スペーサーは無し）
  const half = (spec.length / 1000) / 2;
  u.faceLocal.set(0, half, 0);
  u.backLocal.set(0, -half, 0);
  if (u.extraLocals && u.extraLocals[0]) u.extraLocals[0].set(0, 0, 0);   // 面間の中央
  const newKeep = keepIsBack ? u.backLocal : u.faceLocal;
  part.position.copy(keepPos).sub(newKeep.clone().applyQuaternion(part.quaternion));
  if (typeof setEmissive === 'function' && selectedParts.has(part)) setEmissive(part, SEL_COLOR);
  if (typeof refreshItemList === 'function') refreshItemList();
  if (window.__scheduleHistory) window.__scheduleHistory();
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
  if (hYInput.value.trim() === '') return;             // 空欄の間は適用しない（全消去で1mmに潰れないように）
  const fixed = pipeEndSel === 'face' ? 'back' : 'face';
  rebuildPipe(selectedPart, Math.max(parseFloat(hYInput.value) || 1, 1), fixed);
  if (typeof refreshItemList === 'function') refreshItemList();
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
    if (p === part || !p.userData.faceLocal || p.userData.hidden) continue;
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
    if (isBoltLocal(part, local)) continue;   // フランジ穴・四半円点は常時表示せずスナップ接近時のみシンボル表示（2026-07-20 社長）
    const isGrip = local === grip;
    addMarker(connModelPos(part, local), isGrip ? 0x39ff8a : 0x7fd1ff, markerRadiusFor(part, isGrip));
  }
}
// 複数選択：EL基準＝橙・大、選択中アイテムの他の機点＝水色・小（タップでそこを基準にできる・2026-07-20 社長要望）
function drawMultiSelMarkers() {
  clearMarkers();
  const base = originModelPos(selectedPart);
  for (const p of selectedParts) {
    if (!p.userData.faceLocal || p.userData.hidden) continue;
    for (const local of connsOf(p)) {
      if (isBoltLocal(p, local)) continue;
      const mpos = connModelPos(p, local);
      if (mpos.distanceTo(base) < 1e-6) continue;    // 基準点は下で橙・大で描く
      addMarker(mpos, 0x7fd1ff, markerRadiusFor(p, false));
    }
  }
  addMarker(base, 0xff8a3c, markerRadiusFor(selectedPart, true));
}
function updateIdleMarkers() {
  if (followTool || movingPart || dirDrag || pipeEndDrag) { _idleSig = null; return; }
  // 設定「起点」はスナップのON/OFFであり表示は制御しない（2026-07-20 社長）。選択中アイテムの点は常に表示する
  let sig = null;
  if (selectedParts.size > 1 && selectedPart && selectedPart.userData.faceLocal) {
    // 複数選択：EL基準（基準アイテムの起点）を橙で強調＋選択中アイテムの機点を水色で表示（タップで基準を変更できる）
    const o = originModelPos(selectedPart);
    sig = `multi|${selectedPart.uuid}|${selectedParts.size}|${o.x.toFixed(3)},${o.y.toFixed(3)},${o.z.toFixed(3)}`;
  } else if (pipeSelected() && selectedPart.userData.faceLocal) {
    const f = connModelPos(selectedPart, selectedPart.userData.faceLocal);
    const b = connModelPos(selectedPart, selectedPart.userData.backLocal);
    sig = `pipe|${pipeEndSel}|${f.x.toFixed(3)},${f.y.toFixed(3)},${f.z.toFixed(3)}|${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)}`;
  } else if (selectedPart && selectedParts.size <= 1 && selectedPart.userData.faceLocal && !dirActive()) {
    // 非パイプの選択中アイテム：全機点を表示し grip を強調
    const gk = connModelPos(selectedPart, gripLocalOf(selectedPart));
    sig = `conn|${selectedPart.uuid}|${gk.x.toFixed(3)},${gk.y.toFixed(3)},${gk.z.toFixed(3)}|${connsOf(selectedPart).length}|${showQuadPts ? 1 : 0}${showBoltPts ? 1 : 0}`;
  }
  if (sig === _idleSig) return;       // 状態変化なし→何もしない
  if (!sig) clearMarkers();
  else if (sig.startsWith('multi|')) drawMultiSelMarkers();
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
  const spec = u && (u.pipe || u.elbow || u.cap || u.tee || u.reducer || u.flange || u.gasket);
  const sizeA = spec && spec.sizeA;
  if (sizeA && FLG_BORE[sizeA]) return FLG_BORE[sizeA] / 2 / 1000;
  return 0.03;
}
// 機点マーカーの半径(m)：部品の口径に比例（大きい部品でも分かりやすく）。最小・最大でクランプ。big=起点/吸着の強調用。
function markerRadiusFor(part, big) {
  const ro = partBoreRadius(part);
  const base = Math.min(Math.max(ro * 0.09, 0.0018), 0.018);   // ひと回り小さく（2026-07-20 社長）
  return big ? base * 1.6 : base;
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
// 部品の全機点（ローカル）を返す。faceLocal/backLocal に加え、extraLocals（ティーの枝端等）・
// boltLocals（フランジのボルト穴中心。起点・スナップ用＝自動集計には使わない）も含む。
function connsOf(p) {
  const arr = [];
  if (p.userData.faceLocal) arr.push(p.userData.faceLocal);
  if (p.userData.backLocal) arr.push(p.userData.backLocal);
  if (p.userData.extraLocals) for (const e of p.userData.extraLocals) arr.push(e);
  if (showBoltPts && p.userData.boltLocals) for (const e of p.userData.boltLocals) arr.push(e);   // 設定ON時のみ（既定OFF）
  return arr;
}
// 四半円点（部品の外径リムの4点）＝作図・寸法用のスナップ点（2026-07-20 社長要望）。
// フランジ＝フェイス側の板外周／パイプ＝両端＋中間の管外周／その他継手＝各端面の管外径の外周。
// 機点(connsOf)には含めない＝起点(grip)や回転基準・自動集計には影響しない。設定「四半円点」でON/OFF（既定ON）。
function quadLocalsOf(p) {
  const u = p.userData, t = u.partType;
  if (!u.faceLocal || t === 'gasket' || t === 'pg') return [];
  const out = [];
  const ring = (center, nrm, R) => {
    const n = nrm.clone().normalize();
    const a = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u1 = new THREE.Vector3().crossVectors(a, n).normalize();
    const u2 = new THREE.Vector3().crossVectors(n, u1).normalize();
    out.push(center.clone().addScaledVector(u1, R), center.clone().addScaledVector(u1, -R),
             center.clone().addScaledVector(u2, R), center.clone().addScaledVector(u2, -R));
  };
  const odR = s => ((FLG_BORE[s] || 60) / 2) / 1000;   // 管外径の半径(m)
  // フランジ形の機器（バルブ・フレキ・サイドグラス・仮管）＝両端フランジの板外周＝フランジ単体と同じ四半円点
  //（SW形バルブ・ウエハー形・安全弁は対象外。仮管スペーサーは座面径のリム。2026-07-31 社長要望「他のフランジと同様に」）
  if (t === 'valve' || t === 'flex' || t === 'sight' || t === 'spool') {
    if (!isFlangedBody(u)) return [];
    const vv = u.valve || {};
    if (vv.kind === 'safety' || (vv.kind === 'butterfly' && vv.style === 'wafer')) return [];
    const spec2 = u.valve || u.flex || u.sight || u.spool || {};
    const cls2 = spec2.rating || spec2.cls || 'JIS 10K', szA = spec2.sizeA || '50A';
    const R2 = (t === 'spool' && spec2.type === 'スペーサー')
      ? VMM(rfFaceDia(cls2, szA) || (FLG_BORE[szA] || 60) * 1.1) / 2
      : (flangeDim(cls2, szA).D / 2) / 1000;
    ring(u.faceLocal, u.faceNormal || new THREE.Vector3(0, 1, 0), R2);
    ring(u.backLocal, u.backNormal || new THREE.Vector3(0, -1, 0), R2);
    return out;
  }
  const spec = u.pipe || u.bent || u.elbow || u.tee || u.reducer || u.cap || u.sw || u.flange || {};
  const RA = odR(spec.sizeA || '50A');
  if (t === 'flange') {                                 // フェイス側の板外周（外径D）
    const fd = flangeDim((u.flange && u.flange.cls) || 'JIS 10K', (u.flange && u.flange.sizeA) || '50A');
    ring(new THREE.Vector3(0, (fd.t / 2) / 1000, 0), new THREE.Vector3(0, 1, 0), (fd.D / 2) / 1000);
    return out;
  }
  if (t === 'pipe') {                                   // 両端＋中間の管外周
    const L2 = ((u.pipe && u.pipe.length) || 100) / 2000;
    const n = new THREE.Vector3(0, 1, 0);
    ring(new THREE.Vector3(0, L2, 0), n, RA);
    ring(new THREE.Vector3(0, -L2, 0), n, RA);
    ring(new THREE.Vector3(0, 0, 0), n, RA);
    return out;
  }
  // その他の継手：各端面（face/back/枝端）に管外径のリム
  const RB = odR((u.tee && u.tee.sizeB) || (u.sw && u.sw.sizeB) || (u.reducer && u.reducer.sizeB) || spec.sizeA || '50A');
  const nOf = (loc, key) => (u[key] ? u[key].clone() : (loc.lengthSq() > 1e-12 ? loc.clone() : new THREE.Vector3(0, 1, 0)));
  ring(u.faceLocal, nOf(u.faceLocal, 'faceNormal'), RA);
  if (u.backLocal) ring(u.backLocal, nOf(u.backLocal, 'backNormal'), (t === 'reducer') ? RB : RA);
  if (u.extraLocals) for (const e of u.extraLocals) {
    if (u.cornerLocal && e === u.cornerLocal) continue;   // 工作点（中心）にはリム不要
    if (e.lengthSq() > 1e-9) ring(e, e.clone(), RB);
  }
  return out;
}
// スナップに使う点。設定は表示ではなくスナップ対象のON/OFF（2026-07-20 社長）：
// 起点(showOriginPts)=機点／ボルト穴(showBoltPts・connsOf側で制御)／四半円点(showQuadPts)。起点(grip)選定や回転基準には使わない
function snapLocalsOf(p) {
  const arr = [];
  for (const l of connsOf(p)) { if (isBoltLocal(p, l) || showOriginPts) arr.push(l); }
  if (showQuadPts) for (const q of quadLocalsOf(p)) arr.push(q);
  return arr;
}
// スナップ点の種類判定：フランジ穴('bolt')／四半円点('quad')／構築線・線分の交点('xpt')／その他(null)。表示シンボルの切替用
function snapPtKind(pt) {
  for (const p of placedParts) {
    if (!p.userData.faceLocal || p.userData.hidden) continue;
    if (showBoltPts && p.userData.boltLocals) {
      for (const b of p.userData.boltLocals) if (connModelPos(p, b).distanceTo(pt) < 1e-6) return 'bolt';
    }
    if (showQuadPts) {
      for (const q of quadLocalsOf(p)) if (connModelPos(p, q).distanceTo(pt) < 1e-6) return 'quad';
    }
  }
  if (showXpts && window.__xpts) {
    for (const x of window.__xpts()) if (x.distanceTo(pt) < 1e-6) return 'xpt';
  }
  return null;
}
// 吸着点の標準表示：四半円点/ボルト穴＝赤い起点マーク（2026-07-20 社長：◇と＋のシンボルは廃止）・交点=黄点・それ以外=緑玉
function addSnapMarker(pt, r) {
  const kind = snapPtKind(pt);
  if (kind === 'xpt') addMarker(pt, 0xffd84d, r);
  else if (kind) addMarker(pt, SNAP_RED, r);
  else addMarker(pt, 0x39ff8a, r);
}
// この機点はフランジ穴か（常時マーカーには出さない＝スナップ接近時のみシンボル表示）
function isBoltLocal(p, local) { return !!(p.userData.boltLocals && p.userData.boltLocals.includes(local)); }

// ===== ガスケットの自動挿入（2026-07-20 社長要望） =====
// フランジのフェイス面どうし（＋フランジ形バルブ）を突き合わせた時だけ、パレットの厚みのガスケットを
// 自動で挟み、置いた側を厚みぶん押し出す。呼び径・クラスは相手のフランジから取るのでサイズ違いが起きない。
// ・パイプ端×フランジのフェイス面は対象外（実物では背面へ溶接するため、ここで挟むと邪魔になる）
// ・部品表の自動計上（accessoryRows）とまったく同じ判定条件を使う＝図と部品表が食い違わない
// 「両端フランジ形の機器」か＝フランジ形バルブ／フレキシブル／サイドグラス。
// これらの端はガスケット＋ボルトで留める＝溶接口として数えない（SW形バルブは溶接なので除く）。
function isFlangedBody(u) {
  if (!u) return false;
  if (u.partType === 'flex' || u.partType === 'sight') return true;
  if (u.partType === 'spool') return true;   // 仮管＝フランジ形もスペーサー(ウエハー)形も両端ガスケット留め
  if (u.partType === 'valve') return !['swgate', 'swglobe'].includes((u.valve && u.valve.kind) || '');
  return false;
}
// その部品の接続クラス（ガスケット・ボルトの呼びに使う）
function bodyRatingOf(u) {
  if (u.partType === 'valve') return (u.valve && u.valve.rating) || '';
  if (u.partType === 'flex') return (u.flex && u.flex.cls) || '';
  if (u.partType === 'sight') return (u.sight && u.sight.cls) || '';
  if (u.partType === 'spool') return (u.spool && u.spool.cls) || '';
  return '';
}
function connNormalOf(p, local) {
  const u = p.userData;
  let n = null;
  if (u.faceLocal && local === u.faceLocal && u.faceNormal) n = u.faceNormal.clone();
  else if (u.backLocal && local === u.backLocal && u.backNormal) n = u.backNormal.clone();
  if (!n && u.faceLocal && u.backLocal) {                 // 明示が無い部品（フランジ等）＝軸方向から求める
    const ax = u.faceLocal.clone().sub(u.backLocal);
    if (ax.lengthSq() > 1e-12) n = (local === u.backLocal) ? ax.negate().normalize() : ax.normalize();
  }
  if (!n) n = new THREE.Vector3(0, 1, 0);
  return n.applyQuaternion(p.quaternion).normalize();
}
// その機点がガスケット面か：'flange'＝フランジのフェイス／'valve'＝フランジ形バルブの端／null＝対象外
function gasketSideOf(p, local) {
  const u = p.userData;
  if (u.partType === 'flange') return (u.faceLocal && local === u.faceLocal) ? 'flange' : null;
  if (isFlangedBody(u)) return 'valve';   // フランジ形バルブ・フレキシブル・サイドグラスの端＝ガスケット面
  return null;
}
// ガスケットの厚みを作り替える（プロパティからの変更・2026-07-21 社長要望）。
// 背面(=位置の基準)は動かさずフェイス側へ厚みが伸びる＝相手のフランジは動かさない。
function rebuildGasket(p, t) {
  const u = p.userData;
  if (!u || u.partType !== 'gasket' || !u.gasket) return;
  const nt = parseFloat(t);
  if (!isFinite(nt) || nt <= 0) return;
  const oldFace = u.faceLocal, oldBack = u.backLocal, oldGrip = u.gripLocal;
  const ng = makeGasket(Object.assign({}, u.gasket, { t: nt }));
  while (p.children.length) {                       // 見た目を作り替え（位置・姿勢はそのまま）
    const c = p.children.pop();
    c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  for (const c of [...ng.children]) p.add(c);
  u.gasket = ng.userData.gasket;
  u.faceLocal = ng.userData.faceLocal;
  u.backLocal = ng.userData.backLocal;
  if (oldGrip) u.gripLocal = (oldGrip === oldBack) ? u.backLocal : u.faceLocal;   // 起点の指し先を新しい機点へ付け替え
  _idleSig = null;
  refreshItemList();
}
function autoInsertGasket(part) {
  if (!autoGasket || !part || !part.userData || part.userData.hidden) return null;
  if (part.userData.partType === 'gasket') return null;         // ガスケット自身は対象外
  const TOL = 0.0015;
  for (const local of connsOf(part)) {
    const sideA = gasketSideOf(part, local);
    if (!sideA) continue;
    const pos = connModelPos(part, local);
    for (const q of placedParts) {
      if (q === part || q.userData.hidden || !q.userData.faceLocal) continue;
      for (const l2 of connsOf(q)) {
        const sideB = gasketSideOf(q, l2);
        if (!sideB) continue;
        if (sideA === 'valve' && sideB === 'valve') continue;    // フランジ面が無い＝仕様を決められない
        if (connModelPos(q, l2).distanceTo(pos) > TOL) continue;
        // 仕様はフランジ側から取る（サイズ違い防止）
        const fl = (sideA === 'flange') ? part : q;
        const spec = fl.userData.flange || {};
        const t = (parseFloat(gasketOpts.t) > 0) ? parseFloat(gasketOpts.t) : 3;
        const g = makeGasket({ sizeA: spec.sizeA, cls: spec.cls, t });
        if (!g) return null;
        computeConns(g);
        const n = connNormalOf(q, l2);                            // 固定側の面から外向き＝押し出す方向
        g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
        g.position.copy(pos);                                     // 背面(0,0,0)を相手の面に合わせる
        g.userData.placed = true; g.userData.orient = 0; g.userData.roll = 0;
        modelGroup.add(g); placedParts.push(g);
        part.position.addScaledVector(n, t / 1000);               // 置いた側を厚みぶん押し出す
        refreshItemList();
        if (window.__toast) window.__toast(`ガスケット t${t} を自動で挟みました（${spec.sizeA || ''} ${spec.cls || ''}）`);
        return g;
      }
    }
  }
  return null;
}
// 起点に使う機点（grip）。ユーザーが選んだ機点 gripLocal、未選択なら faceLocal。
// パイプは端クリックで pipeEndSel(face/back) を起点に選ぶので、選択中パイプはそれを優先（移動と回転で起点を一致させる）。
function gripLocalOf(obj) {
  if (obj.userData.partType === 'pipe' && obj === selectedPart && pipeEndSel)
    return pipeEndSel === 'back' ? obj.userData.backLocal : obj.userData.faceLocal;
  return obj.userData.gripLocal || obj.userData.faceLocal;
}
// 回転（45°送り・スピナー・方位角/立面角/回転の編集）の基準に使う機点：
// ボルト穴（boltLocals）が起点でも回転はフェイス中心基準＝穴を中心に振り回さない（2026-07-19 社長報告）
function rotGripLocalOf(obj) {
  const g = gripLocalOf(obj);
  const bl = obj.userData.boltLocals;
  if (g && bl && bl.some(b => b === g || b.distanceTo(g) < 1e-9)) return obj.userData.faceLocal || g;
  return g;
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
function resolveSnap(clientX, clientY, exclude, noNear) {
  if (!snapOn) return null;                             // 設定でスナップOFF＝吸着しない
  const rect = renderer.domElement.getBoundingClientRect();
  const cam = activeCam();
  let best = null, bestD = SNAP_PX;
  for (const p of placedParts) {
    if (p === exclude || !p.userData.faceLocal || p.userData.hidden) continue;
    for (const local of snapLocalsOf(p)) {
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
  // 近接スナップON＝点の候補が無ければ線分・構築線の線上へ吸着
  //（noNear＝作図側から呼ばれるフォールバック時は適用しない。作図の近接判定は drawSnapPoint 側が
  //  直角優先・起点張り付き防止つきで済ませており、ここで再吸着すると短い線が引けなくなる）
  if (!best && !noNear && nearSnapOn && window.__annNearestOnLine) best = window.__annNearestOnLine(clientX, clientY, NEAR_SNAP_PX);
  return best;
}
// 配置/移動の着地点を決める：まず機点スナップ、無ければ高さ planeY の水平面。
// planeY を渡すと「その高さの平面」上で平行移動できる（再移動で高さが床に戻らない）。
// planeY 省略時＝既定EL（設定⚙・2026-08-02 社長指示）。
function resolveTarget(clientX, clientY, exclude, planeY = defaultElY(), noNear = false) {
  const snap = resolveSnap(clientX, clientY, exclude, noNear);
  if (snap) return { point: snap, snapped: true };
  const rect = renderer.domElement.getBoundingClientRect();
  placeNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  placeNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  placeRay.setFromCamera(placeNdc, activeCam());
  const hit = new THREE.Vector3();
  const plane = planeY === 0 ? floorPlane : new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  if (!placeRay.ray.intersectPlane(plane, hit)) {
    // 既定ELの面がカメラより上にあると見下ろしの光線は当たらない。
    // その時は床でXZを拾い、高さだけ planeY へ持ち上げる＝クリックした場所の真上（2026-08-02 既定EL導入時の対策）
    if (!placeRay.ray.intersectPlane(floorPlane, hit)) return null;
    hit.y = planeY;
  }
  modelGroup.worldToLocal(hit);
  return { point: hit, snapped: false };
}
// 移動中の起点（橙）と、スナップで近づいた点だけを表示する（2026-07-20 社長：候補点の常時表示は廃止）
function showInteractionMarkers(movingObj, snapPoint) {
  clearMarkers();
  addMarker(originModelPos(movingObj), 0xff8a3c, markerRadiusFor(movingObj, false));    // 起点（橙）
  if (snapPoint) addSnapMarker(snapPoint, markerRadiusFor(movingObj, true));   // 吸着点＝緑（四半円点=赤◇・ボルト穴=赤＋・交点=黄）
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
  clearOtherCommands('place');   // 他のコマンドは解除（同時に光らせない）
  stopFollow();
  followTool = { tool, tile };
  { const _p = defaultPose(tool); followOrient = _p.dir; followRoll = _p.roll; }   // 挿入時の既定姿勢（DEFAULT_POSE）
  followQuat = null; resetPipeRotState();
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
  if (window.__syncTouchOrbit) window.__syncTouchOrbit();   // 配置中は1本指の視点回転を止める（線分の作図と同じ。2本指パン/ズームは維持）
}
function stopFollow() {
  if (followTool) followTool.tile.classList.remove('selected');
  if (followPreview) {
    modelGroup.remove(followPreview);
    followPreview.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    followPreview = null;
  }
  followTool = null;
  followParked = null;
  clearMarkers();
  hideInsDist();
  clearPairGhost();
  if (window.__syncTouchOrbit) window.__syncTouchOrbit();   // 配置終了＝1本指の視点回転を元に戻す
}
// プレビューを「起点が指す点」に置く＋向き適用＋機点スナップ
function updateFollowPreview(clientX, clientY) {
  if (!followPreview) return;
  const rect = renderer.domElement.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    followPreview.visible = false; clearMarkers();
    return;   // 距離ボックスは消さない（配置モード中は最後の値を保持＝入力しに行ける）
  }
  followPreview.visible = true;
  // 3軸ボタンで回した向きは全部品で毎フレーム維持する（旧：パイプ系だけ維持でフランジ等は既定向きへ
  // 巻き戻されて「回転が効かない」ように見えた。2026-07-29 社長報告の一因）
  if (followQuat) followPreview.quaternion.copy(followQuat);
  else orientRotation(followPreview, followOrient, followRoll);
  // ボスのプレビューは従来どおりの通常スナップ（外面への移動は「置いた後」）。
  // 合いフランジ同様、両端までの距離ボックスは出す（数値入力＋Enterで確定も可。2026-07-31 社長要望）
  if (isBossTool(followPreview)) {
    // 距離の基準はタッチ位置ではなく「緑の起点（吸着点）」＝プレビューと同じ点（2026-07-31 社長指摘）
    const t0 = resolveTarget(clientX, clientY, null);
    const bh = (t0 && t0.snapped) ? bossFitAtPoint(t0.point, clientX, clientY) : bossFitAt(clientX, clientY);
    if (bh) showInsDist(clientX, clientY, bh);
  }
  // 配管化②：挿入系アイテム＝吸着点（中点・交点など）が芯線上ならその点へ、無ければ画面距離で挿入予告
  if (INSERTABLE_TYPES[followPreview.userData.partType] && insertAxialOk(followPreview)) {
    const insT = insertTargetAt(clientX, clientY);
    if (insT) {
      let pt, dir, qIns;
      if (insT.pipe.userData.partType === 'bentpipe') {   // R曲げ管＝接線に合わせる
        pt = bentPointAt(insT.pipe, insT.tMm);
        dir = bentAxisAt(insT.pipe, insT.tMm);
        qIns = bentQuatAt(insT.pipe, insT.tMm);
      } else {
        const back = connModelPos(insT.pipe, insT.pipe.userData.backLocal);
        const face = connModelPos(insT.pipe, insT.pipe.userData.faceLocal);
        dir = face.clone().sub(back).normalize();
        pt = back.clone().addScaledVector(dir, insT.tMm / 1000);
        qIns = insT.pipe.quaternion;
      }
      followPreview.quaternion.copy(qIns);
      const fu = followPreview.userData;
      const sopFl = fu.partType === 'flange' && (fu.flange || {}).type === 'SOP';
      const ljFl = fu.partType === 'flange' && (fu.flange || {}).type === 'LJ';
      if (sopFl) {
        // 面基準（案A）：片フランジ＝フェイス面を指定点へ／合い＝ガスケット中央を指定点へ
        const P = pairGhostSpans();
        const ofs = P ? P.tg / 2 : 0;
        followPreview.position.copy(pt).addScaledVector(dir, -ofs)
          .sub(fu.faceLocal.clone().applyQuaternion(followPreview.quaternion));
      } else if (ljFl) {
        // LJ＝スタブエンドの管口（パイプと突き合わせる側）の中心を指定点へ（2026-08-04 社長指示）
        followPreview.position.copy(pt)
          .sub(fu.backLocal.clone().applyQuaternion(followPreview.quaternion));
      } else {
        const mid = fu.faceLocal.clone().add(fu.backLocal).multiplyScalar(0.5).applyQuaternion(followPreview.quaternion);
        followPreview.position.copy(pt).sub(mid);   // 軸方向の中央を芯線上の点へ
      }
      updatePairGhost();                          // 2枚目とガスケットの影も出す
      showInsDist(clientX, clientY, insT);        // 両端（曲がり・分岐）までの距離を表示（入力で確定も可）
      showInteractionMarkers(followPreview, pt);
      return;
    }
  }
  // 距離ボックスはここでは消さない＝パイプから離れても最後の値を保持（入力しに行く途中で消えない）
  // 最初の部品も線分と同じく、カーソル位置（スナップ無ければ床面投影）へ自由配置
  const tgt = resolveTarget(clientX, clientY, null);
  if (!tgt) return;
  // 相手の機点へ吸着した時は相手の向きへ自動で合わせる（2026-07-29 社長要望。
  // 手動で回した後（followQuat あり）は本人の向きを尊重する）。
  // 位置は面基準＝フェイスを吸着点そのものに置く（控えは図では見せず切寸表で引く。2026-07-29 案A採用）
  if (tgt.snapped && !followQuat && MATE_TYPES[followPreview.userData.partType]) {
    const mi = mateInfoAt(tgt.point);
    if (mi) followPreview.quaternion.copy(mi.q);
  }
  setPartByOrigin(followPreview, tgt.point);
  updatePairGhost();   // 合いフランジ＝通常配置のプレビューでも2枚＋ガスケットで見せる
  showInteractionMarkers(followPreview, tgt.snapped ? tgt.point : null);
}
function moveFollow(x, y) { updateFollowPreview(x, y); }

// 追従中：右クリック＝方向(dir)送り、Shift+右クリック＝ひねり(roll)切替。起点は保つ。
function cycleFollowOrientation(mode) {
  if (!followTool || !followPreview) return;
  const keep = originModelPos(followPreview);
  if (followQuat) followPreview.quaternion.copy(followQuat);
  else orientRotation(followPreview, followOrient, followRoll);
  stepPartRotate(followPreview, mode);           // 3軸45°送り（配置済みと同じ操作感）
  followQuat = followPreview.quaternion.clone(); // 以後は自由姿勢として毎フレーム維持
  setPartByOrigin(followPreview, keep);
  showInteractionMarkers(followPreview, null);
}

// ===== 配管化②：パイプへの割り込み挿入（2026-07-29 社長要望） =====
// パレットのアイテムを配置済みパイプの「芯線の上」へ置くと、パイプを2本に分割して割り込ませ、
// 両側のパイプ長を自動調整する（芯々は変えない＝分割2本＋挿入物の長さ＝元のパイプ長）。
// ・フランジはパレットの「枚数」で 片フランジ／合いフランジ（ガスケットを挟んで2枚。2枚目は面を向かい合わせ）。
// ・両端フランジ形の機器（フランジ形バルブ・フレキ・サイドグラス）は、相手フランジ＋ガスケットを両側に
//   自動で付けて挿入する（クラス＝機器のレーティング、Sch＝パイプのSch、タイプ＝パレットのフランジ設定）。
// ・レジューサーは径が合う側を既存パイプへ向け、反対側のパイプは新しい径で作り直す。
// ・入らない長さなら理由を出して中止（何も置かない）。エルボ挿入（ルート変更）は対象外。
const INSERTABLE_TYPES = { flange: 1, valve: 1, flex: 1, sight: 1, spool: 1 };   // レジューサーの途中挿入は廃止（2026-07-29 社長指示）
// ---- R曲げパイプ（bentpipe）の芯線ヘルパ（2026-07-30 社長要望：道中にフランジ挿入）----
// tMm＝背面端（ローカルφ=π）からの弧長。局所円弧＝(R cosφ, R sinφ, 0)・φは面側へ向かって減る。
const _n2pi = x => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
function bentArcLenMm(p) { const b = p.userData.bent; return b.R * (b.angleDeg * Math.PI / 180) * 1000; }
function bentPhiAt(p, tMm) { return Math.PI - (tMm / 1000) / p.userData.bent.R; }
function bentPointAt(p, tMm) {   // 芯線上の点（model座標）
  const b = p.userData.bent, phi = bentPhiAt(p, tMm);
  return new THREE.Vector3(b.R * Math.cos(phi), b.R * Math.sin(phi), 0).applyQuaternion(p.quaternion).add(p.position);
}
function bentAxisAt(p, tMm) {    // 背→面向きの接線（model座標・単位）
  const phi = bentPhiAt(p, tMm);
  return new THREE.Vector3(Math.sin(phi), -Math.cos(phi), 0).applyQuaternion(p.quaternion).normalize();
}
function bentQuatAt(p, tMm) {    // ローカル+Yを接線に合わせた姿勢（挿入部品・プレビュー用）
  const phi = bentPhiAt(p, tMm);
  const qL = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(phi), -Math.cos(phi), 0));
  return p.quaternion.clone().multiply(qL);
}
// 曲げ角だけ変えて作り直す（背面端＝ローカルφ=πは形状上不動なので position/quaternion は変えない）
function rebuildBentPipe(part, newAngleDeg) {
  const bent = part.userData.bent;
  const fresh = makeBentPipe(Object.assign({}, bent, { angleDeg: newAngleDeg }));
  while (part.children.length) {
    const c = part.children.pop();
    if (c.traverse) c.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material && n.material.dispose) n.material.dispose(); });
  }
  while (fresh.children.length) part.add(fresh.children[0]);
  bent.angleDeg = newAngleDeg;
  part.userData.backLocal = fresh.userData.backLocal;
  part.userData.faceLocal = fresh.userData.faceLocal;
  part.userData.backNormal = fresh.userData.backNormal;
  part.userData.faceNormal = fresh.userData.faceNormal;
  part.userData.cornerLocal = fresh.userData.cornerLocal;
  part.userData.extraLocals = fresh.userData.extraLocals;
  part.userData.gripLocal = part.userData.backLocal.clone();
}
const INSERT_SNAP_PX = 16;      // 画面上でこの距離までパイプ芯線に近ければ「挿入」と解釈
const INSERT_END_MARGIN = 1;    // 端から1mm以内は挿入しない（端への通常の突き合わせと区別）
// 軸方向にまっすぐ通り抜ける部品か（安全弁=アングル形や偏心レジューサーは芯がずれるので対象外）
function insertAxialOk(obj) {
  const fl = obj.userData.faceLocal, bl = obj.userData.backLocal;
  return !!(fl && bl && Math.hypot(fl.x - bl.x, fl.z - bl.z) < 0.0005);
}
// カーソル近傍のパイプ芯線上の点を探す。{pipe, tMm(背面端からの距離mm)} か null。
function pipeAxisTargetAt(clientX, clientY, maxPx) {
  const limitPx = maxPx || INSERT_SNAP_PX;
  const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, cam);
  let best = null;
  for (const p of placedParts) {
    if (p.userData.partType === 'bentpipe' && !p.userData.hidden) {   // R曲げ管＝円弧に沿って最寄り点を探す
      const Lmm = bentArcLenMm(p);
      const N = Math.max(16, Math.ceil(Lmm / 25));
      for (let i = 0; i <= N; i++) {
        const t = (Lmm * i) / N;
        const scr = modelGroup.localToWorld(bentPointAt(p, t)).project(cam);
        if (scr.z >= 1) continue;
        const sx = rect.left + (scr.x * 0.5 + 0.5) * rect.width;
        const sy = rect.top + (-scr.y * 0.5 + 0.5) * rect.height;
        const px = Math.hypot(sx - clientX, sy - clientY);
        if (px > limitPx) continue;
        if (!best || px < best.px) best = { pipe: p, tMm: t, px };
      }
      continue;
    }
    if (p.userData.partType !== 'pipe' || p.userData.hidden || !p.userData.faceLocal) continue;
    const a = modelGroup.localToWorld(connModelPos(p, p.userData.backLocal).clone());
    const b = modelGroup.localToWorld(connModelPos(p, p.userData.faceLocal).clone());
    const ab = b.clone().sub(a), segL = ab.length();
    if (segL < 1e-6) continue;
    const d = ab.multiplyScalar(1 / segL);
    const ro = ray.ray.origin, rd = ray.ray.direction;
    const w0 = a.clone().sub(ro);
    const bDot = d.dot(rd), denom = 1 - bDot * bDot;
    if (denom < 1e-9) continue;                              // 視線と平行＝位置が決まらない
    const t = Math.min(Math.max((bDot * rd.dot(w0) - d.dot(w0)) / denom, 0), segL);   // レイとの最近接（線分内へクランプ）
    const Pw = a.clone().addScaledVector(d, t);
    const scr = Pw.clone().project(cam);
    if (scr.z >= 1) continue;
    const sx = rect.left + (scr.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-scr.y * 0.5 + 0.5) * rect.height;
    const px = Math.hypot(sx - clientX, sy - clientY);
    if (px > limitPx) continue;
    if (!best || px < best.px) best = { pipe: p, tMm: t * 1000, px };
  }
  if (best) {
    const Lmm = best.pipe.userData.partType === 'bentpipe' ? bentArcLenMm(best.pipe) : best.pipe.userData.pipe.length;
    if (best.tMm < INSERT_END_MARGIN || best.tMm > Lmm - INSERT_END_MARGIN) return null;
  }
  return best;
}
// モデル座標の点がパイプ芯線の途中（半径1mm以内・端1mm除く）に乗っていれば挿入先とする。
// 中点・交点などの吸着点で「きちっとした位置」へ挿入するための判定（2026-07-29 社長要望）。
function pipeAxisHitAtPoint(pt) {
  for (const p of placedParts) {
    if (p.userData.partType === 'bentpipe' && !p.userData.hidden) {   // R曲げ管：円弧の上（半径1mm以内・端1mm除く）
      const b = p.userData.bent, ang = b.angleDeg * Math.PI / 180;
      const l = pt.clone().sub(p.position).applyQuaternion(p.quaternion.clone().invert());
      const rr = Math.hypot(l.x, l.y);
      if (Math.abs(l.z) > 0.001 || Math.abs(rr - b.R) > 0.001) continue;
      const s = _n2pi(Math.PI - Math.atan2(l.y, l.x)) * b.R;   // 背面端からの弧長(m)
      const tMm = s * 1000, Lmm = bentArcLenMm(p);
      if (tMm < INSERT_END_MARGIN || tMm > Lmm - INSERT_END_MARGIN) continue;
      return { pipe: p, tMm };
    }
    if (p.userData.partType !== 'pipe' || p.userData.hidden || !p.userData.faceLocal) continue;
    const a = connModelPos(p, p.userData.backLocal), b = connModelPos(p, p.userData.faceLocal);
    const ab = b.clone().sub(a), L = ab.length();
    if (L < 1e-6) continue;
    const d = ab.multiplyScalar(1 / L);
    const t = pt.clone().sub(a).dot(d);
    const radial = pt.clone().sub(a).sub(d.clone().multiplyScalar(t)).length();
    if (radial > 0.001) continue;
    const tMm = t * 1000, Lmm = p.userData.pipe.length;
    if (tMm < INSERT_END_MARGIN || tMm > Lmm - INSERT_END_MARGIN) continue;   // 端＝従来の突き合わせに譲る
    return { pipe: p, tMm };
  }
  return null;
}
// 部品の「機点」（面・背面・工作点・ボルト穴）だけの近接判定。四半円点は含めない。
// ＝接続の意図がある点の上でだけ挿入を抑止し、パイプ胴の四半円点（作図用の赤マーク）の上では
//   挿入を邪魔しない（「起点に来ると既定向きで置かれる」不具合の真因。2026-07-29 社長報告）
function connSnapAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
  for (const p of placedParts) {
    if (!p.userData.faceLocal || p.userData.hidden) continue;
    for (const local of connsOf(p)) {
      const ndc = modelGroup.localToWorld(connModelPos(p, local).clone()).project(cam);
      if (ndc.z >= 1) continue;
      const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
      if (Math.hypot(sx - clientX, sy - clientY) <= SNAP_PX) return true;
    }
  }
  return false;
}
// 挿入先の決定（2026-07-29 社長報告への対策）：
// ・部品の機点へ吸着＝従来の突き合わせ配置（mateQuatAtで向きも相手に合う）＝挿入しない。
//   ※同軸に並ぶフランジ組の機点はパイプ軸線上に乗るため、ここで挿入すると誤爆する。
// ・線分（芯線）の端点・中点・交点へ吸着＝その正確な位置へ挿入（「中点へきちっと」ができる）。
// ・どちらも無ければ画面距離で芯線を探す（従来の接近挿入）。
function insertTargetAt(clientX, clientY) {
  if (connSnapAt(clientX, clientY)) return null;   // 機点吸着＝突き合わせ・向き合わせを優先
  let byPt = null;
  if (window.__annSnapPoints) {
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    let best = null, bestD = SNAP_PX;
    for (const pt of window.__annSnapPoints()) {
      const ndc = modelGroup.localToWorld(pt.clone()).project(cam);
      if (ndc.z >= 1) continue;
      const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) { bestD = d; best = pt; }
    }
    if (best) byPt = pipeAxisHitAtPoint(best);
  }
  return byPt || pipeAxisTargetAt(clientX, clientY);
}
// ---- 吸着した相手の向きへ合わせる（2026-07-29 社長要望：フランジ等を相手のフランジへ置く時、毎回回さなくて済むように）----
const MATE_TYPES = { flange: 1, gasket: 1, valve: 1, flex: 1, sight: 1, spool: 1, cap: 1 };
function mateInfoAt(pt) {
  // 同じ点に複数の機点が重なる時（例：面基準ではパイプ端とフランジのフェイスが同位置）は
  // 「フェイス面」を最優先＝フランジがある所へ持って行けば必ず面と面が向き合う（2026-07-29 社長報告）
  let best = null, bestRank = -1;
  for (const q of placedParts) {
    if (q.userData.hidden || !q.userData.faceLocal) continue;
    for (const l of connsOf(q)) {
      if (connModelPos(q, l).distanceTo(pt) > 1e-6) continue;
      const n = connNormalOf(q, l);
      if (!n || n.lengthSq() < 1e-9) continue;
      const u = q.userData, tp = u.partType;
      // フェイス面（フランジの表・ガスケット・フランジ形機器の両端）＝面と面を向かい合わせ（−n）。
      // 溶接端（パイプ・エルボ等）やフランジの背面＝こちらの背を相手へ向ける（+n）。
      const faceMate = (tp === 'gasket') || (tp === 'flange' && l === u.faceLocal) ||
                       (isFlangedBody(u) && (l === u.faceLocal || l === u.backLocal));
      const rank = faceMate ? 2 : (tp === 'flange' ? 1 : 0);
      if (rank <= bestRank) continue;
      const dirN = faceMate ? n.clone().negate() : n.clone();
      best = { part: q, n: n.clone().normalize(),
               q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirN.normalize()) };
      bestRank = rank;
    }
  }
  return best;
}
// ---- 挿入位置から両端（曲がり・分岐）までの距離表示＋数値入力（2026-07-29 社長要望）----
// ←（背面端まで）／（フェイス端まで）→ の2欄。どちらかに数値を入れてEnter＝その位置へ挿入を確定。
let _insDistBox = null, _insL = null, _insR = null, _insPrev = null;
function insDistFocused() { return !!(_insDistBox && (document.activeElement === _insL || document.activeElement === _insR)); }
function ensureInsDistBox() {
  if (_insDistBox) return;
  _insDistBox = document.createElement('div');
  _insDistBox.id = 'insDistBox';
  _insDistBox.style.cssText = 'position:fixed;z-index:95;display:none;align-items:center;gap:4px;padding:3px 8px;font:12px Meiryo,sans-serif;' +
    'color:#1d2c4f;background:rgba(248,250,253,.97);border:1px solid #7fa8e8;border-radius:6px;white-space:nowrap;box-shadow:0 2px 8px rgba(20,40,80,.18)';
  const ist = 'width:58px;text-align:right;border:1px solid #c4ccda;border-radius:4px;padding:1px 3px;background:#fff;color:#1d2c4f;font:inherit';
  _insDistBox.innerHTML = `<span>←</span><input id="insDistL" type="number" step="1" min="1" style="${ist}"><span>mm ｜</span>` +
    `<input id="insDistR" type="number" step="1" min="1" style="${ist}"><span>mm→</span>`;
  document.body.appendChild(_insDistBox);
  _insL = _insDistBox.querySelector('#insDistL');
  _insR = _insDistBox.querySelector('#insDistR');
  const commit = (side) => {
    if (!_insPrev || !followTool) return;
    const L = _insPrev.pipe.userData.partType === 'bentpipe' ? bentArcLenMm(_insPrev.pipe) : _insPrev.pipe.userData.pipe.length;
    const v = parseFloat(side === 'L' ? _insL.value : _insR.value);
    if (!isFinite(v)) return;
    let tMm = side === 'L' ? v : L - v;
    tMm = Math.min(Math.max(tMm, INSERT_END_MARGIN + 0.1), L - INSERT_END_MARGIN - 0.1);
    commitInsertAt(_insPrev.pipe, tMm);
  };
  for (const [el, side] of [[_insL, 'L'], [_insR, 'R']]) {
    el.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(side); }
      if (e.key === 'Escape') { e.preventDefault(); el.blur(); }
    });
    ['pointerdown', 'click'].forEach(ev => el.addEventListener(ev, e => e.stopPropagation()));
  }
  ['pointerdown', 'click'].forEach(ev => _insDistBox.addEventListener(ev, e => e.stopPropagation()));
}
function showInsDist(cx, cy, hit) {
  ensureInsDistBox();
  _insPrev = { pipe: hit.pipe, tMm: hit.tMm, radial: hit.radial || null, quat: hit.quat || null };   // ボスは半径方向も控える
  const L = hit.pipe.userData.partType === 'bentpipe' ? Math.round(bentArcLenMm(hit.pipe)) : hit.pipe.userData.pipe.length;
  if (document.activeElement !== _insL) _insL.value = Math.round(hit.tMm);
  if (document.activeElement !== _insR) _insR.value = Math.round(L - hit.tMm);
  // 箱はカーソルを追わず、出す時に一度だけ「調整中のオブジェクトの少し上」へ置く
  //（画面上部の定位置は遠すぎる：2026-07-31 社長要望。追従させると入力しに行く途中で動くので固定のまま）
  if (_insDistBox.style.display !== 'flex') {
    _insDistBox.style.display = 'flex';
    const rect = renderer.domElement.getBoundingClientRect();
    const bw = _insDistBox.offsetWidth || 260;
    const lx = Math.min(Math.max(cx - bw / 2, rect.left + 8), rect.right - bw - 8);
    const ly = Math.max(cy - 130, rect.top + 8);
    _insDistBox.style.left = Math.round(lx) + 'px';
    _insDistBox.style.top = Math.round(ly) + 'px';
  }
}
function hideInsDist() {
  if (_insDistBox) _insDistBox.style.display = 'none';
  _insPrev = null;
}
// ---- ボス（SW BOSS）＝位置を決めたらパイプの外径面へ吸い付かせる（2026-07-29 社長要望）----
// 軸方向の位置は挿入と同じ芯線判定、半径方向はカーソルが指している側。溶接端(-Y)を管表面へ
//（見た目の隙間が出ないよう1mmだけ沈める）。距離ボックスの数値入力（Enter）にも対応。
function isBossTool(o) { return !!(o && o.userData.partType === 'sw' && (o.userData.sw || {}).kind === 'BOSS'); }
// ボスの姿勢＝枝（ローカル+Y）を半径方向へ・ローカルZを管軸に揃える＝ひねりが出ない「通常の角度」
//（setFromUnitVectorsだけだとひねりが不定で、特殊な角度に見える。2026-07-29 社長報告）
// ボスの既定の取り付き側＝真上（縦管なら東）。カーソルの側では決めない（2026-07-29 社長指示）
function bossDefaultRadial(d) {
  let r = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y);
  if (r.lengthSq() < 1e-10) r = new THREE.Vector3(1, 0, 0).addScaledVector(d, -d.x);
  return r.normalize();
}
function bossQuat(radial, axisDir) {
  const y = radial.clone().normalize();
  let z = axisDir.clone().addScaledVector(y, -axisDir.dot(y));
  if (z.lengthSq() < 1e-10) z = new THREE.Vector3(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = y.clone().cross(z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
function bossFitAt(clientX, clientY) {
  const hit = pipeAxisTargetAt(clientX, clientY, 26);   // ボスは太い管の胴の上で離すので少し広め
  if (!hit) return null;
  const p = hit.pipe;
  const aW = modelGroup.localToWorld(connModelPos(p, p.userData.backLocal).clone());
  const bW = modelGroup.localToWorld(connModelPos(p, p.userData.faceLocal).clone());
  const dW = bW.clone().sub(aW).normalize();
  const axisW = aW.clone().addScaledVector(dW, hit.tMm / 1000);
  const radialW = bossDefaultRadial(dW);   // 既定＝真上（縦管なら東）。向きの調整は回転ボタンで
  const outR = (FLG_BORE[p.userData.pipe.sizeA] || 60) / 2000;
  const surfW = axisW.clone().addScaledVector(radialW, Math.max(outR - 0.001, 0));
  const surf = modelGroup.worldToLocal(surfW.clone());
  const radial = modelGroup.worldToLocal(surfW.clone().addScaledVector(radialW, 0.1)).sub(surf).normalize();
  const axisL = modelGroup.worldToLocal(surfW.clone().addScaledVector(dW, 0.1)).sub(surf).normalize();
  return { pipe: p, tMm: hit.tMm, surf, radial, quat: bossQuat(radial, axisL) };
}
// スナップ済みの配置点P（＝プレビューの起点位置）を基準に、その真横のパイプ外面へ合わせる。
// 中点・機点などへスナップして置いた時、その点の軸方向位置がそのまま使われる（2026-07-29 社長報告）。
// Pが芯線上（半径方向が決まらない）や近くにパイプが無い時は、従来のカーソル基準へフォールバック。
function bossFitAtPoint(P, clientX, clientY) {
  let best = null;
  for (const p of placedParts) {
    if (p.userData.partType !== 'pipe' || p.userData.hidden || !p.userData.faceLocal) continue;
    const a = connModelPos(p, p.userData.backLocal), b = connModelPos(p, p.userData.faceLocal);
    const ab = b.clone().sub(a), L = ab.length();
    if (L < 1e-6) continue;
    const d = ab.multiplyScalar(1 / L);
    let t = P.clone().sub(a).dot(d);
    t = Math.min(Math.max(t, INSERT_END_MARGIN / 1000), L - INSERT_END_MARGIN / 1000);
    const axisPt = a.clone().addScaledVector(d, t);
    const rd = P.distanceTo(axisPt);
    if (rd > 0.25) continue;                                 // 250mmより遠い＝そのパイプ狙いではない
    if (!best || rd < best.rd) best = { pipe: p, d, axisPt, rd, tMm: t * 1000 };
  }
  if (!best) return bossFitAt(clientX, clientY);
  const radial = bossDefaultRadial(best.d);   // 既定＝真上（縦管なら東）
  const outR = (FLG_BORE[best.pipe.userData.pipe.sizeA] || 60) / 2000;
  const surf = best.axisPt.clone().addScaledVector(radial, Math.max(outR - 0.001, 0));
  return { pipe: best.pipe, tMm: best.tMm, surf, radial, quat: bossQuat(radial, best.d) };
}
// ボスが乗っている親パイプ（基部が外周面上にあるパイプ）＝回転の基準に使う
function bossHostPipe(part) {
  if (!isBossTool(part) || !part.userData.backLocal) return null;
  const base = connModelPos(part, part.userData.backLocal);
  for (const p of placedParts) {
    if (p.userData.partType !== 'pipe' || p.userData.hidden || !p.userData.faceLocal) continue;
    const a = connModelPos(p, p.userData.backLocal), b = connModelPos(p, p.userData.faceLocal);
    const ab = b.clone().sub(a), L = ab.length();
    if (L < 1e-6) continue;
    const d = ab.multiplyScalar(1 / L);
    const t = base.clone().sub(a).dot(d);
    if (t < -0.001 || t > L + 0.001) continue;
    const axisPt = a.clone().addScaledVector(d, t);
    const outR = (FLG_BORE[p.userData.pipe.sizeA] || 60) / 2000;
    if (Math.abs(base.distanceTo(axisPt) - (outR - 0.001)) > 0.005) continue;   // 外周面（±5mm）に乗っているか
    return { pipe: p, axisPt, dir: d };
  }
  return null;
}
function bossPlaceAt(obj, pipe, tMm, radial, quat) {
  const a = connModelPos(pipe, pipe.userData.backLocal), b = connModelPos(pipe, pipe.userData.faceLocal);
  const d = b.clone().sub(a).normalize();
  const outR = (FLG_BORE[pipe.userData.pipe.sizeA] || 60) / 2000;
  const surf = a.clone().addScaledVector(d, tMm / 1000).addScaledVector(radial, Math.max(outR - 0.001, 0));
  obj.quaternion.copy(quat);
  obj.position.copy(surf).sub(obj.userData.backLocal.clone().applyQuaternion(quat));
  obj.userData.placed = true; obj.userData.orient = 0; obj.userData.roll = 0;
  modelGroup.add(obj); placedParts.push(obj);
}
// 数値入力（Enter）で指定位置へ挿入（またはボスの取り付け）を確定
function commitInsertAt(pipe, tMm) {
  if (!followTool) return;
  const prevRadial = _insPrev && _insPrev.radial, prevQuat = _insPrev && _insPrev.quat;
  const obj = followTool.tool.build();
  computeConns(obj);
  if (isBossTool(obj)) {                                   // ボス＝外径面へ取り付け
    if (!prevQuat || !prevRadial) return;
    if (_insL) _insL.blur();
    if (_insR) _insR.blur();
    hideInsDist(); clearPairGhost();
    bossPlaceAt(obj, pipe, tMm, prevRadial, prevQuat);
    refreshItemList();
    stopFollow();
    selectPart(obj);
    if (window.__scheduleHistory) window.__scheduleHistory();
    return;
  }
  if (!INSERTABLE_TYPES[obj.userData.partType] || !insertAxialOk(obj)) {
    obj.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material && n.material.dispose) n.material.dispose(); });
    return;
  }
  if (_insL) _insL.blur();
  if (_insR) _insR.blur();
  hideInsDist(); clearPairGhost();
  if (insertItemIntoPipe(obj, { pipe, tMm })) {
    refreshItemList();
    stopFollow();
    selectPart(obj);
  } else {
    obj.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material && n.material.dispose) n.material.dispose(); });
  }
}
// ---- 合いフランジの挿入プレビュー＝2枚目＋ガスケットの影も出す（2026-07-29 社長要望）----
let _pairGhost = null;
function clearPairGhost() {
  if (!_pairGhost) return;
  modelGroup.remove(_pairGhost.grp);
  _pairGhost.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
  _pairGhost = null;
}
window.__pairGhostActive = () => !!(_pairGhost && _pairGhost.grp.visible);
// 影を（必要なら）作って各スパン(m)を返す。合いフランジ選択でなければ影を消して null
function pairGhostSpans() {
  const isPair = followPreview && followPreview.userData.partType === 'flange' && flangeOpts.pair === '2';
  if (!isPair) { clearPairGhost(); return null; }
  const spec = followPreview.userData.flange || flangeOpts;
  const gt = (parseFloat(gasketOpts.t) > 0) ? parseFloat(gasketOpts.t) : 3;
  const key = [spec.sizeA, spec.type, spec.cls, spec.face, spec.sch, gt].join('|');
  if (!_pairGhost || _pairGhost.key !== key) {
    clearPairGhost();
    const g = makeGasket({ sizeA: spec.sizeA, cls: spec.cls, t: gt });
    const f2 = makeFlange(spec);
    computeConns(g); computeConns(f2);
    const grp = new THREE.Group();
    for (const o of [g, f2]) {
      o.traverse(m => { if (m.isMesh && m.material) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.45; m.material.depthWrite = false; } });
      grp.add(o);
    }
    modelGroup.add(grp);
    _pairGhost = { grp, key, g, f2,
      s1: followPreview.userData.faceLocal.y - followPreview.userData.backLocal.y,
      tg: g.userData.faceLocal.y - g.userData.backLocal.y,
      s2: f2.userData.faceLocal.y - f2.userData.backLocal.y };
  }
  return _pairGhost;
}
// followPreview（1枚目）の姿勢に沿って、ガスケット＋2枚目の影を面合わせで並べる。
// 挿入プレビューでも通常配置のプレビューでも同じ（2026-07-29 社長要望：配置時も常に2枚見せる）
function updatePairGhost() {
  const P = pairGhostSpans();
  if (!P) return;
  const q1 = followPreview.quaternion;
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q1).normalize();   // 1枚目のフェイス方向
  const F = connModelPos(followPreview, followPreview.userData.faceLocal);
  const q2 = q1.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
  P.g.quaternion.copy(q1);
  P.g.position.copy(F).sub(P.g.userData.backLocal.clone().applyQuaternion(q1));            // ガスケット背面＝1枚目フェイス
  P.f2.quaternion.copy(q2);
  P.f2.position.copy(F).addScaledVector(n, P.tg).sub(P.f2.userData.faceLocal.clone().applyQuaternion(q2));   // 2枚目フェイス＝ガスケット面
  P.grp.visible = true;
}
// 挿入する部品列（軸方向の並び）を組む。{train:[{obj,flip}], span(mm), dsSize(下流の径|null)}
function buildInsertTrain(obj, pipe) {
  const u = obj.userData, pu = pipe.userData.pipe;
  const train = []; let dsSize = null;
  const gskT = (parseFloat(gasketOpts.t) > 0) ? parseFloat(gasketOpts.t) : 3;
  if (u.partType === 'flange' && flangeOpts.pair === '2') {
    const g = makeGasket({ sizeA: u.flange.sizeA, cls: u.flange.cls, t: gskT });
    const f2 = makeFlange(u.flange);
    train.push({ obj, flip: false }, { obj: g, flip: false }, { obj: f2, flip: true });   // 2枚目は面を向かい合わせ
  } else if (isFlangedBody(u)) {
    const spec = u[u.partType] || {};
    const sizeA = spec.sizeA || pu.sizeA;
    const cls = bodyRatingOf(u) || flangeOpts.cls;
    const fType = (typeof classesForType === 'function' && classesForType(flangeOpts.type).includes(cls)) ? flangeOpts.type : 'SOP';
    let fl1 = null, fl2 = null;
    try { fl1 = makeFlange({ sizeA, type: fType, cls, face: flangeOpts.face, sch: pu.sch });
          fl2 = makeFlange({ sizeA, type: fType, cls, face: flangeOpts.face, sch: pu.sch }); } catch (e) { fl1 = null; }
    if (fl1 && fl2) {
      const g1 = makeGasket({ sizeA, cls, t: gskT }), g2 = makeGasket({ sizeA, cls, t: gskT });
      train.push({ obj: fl1, flip: false }, { obj: g1, flip: false }, { obj, flip: false },
                 { obj: g2, flip: false }, { obj: fl2, flip: true });
    } else train.push({ obj, flip: false });                 // 規格外＝機器だけ挿入
  } else {
    train.push({ obj, flip: false });
  }
  // 面基準（案A・2026-07-29 社長採用）：SOPフランジは長さを消費しない（ハブは管に被さり、フェイスが区切り）。
  // 消費するのはガスケット厚・バルブ等の面間・WN/SWフランジの全高だけ＝面間の寸法が図面のまま揃う。
  // LJはスタブエンドが管を置き換える＝スタブ全高を消費し、起点は管口（2026-08-04 社長指示）。
  let span = 0;
  for (const it of train) {
    computeConns(it.obj);
    const u2 = it.obj.userData;
    it.sopFl = u2.partType === 'flange' && (u2.flange || {}).type === 'SOP';
    it.adv = it.sopFl ? 0 : (u2.faceLocal.y - u2.backLocal.y) * 1000;
    span += it.adv;
  }
  return { train, span, dsSize };
}
// R曲げ管の途中へのフランジ挿入（2026-07-30 社長要望）。管を切ってフランジを溶接する想定＝
// フランジのみ対応（バルブ等は両フェイスが平行にならず現実に入らないため断る）。
// 挿入部品は挿入点の接線に沿って置き、曲げ管は弧長で L1/L2 に分割する（面基準＝SOPは長さ消費なし）。
function insertItemIntoBentPipe(obj, hit) {
  const pipe = hit.pipe, bent = pipe.userData.bent;
  const disposeOf = (o) => o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material && n.material.dispose) n.material.dispose(); });
  if (obj.userData.partType !== 'flange') {
    if (window.__toast) window.__toast('R曲げ管の途中に挿入できるのはフランジだけです（管を切って溶接する想定。バルブ等は両面が平行にならないため入りません）');
    return false;
  }
  const plan = buildInsertTrain(obj, pipe);
  const Lmm = bentArcLenMm(pipe);
  // LJが先頭＝指定点はスタブの管口（2026-08-04 社長指示）。他は挿入中心。
  const ljLead0 = plan.train[0] && plan.train[0].obj.userData.partType === 'flange' &&
                  ((plan.train[0].obj.userData.flange || {}).type === 'LJ');
  const L1 = hit.tMm - (ljLead0 ? 0 : plan.span / 2), L2 = Lmm - hit.tMm - (ljLead0 ? plan.span : plan.span / 2);
  if (L1 < 0.5 || L2 < 0.5) {
    for (const it of plan.train) if (it.obj !== obj) disposeOf(it.obj);
    if (window.__toast) window.__toast(`挿入できません：挿入には${Math.ceil(plan.span)}mm必要です（展開${Math.round(Lmm)}mm）。もう少し中寄りに置いてください`);
    return false;
  }
  const pt = bentPointAt(pipe, hit.tMm);
  const dir = bentAxisAt(pipe, hit.tMm);
  const qIns = bentQuatAt(pipe, hit.tMm);
  const FLIP2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  let s = ljLead0 ? 0 : -plan.span / 2;                    // 指定点からの距離(mm)。LJ先頭＝管口が指定点
  for (const it of plan.train) {
    const o = it.obj, q = qIns.clone();
    if (it.flip) q.multiply(FLIP2);
    o.quaternion.copy(q);
    const anchor = (it.sopFl || it.flip) ? o.userData.faceLocal : o.userData.backLocal;
    o.position.copy(pt).addScaledVector(dir, s / 1000).sub(anchor.clone().applyQuaternion(q));
    o.userData.placed = true; o.userData.orient = 0; o.userData.roll = 0;
    if (pipe.userData.groupId != null) o.userData.groupId = pipe.userData.groupId;
    modelGroup.add(o); placedParts.push(o);
    s += it.adv;
  }
  // 下流側（面側）の新しい曲げ管：φ2＝下流片の背側端の角度へ回して同じ円弧上に載せる
  const R = bent.R;
  const p2 = makeBentPipe({ sizeA: bent.sizeA, sch: bent.sch, R, angleDeg: (L2 / 1000 / R) * 180 / Math.PI });
  computeConns(p2);
  const phi2 = Math.PI - ((hit.tMm + (ljLead0 ? plan.span : plan.span / 2)) / 1000) / R;
  p2.quaternion.copy(pipe.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi2 - Math.PI));
  p2.position.copy(pipe.position);
  p2.userData.placed = true; p2.userData.orient = pipe.userData.orient || 0; p2.userData.roll = pipe.userData.roll || 0;
  if (pipe.userData.mat) p2.userData.mat = pipe.userData.mat;
  if (pipe.userData.groupId != null) p2.userData.groupId = pipe.userData.groupId;
  modelGroup.add(p2); placedParts.push(p2);
  rebuildBentPipe(pipe, (L1 / 1000 / R) * 180 / Math.PI);  // 上流側＝元の曲げ管を短縮（背面端は不動）
  if (typeof _idleSig !== 'undefined') _idleSig = null;
  const extra = plan.span > 0.01 ? `（消費${Math.round(plan.span)}mm）` : '（面基準＝長さ消費なし）';
  if (window.__toast) window.__toast(`フランジを挿入し、R曲げ管を展開 ${Math.round(L1)}mm＋${Math.round(L2)}mm に分割しました${extra}`);
  if (window.__scheduleHistory) window.__scheduleHistory();
  return true;
}
// 挿入の実行。成功=true。失敗（長さ不足）はトーストを出して false（同伴部品は破棄）。
function insertItemIntoPipe(obj, hit) {
  if (hit.pipe.userData.partType === 'bentpipe') return insertItemIntoBentPipe(obj, hit);
  const pipe = hit.pipe, pu = pipe.userData.pipe;
  const plan = buildInsertTrain(obj, pipe);
  const L = pu.length;
  // LJが先頭＝指定点はスタブの管口（そこから下流へスタブが伸びる。2026-08-04 社長指示）。他は挿入中心。
  const ljLead = plan.train[0] && plan.train[0].obj.userData.partType === 'flange' &&
                 ((plan.train[0].obj.userData.flange || {}).type === 'LJ');
  const L1 = hit.tMm - (ljLead ? 0 : plan.span / 2), L2 = L - hit.tMm - (ljLead ? plan.span : plan.span / 2);
  const disposeOf = (o) => o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material && n.material.dispose) n.material.dispose(); });
  if (L1 < 0.5 || L2 < 0.5) {
    for (const it of plan.train) if (it.obj !== obj) disposeOf(it.obj);
    if (window.__toast) window.__toast(`挿入できません：挿入には${Math.ceil(plan.span)}mm必要です（パイプ${Math.round(L)}mm）。もう少し中寄りに置くか、パイプを伸ばしてください`);
    return false;
  }
  const back = connModelPos(pipe, pipe.userData.backLocal).clone();
  const face = connModelPos(pipe, pipe.userData.faceLocal).clone();
  const dir = face.clone().sub(back).normalize();
  const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);   // ローカルY反転
  let s = L1;                                                // パイプ背面端からの距離(mm)
  for (const it of plan.train) {
    const o = it.obj, q = pipe.quaternion.clone();
    if (it.flip) q.multiply(FLIP);
    o.quaternion.copy(q);
    // 面基準：SOP/LJフランジはフェイスを現在位置sへ置く（体は管に被さる・長さ消費0）。
    // それ以外は上流側の機点（flip時はフェイス）をsへ置き、全長ぶん進む
    const anchor = (it.sopFl || it.flip) ? o.userData.faceLocal : o.userData.backLocal;
    o.position.copy(back).addScaledVector(dir, s / 1000).sub(anchor.clone().applyQuaternion(q));
    o.userData.placed = true; o.userData.orient = 0; o.userData.roll = 0;
    if (pipe.userData.groupId != null) o.userData.groupId = pipe.userData.groupId;
    modelGroup.add(o); placedParts.push(o);
    s += it.adv;
  }
  // 下流側の新しいパイプ（レジューサー挿入なら新しい径）
  const p2 = makePipe({ sizeA: plan.dsSize || pu.sizeA, sch: pu.sch, length: L2 });
  computeConns(p2);
  p2.quaternion.copy(pipe.quaternion);
  p2.position.copy(back).addScaledVector(dir, (L1 + plan.span + L2 / 2) / 1000);
  p2.userData.placed = true; p2.userData.orient = pipe.userData.orient || 0; p2.userData.roll = pipe.userData.roll || 0;
  if (pipe.userData.mat) p2.userData.mat = pipe.userData.mat;
  if (pipe.userData.groupId != null) p2.userData.groupId = pipe.userData.groupId;
  modelGroup.add(p2); placedParts.push(p2);
  rebuildPipe(pipe, L1, 'back');                             // 上流側＝元のパイプを短縮（背面端は不動）
  if (typeof _idleSig !== 'undefined') _idleSig = null;
  const nm = (typeof partColumns === 'function') ? partColumns(obj).kind : 'アイテム';
  const extra = plan.span > 0.01 ? `（消費${Math.round(plan.span)}mm）` : '（面基準＝長さ消費なし）';
  if (window.__toast) window.__toast(`${nm}を挿入し、パイプを ${Math.round(L1)}mm＋${Math.round(L2)}mm に分割しました${extra}${plan.dsSize ? `。下流は${plan.dsSize}` : ''}`);
  if (window.__scheduleHistory) window.__scheduleHistory();
  return true;
}

// ===== 配管化③：パイプ切寸（現場でそのまま切れる長さ）=====
// 面基準（案A・2026-07-29 社長採用）：図面のパイプは常に「フェイス面まで」描く。控えは図では見せず、
// ここで切寸に反映する＝切寸＝図面長さ−SOP控え−BWギャップ÷2。
//  ・BW（エルボ・ティー・レジューサー・キャップ・他のパイプ・WNフランジの首）＝ルートギャップの半分を引く。
//    ギャップ0mmの時は縮み代として+0.5mm。例：フランジ→エルボ 25A SGP 面→芯100・ギャップ3mm
//    ＝パイプ図面61.9（=100−38.1）→ 61.9−7.5−1.5＝52.9→53mm（社長の検算と一致）
//  ・SOP/LJフランジの背面＝差し込み（フランジ全高−フェイスからの控え）ぶん長く
//  ・SW継手（エルボ・ティー・ボス等＝機点がソケット底）＝図面はソケット底まで描かれるので、
//    切寸は「SWクリアランス（既定2mm・設定で変更可）だけ短く」。ボスはクリアランス＋ルートギャップ。
//    例：25A SGP フランジ→SW90°エルボ 面→芯100＝100−SOP控え7.5−（中心→ソケット底22.2）−クリアランス2＝68.3（社長の検算と一致）
//  ・SWフランジ・SW形バルブ（機点＝差込み口）＝ソケット深さ−クリアランスぶん長く
//  ・どこにも繋がっていない端・ガスケット面など＝そのまま
function pipeEndJoint(pipe, endLocal) {
  const P = connModelPos(pipe, endLocal);
  const TOL = 0.0015;
  const pp = pipe.userData.pipe;
  // SOP/LJフランジ＝管端がハブ領域（背面〜フェイス）に入っていれば差し込み継手。
  // 2026-07-29 社長指示で差し込みは実寸表現（管端＝フェイス−控え）になったため、点一致ではなく領域で判定する。
  // 調整値＝（フェイス−控え）−現在の管端位置：正しく差し込まれていれば0＝図面長さがそのまま切寸。
  for (const q of placedParts) {
    if (q === pipe || q.userData.hidden || q.userData.partType !== 'flange') continue;
    const o = q.userData.flange || {};
    if (o.type !== 'SOP' && o.type !== 'RDF') continue;   // LJは差し込みでなくスタブ管口へのBW（下の機点判定で扱う）
    // レジューシングは小径の穴が差し込み口＝背面と（偏心で寄った）フェイス側の機点で領域を見る
    const B = connModelPos(q, q.userData.backLocal);
    const F = (o.type === 'RDF' && q.userData.extraLocals && q.userData.extraLocals[0])
      ? connModelPos(q, q.userData.extraLocals[0]) : connModelPos(q, q.userData.faceLocal);
    const ax = F.clone().sub(B), span = ax.length();
    if (span < 1e-6) continue;
    const d = ax.multiplyScalar(1 / span);
    const t = P.clone().sub(B).dot(d);
    const radial = P.clone().sub(B).sub(d.clone().multiplyScalar(t)).length();
    if (radial > TOL) continue;
    // フェイスからの行き過ぎはガスケット厚ぶん（6mm）まで差し込みとみなす。
    // 実件（2026-08-04 社長のKST-2026-001）＝管端を合いフランジのフェイスへ吸着させたため
    // 手前のフランジのフェイスを3mm（ガスケット厚）突き抜け、SOP判定から漏れて
    // 「突き当て」扱い＝控え8.7が引かれず切寸312.3（正解300.6）になっていた。
    // depth=(全高−控え)−t は行き過ぎ分も自動で差し引くので、切寸は正しく300.6になる。
    const OVER = 0.006;
    if (t < -TOL || t > span + OVER) continue;
    // 管の胴が背面側へ伸びている時だけ「差し込み」。フェイス側に突き当てただけの管は対象外
    const otherLocal = (endLocal === pipe.userData.backLocal) ? pipe.userData.faceLocal : pipe.userData.backLocal;
    if (connModelPos(pipe, otherLocal).clone().sub(P).dot(d) > 0) continue;
    const sop = weldValsOf(pp.sizeA, pp.sch).sop;
    return { kind: 'SOP', with: o.type === 'RDF' ? 'RF' : o.type, depth: Math.round(((span * 1000 - sop) - t * 1000) * 10) / 10 };
  }
  // フランジのフェイス面上で終わる管（面基準の下流側など）＝面への突き当て。
  // 同じ点でもう一方のパイプ端と重なっていても「パイプ同士のBW」に誤判定しない（2026-07-29 案A対応）
  for (const q of placedParts) {
    if (q === pipe || q.userData.hidden || q.userData.partType !== 'flange') continue;
    if (connModelPos(q, q.userData.faceLocal).distanceTo(P) <= TOL) return { kind: 'none' };
  }
  for (const q of placedParts) {
    if (q === pipe || q.userData.hidden || !q.userData.faceLocal) continue;
    const u = q.userData;
    for (const l of connsOf(q)) {
      if (connModelPos(q, l).distanceTo(P) > TOL) continue;
      const BW_NAME = { pipe: 'パイプ', elbow: 'エルボ', tee: 'ティー', reducer: 'レジューサ', cap: 'キャップ' };
      if (BW_NAME[u.partType]) return { kind: 'BW', with: BW_NAME[u.partType] };
      if (u.partType === 'flange') {
        const o = u.flange || {};
        if (l !== u.backLocal) return { kind: 'none' };            // フェイス側＝管の継手ではない
        if (o.type === 'WN') return { kind: 'BW', with: 'WN' };    // 首の先でBW
        if (o.type === 'LJ') return { kind: 'BW', with: 'スタブエンド' };   // スタブの管口へ突き合わせ（2026-08-04 社長指示のモデル）
        if (o.type === 'SW') {
          const C = SW_C_E[o.sizeA] || 0;                          // ソケット深さ（規格表）
          return C > 0 ? { kind: 'SW', with: 'SWフランジ', depth: Math.max(C - weldValsOf(pp.sizeA, pp.sch).swc, 0) } : { kind: 'none' };
        }
        return { kind: 'none' };                                   // SOP/LJは上の領域判定で処理済み。BL等はなし
      }
      if (u.partType === 'sw') {
        const k = u.sw.kind || '';
        // makeSWの機点＝ソケット底＝図面のパイプは奥まで差した表現。切寸は「クリアランス分だけ引く」。
        // ボスはクリアランス＋ルートギャップを引く（2026-07-31 社長検算：SW90E 25A 面→芯100 → 68.3mm）
        const wv = weldValsOf(pp.sizeA, pp.sch);
        return { kind: 'SW', with: k === 'BOSS' ? 'ボス' : 'SW継手', depth: -(k === 'BOSS' ? (wv.swc + wv.gap) : wv.swc) };
      }
      if (u.partType === 'valve' && ['swgate', 'swglobe'].includes((u.valve && u.valve.kind) || '')) {
        const C = SW_C_E[u.valve.sizeA] || 0;
        return C > 0 ? { kind: 'SW', with: 'SWバルブ', depth: Math.max(C - weldValsOf(pp.sizeA, pp.sch).swc, 0) } : { kind: 'none' };
      }
      return { kind: 'none' };                                     // ガスケット・フランジ形機器など
    }
  }
  return { kind: 'free' };
}
function pipeCutInfo(pipe) {
  const u = pipe.userData, o = u.pipe;
  const ends = [pipeEndJoint(pipe, u.backLocal), pipeEndJoint(pipe, u.faceLocal)];
  const w = weldValsOf(o.sizeA, o.sch);
  let cut = o.length;
  for (const e of ends) {
    if (e.kind === 'BW') cut += (w.gap > 0 ? -w.gap / 2 : 0.5);   // ギャップの半分を引く／0mmは縮み代+0.5
    else if (e.kind === 'SOP' || e.kind === 'SW') cut += e.depth;
  }
  // 斜め切り＝芯の長さに対して ±r·tanθ（2026-08-02 社長要望）
  const aF = Math.abs(Number(o.cutAngFace) || 0), aB = Math.abs(Number(o.cutAngBack) || 0);
  if (aF || aB) {
    const rOut = (FLG_BORE[o.sizeA] || 114) / 2;
    const d = rOut * (Math.tan(aF * Math.PI / 180) + Math.tan(aB * Math.PI / 180));
    return { ends, cut: Math.round((cut - d) * 10) / 10, cutMax: Math.round((cut + d) * 10) / 10,
             slant: true, gap: w.gap, sop: w.sop };
  }
  // 被り付き（枝管）＝母管の丸みで切るので切寸は「最短〜最長」（2026-08-02 社長要望）
  if (o.branch && o.branch.hostR > 0) {
    const rOut = (FLG_BORE[o.sizeA] || 114) / 2;
    const bi = branchCutInfo(cut, o.branch.hostR, rOut);
    return { ends, cut: Math.round(bi.min * 10) / 10, cutMax: Math.round(bi.max * 10) / 10,
             branch: true, branchSide: o.branch.side || 'inner', gap: w.gap, sop: w.sop };
  }
  return { ends, cut: Math.round(cut * 10) / 10, gap: w.gap, sop: w.sop };
}
window.__pipeCutInfo = (i) => {
  const p = placedParts[i];
  if (!p || p.userData.partType !== 'pipe') return null;
  const c = pipeCutInfo(p);
  return { cut: c.cut, cutMax: c.cutMax, branch: !!c.branch, branchSide: c.branchSide, slant: !!c.slant, gap: c.gap, sop: c.sop, ends: c.ends.map(e => ({ kind: e.kind, with: e.with || '', depth: e.depth != null ? Math.round(e.depth * 10) / 10 : null })) };
};

// 仮配置：プレビューの姿勢（位置・向き）をそのままコピーして置く＝見た目が完全一致。
// 置いた部品オブジェクトを返す（呼び出し側で選択＝高さ入力フォームを出す）。
function placeToolAt(tool, clientX, clientY) {
  if (!followPreview) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  updateFollowPreview(clientX, clientY);     // 確定直前にプレビュー位置を最新化
  const obj = tool.build();
  computeConns(obj);
  // ▼配管化②：パイプの芯線上に置いたら「挿入」＝パイプを分割して割り込ませ、長さを自動調整。
  // 吸着点（中点・交点など）が芯線上ならその正確な位置へ。パイプ端の吸着＝従来の突き合わせ（プレビューと同じ判定）
  if (INSERTABLE_TYPES[obj.userData.partType] && insertAxialOk(obj)) {
    const hit = insertTargetAt(clientX, clientY);
    if (hit) {
      hideInsDist(); clearPairGhost();
      if (insertItemIntoPipe(obj, hit)) { refreshItemList(); return obj; }
      obj.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material && n.material.dispose) n.material.dispose(); });
      return null;   // 入らない＝置かずに配置モードを継続（理由はトースト済み）
    }
  }
  obj.quaternion.copy(followPreview.quaternion);
  obj.position.copy(followPreview.position);
  // ボス＝置いて手を離した瞬間にパイプの外面へ移す（プレビュー中は通常スナップ。2026-07-29 社長指示）。
  // 基準は「スナップ済みの配置点」＝中点・機点へ吸着して置けばその軸位置の真横に付く
  if (isBossTool(obj)) {
    const bf = bossFitAtPoint(originModelPos(obj).clone(), clientX, clientY);
    if (bf) {
      obj.quaternion.copy(bf.quat);
      obj.position.copy(bf.surf).sub(obj.userData.backLocal.clone().applyQuaternion(bf.quat));
    }
  }
  obj.userData.placed = true;
  obj.userData.orient = followOrient;
  obj.userData.roll = followRoll;
  modelGroup.add(obj);
  placedParts.push(obj);
  // 合いフランジ＝通常配置でも2枚＋ガスケットをセットで置く（2026-07-29 社長要望。プレビューの影と同じ並び）
  if (obj.userData.partType === 'flange' && flangeOpts.pair === '2') {
    const spec = obj.userData.flange;
    const gt = (parseFloat(gasketOpts.t) > 0) ? parseFloat(gasketOpts.t) : 3;
    const g = makeGasket({ sizeA: spec.sizeA, cls: spec.cls, t: gt });
    const f2 = makeFlange(spec);
    computeConns(g); computeConns(f2);
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(obj.quaternion).normalize();
    const F = connModelPos(obj, obj.userData.faceLocal);
    g.quaternion.copy(obj.quaternion);
    g.position.copy(F).sub(g.userData.backLocal.clone().applyQuaternion(g.quaternion));
    f2.quaternion.copy(obj.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    const tgM = g.userData.faceLocal.y - g.userData.backLocal.y;
    f2.position.copy(F).addScaledVector(n, tgM).sub(f2.userData.faceLocal.clone().applyQuaternion(f2.quaternion));
    for (const o2 of [g, f2]) { o2.userData.placed = true; o2.userData.orient = 0; o2.userData.roll = 0; modelGroup.add(o2); placedParts.push(o2); }
  }
  refreshItemList();
  autoInsertGasket(obj);      // フランジ面どうしなら、ここでガスケットを挟んで厚みぶん押し出す
  return obj;
}

// ===================================================================
//  再移動：配置済み部品をダブルクリックで掴む→追従→クリックで置く
// ===================================================================
function startMovePart(part, cx, cy) {
  stopFollow();
  movingPart = part;
  movingOrient = part.userData.orient || 0;
  movingRoll = part.userData.roll || 0;
  moveOrig = part.position.clone();
  moveGroup = moveGroupFor(part);                  // 複数選択ならその他メンバーも一緒に動かす
  // 掴んだ位置と起点の画面オフセットを記録＝差分移動の基準（掴んだ瞬間に起点が指の下へ飛ばない）。
  // タップ判定（moveStarted）にも使う：しきい値未満の指ブレでは動かさない（2026-07-13 社長指摘：
  // ダブルタップのわずかなブレで moveExistingPart が走り、起点がタップ位置へ瞬間移動していた）。
  moveStartPt = (cx != null) ? { x: cx, y: cy } : null;
  moveStarted = false;
  moveGrabOff = { x: 0, y: 0 };
  if (cx != null) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = modelGroup.localToWorld(originModelPos(part).clone()).project(activeCam());
    if (ndc.z < 1) {
      moveGrabOff.x = cx - (rect.left + (ndc.x * 0.5 + 0.5) * rect.width);
      moveGrabOff.y = cy - (rect.top + (-ndc.y * 0.5 + 0.5) * rect.height);
    }
  }
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
  // 差分移動：掴んだ位置と起点の画面オフセットを引いた点で追従＝ドラッグした分だけ動く。
  // 機点スナップも「起点が来るべき位置」で判定されるので従来どおり吸着する。
  const tgt = resolveTarget(clientX - moveGrabOff.x, clientY - moveGrabOff.y, movingPart, curY);
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
  autoInsertGasket(movingPart);   // 移動でフランジ面どうしが合った時もガスケットを挟む
  clearSelPivot();                // 決めていた起点（オレンジの玉）は移動が終わったら片付ける
  if (window.__originPickClear) window.__originPickClear();
  // 動かした先が母管の上なら被り付きにする（2026-08-03 社長指示：置いた時だけでなく動かした時も）
  if (typeof applyBranchIfOnPipe === 'function' && applyBranchIfOnPipe(movingPart) && window.__toast)
    window.__toast('被り付きにしました（母管の内面でカット・母管は貫通）');
  movingPart = null; moveOrig = null; moveGroup = []; movingByDrag = false; moveHoldTap = false;
  moveStartPt = null; moveStarted = false; moveGrabOff = { x: 0, y: 0 };
  const wasMoveCmd = moveMode;
  finishMoveCommand();   // 自由移動1回で「移動」コマンド終了
  if (wasMoveCmd) selectPart(null);   // 移動コマンドで動かした時は選択も解除（直線移動と揃える。2026-07-28 社長指摘）
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
  movingPart = null; moveOrig = null; moveGroup = []; movingByDrag = false; moveHoldTap = false;
  moveStartPt = null; moveStarted = false; moveGrabOff = { x: 0, y: 0 };
  controls.enabled = true;
  clearMarkers();
}
// 現在の姿勢が「向き/回転テーブル」の姿勢と一致しているか（±qは同一姿勢）。
// プロパティの方位角・立面角・回転や角度スピナーで自由回転した後は一致しない。
function tablePoseQuat(dirIdx, rollIdx) {
  const d = DIR_QUATS[((dirIdx % DIR_COUNT) + DIR_COUNT) % DIR_COUNT];
  const r = (((rollIdx | 0) % ROLL_COUNT) + ROLL_COUNT) % ROLL_COUNT;
  return d.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_rollAxis, r * Math.PI / 4));
}
function poseNearTable(p, dirIdx, rollIdx) {
  return Math.abs(tablePoseQuat(dirIdx, rollIdx).dot(p.quaternion)) > 0.99995;
}
// テーブル外（自由回転済み）の姿勢から45°送る：向き＝鉛直軸まわり（方位を送る）／回転＝フェイス軸まわり。
// テーブル姿勢へ巻き戻さない（2026-07-19 社長報告：水平向きフランジが回転ボタンで立面へ飛ぶ不具合の修正）
function stepFreePose(p, shift) {
  const axis = shift ? new THREE.Vector3(0, 1, 0).applyQuaternion(p.quaternion).normalize()
                     : new THREE.Vector3(0, 1, 0);
  const ang = shift ? Math.PI / 4 : -Math.PI / 4;   // 向き送りは方位角+45°（北→東の時計回り。+Y回転は方位角を減らすため負）
  p.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, ang));
}
// 移動中：右クリック＝方向送り、Shift+右クリック＝回転（旧ひねり）切替。起点は保つ。
function cycleMoveOrientation(mode) {   // 自由移動中の3軸45°送り（2026-07-29 3軸化）
  if (!movingPart) return;
  stepPartRotate(movingPart, mode);
  showInteractionMarkers(movingPart, null);
  _idleSig = null; updateForm();
}
// 配置済み（選択中）＝3軸45°送りへ統一。旧名はテスト・他呼び出しの互換で残す。
function cycleSelectedOrientation(mode) { pipeRotate(mode); }
// ---- パイプ・エルボの回転：線分と同じ仕様（起点まわりに45°／Shift=鉛直／垂直時クロス／長押しで角度スピナー） ----
let _pipeRotAxis = null, _pipeTipAxis = null, _pipeTipMode = false;
function resetPipeRotState() { _pipeRotAxis = null; _pipeTipAxis = null; _pipeTipMode = false; _elevStepAxis = null; _elevStepFor = null; _azStepAxis = null; _azStepFor = null; }
// SW継手の回転・向き挙動は対応するBW形状に合わせる（90E/45E=エルボ／T/TR/CROSS=ティー／CAP=キャップ／その他=レジューサ）。
function swShapeOf(part) {
  if (!part || part.userData.partType !== 'sw') return null;
  const k = (part.userData.sw && part.userData.sw.kind) || '';
  if (k === '90E' || k === '45E') return 'elbow';
  if (k === 'T' || k === 'TR' || k === 'CROSS') return 'tee';
  if (k === 'CAP') return 'cap';
  return 'reducer';   // FC/HC/FCR/BOSS/UNION：直管2端＝レジューサ系の横回転
}
// バルブはフランジと同じ向き挙動（離散方向の送り＋ひねり＋角度スピナー）にする。
function valveShapeOf(part) {
  return (part && part.userData.partType === 'valve') ? 'flange' : null;
}
// バルブの挿入時の既定の向き：インライン弁=ハンドル上(index13=X270°でローカル+Z→世界+Y)／安全弁=立て(index2=identity)。
// 挿入時の既定の姿勢（2026-07-27 社長要望：アイテムごとにバラバラだった挿入方向を統一する）。
//   方位＝北 -Z ／ 南 +Z ／ 東 +X ／ 西 -X
//   ・フランジ／パイプ／継手＝面を東へ（dir0＝既定）
//   ・バルブ＝軸を東・ハンドルを上（dir0 + roll6）※従来は北向きだった
//   ・エルボ90/45＝片方の口を真下、もう片方を東へ（dir2＝無回転。
//        エルボはローカル形状がそのまま「東＋真下」なので、回さないのが正解）
//   ・180°エルボ＝両方の口を東へ向け、2つの口を縦に並べる（dir4）
//   ・ティー＝本管を横に寝かせ、枝を東へ（dir13 + roll2）。
//        枝は本管と直角なので、枝を東西に向けると本管は必ず南北向きになる＝ここだけ東向きにできない
//   ・ボス＝縦（dir2＝無回転）
//   ・SW形バルブ800（ゲート/グローブ）＝縦・ハンドルを東へ（dir2 + roll2）
//   ・サイドグラス＝軸を東・のぞき窓を横（東西ではなく南北）へ（dir0 + roll2）
//   ・PG＝立てる（取付ネジが真下）・文字板を東へ（dir2 + roll2）
//   ・安全弁＝入口を下・出口を東（dir2。従来どおり）
// ※ dir/roll の番号は DIR_QUATS（Z軸リング0-8／X軸リング9-17）と 45°×8 のひねり。
//    総当りで「その向きになる組合せ」を求めて決めた値なので、DIR_QUATS を変えたら取り直すこと。
const DEFAULT_POSE = {
  elbow90: { dir: 2, roll: 0 }, elbow45: { dir: 2, roll: 0 },
  return180: { dir: 4, roll: 0 },
  tee: { dir: 13, roll: 2 },
  boss: { dir: 2, roll: 0 },
  vCompact: { dir: 2, roll: 2 },
  sight: { dir: 0, roll: 2 },
  pg: { dir: 2, roll: 2 },
  vSafety: { dir: 2, roll: 0 },
};
function defaultPose(tool) {
  if (!tool) return { dir: DEFAULT_DIR, roll: 0 };
  const p = DEFAULT_POSE[tool.type];
  if (p) return { dir: p.dir, roll: p.roll };
  if (tool.valve) return { dir: 0, roll: 6 };     // バルブ＝軸を東・ハンドルを上
  return { dir: DEFAULT_DIR, roll: 0 };           // フランジ・パイプ・継手・フレキシブル＝面を東へ
}
// 回転・向き挙動上の実効partType（SW・バルブは対応BW形状へ読み替え／BW・パイプ等はそのまま）
function behType(part) { return part ? (swShapeOf(part) || valveShapeOf(part) || part.userData.partType) : null; }
function isFreeRotPart(part) { return !!(part && ['pipe', 'elbow', 'cap', 'tee', 'reducer'].includes(behType(part))); }   // 短押し右クリック45°の対象（レデューサーはキャップと同じ）
function isSpinRotPart(part) { return !!(part && part.userData && part.userData.faceLocal); }   // 長押し角度スピナーの対象＝機点を持つ部品すべて（2026-08-02 回転コマンド廃止に伴い全部品へ拡大）
function is180Elbow(part) { return !!(part && part.userData.partType === 'elbow' && part.userData.elbow && String(part.userData.elbow.kind || '').startsWith('180') && !(part.userData.elbow.cutAngle > 0)); }   // 180°母材の切断エルボは180°扱いしない
// 180°エルボは右クリックとShiftの回転を入れ替える
function rotShift(part, shift) { return is180Elbow(part) ? !shift : shift; }
function partRotPivotDir(part) {     // {pivot, dirRef}：起点（grip）の位置と、起点→最も離れた機点の向き
  const gl = (part.userData.partType === 'pipe')
    ? ((pipeEndSel === 'back') ? part.userData.backLocal : part.userData.faceLocal)
    : rotGripLocalOf(part);   // ボルト穴起点でも回転はフェイス中心基準
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
// ===== 複数選択の回転（2026-08-02 社長指示） =====
// 方位角・立面角・回転は、選択している部品ぜんぶ＋選択中の線を、決めた起点（selPivot。
// 未指定なら主選択の起点）を中心にまとめて回す。軸は主選択の面から決める＝単体の時と同じ操作感。
// これでリボンの「回転」コマンド（鉛直軸まわりだけ）に頼らず3軸で回せる。
function rotSelPartsOf(primary) {
  if (primary && selectedParts.has(primary) && selectedParts.size > 1) return [...selectedParts];
  return primary ? [primary] : [];
}
function rotPivotOf(part) {
  if (selPivot) return selPivot.clone();
  return partRotPivotDir(part).pivot;
}
// 起点まわりに、選択中の部品と線をまとめて回す
function rotateSelAround(primary, pivot, q) {
  consumeMoveArm();
  for (const p of rotSelPartsOf(primary)) rotatePipeAround(p, pivot, q);
  if (window.__annRotateSelBy && window.__annHasSel && window.__annHasSel()) window.__annRotateSelBy(pivot, q);
}
// 「起点を決めた直後（次のタッチで動き出す状態）」で回した時は、移動の待ち受けを解除する。
// ＝起点だけ決めて回す使い方ができる（決めた中心の印は残す）。
function consumeMoveArm() {
  if (!moveReady) return;
  moveReady = false;
  if (moveMode) setMoveMode(false);
  if (selPivot && window.__originPickMark) window.__originPickMark(selPivot);
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
  const t = behType(part);                    // SWは対応BW形状として扱う
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
// ===== 方位角・立面角・回転の3軸45°送り（2026-07-29 社長要望） =====
// 従来の「向き（Z/X軸リング送り）＋回転（Shift）」を、プロパティと同じ3軸へ再編：
//  ・方位角＝世界の鉛直軸まわり45°（北→東まわり＝平面図での向き直し）
//  ・立面角＝フェイス方位の水平直交軸まわり45°（起こす・寝かす）
//  ・回転　＝フェイス法線（部品ローカル+Y）まわり45°（ひねり）
// ピボットは従来どおり起点（grip・パイプは選択端）。姿勢の真実はquaternionなので、
// 送りテーブル(orient/roll)には依存しない＝どんな姿勢からでも同じ向きに効く。
// 互換：mode に従来の boolean が来たら false='az'（旧・向き）／true='roll'（旧・回転）と読む。
function rotModeOf(m) { return m === true ? 'roll' : m === false ? 'az' : (m || 'az'); }
function partAxisFor(part, mode) {
  // 基準となる面＝「今選んでいる起点の端面」（2026-07-30 社長仕様：エルボ等は選択端の面。
  // 工作点（角）を起点にしている時はフェイス側の面）。フランジ等はローカル+Y＝従来どおり
  const u = part.userData;
  let n;
  const gl = (typeof gripLocalOf === 'function') ? gripLocalOf(part) : null;
  if (gl && u.cornerLocal && gl.distanceTo(u.cornerLocal) < 1e-6 && u.faceNormal) {
    n = u.faceNormal.clone().applyQuaternion(part.quaternion).normalize();
  } else if (typeof gripFaceNormal === 'function') {
    n = gripFaceNormal(part);
  } else {
    n = new THREE.Vector3(0, 1, 0).applyQuaternion(part.quaternion).normalize();
  }
  if (mode === 'roll') return n;
  // 面の「縦・横」：面内で世界の鉛直に最も近い軸v（縦）と、それに直交する面内軸h（横）。
  // 方位角＝vまわり＝面が水平方向に動く／立面角＝hまわり＝面が垂直方向に動く（2026-07-30 社長仕様）。
  // 面が寝ている（法線が鉛直）時はvが決まらないので、部品ローカルZを縦の代わりに使う＝必ず面が動く
  let v = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y);
  if (v.lengthSq() < 1e-6) v = new THREE.Vector3(0, 0, 1).applyQuaternion(part.quaternion);
  v.normalize();
  if (mode === 'az') return v;
  return new THREE.Vector3().crossVectors(n, v).normalize();
}
let _elevStepAxis = null, _elevStepFor = null;   // 立面角ボタン連打中の固定軸（真上・真下を跨いで一周できる）
let _azStepAxis = null, _azStepFor = null;       // 方位角ボタン連打中の固定軸（寝姿から起きても同じ向きに回り続ける）
function stepPartRotate(part, mode) {
  mode = rotModeOf(mode);
  // ボスの「回転」＝親パイプの中心（軸）まわりに45°＝外周の上を回って向きを変える（2026-07-29 社長要望）
  if (mode === 'roll' && typeof isBossTool === 'function' && isBossTool(part)) {
    const h = bossHostPipe(part);
    if (h) { rotateSelAround(part, h.axisPt, new THREE.Quaternion().setFromAxisAngle(h.dir, Math.PI / 4)); return; }
  }
  // ボスの「立面角」「方位角」＝起点を中心に世界方位で振る（2026-07-29 社長指示）：
  //   立面角＝南北へ振る（＝東西軸まわり）／方位角＝東西へ振る（＝南北軸まわり）
  if (typeof isBossTool === 'function' && isBossTool(part) && (mode === 'az' || mode === 'el')) {
    const axis = mode === 'el' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    rotateSelAround(part, rotPivotOf(part), new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 4));
    return;
  }
  // 方位角・立面角・回転は常に「今向いているフェイス面」を基準にする（2026-07-30 社長仕様）。
  // 真上/真下向きでも特別扱いしない（旧v0729-Uの世界方位振りは廃止）：
  //  方位角＝鉛直軸まわり（面の向き直し。寝ている面では面内の向き＝プロパティの方位角と同じ）
  //  立面角＝面の水平直交軸まわり（寝ている面はローカルXまわり）／回転＝フェイス法線まわり（中芯は法線軸上）
  const pivot = rotPivotOf(part);
  let axis, ang = Math.PI / 4;
  if (mode === 'az') {
    // 方位角＝常に右回転（上から見て時計回り。2026-07-30 社長仕様）。連打中は軸をラッチ＝一周同じ向き
    if (_azStepFor !== part || !_azStepAxis) { _azStepAxis = partAxisFor(part, 'az'); _azStepFor = part; }
    axis = _azStepAxis; ang = -Math.PI / 4;
    _elevStepAxis = null; _elevStepFor = null;               // 方位を変えたら立面の固定軸は作り直す
  } else if (mode === 'el') {
    // 立面角＝常に選択面に対して同じ向きに回る（起こす方向から一周。2026-07-30 社長仕様＝往復しない）。
    // 連打中は最初に決めた軸で回し続ける＝頂点で軸が反転して往復する不具合の対策
    if (_elevStepFor !== part || !_elevStepAxis) { _elevStepAxis = partAxisFor(part, 'el'); _elevStepFor = part; }
    axis = _elevStepAxis;
    _azStepAxis = null; _azStepFor = null;                   // 立面を動かしたら方位の固定軸は作り直す
  } else {
    axis = partAxisFor(part, mode);   // 回転＝フェイス法線（ロールでは法線が変わらないので固定不要）
  }
  rotateSelAround(part, pivot, new THREE.Quaternion().setFromAxisAngle(axis, ang));
}
function lineRotate45(part, shift) {   // 起点(grip)まわりに45°回す核（パイプ・エルボ・キャップ・ティー共通。追従中も再利用）
  const { pivot, dirRef } = partRotPivotDir(part);
  const q = new THREE.Quaternion().setFromAxisAngle(partRotAxis(part, shift, dirRef), Math.PI / 4);
  rotatePipeAround(part, pivot, q);
}
function pipeRotate(mode) {   // 選択中の部品を3軸45°送り（全部品共通。旧名はテスト互換で残す）
  const part = selectedPart; if (!part || !part.userData.faceLocal) return;
  stepPartRotate(part, mode);
  if (selectedParts.has(part)) setEmissive(part, SEL_COLOR);
  _idleSig = null; updateForm();
}
let _pipeSpin = null;
function pipeRotateSpinStart(mode) {
  mode = rotModeOf(mode);
  const part = selectedPart; if (!isSpinRotPart(part)) return false;
  // ボスの回転スピナー＝親パイプの軸まわり（外周の上を連続で回す）
  if (mode === 'roll' && typeof isBossTool === 'function' && isBossTool(part)) {
    const h = bossHostPipe(part);
    if (h) {
      _pipeSpin = spinRec(part, h.axisPt, h.dir, 0);
      return true;
    }
  }
  // ボスの立面角・方位角スピナー＝起点中心・世界方位の振り（立面角=南北／方位角=東西）を連続で
  if (typeof isBossTool === 'function' && isBossTool(part) && (mode === 'az' || mode === 'el')) {
    const axis = mode === 'el' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    _pipeSpin = spinRec(part, rotPivotOf(part), axis, 0);
    return true;
  }
  // スピナーも常に面基準（2026-07-30 社長仕様。旧v0729-Uの世界方位振りは廃止）
  const pivot = rotPivotOf(part);
  const n360 = v => ((v % 360) + 360) % 360;
  let axis, baseDeg = 0;   // スピナーの初期表示角＝プロパティの方位角/立面角/回転と同じ絶対角
  if (mode === 'az') {
    axis = partAxisFor(part, 'az').negate();   // 面の縦軸まわり。スピナー＋方向＝方位角＋（立ち姿では北→東）
    if (window.__partFaceBearing) baseDeg = n360(window.__partFaceBearing(part));
  } else {
    axis = partAxisFor(part, mode);
    if (mode === 'el' && window.__partFaceElev) baseDeg = n360(window.__partFaceElev(part));
    else if (mode === 'roll' && window.__partFaceRoll) baseDeg = n360(window.__partFaceRoll(part));
  }
  _pipeSpin = spinRec(part, pivot, axis, baseDeg);
  return true;
}
// スピナーの記録＝主選択だけでなく「一緒に回る仲間」の初期姿勢も控える（複数選択の回転。2026-08-02）
function spinRec(part, pivot, axis, baseDeg) {
  consumeMoveArm();
  const grp = rotSelPartsOf(part).map(p => ({ part: p, pos0: p.position.clone(), quat0: p.quaternion.clone() }));
  const ann = !!(window.__annRotSpinStart && window.__annHasSel && window.__annHasSel() && window.__annRotSpinStart());
  return { part, pivot: pivot.clone(), axis: axis.clone(), pos0: part.position.clone(), quat0: part.quaternion.clone(), baseDeg, grp, ann };
}
function pipeRotateSpinApply(deg) {
  if (!_pipeSpin) return;
  const s = _pipeSpin, q = new THREE.Quaternion().setFromAxisAngle(s.axis, deg * Math.PI / 180);
  for (const g of s.grp) {
    g.part.quaternion.copy(g.quat0).premultiply(q);
    g.part.position.copy(s.pivot).add(g.pos0.clone().sub(s.pivot).applyQuaternion(q));
  }
  if (s.ann && window.__annRotSpinApply) window.__annRotSpinApply(s.pivot, q);
  if (selectedParts.has(s.part)) setEmissive(s.part, SEL_COLOR);
  _idleSig = null; updateForm();
}
function pipeRotateSpinEnd() { if (_pipeSpin && _pipeSpin.ann && window.__annRotSpinEnd) window.__annRotSpinEnd(); _pipeSpin = null; }
function pipeRotateSpinCancel() {
  if (!_pipeSpin) return;
  for (const g of _pipeSpin.grp) { g.part.position.copy(g.pos0); g.part.quaternion.copy(g.quat0); }
  if (_pipeSpin.ann && window.__annRotSpinCancel) window.__annRotSpinCancel();
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
// カーソル(ray)を「点 mid を通り dir 方向の直線」へ最近接投影し、mid からの符号付き距離を返す（modelGroupローカル）。
// 逃げ方向(dir)は水平でも垂直でも斜めでもよく、それを固定したまま“足の長さ＝逃げ量”だけを取り出すのに使う。
function projectOffsetAlongDir(cx, cy, mid, dir) {
  const rect = renderer.domElement.getBoundingClientRect();
  placeNdc.x = ((cx - rect.left) / rect.width) * 2 - 1;
  placeNdc.y = -((cy - rect.top) / rect.height) * 2 + 1;
  placeRay.setFromCamera(placeNdc, activeCam());
  const O = modelGroup.worldToLocal(placeRay.ray.origin.clone());                                  // レイ起点（ローカル）
  const D = modelGroup.worldToLocal(placeRay.ray.origin.clone().add(placeRay.ray.direction)).sub(O); // レイ方向（ローカル）
  const v = new THREE.Vector3(dir.x, dir.y, dir.z);
  if (v.lengthSq() < 1e-12) return null;
  v.normalize();
  const w0 = O.clone().sub(mid);
  const a = D.dot(D), b = D.dot(v), d = D.dot(w0), e = v.dot(w0);   // 2直線の最近接点（offset直線側の媒介変数tを解く）
  const denom = a - b * b;
  if (Math.abs(denom) < 1e-9) return null;   // レイと逃げ方向が平行＝決められない
  return (a * e - b * d) / denom;            // dir方向の符号付き距離＝新しい逃げ量
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
  if (!snapOn) return null;                             // 設定でスナップOFF＝吸着しない
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
    if ((exParts && exParts.has(p)) || !p.userData.faceLocal || p.userData.hidden) continue;
    for (const local of snapLocalsOf(p)) consider(connModelPos(p, local));
  }
  if (window.__annSnapPoints) for (const mpos of window.__annSnapPoints()) consider(mpos);   // 線分・寸法線の端点（追従中の線は除外済）
  return best;
}
function updateDirMove(clientX, clientY) {
  if (dirDrag.vert) {   // Shift＋ドラッグ＝Y方向（鉛直）移動（2026-07-19 社長要望）。鉛直線上の機点へ吸着
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    const w0 = modelGroup.localToWorld(dirDrag.startOrigin.clone()).project(cam);
    const w1 = modelGroup.localToWorld(dirDrag.startOrigin.clone().add(new THREE.Vector3(0, 0.1, 0))).project(cam);
    const pxPerM = Math.hypot((w1.x - w0.x) * rect.width, (w1.y - w0.y) * rect.height) / 2 / 0.1;
    if (!(pxPerM > 1e-6)) return;
    const dy = (dirDrag.sy - clientY) / pxPerM;                     // 画面で上へドラッグ＝+Y
    const dir = new THREE.Vector3(0, dy >= 0 ? 1 : -1, 0);
    let dist = Math.abs(dy);
    const exPartsV = new Set([dirDrag.part]);
    if (dirDrag.group) for (const g of dirDrag.group) exPartsV.add(g.part);
    let sxV = clientX, syV = clientY;                                // 吸着判定＝起点の現在位置の画面座標
    const onV = modelGroup.localToWorld(dirDrag.startOrigin.clone().addScaledVector(dir, dist)).project(cam);
    if (onV.z < 1) { sxV = rect.left + (onV.x * 0.5 + 0.5) * rect.width; syV = rect.top + (-onV.y * 0.5 + 0.5) * rect.height; }
    const snapV = nearestDirSnap(dirDrag.startOrigin, dir, sxV, syV, exPartsV);
    if (snapV != null) dist = snapV;
    setPartByOrigin(dirDrag.part, dirDrag.startOrigin.clone().addScaledVector(dir, dist));
    applyGroupDelta(dirDrag.group, dirDrag.part, dirDrag.primaryStartPos);
    if (dirDrag.annFollow) { const d = dirDrag.part.position.clone().sub(dirDrag.primaryStartPos); window.__annMoveApply(d.x, d.y, d.z); }
    drawDirGuide();
    if (snapV != null) addMarker(dirDrag.startOrigin.clone().addScaledVector(dir, dist), 0x39ff8a, markerRadiusFor(dirDrag.part, true));
    return;
  }
  const hit = planeHitAt(clientX, clientY, dirDrag.planeY);
  if (!hit) return;
  // 移動量は「指を置いた地点(startHit)からの差分」で測る。原点基準だと、原点から離れた所を
  // 掴んだ瞬間にそのオフセット分だけ飛んでしまう（タップでも瞬間移動する不具合）。差分基準なら
  // タップ＝移動量ゼロ＝動かない、ドラッグした分だけ動く（掴んだ位置のオフセットも保持される）。
  const base = dirDrag.startHit || dirDrag.startOrigin;
  const vx = hit.x - base.x, vz = hit.z - base.z;
  const ang = Math.round(Math.atan2(vz, vx) / DIR_STEP) * DIR_STEP;     // 45°スナップ
  const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
  let dist = Math.max(0, vx * dir.x + vz * dir.z);                      // 進行方向への投影距離
  // 45°ライン上に本当に乗っている機点があれば、その距離へ吸着（along のみ合わせるのでラインは崩れない）
  const exParts = new Set([dirDrag.part]);
  if (dirDrag.group) for (const g of dirDrag.group) exParts.add(g.part);
  // 吸着判定は「起点の現在位置」の画面座標で行う（カーソル基準だと、起点から離れた所を掴んだ時に
  // カーソルが機点の上を通っただけで起点が吸着＝起点以外の場所でスナップして飛ぶ）
  let sx = clientX, sy = clientY;
  {
    const rect = renderer.domElement.getBoundingClientRect();
    const on = modelGroup.localToWorld(dirDrag.startOrigin.clone().add(dir.clone().multiplyScalar(dist))).project(activeCam());
    if (on.z < 1) { sx = rect.left + (on.x * 0.5 + 0.5) * rect.width; sy = rect.top + (-on.y * 0.5 + 0.5) * rect.height; }
  }
  const snapAlong = nearestDirSnap(dirDrag.startOrigin, dir, sx, sy, exParts);
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
const hDirInput = document.getElementById('hDir');   // 移動の向き（空＝ドラッグの向き）
const legXInput = document.getElementById('legX');
const legZInput = document.getElementById('legZ');
const legXBox = document.getElementById('legXBox');
const legZBox = document.getElementById('legZBox');
// 高さラベル：フェイスが立っている(法線が水平)=COP(管中心高さ)、寝ている(法線が上下)=EL(基準面高さ)
// ティーは主管×枝管の交点(中心)を高さ基準とするため常に COP。
const _zeroLocal = new THREE.Vector3(0, 0, 0);
function heightLabelFor(obj) {
  return 'EL';   // 高さ表記はELに統一（2026-07-19 社長要望。旧：向きによりCOP/EL切替）
}
// 高さ基準点(model座標)。ティーは主管×枝管の交点(ローカル原点=中心)、他は起点(grip)。
function heightRefModelPos(obj) {
  if (behType(obj) === 'tee') return connModelPos(obj, _zeroLocal);
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
  if (window.__propsRefresh) window.__propsRefresh();   // プロパティパネルへ選択・値の変化を通知（早期returnより前）
  if (!hYInput) return;
  if (dirActive()) {
    if (hLabel) hLabel.textContent = dirDrag.vert ? '距離(上下)' : '距離';
    // 入力中は書き換えない＝数字を全部消せる（2026-08-02 社長「0の数字まで削除できない」）
    if (document.activeElement === hYInput) return;
    const cur = originModelPos(dirDrag.part);
    hYInput.value = Math.round((dirDrag.vert ? Math.abs(cur.y - dirDrag.startOrigin.y)
                                             : Math.hypot(cur.x - dirDrag.startOrigin.x, cur.z - dirDrag.startOrigin.z)) * 1000);
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
    if (pipeLenInputMode()) {   // 端スライド中／スライド後＝「長さ」をキーボード入力
      if (hLabel) hLabel.textContent = '長さ';
      if (document.activeElement !== hYInput) hYInput.value = Math.round(selectedPart.userData.pipe.length);   // 編集中は上書きしない
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
  if (hDirInput) hDirInput.style.display = dirActive() ? '' : 'none';   // 方向欄は距離入力の時だけ出す
  // 配置済みオブジェクトを選択しただけでは空間上の入力フォーム（EL/COP/長さ）は出さない
  // （2026-07-18 社長要望：値の表示・編集はプロパティパネルへ集約＝画面を広く使う）。
  // 例外＝方向ドラッグの距離入力（移動コマンドの操作中だけ従来どおり表示）
  if (!dirActive()) { hForm.style.display = 'none'; return; }
  if (window.__mirrorActive && window.__mirrorActive()) { hForm.style.display = 'none'; return; }   // 鏡モード中は入力フォームを出さない
  if (window.__rotateActive && window.__rotateActive()) { hForm.style.display = 'none'; return; }   // 回転モード中も同様
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
  const refLocal = (behType(selectedPart) === 'tee') ? _zeroLocal : gripLocalOf(selectedPart);
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
// 距離入力→その距離だけ起点から移動。向きは「方向」欄で選べる（未選択＝ドラッグで決めた向き）。
// 旧＝ドラッグ前に数値だけ入れると必ず東(+X)へ動いていた（2026-08-02 社長指摘）。
function applyDistInput() {
  if (!dirDrag) return;
  if (String(hYInput.value).trim() === '') return;      // 空欄＝まだ動かさない（消している途中）
  const cur = originModelPos(dirDrag.part);
  const ox = cur.x - dirDrag.startOrigin.x, oz = cur.z - dirDrag.startOrigin.z;
  const len = Math.hypot(ox, oz);
  const D = Math.max(0, (parseFloat(hYInput.value) || 0) / 1000);
  const sel = hDirInput ? hDirInput.value : '';
  let dx, dy = 0, dz;
  if (sel === 'x+') { dx = 1; dz = 0; }
  else if (sel === 'x-') { dx = -1; dz = 0; }
  else if (sel === 'z+') { dx = 0; dz = 1; }
  else if (sel === 'z-') { dx = 0; dz = -1; }
  else if (sel === 'y+') { dx = 0; dz = 0; dy = 1; }
  else if (sel === 'y-') { dx = 0; dz = 0; dy = -1; }
  else if (len > 1e-6) { dx = ox / len; dz = oz / len; }          // ドラッグで決めた向き
  else {                                                          // まだ向きが決まっていない＝縦移動中ならY、そうでなければ動かさない
    if (!dirDrag.vert) return;
    dx = 0; dz = 0; dy = Math.sign(cur.y - dirDrag.startOrigin.y) || 1;
  }
  setPartByOrigin(dirDrag.part, new THREE.Vector3(dirDrag.startOrigin.x + dx * D,
                                                  dirDrag.startOrigin.y + dy * D,
                                                  dirDrag.startOrigin.z + dz * D));
  applyGroupDelta(dirDrag.group, dirDrag.part, dirDrag.primaryStartPos);
  dirDrag.locked = true;
  drawDirGuide();
}
if (hYInput) {
  const applyHY = () => {
    if (dirActive()) applyDistInput();
    else if (lineElRef()) window.__lineApplyEl(parseFloat(hYInput.value) || 0);   // 線分EL（起点指定の有無で全体/片側）
    else if (pipeLenInputMode()) applyPipeLength();   // 端スライド後＝長さをキーボードで伸縮（起点側が動く）
    else if (pipeSelected()) applyPipeCOP();   // パイプCOP（端クリック＝その端だけ傾け／未選択＝全体）
    else applyHeightInput();
  };
  hYInput.addEventListener('input', applyHY);    // スピナー長押し・連続増減でも追従
  hYInput.addEventListener('change', applyHY);
  if (hDirInput) {                                // 向きを選んだら、その場でその方角へ動かし直す
    hDirInput.addEventListener('change', () => { if (dirActive()) { applyDistInput(); updateForm(); } });
    ['pointerdown', 'click'].forEach(ev => hDirInput.addEventListener(ev, e => e.stopPropagation()));
  }
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
      else if (pipeLenInputMode()) { applyPipeLength(); updateForm(); }        // 端スライド後＝長さ確定（選択は維持）
      else if (pipeSelected()) { applyPipeCOP(); updateForm(); }              // パイプCOP確定（端クリック＝傾け／未選択＝全体）
      else { applyHeightInput(); selectPart(null); }                          // フランジCOP確定→選択解除
      hYInput.blur();   // iPad：確定したらキーボードを閉じる（xline連鎖は上で既にblur済み・二重でも無害）
    }
    e.stopPropagation();
  });
}
[legXInput, legZInput].forEach(inp => {
  if (!inp) return;
  inp.addEventListener('input', applyLegInputs);    // スピナー長押し・連続増減でも追従
  inp.addEventListener('change', applyLegInputs);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { applyLegInputs(); dirDrag = null; clearMarkers(); updateForm(); inp.blur(); }  // 確定→ロック解除・補助線消去＋キーボードを閉じる（iPad）
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
  box.style.display = 'inline-flex';
  // 線に被せない（2026-08-02 社長指摘）。外向きへ「欄の半分＋余白」だけ離す＝
  // 欄のふちが線に触れない。横に出る時は幅の半分、上下に出る時は高さの半分で効かせる。
  const off = 10 + Math.abs(ox) * box.offsetWidth / 2 + Math.abs(oy) * box.offsetHeight / 2;
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
  if (hideArmed && obj) { setHideArmed(false); hidePickedPart(obj); return; }   // 「非表示」実行待ち＝選択せず隠す（1回で終了）
  if (additive) { toggleSelect(obj); return; }
  clearClash();   // 干渉表示中なら赤表示を解除（次の操作で消える仕様）
  if (typeof resetPipeRotState === 'function') resetPipeRotState();   // 選択が変わったらパイプ回転軸をリセット
  clearSelPivot();   // 選択をやり直したら、決めていた起点（回転の中心）も消す
  if (window.__annClearSel) window.__annClearSel();   // 部品を単独選択/解除したら線選択も解除（部品と排他）
  if (pipeEndDrag && pipeEndDrag.part !== obj) { pipeEndDrag = null; controls.enabled = true; }
  if (dirDrag && dirDrag.part !== obj) { dirDrag = null; controls.enabled = true; clearMarkers(); }
  if (selectedPart !== obj) { pipeEndSel = null; pipeLenSticky = false; }   // 別部品/解除なら起点選択・長さモードを外す（_idleSigは更新判定に任せる）
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
  // 選択してもパレットへは映さない（2026-07-29 社長指示：パレットは新規配置の設定専用。
  // 配置済みの編集は空間内の操作かプロパティで行う＝syncPaletteToPart は呼ばない）
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
  if (window.__toast) window.__toast('グループにしました');
}
function ungroupSelection() {
  const gids = new Set();
  for (const p of selectedParts) if (p.userData.groupId != null) gids.add(p.userData.groupId);
  if (window.__annSelGroupIds) for (const g of window.__annSelGroupIds()) gids.add(g);
  if (!gids.size) return;
  for (const p of placedParts) if (gids.has(p.userData.groupId)) p.userData.groupId = null;
  if (window.__annClearGroupIds) window.__annClearGroupIds(gids);
  refreshItemList();
  if (window.__toast) window.__toast('グループを解除しました');
}
// Ctrl+クリック：対象を選択集合に出し入れする（主選択 selectedPart も更新）
function toggleSelect(obj) {
  if (!obj) return;                          // 空クリックは現在の選択を保持
  clearSelPivot();                           // 選択を足し引きしたら起点（回転の中心）は決め直す
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

// ===== 表示／非表示（2026-07-17 社長要望） =====
// 「非表示」＝CAD式の1回きりコマンド：①選択→非表示（即実行）②非表示→タップしたアイテムを隠す（1回で終了・Esc/再押下で取消）。
// 「再表示」＝隠した全アイテムを一括で戻す。非表示中もアイテムリスト・自動集計には載る（表示だけの補助機能）。
// 隠したアイテムは選択・スナップ・窓選択・干渉チェックの対象から外れる。保存ファイル・元に戻すにも引き継がれる。
let hideArmed = false;   // true=「非表示」コマンド実行待ち（次に選んだアイテムを隠す）
function setHideArmed(on) {
  hideArmed = !!on;
  const b = document.getElementById('cmdHide');
  if (b) b.classList.toggle('active', hideArmed);
}
function hidePartOnly(p) {   // 1部品を隠す（選択からも外す）。画面更新は呼び元で行う
  p.userData.hidden = true; p.visible = false;
  setEmissive(p, 0x000000);
  selectedParts.delete(p);
  if (selectedPart === p) { selectedPart = null; pipeEndSel = null; pipeLenSticky = false; }
}
function hideSelectedObjects() {   // 選択中の部品＋注釈を隠す。返り値＝隠した件数
  const parts = [...selectedParts];
  for (const p of parts) hidePartOnly(p);
  const nAnn = window.__annHideSel ? window.__annHideSel() : 0;
  clearMarkers(); updateForm(); refreshItemList();
  // 非表示も履歴に積む＝これが無いと「非表示→別の操作→元に戻す」で非表示まで巻き戻り、
  // 再表示を押していないのに表示される（2026-08-04 社長報告の真因）
  if (window.__scheduleHistory) window.__scheduleHistory();
  return parts.length + nAnn;
}
// コマンド実行待ち中にタップされた部品を隠す（グループの一員なら同グループの部品・注釈も一緒に隠す）
function hidePickedPart(obj) {
  const gid = obj.userData ? obj.userData.groupId : null;
  const targets = gid != null ? placedParts.filter(p => p.userData.groupId === gid) : [obj];
  for (const p of targets) hidePartOnly(p);
  let n = targets.length;
  if (gid != null && window.__annHideGroup) n += window.__annHideGroup(gid);
  clearMarkers(); updateForm(); refreshItemList();
  if (window.__scheduleHistory) window.__scheduleHistory();   // 非表示も履歴に積む（元に戻すで勝手に再表示させない）
  if (window.__toast) window.__toast('非表示：' + n + '件を隠しました（「再表示」で戻せます）');
}
function hideCommand() {   // リボン「非表示」ボタン
  if (hideArmed) { setHideArmed(false); if (window.__toast) window.__toast('非表示：取り消しました'); return; }
  const nSel = selectedParts.size + (window.__annSelCount ? window.__annSelCount() : 0);
  if (nSel) {
    const n = hideSelectedObjects();
    if (window.__toast) window.__toast('非表示：' + n + '件を隠しました（「再表示」で戻せます）');
  } else {
    clearOtherCommands('hide');                          // 他のコマンドは解除（同時に光らせない）
    setHideArmed(true);

  }
}
function showAllHidden() {   // リボン「再表示」ボタン＝隠した全アイテムを戻す
  let n = 0;
  for (const p of placedParts) if (p.userData.hidden) { p.userData.hidden = false; p.visible = true; n++; }
  n += window.__annShowAll ? window.__annShowAll() : 0;
  refreshItemList();
  if (n && window.__scheduleHistory) window.__scheduleHistory();   // 再表示も履歴に積む
  if (window.__toast) window.__toast(n ? '再表示：' + n + '件を表示しました' : '非表示のアイテムはありません');
}

// ===================================================================
//  設置アイテム一覧（右側パネル）
// ===================================================================
// 配置済み部品1個を「種別(末尾に形状記号まで)・タイプ(将来のBW/SW/SCRD用・現状空)・サイズ・クラス」に分解。
// 種別の例: フランジ / 90°エルボ(L) / ティー(RT) / レジューサ(E) / キャップ。
function partColumns(p) {
  const u = p.userData;
  switch (u.partType) {
    case 'flange': { const o = u.flange || {};
      // レジューシング＝呼び径は「大×小」・型に同心/偏心を添える（2026-08-03 社長要望）
      if (o.type === 'RDF') return { kind: 'フランジ', type: `RF(${o.ecc ? '偏心' : '同心'})`, size: `${o.sizeA || ''}×${o.sizeB || ''}`, cls: o.cls || '' };
      return { kind: 'フランジ', type: o.type || '', size: o.sizeA || '', cls: o.cls || '' }; }
    case 'gasket': { const o = u.gasket || {}; return { kind: 'ガスケット', type: `t${o.t != null ? o.t : 3}`, size: o.sizeA || '', cls: o.cls || '' }; }
    case 'pipe':   { const o = u.pipe || {};
      // 表示はCSVの切寸表と同じ「切寸」に揃える（2026-07-31 社長指示）。未配置（プレビュー等）は図面長のまま
      let L = Math.round((o.length || 0) * 10) / 10, tp = null;
      try {
        if (u.placed && typeof pipeCutInfo === 'function') {
          const c = pipeCutInfo(p); L = c.cut;
          if (c.branch) tp = `被付 L${c.cut}〜${c.cutMax}`;   // 被り付き＝母管の丸みで切るので最短〜最長
          else if (c.slant) tp = `斜切 L${c.cut}〜${c.cutMax}`;   // 斜め切り＝最短〜最長
        }
      } catch (e) {}
      return { kind: 'パイプ', type: tp || `L${L}`, size: o.sizeA || '', cls: o.sch || '' }; }
    case 'bentpipe': { const o = u.bent || {}; const len = Math.round((o.R || 0) * (o.angleDeg || 0) * Math.PI / 180 * 1000); return { kind: 'パイプ', type: `R曲げR${Math.round((o.R || 0) * 1000)} 展開L${len}`, size: o.sizeA || '', cls: o.sch || '' }; }
    case 'elbow':  { const o = u.elbow || {};  const nm = {'90L':'90°エルボ','90S':'90°エルボ','45L':'45°エルボ','45S':'45°エルボ','180L':'180°エルボ','180S':'180°エルボ'}; let tp = (o.kind && o.kind.endsWith('S')) ? 'BW(S)' : 'BW(L)'; if (o.cutAngle > 0) tp += `切${Math.round(o.cutAngle * 10) / 10}°`; return { kind: nm[o.kind] || 'エルボ', type: tp, size: o.sizeA || '', cls: o.sch || '' }; }
    case 'cap':    { const o = u.cap || {};    return { kind: 'キャップ', type: 'BW', size: o.sizeA || '', cls: o.sch || '' }; }
    case 'tee':    { const o = u.tee || {};    const rt = (o.sizeB && o.sizeB !== o.sizeA); return { kind: 'ティー', type: rt ? 'BW(RT)' : 'BW(T)', size: rt ? `${o.sizeA}×${o.sizeB}` : (o.sizeA || ''), cls: o.sch || '' }; }
    case 'reducer':{ const o = u.reducer || {};return { kind: 'レジューサ', type: o.ecc ? 'BW(E)' : 'BW(C)', size: `${o.sizeA || ''}×${o.sizeB || ''}`, cls: o.sch || '' }; }
    case 'sw':     { const o = u.sw || {}; const nm = {'90E':'90°エルボ','45E':'45°エルボ','T':'ティー','TR':'ティー','CROSS':'クロス','FC':'カップリング','HC':'カップリング','FCR':'カップリング','BOSS':'ボス','CAP':'キャップ','UNION':'ユニオン'}; const tp = {'FC':'FC','HC':'HC','FCR':'FCR','T':'SW(T)','TR':'SW(RT)'}[o.kind] || 'SW'; const rb = (o.sizeB && o.sizeB !== o.sizeA); return { kind: nm[o.kind] || 'SW継手', type: tp, size: rb ? `${o.sizeA}×${o.sizeB}` : (o.sizeA || ''), cls: 'Sch80' }; }
    case 'valve':  { const o = u.valve || {}; const nm = {ball:'ボールバルブ',gate:'ゲートバルブ',globe:'グローブバルブ',check:'チェッキバルブ',strainer:'ストレーナー(Y)',butterfly:'バタフライバルブ',safety:'安全弁(アングル)',swgate:'コンパクトバルブ',swglobe:'コンパクトバルブ'}; let tp = '', cls = '', sz = o.sizeA || ''; if (o.kind === 'butterfly') { tp = (o.style === 'wafer' ? 'ウエハー' : 'フランジ'); cls = o.rating || ''; } else if (o.kind === 'swgate' || o.kind === 'swglobe') { tp = (o.kind === 'swgate' ? 'ゲート' : 'グローブ'); cls = 'Class800'; } else { cls = o.rating || ''; } if (o.kind === 'safety' && o.sizeB) sz = `${o.sizeA}×${o.sizeB}`; return { kind: nm[o.kind] || 'バルブ', type: tp, size: sz, cls }; }
    case 'flex':   { const o = u.flex || {};   return { kind: 'フレキシブル', type: `L${Math.round(o.length || 0)}`, size: o.sizeA || '', cls: o.cls || '' }; }
    case 'spool':  { const o = u.spool || {};  return { kind: '仮管', type: `${o.type === 'スペーサー' ? 'SP' : 'FLG'} L${Math.round(o.length || 0)}`, size: o.sizeA || '', cls: o.cls || '' }; }
    case 'sight':  { const o = u.sight || {};  return { kind: 'サイドグラス', type: `L${Math.round(o.length || 0)}`, size: o.sizeA || '', cls: o.cls || '' }; }
    case 'pg':     { const o = u.pg || {};     return { kind: 'PG(圧力計)', type: `${o.thread || ''}${o.siphon === false ? '' : '＋サイフォン'}`, size: `${o.dia || 100}Φ`, cls: '' }; }
    default: return { kind: u.partType || 'アイテム', type: '', size: '', cls: '' };
  }
}
// 種別の並び順＝ツールパレット(TOOLS=形状ファミリ)の順。partType＋種別から所属ファミリの順位を引く。
const _typeOrder = {};
TOOLS.forEach((t, i) => { _typeOrder[t.type] = i; });
function partTypeRank(p) {
  const u = p.userData;
  const r = fam => (_typeOrder[fam] != null ? _typeOrder[fam] : 99);
  if (u.partType === 'bentpipe') return r('pipe');
  if (u.partType === 'tee')     return r('tee');
  if (u.partType === 'reducer') return r('reducer');
  if (u.partType === 'cap')     return r('cap');
  if (u.partType === 'elbow') {
    const k = (u.elbow && u.elbow.kind) || '';
    return r(k.startsWith('45') ? 'elbow45' : (k.startsWith('180') ? 'return180' : 'elbow90'));
  }
  if (u.partType === 'sw') {
    const k = (u.sw && u.sw.kind) || '';
    const map = { '90E':'elbow90','45E':'elbow45','T':'tee','TR':'tee','CROSS':'cross','FC':'coupling','HC':'coupling','FCR':'coupling','BOSS':'boss','CAP':'cap','UNION':'union' };
    return r(map[k] || u.partType);
  }
  if (u.partType === 'valve') {
    const k = (u.valve && u.valve.kind) || '';
    const map = { ball:'vBall', gate:'vGate', globe:'vGlobe', check:'vCheck', strainer:'vStrainer', butterfly:'vButterfly', safety:'vSafety', swgate:'vCompact', swglobe:'vCompact' };
    return r(map[k] || u.partType);
  }
  return r(u.partType);
}
// ===== 自動採寸・溶接番号の下ごしらえ（2026-07-31 社長採用） =====
// 芯線ラン＝パイプと「軸方向へ真っ直ぐ通り抜ける繋ぎ物」（フランジ・ガスケット・バルブ・仮管等）を
// 同一直線でつないだひとまとまり。芯々寸法はランの両端の工作点（エルボの角・ティーの芯）どうしで取る。
function _autoDimSegs() {
  const segs = [];
  for (const p of placedParts) {
    const u = p.userData;
    if (u.hidden || !u.faceLocal || !u.backLocal || !u.placed) continue;
    if (u.partType === 'pipe') { segs.push({ p, pipe: true, a: connModelPos(p, u.backLocal), b: connModelPos(p, u.faceLocal) }); continue; }
    if (u.partType === 'elbow' || u.partType === 'tee' || u.partType === 'bentpipe' || u.partType === 'pg') continue;
    if (u.partType === 'sw' && !['FC', 'HC', 'FCR', 'UNION'].includes((u.sw || {}).kind)) continue;
    if (!insertAxialOk(p)) continue;
    const a = connModelPos(p, u.backLocal), b = connModelPos(p, u.faceLocal);
    if (a.distanceTo(b) < 0.0005) continue;
    segs.push({ p, pipe: false, a, b });
  }
  return segs;
}
function autoDimRuns() {
  const TOL = 0.0015;
  const segs = _autoDimSegs();
  const used = new Array(segs.length).fill(false);
  const runs = [];
  const dirOf = s => s.b.clone().sub(s.a).normalize();
  // pass0＝パイプを本体にしたラン。pass1＝パイプの無い連なり（アイテムにフランジを付けた形。
  // 例：レジューサの両口にフランジ。2026-08-04 社長指示「アイテム＋片/両フランジは採寸する」。
  // アイテム単品・フランジ対だけ（アイテム無し）は従来どおり対象外）
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < segs.length; i++) {
      if (used[i] || (pass === 0 && !segs[i].pipe)) continue;
      used[i] = true;
      const d0 = dirOf(segs[i]);
      let A = segs[i].a.clone(), B = segs[i].b.clone();
      const pipes = segs[i].pipe ? [segs[i].p] : [], parts = [segs[i].p];
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = 0; j < segs.length; j++) {
          if (used[j]) continue;
          if (Math.abs(dirOf(segs[j]).dot(d0)) < 0.9995) continue;   // 同一直線の向きだけつなぐ
          const pairs = [[segs[j].a, segs[j].b], [segs[j].b, segs[j].a]];
          for (const [pt, other] of pairs) {
            if (pt.distanceTo(A) < TOL) { A = other.clone(); used[j] = true; parts.push(segs[j].p); if (segs[j].pipe) pipes.push(segs[j].p); grew = true; break; }
            if (pt.distanceTo(B) < TOL) { B = other.clone(); used[j] = true; parts.push(segs[j].p); if (segs[j].pipe) pipes.push(segs[j].p); grew = true; break; }
          }
          if (grew) break;
        }
      }
      if (pass === 1) {
        const hasFlange = parts.some(q => q.userData.partType === 'flange');
        const hasItem = parts.some(q => !['flange', 'gasket'].includes(q.userData.partType));
        if (!hasFlange || !hasItem) continue;   // フランジ付きのアイテムだけ対象（単品は出さない）
      }
      runs.push({ A, B, dir: d0, pipes, parts });
    }
  }
  return runs;
}
// ランの端点P → 寸法の基準点。エルボ（BW/SW）＝角の工作点、ティー・クロス＝芯、
// ボスのソケット底＝母管の中心（例：母管→ボス→パイプ→フランジは母管中心からフェイス面まで。2026-07-31 社長指示）。
// それ以外＝端面のまま。
function runEndKeyPoint(P) {
  const TOL = 0.0015;
  for (const q of placedParts) {
    const u = q.userData;
    if (u.hidden || !u.faceLocal) continue;
    const isElbow = u.partType === 'elbow' || (u.partType === 'sw' && ['90E', '45E'].includes((u.sw || {}).kind));
    const isTee = u.partType === 'tee' || (u.partType === 'sw' && ['T', 'TR', 'CROSS'].includes((u.sw || {}).kind));
    const isBoss = u.partType === 'sw' && (u.sw || {}).kind === 'BOSS';
    if (!isElbow && !isTee && !isBoss) continue;
    for (const l of connsOf(q)) {
      if (connModelPos(q, l).distanceTo(P) > TOL) continue;
      if (isBoss) { const host = bossHostPipe(q); return { pt: host ? host.axisPt.clone() : P.clone(), kind: 'center' }; }
      if (u.cornerLocal) return { pt: connModelPos(q, u.cornerLocal), kind: isElbow ? 'corner' : 'center' };
      return { pt: q.position.clone(), kind: isElbow ? 'corner' : 'center' };
    }
  }
  return { pt: P.clone(), kind: 'end' };
}
// 溶接口の列挙（付属品自動集計と同じ判定）＋ルートたどり順（端の部品からBFS）。溶接番号の下書きに使う。
function collectWeldJoints() {
  const TOL = 0.0015;
  const pts = [];
  for (const p of placedParts) {
    const u = p.userData;
    if (u.hidden || !u.faceLocal) continue;
    const isFlange = u.partType === 'flange';
    const swValve = u.partType === 'valve' && ['swgate', 'swglobe'].includes((u.valve || {}).kind);
    const flangedBody = isFlangedBody(u);
    const isPG = u.partType === 'pg';
    const swSide = u.partType === 'sw' || swValve || (isFlange && u.flange && u.flange.type === 'SW');
    const spec = u.pipe || u.elbow || u.flange || u.sw || u.tee || u.reducer || u.cap || {};
    for (const cp of connPointsForStats(p)) {
      pts.push({ p, pos: connModelPos(p, cp.local), size: cp.size, sch: spec.sch || '',
                 weldable: !(isFlange && cp.face) && !flangedBody && u.partType !== 'gasket' && !isPG, sw: swSide });
    }
  }
  const joints = [];
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const A = pts[i], B = pts[j];
      if (A.p === B.p || A.pos.distanceTo(B.pos) > TOL) continue;
      link(A.p, B.p); link(B.p, A.p);
      if (A.weldable && B.weldable) joints.push({ pt: A.pos.clone(), sw: !!(A.sw || B.sw), size: A.size || B.size, sch: A.sch || B.sch, pA: A.p, pB: B.p });
    }
  }
  // 付番順＝接続の端（つながりが一番少ない部品）からのたどり順＝おおむね上流→下流
  const idx = new Map(); let k = 0;
  const deg = p => (adj.get(p) ? adj.get(p).size : 0);
  const start = placedParts.filter(p => adj.has(p)).sort((a, b) => deg(a) - deg(b))[0];
  if (start) {
    const seen = new Set([start]); const q = [start];
    while (q.length) { const p = q.shift(); idx.set(p, k++); for (const n of (adj.get(p) || [])) if (!seen.has(n)) { seen.add(n); q.push(n); } }
  }
  for (const p of placedParts) if (!idx.has(p)) idx.set(p, k++);
  joints.sort((a, b) => (Math.min(idx.get(a.pA), idx.get(a.pB)) - Math.min(idx.get(b.pA), idx.get(b.pB))) ||
                        (Math.max(idx.get(a.pA), idx.get(a.pB)) - Math.max(idx.get(b.pA), idx.get(b.pB))));
  return joints;
}

// ===== 付属品・溶接・パイプ合計の自動集計（参考値・2026-07-14 社長要望） =====
// 機点の一致（1.5mm以内）から継手を推定する：
//  ・フランジのフェイス同士／フェイス×フランジ形バルブ ＝ ガスケット＋ボルト・ナット 1組
//  ・それ以外の機点一致 ＝ 溶接口 1口（SW系＝差込溶接／その他＝突合せ溶接）
// あくまで拾い出しの下書き（参考値）。実数は検図のうえ確定する。
function connPointsForStats(p) {
  const u = p.userData;
  const spec = u.flange || u.gasket || u.pipe || u.elbow || u.cap || u.tee || u.reducer || u.sw || u.valve
            || u.flex || u.sight || u.pg || {};
  const a = spec.sizeA || '', b = spec.sizeB || a;
  const out = [];
  if (u.faceLocal) out.push({ local: u.faceLocal, size: a, face: true });
  if (u.backLocal) out.push({ local: u.backLocal, size: (u.partType === 'reducer') ? b : a, face: false });
  if (u.extraLocals) for (const e of u.extraLocals) out.push({ local: e, size: b, face: false });   // ティー枝・安全弁出口＝第2サイズ
  return out;
}
function accessoryRows() {
  const TOL = 0.0015;
  const pts = [];
  for (const p of placedParts) {
    const u = p.userData;
    if (!u.faceLocal) continue;
    const isFlange = u.partType === 'flange';
    const isValve = u.partType === 'valve';
    const swValve = isValve && ['swgate', 'swglobe'].includes((u.valve && u.valve.kind) || '');
    const flangedBody = isFlangedBody(u);                             // フランジ形バルブ／フレキシブル／サイドグラス
    const isPG = u.partType === 'pg';                                 // PGはネジ接続＝溶接もガスケットも計上しない
    const swSide = u.partType === 'sw' || swValve || (isFlange && u.flange && u.flange.type === 'SW');
    for (const cp of connPointsForStats(p)) {
      pts.push({
        p, pos: connModelPos(p, cp.local), size: cp.size,
        gasketFace: isFlange && cp.face,                              // フランジのフェイス＝ガスケット面
        valveFlanged: flangedBody,                                    // フランジ形機器の接続端
        // 溶接され得る端（フランジのフェイス・フランジ形機器・ガスケット・PGのネジ口は除外）
        weldable: !(isFlange && cp.face) && !flangedBody && u.partType !== 'gasket' && !isPG,
        sw: swSide,
        cls: isFlange ? ((u.flange && u.flange.cls) || '')
           : (flangedBody ? bodyRatingOf(u) : (swValve ? 'Class800' : '')),
      });
    }
  }
  const gasket = new Map(), weldB = new Map(), weldS = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const A = pts[i], B = pts[j];
      if (A.p === B.p) continue;
      if (Math.abs(A.pos.x - B.pos.x) > TOL || Math.abs(A.pos.y - B.pos.y) > TOL || Math.abs(A.pos.z - B.pos.z) > TOL) continue;
      if (A.pos.distanceTo(B.pos) > TOL) continue;
      if ((A.gasketFace && (B.gasketFace || B.valveFlanged)) || (B.gasketFace && A.valveFlanged)) {
        const f = A.gasketFace ? A : B;
        bump(gasket, `${f.size}|${f.cls}`);
      } else if (A.weldable && B.weldable) {
        bump((A.sw || B.sw) ? weldS : weldB, A.size || B.size);
      }
    }
  }
  // 実物のガスケットを挟んだ継手も「ボルト・ナット1式」を計上する（2026-07-20 社長要望）。
  // 挟むとフランジ面どうしが接しなくなり上の判定に掛からないため、ガスケット部品側から数える。
  const bolts = new Map(gasket);
  for (const p of placedParts) {
    const u = p.userData;
    if (u.partType !== 'gasket' || u.hidden || !u.faceLocal) continue;
    const faces = [connModelPos(p, u.backLocal), connModelPos(p, u.faceLocal)];
    let hit = null;
    for (const q of placedParts) {
      const qu = q.userData;
      if (q === p || qu.hidden || !qu.faceLocal) continue;
      const isFl = qu.partType === 'flange';
      const isFlBody = isFlangedBody(qu);   // フランジ形バルブ／フレキシブル／サイドグラス
      if (!isFl && !isFlBody) continue;
      const cand = isFl ? [qu.faceLocal] : connsOf(q);
      for (const l of cand) {
        if (!l) continue;
        const w = connModelPos(q, l);
        if (!faces.some(f => f.distanceTo(w) <= TOL)) continue;
        if (isFl) hit = { size: (qu.flange && qu.flange.sizeA) || '', cls: (qu.flange && qu.flange.cls) || '' };
        else if (!hit) {
          const spec = qu.valve || qu.flex || qu.sight || {};
          hit = { size: spec.sizeA || '', cls: bodyRatingOf(qu) };
        }
      }
    }
    if (hit) bump(bolts, `${hit.size}|${hit.cls}`);
  }
  const rows = [];
  for (const [k, n] of gasket) { const [size, cls] = k.split('|'); rows.push({ kind: 'ガスケット', type: '自動', size, cls, qty: n, mat: '' }); }
  for (const [k, n] of bolts) { const [size, cls] = k.split('|'); rows.push({ kind: 'ボルト・ナット', type: '自動・1式', size, cls, qty: n, mat: '' }); }
  for (const [size, n] of weldB) rows.push({ kind: '溶接口(突合せ)', type: '自動', size, cls: '—', qty: n, mat: '' });
  for (const [size, n] of weldS) rows.push({ kind: '溶接口(差込)', type: '自動', size, cls: '—', qty: n, mat: '' });
  // パイプ合計長さ（呼び径×Schごと・m）
  const lenBy = new Map();
  for (const p of placedParts) {
    if (p.userData.partType !== 'pipe') continue;
    const o = p.userData.pipe || {};
    const k = `${o.sizeA || ''}|${o.sch || ''}`;
    lenBy.set(k, (lenBy.get(k) || 0) + (o.length || 0));
  }
  for (const [k, mm] of lenBy) { const [size, sch] = k.split('|'); rows.push({ kind: 'パイプ合計', type: '自動', size, cls: sch, qty: (Math.round(mm) / 1000) + 'm', mat: '' }); }
  return rows;
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
    if (g.parts.every(p => p.userData.hidden)) { tr.style.opacity = '.45'; tr.title = '非表示のアイテム（「再表示」で戻せます）'; }   // 全部隠れている行は淡く
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
      const vis = g.parts.filter(p => !p.userData.hidden);   // 非表示は選択しない（見えない物を動かさせない）
      if (!vis.length) { if (window.__toast) window.__toast('この行のアイテムは非表示です（「再表示」で戻せます）'); return; }
      const add = e.ctrlKey || e.metaKey || touchCtrl;
      if (!add) { for (const p of selectedParts) setEmissive(p, 0x000000); selectedParts.clear(); }
      for (const p of vis) { selectedParts.add(p); setEmissive(p, SEL_COLOR); }
      selectedPart = vis[vis.length - 1];
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
  // 付属品・溶接・パイプ合計の自動集計行（表示のみ・クリック不可）。CSV・印刷の部品表にも同じ内容が載る
  const acc = accessoryRows();
  if (acc.length) {
    const hd = document.createElement('tr'); hd.className = 'il-acc-head';
    const htd = document.createElement('td'); htd.colSpan = 8; htd.textContent = '― 付属品・溶接・合計（自動集計・参考） ―';
    hd.appendChild(htd); _ilBody.appendChild(hd);
    for (const r of acc) {
      const tr = document.createElement('tr'); tr.className = 'il-acc';
      const mk = txt => { const td = document.createElement('td'); td.textContent = txt; return td; };
      tr.appendChild(mk('')); tr.appendChild(mk(r.kind)); tr.appendChild(mk(r.type)); tr.appendChild(mk(r.size));
      tr.appendChild(mk(r.cls)); tr.appendChild(mk(r.qty)); tr.appendChild(mk('')); tr.appendChild(mk(''));
      _ilBody.appendChild(tr);
    }
  }
}

// ===== 干渉チェック（参考・2026-07-14 社長要望） =====
// 部品ごとのAABB（外接箱・2mm縮小）同士の重なりで「干渉の疑い」を検出して赤表示する。
// 機点が一致している（＝意図して接続した）ペアは干渉と見なさない。次のクリック（選択変更）で表示解除。
let _clashGroup = null;
function clearClash() {
  if (!_clashGroup) return;
  modelGroup.remove(_clashGroup);
  _clashGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  _clashGroup = null;
}
// ---- 干渉判定の下ごしらえ（2026-07-21 社長指摘：当たっていないのに四角く赤くなる） ----
// 原因＝画面軸に沿った外接箱(AABB)で判定していたため、斜めの配管ほど箱が実体より大きく、
// 離れていても箱が重なって「干渉」と出ていた。部品の向きに沿った箱(OBB)＋軸線どうしの距離で判定する。
function localBoxOf(p) {                       // 部品座標系での境界箱（回転の影響を受けない実寸）
  const box = new THREE.Box3(), bb = new THREE.Box3(), m = new THREE.Matrix4();
  p.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(p.matrixWorld).invert();
  p.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    bb.copy(o.geometry.boundingBox);
    m.multiplyMatrices(inv, o.matrixWorld);
    bb.applyMatrix4(m);
    box.union(bb);
  });
  return box;
}
function obbOf(p) {                            // 向き付き境界箱：中心・3軸・半径3方向
  const lb = localBoxOf(p);
  if (lb.isEmpty()) return null;
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), sc = new THREE.Vector3();
  p.matrixWorld.decompose(pos, quat, sc);
  const c = lb.getCenter(new THREE.Vector3()).applyMatrix4(p.matrixWorld);
  const half = lb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const u = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map(v => v.applyQuaternion(quat).normalize());
  return { c, u, e: [half.x * Math.abs(sc.x), half.y * Math.abs(sc.y), half.z * Math.abs(sc.z)], lb, sc };
}
function obbOverlap(A, B, gap) {               // 分離軸判定（15軸）。gap＝この隙間までは当たりとしない
  const EPS = 1e-6;
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Ab = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { R[i][j] = A.u[i].dot(B.u[j]); Ab[i][j] = Math.abs(R[i][j]) + EPS; }
  const d = new THREE.Vector3().subVectors(B.c, A.c);
  const t = [d.dot(A.u[0]), d.dot(A.u[1]), d.dot(A.u[2])];
  const ae = A.e.map(v => Math.max(v - gap, 0)), be = B.e.map(v => Math.max(v - gap, 0));
  for (let i = 0; i < 3; i++)
    if (Math.abs(t[i]) > ae[i] + be[0] * Ab[i][0] + be[1] * Ab[i][1] + be[2] * Ab[i][2]) return false;
  for (let j = 0; j < 3; j++)
    if (Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]) > be[j] + ae[0] * Ab[0][j] + ae[1] * Ab[1][j] + ae[2] * Ab[2][j]) return false;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3, j1 = (j + 1) % 3, j2 = (j + 2) % 3;
    const ra = ae[i1] * Ab[i2][j] + ae[i2] * Ab[i1][j];
    const rb = be[j1] * Ab[i][j2] + be[j2] * Ab[i][j1];
    if (Math.abs(t[i2] * R[i1][j] - t[i1] * R[i2][j]) > ra + rb) return false;
  }
  return true;
}
// 部品の軸線（背面→フェイス）と、軸まわりの外半径。配管部品は軸対称なのでこれで実体に近い判定ができる
function axisOf(p, obb) {
  const u = p.userData;
  if (!u.faceLocal || !u.backLocal || !obb) return null;
  const a = connModelPos(p, u.backLocal), b = connModelPos(p, u.faceLocal);
  if (a.distanceTo(b) < 1e-6) return null;
  const lb = obb.lb, sc = obb.sc;
  const rx = Math.max(Math.abs(lb.min.x), Math.abs(lb.max.x)) * Math.abs(sc.x);
  const rz = Math.max(Math.abs(lb.min.z), Math.abs(lb.max.z)) * Math.abs(sc.z);
  return { a, b, r: Math.max(rx, rz) };
}
// ---- 実形状どうしの交差判定（2026-07-21 社長指摘：近似では当たっていない物まで拾う） ----
// 部品の三角形をワールド座標で取り出し、格子で絞ってから三角形どうしの交差を調べる。
// 近似（箱・円筒）と違い「実際に面が突き抜けているか」を見るので誤検出が原理的に起きない。
function trisOf(p) {
  const out = [];
  p.updateMatrixWorld(true);
  p.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, m = o.matrixWorld;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      const a = new THREE.Vector3().fromBufferAttribute(pos, i0).applyMatrix4(m);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i1).applyMatrix4(m);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i2).applyMatrix4(m);
      out.push([a, b, c]);
    }
  });
  return out;
}
// 線分と三角形の交差（Möller–Trumbore）。交点を返す／無ければ null
function segTri(p0, p1, t) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const e1 = new THREE.Vector3().subVectors(t[1], t[0]);
  const e2 = new THREE.Vector3().subVectors(t[2], t[0]);
  const pv = new THREE.Vector3().crossVectors(dir, e2);
  const det = e1.dot(pv);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tv = new THREE.Vector3().subVectors(p0, t[0]);
  const u = tv.dot(pv) * inv;
  if (u < 0 || u > 1) return null;
  const qv = new THREE.Vector3().crossVectors(tv, e1);
  const v = dir.dot(qv) * inv;
  if (v < 0 || u + v > 1) return null;
  const s = e2.dot(qv) * inv;
  if (s < 0 || s > 1) return null;                       // 線分の外
  return p0.clone().addScaledVector(dir, s);
}
function triBox(t) {
  return new THREE.Box3().setFromPoints(t);
}
// 2部品の実形状が交差していれば、その代表点（交点の平均）を返す。していなければ null
function meshHit(pa, pb, limitMs) {
  const A = trisOf(pa), B = trisOf(pb);
  if (!A.length || !B.length) return null;
  const bxA = new THREE.Box3().setFromObject(pa), bxB = new THREE.Box3().setFromObject(pb);
  const zone = bxA.clone().intersect(bxB).expandByScalar(0.001);      // 重なり得る範囲だけを見る
  if (zone.isEmpty()) return null;
  const bt = B.map(t => triBox(t)).map((b, i) => (b.intersectsBox(zone) ? { b, t: B[i] } : null)).filter(Boolean);
  if (!bt.length) return null;
  // Bの三角形を格子に入れる（20mm）。斜め配管でも候補が一気に減る
  const CELL = 0.02;
  const grid = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  for (const it of bt) {
    const lo = it.b.min, hi = it.b.max;
    for (let x = Math.floor(lo.x / CELL); x <= Math.floor(hi.x / CELL); x++)
      for (let y = Math.floor(lo.y / CELL); y <= Math.floor(hi.y / CELL); y++)
        for (let z = Math.floor(lo.z / CELL); z <= Math.floor(hi.z / CELL); z++) {
          const k = key(x, y, z);
          let arr = grid.get(k); if (!arr) { arr = []; grid.set(k, arr); }
          arr.push(it.t);
        }
  }
  const pts = [];
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  for (const ta of A) {
    const ba = triBox(ta);
    if (!ba.intersectsBox(zone)) continue;
    const seen = new Set();
    const lo = ba.min, hi = ba.max;
    for (let x = Math.floor(lo.x / CELL); x <= Math.floor(hi.x / CELL); x++)
      for (let y = Math.floor(lo.y / CELL); y <= Math.floor(hi.y / CELL); y++)
        for (let z = Math.floor(lo.z / CELL); z <= Math.floor(hi.z / CELL); z++) {
          const arr = grid.get(key(x, y, z));
          if (!arr) continue;
          for (const tb of arr) {
            if (seen.has(tb)) continue;
            seen.add(tb);
            let hit = segTri(ta[0], ta[1], tb) || segTri(ta[1], ta[2], tb) || segTri(ta[2], ta[0], tb)
                   || segTri(tb[0], tb[1], ta) || segTri(tb[1], tb[2], ta) || segTri(tb[2], tb[0], ta);
            if (hit) pts.push(hit);
          }
        }
    if (pts.length >= 24) break;                                       // 代表点が十分集まったら打ち切り
    if (limitMs && t0 && (performance.now() - t0) > limitMs) break;     // 重い図面でも固まらないように
  }
  if (!pts.length) return null;
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  return c.multiplyScalar(1 / pts.length);
}
// ---- 重なっている「体積」そのものを赤く光らせる（2026-07-21 社長の意図） ----
// 重なり得る範囲を細かい格子で刻み、両方の部品の内側にある点だけを集めて小さな立方体で埋める。
// ＝干渉している部分の形がそのまま赤く出る。点(マーカー)ではなく実際に食い込んでいる量が見える。
function pointInPart(part, pt, rc, dir) {
  rc.set(pt, dir);
  rc.far = Infinity;
  const hits = rc.intersectObject(part, true);
  let n = 0;                                   // 同じ位置の重複ヒットは1回と数える（稜線を貫いた時の誤判定対策）
  let last = -1;
  for (const h of hits) { if (h.distance - last > 1e-6) n++; last = h.distance; }
  return (n % 2) === 1;                        // 奇数回貫く＝内側
}
function overlapVolume(pa, pb, maxPts) {
  const bxA = new THREE.Box3().setFromObject(pa), bxB = new THREE.Box3().setFromObject(pb);
  const zone = bxA.clone().intersect(bxB);
  if (zone.isEmpty()) return null;
  const size = zone.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const N = 18;                                             // 1辺あたりの最大分割数（重い図面でも止まらない）
  const step = Math.max(0.0025, maxDim / N);
  const nx = Math.min(N, Math.max(1, Math.ceil(size.x / step)));
  const ny = Math.min(N, Math.max(1, Math.ceil(size.y / step)));
  const nz = Math.min(N, Math.max(1, Math.ceil(size.z / step)));
  const sx = size.x / nx, sy = size.y / ny, sz = size.z / nz;
  const restore = [];                                       // 内外判定には裏面も拾う必要がある
  for (const p of [pa, pb]) p.traverse(o => { if (o.isMesh && o.material && o.material.side !== THREE.DoubleSide) { restore.push([o.material, o.material.side]); o.material.side = THREE.DoubleSide; } });
  const rc = new THREE.Raycaster();
  const dir = new THREE.Vector3(0.5231, 0.6117, 0.5934).normalize();   // 軸に平行でない向き＝稜線を踏みにくい
  const pts = [];
  const pt = new THREE.Vector3();
  for (let i = 0; i <= nx && pts.length < maxPts; i++)
    for (let j = 0; j <= ny && pts.length < maxPts; j++)
      for (let k = 0; k <= nz && pts.length < maxPts; k++) {
        pt.set(zone.min.x + i * sx, zone.min.y + j * sy, zone.min.z + k * sz);
        if (!pointInPart(pa, pt, rc, dir)) continue;
        if (!pointInPart(pb, pt, rc, dir)) continue;
        pts.push(pt.clone());
      }
  for (const [m, s] of restore) m.side = s;
  if (!pts.length) return null;
  return { pts, cell: Math.max(sx, sy, sz) };
}
// 円筒で正確に表せる部品か（軸対称で出っ張りが無い）
function isCylPart(p) { return ['pipe', 'gasket', 'flange'].includes(p.userData.partType); }
// 線分どうしの最短距離と、その最近点の中点（＝当たっている位置）
function segSegClosest(p1, q1, p2, q2) {
  const d1 = new THREE.Vector3().subVectors(q1, p1), d2 = new THREE.Vector3().subVectors(q2, p2);
  const r = new THREE.Vector3().subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a < 1e-12 && e < 1e-12) { s = t = 0; }
  else if (a < 1e-12) { s = 0; t = Math.min(Math.max(f / e, 0), 1); }
  else {
    const c = d1.dot(r);
    if (e < 1e-12) { t = 0; s = Math.min(Math.max(-c / a, 0), 1); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.min(Math.max((b * f - c * e) / den, 0), 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(Math.max(-c / a, 0), 1); }
      else if (t > 1) { t = 1; s = Math.min(Math.max((b - c) / a, 0), 1); }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, t);
  return { dist: c1.distanceTo(c2), mid: c1.clone().add(c2).multiplyScalar(0.5) };
}
function runClashCheck() {
  clearClash();
  const visParts = placedParts.filter(p => !p.userData.hidden);   // 非表示は検査対象外（赤表示しても見えない）
  if (visParts.length < 2) { if (window.__toast) window.__toast('干渉チェック：部品が2つ以上必要です'); return; }
  // 接続済みペア（機点の一致）を除外リストへ
  const connKey = new Set();
  const pts = [];
  visParts.forEach((p, idx) => { if (p.userData.faceLocal) for (const l of connsOf(p)) pts.push({ idx, pos: connModelPos(p, l) }); });
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    if (pts[i].idx !== pts[j].idx && pts[i].pos.distanceTo(pts[j].pos) < 0.0015)
      connKey.add(Math.min(pts[i].idx, pts[j].idx) + '_' + Math.max(pts[i].idx, pts[j].idx));
  }
  // 部品の向きに沿った箱(OBB)で粗く判定し、軸のある部品どうしは軸線間の距離で本判定する。
  // これで斜め配管が「離れているのに当たり」と出ることがなくなる（2026-07-21 社長指摘）
  const GAP = 0.002;                 // 2mm 以内の接近は「接している」とみなさない（意図した突き合わせ対策）
  const obbs = visParts.map(p => obbOf(p));
  const axes = visParts.map((p, i) => axisOf(p, obbs[i]));
  const grp = new THREE.Group();
  const hits = [];
  for (let i = 0; i < visParts.length; i++) {
    for (let j = i + 1; j < visParts.length; j++) {
      if (connKey.has(i + '_' + j)) continue;
      const A = obbs[i], B = obbs[j];
      if (!A || !B) continue;
      if (!obbOverlap(A, B, GAP)) continue;                      // 実体の箱が重ならない＝干渉なし
      // 本判定＝実際の形状（三角形）が突き抜けているかを見る。近似ではないので誤検出しない
      const ax = axes[i], bx = axes[j];
      let at = meshHit(visParts[i], visParts[j], 250);
      // 同軸で丸ごと重なっている場合は面が交差せず（面どうしが一致する）検出できないので、
      // 円筒で正確に表せる部品（管・フランジ・ガスケット）に限って芯間距離でも判定する
      if (!at && ax && bx && isCylPart(visParts[i]) && isCylPart(visParts[j])) {
        const cl = segSegClosest(ax.a, ax.b, bx.a, bx.b);
        if (cl.dist < ax.r + bx.r - GAP) at = cl.mid;
      }
      if (!at) continue;
      const vol = overlapVolume(visParts[i], visParts[j], 2600);   // 重なっている体積そのものを拾う
      hits.push({ at, vol, a: visParts[i], b: visParts[j] });
    }
  }
  const pairs = hits.length;
  // 重なっている分だけを赤く光らせる（社長の意図：干渉している体積そのものを見せる）
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.55, depthTest: false });
  for (const h of hits) {
    const toLocal = v => modelGroup.worldToLocal(v.clone());
    if (h.vol && h.vol.pts.length) {
      const cell = h.vol.cell * 1.15;                            // 少し重ねて塊に見せる
      const geo = new THREE.BoxGeometry(cell, cell, cell);
      const inst = new THREE.InstancedMesh(geo, redMat, h.vol.pts.length);
      const m4 = new THREE.Matrix4();
      h.vol.pts.forEach((p, idx) => { m4.makeTranslation(0, 0, 0).setPosition(toLocal(p)); inst.setMatrixAt(idx, m4); });
      inst.instanceMatrix.needsUpdate = true;
      inst.renderOrder = 997; inst.frustumCulled = false;
      grp.add(inst);
    } else {                                                     // 体積を拾えないほど薄い干渉＝位置だけ示す
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.004, 14, 10), redMat);
      ball.position.copy(toLocal(h.at)); ball.renderOrder = 997;
      grp.add(ball);
    }
  }
  if (!pairs) { if (window.__toast) window.__toast('干渉は見つかりませんでした'); return; }
  _clashGroup = grp;
  modelGroup.add(grp);
  if (window.__toast) {
    const names = hits.slice(0, 2).map(h => `${partColumns(h.a).kind}×${partColumns(h.b).kind}`).join('・');
    window.__toast(`干渉${pairs}箇所：${names}${pairs > 2 ? ' ほか' : ''}（重なっている分を赤表示／クリックで解除）`);
  }
}

// カーソル下の配置済み部品（ルート）を返す。無ければ null。
function pickPlacedAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  pickRay.setFromCamera(pickNdc, activeCam());
  const hits = pickRay.intersectObjects(placedParts.filter(p => !p.userData.hidden), true);   // 非表示はクリックで拾わない
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
  if (followTool) {
    if (e.pointerType !== 'mouse' && viewDown && Math.hypot(e.clientX - viewDown.x, e.clientY - viewDown.y) <= 6) return;   // タップ判定中はプレビューを動かさず、離した位置を保持
    moveFollow(e.clientX, e.clientY);
    if (e.pointerType !== 'mouse') followParked = { x: e.clientX, y: e.clientY };   // ドラッグ＝離した位置を記録（設置はここに置く）
  }
  else if (movingPart) {
    // タップ判定：しきい値未満の指ブレでは動かさない（ダブルタップで瞬間移動しない）。超えたらドラッグ＝移動開始
    const moveTh = (e.pointerType !== 'mouse') ? 10 : 4;
    if (!moveStarted && moveStartPt && Math.hypot(e.clientX - moveStartPt.x, e.clientY - moveStartPt.y) <= moveTh) return;
    moveStarted = true;
    moveExistingPart(e.clientX, e.clientY);
  }
  else if (annPlaceMode) { moveAnnPlace(e.clientX, e.clientY); }   // 線・寸法だけを掴んで置いている最中
  else if (movePickOrigin && window.__originPickCursor) {   // 移動：起点の位置決め中
    if (e.pointerType !== 'mouse' && !movePicking) return;  // 指が触れている間だけ（確定のタップで起点が飛ばないように）
    const r = window.__originPickCursor(e.clientX, e.clientY);
    if (r && r.p) movePickParked = r.p.clone();
  }
  else if (dirDrag && (!dirDrag.locked || dirDrag.hover)) {
    // 起点を決めたあとのスライドは「指が触れている間」だけ動かす。タッチにはホバーが無く、
    // 確定のタップでも pointermove が届くため、ここを塞がないと確定した瞬間に
    // タップした方向へ動いてしまう（2026-07-28 社長指摘）。マウスは従来どおりホバーで動かす。
    if (dirDrag.hover && e.pointerType !== 'mouse' && !dirDrag.touching) return;
    const moveTh = (e.pointerType !== 'mouse') ? 10 : 4;   // タッチは指ブレが大きいのでしきい値を上げる（タップで移動が始まらないように）
    if (!dirDrag.started && Math.hypot(e.clientX - dirDrag.sx, e.clientY - dirDrag.sy) > moveTh) dirDrag.started = true;
    dirDrag.vert = !!(e.shiftKey || touchShift);           // Shift＝Y方向（鉛直）移動（途中切替も可）
    if (dirDrag.started) updateDirMove(e.clientX, e.clientY);
  }
});

// 部品の上で押し下げ＝その部品を選択し、ドラッグで「方向移動」開始（オービットより先に捕捉）。
// captureフェーズで controls.enabled=false にし、OrbitControls の回転開始を抑止する。
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0 || followTool || movingPart) return;
  // Ctrl＝複数選択トグル/窓選択。ただし「移動」コマンド中に選択済み部品を掴んだ時だけは、
  // Ctrl（タッチのCtrl点灯）を解除しなくてもそのまま集団移動できる（2026-07-19 社長要望）
  const ctrlish = e.ctrlKey || e.metaKey || touchCtrl;
  if (ctrlish && !moveMode) return;                     // Ctrl+クリックは複数選択トグル → pointerup で処理
  const rect = renderer.domElement.getBoundingClientRect();
  if (inGizmo(e.clientX - rect.left, e.clientY - rect.top)) return;
  if (annPlaceMode) {          // 線・寸法を置いている最中＝タップは「確定」なので部品を掴まない。
    // ただし直線移動中は、ダブルタップ／長押しで自由移動へ切り替える（部品と同じ。2026-08-02 社長指摘）
    if (!annPlaceMode.free) {
      const dbl = (e.timeStamp - _annTap.t < 350) && Math.hypot(e.clientX - _annTap.x, e.clientY - _annTap.y) < 12;
      _annTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (dbl) { clearTimeout(freeHoldTimer); annPlaceFree(e.clientX, e.clientY); }
      else { clearTimeout(freeHoldTimer); const fx = e.clientX, fy = e.clientY; freeHoldTimer = setTimeout(() => annPlaceFree(fx, fy), 500); }
    }
    return;
  }
  if (moveReady) {              // 起点確定後の最初のタッチ＝ここから動かし始める
    moveReady = false;
    e.stopImmediatePropagation();
    beginMoveAfterOrigin(e.clientX, e.clientY);
    // 押した記録を残す。続けてもう一度タップすればダブルタップ＝自由移動になる（2026-07-28 社長指摘）
    _lastDownT = e.timeStamp; _lastDownX = e.clientX; _lastDownY = e.clientY; _lastDownPart = selectedPart;
    // この指をそのまま押し続けても自由移動へ入れるようにする。
    // 起点確定後の最初のタッチには長押しの待ちが張られておらず、押し続けても何も起きなかった（2026-07-28 社長指摘）
    if (dirDrag) {
      clearTimeout(freeHoldTimer);
      const fx = e.clientX, fy = e.clientY, fp = dirDrag.part;
      freeHoldTimer = setTimeout(() => {
        if (!dirDrag || !dirDrag.hover || dirDrag.started || movingPart) return;
        dirDrag = null; clearMarkers();
        startMovePart(fp, fx, fy);
        movingByDrag = true; moveHoldTap = true; controls.enabled = false;
        if (window.__toast) window.__toast('自由移動：ドラッグして離す／そのまま離せばタップで確定');
      }, 500);
    }
    return;
  }
  if (movePickOrigin) {
    // 移動：①指でカーソルの位置を決める（押す→動かす→離す。離した所にカーソルは残る）
    //       ②もう一度タップで起点を確定（2026-07-28 社長指示）
    e.stopImmediatePropagation();
    if (movePickAwait) {                       // ②確定のタップ
      movePickAwait = false; movePicking = false;
      const pt = movePickParked ? movePickParked.clone() : null;
      endMovePickOrigin();
      if (pt && selectedPart) setGripFromPoint(selectedPart, pt);
      // 決めた起点は回転（方位角・立面角・回転）の中心にもなる（2026-08-02 社長指示）。
      // 選択中の部品ぜんぶ＋線が この点を中心に回る＝移動せずに回すだけでもよい。
      selPivot = pt ? pt.clone() : null;
      if (pt && window.__originPickMark) window.__originPickMark(pt);   // 中心が見えるよう印は残す
      _idleSig = null; updateForm();
      moveReady = true;                        // ここではまだ動かさない。次のタッチで動き始める
      if (window.__toast) window.__toast('起点を決めました：タッチしてスライド＝移動／方位角・立面角・回転＝この点を中心に回す');
      return;
    }
    movePicking = true;                        // ①位置決め開始
    const r = window.__originPickCursor ? window.__originPickCursor(e.clientX, e.clientY) : null;
    if (r && r.p) movePickParked = r.p.clone();
    return;
  }
  if (dirDrag && dirDrag.hover) {
    // 起点を決めたあとのスライド移動中。押しただけでは位置をやり直さない
    //（やり直すと、せっかく合わせた距離が押した瞬間に消える）。
    // ここは isDbl の宣言より前なので、ダブルタップ判定は自前で行う
    const dbl = (e.timeStamp - _lastDownT < 350)
             && Math.hypot(e.clientX - _lastDownX, e.clientY - _lastDownY) < 6
             && _lastDownPart === dirDrag.part;
    _lastDownT = e.timeStamp; _lastDownX = e.clientX; _lastDownY = e.clientY; _lastDownPart = dirDrag.part;
    // 一度スライドして離したあとの指では動かさない（この指は「確定のタップ」なので、
    // 触れた場所へ寄っていってはいけない。2026-07-28 社長指摘）
    if (!dirDrag.slid) dirDrag.touching = true;        // この指が離れるまでがスライド
    if (dbl) {                                         // ダブルタップ＝自由移動へ
      _lastDownT = 0; _lastDownPart = null;
      const dp = dirDrag.part;                         // ここで控えないと dirDrag を消した後に読めない
      dirDrag = null; clearMarkers();
      startMovePart(dp, e.clientX, e.clientY);
      movingByDrag = true; controls.enabled = false;
      return;
    }
    clearTimeout(freeHoldTimer);                       // 長押し（0.5秒）＝自由移動へ
    const hx = e.clientX, hy = e.clientY, hp = dirDrag.part;
    freeHoldTimer = setTimeout(() => {
      if (!dirDrag || !dirDrag.hover || movingPart) return;
      dirDrag = null; clearMarkers();
      startMovePart(hp, hx, hy);
      movingByDrag = true; moveHoldTap = true;         // 動かさず離したら「タップで確定」へ
    }, 500);
    return;                                            // 短いタップは pointerup 側で「確定」になる
  }
  // パイプ端の優先掴み：選択中がパイプで、その端の近く(16px)を押したら、
  // 重なる他部品(フランジ等)より優先してパイプ端を掴む（起点が取れない問題の対策）。
  if (!ctrlish && selectedPart && selectedPart.userData.partType === 'pipe' && selectedParts.size <= 1) {
    const pe = nearestPipeEnd(selectedPart, e.clientX, e.clientY);
    if (pe) {
      pipeEndDrag = { part: selectedPart, grabbedEnd: pe, sx: e.clientX, sy: e.clientY, moved: false, origLen: selectedPart.userData.pipe.length };
      controls.enabled = false;
      return;
    }
  }
  const part = pickPlacedAt(e.clientX, e.clientY);
  if (!part) return;                       // 部品以外＝通常のオービット
  if (ctrlish) {
    if (!selectedParts.has(part)) return;  // 未選択の部品＝従来どおりCtrlトグル（pointerup側）へ
    e.stopImmediatePropagation();          // 選択済みを掴んだ＝移動。窓選択(boxSel)は起動させない
  }
  // --- ダブルクリック（同じ部品を素早く2回押下）→ 押したままドラッグで自由移動 ---
  const isDbl = (e.timeStamp - _lastDownT < 350)
             && Math.hypot(e.clientX - _lastDownX, e.clientY - _lastDownY) < 6
             && _lastDownPart === part;
  _lastDownT = e.timeStamp; _lastDownX = e.clientX; _lastDownY = e.clientY; _lastDownPart = part;
  // クリック近傍の機点を「移動の起点(grip)」に選ぶ（パイプ以外・単一選択時）。方向/自由移動とも起点になる。
  const multiMember = selectedParts.has(part) && selectedParts.size > 1;
  if (part.userData.partType !== 'pipe' && !multiMember) {
    const gl = nearestConnLocal(part, e.clientX, e.clientY);
    if (gl) { part.userData.gripLocal = gl; resetPipeRotState(); clearSelPivot(); }   // 起点が変わったら回転軸を再計算（決めていた回転中心も外す）
  } else if (multiMember) {
    // 複数選択中：機点をタップしたらそこを EL基準（起点）にする（2026-07-20 社長要望）。
    // 選択は保ったまま、基準アイテムと起点だけを付け替える。機点から離れた場所を掴んだ時は従来どおり集団移動
    const gl = nearestConnLocal(part, e.clientX, e.clientY);
    if (gl) {
      if (selectedPart !== part) { selectedPart = part; pipeEndSel = null; }
      part.userData.gripLocal = gl;
      resetPipeRotState();
      _idleSig = null; updateForm(); refreshItemList();
    }
  }
  if (isDbl && moveMode) {                             // 自由移動も「移動」コマンドON時のみ
    _lastDownT = 0; _lastDownPart = null;              // 3連クリックの誤検出を防ぐためリセット
    if (dirDrag) { dirDrag = null; clearMarkers(); }   // 1回目クリックで張った方向移動を破棄
    startMovePart(part, e.clientX, e.clientY);   // 自由移動開始（複数選択ならグループ維持＝集団自由移動）
    movingByDrag = true;                 // このまま押し下げ→ドラッグ→pointerupで確定
    controls.enabled = false;            // ドラッグ中はオービット停止
    return;
  }
  // タッチ：未選択の部品に触れた1回目は「選択のみ」。移動は選択後にもう一度ドラッグした時だけ。
  // この選択タッチでは視点(オービット)も動かさない（pointerupで戻す）。触れただけで動く/視点が回るのを防ぐ。
  if (e.pointerType !== 'mouse' && !selectedParts.has(part)) {
    selectPart(part);
    controls.enabled = false; touchSelOnly = true;
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
  // 「移動」コマンドOFF＝ここまで（選択・起点選択のみ）。ドラッグは視点操作に譲る
  //（2026-07-15 社長提案：移動はコマンドを選んだ時だけ＝誤ドラッグで部品が動かない）
  if (!moveMode) return;
  const o = originModelPos(part);
  const sh = planeHitAt(e.clientX, e.clientY, o.y);   // 指を置いた地点の平面ヒット（移動量の基準。タップでズレないように）
  if (hDirInput) hDirInput.value = '';          // 新しい移動＝向きは「ドラッグの向き」から
  dirDrag = { part, sx: e.clientX, sy: e.clientY, startOrigin: o.clone(), startHit: sh ? sh.clone() : o.clone(), planeY: o.y, dir: null, dist: 0, started: false, locked: false,
              group, primaryStartPos: part.position.clone(), annFollow: false };
  if (window.__annHasSel && window.__annHasSel()) { window.__annMoveStart(); dirDrag.annFollow = true; }   // 窓選択の線も一緒に直行移動
  controls.enabled = false;                // ドラッグ中はオービット停止
  // 長押し(0.5秒・動かさない)＝自由移動へ切替（ダブルタップ→ドラッグと同じ。iPadで確実な操作）
  clearTimeout(freeHoldTimer);
  const fhX = e.clientX, fhY = e.clientY;
  freeHoldTimer = setTimeout(() => {
    if (!dirDrag || dirDrag.part !== part || dirDrag.started || movingPart) return;   // 既にドラッグ開始＝直行移動を継続
    dirDrag = null; clearMarkers();
    startMovePart(part, fhX, fhY);         // 自由移動開始（複数選択ならグループごと）
    movingByDrag = true;                   // 押したまま→ドラッグ→離して確定
    moveHoldTap = true;                    // 動かさずに離したら「タップで確定」モードへ（2026-07-20 社長要望）
    controls.enabled = false;
    if (window.__toast) window.__toast('自由移動：ドラッグして離す／そのまま離せばタップで確定');
  }, 500);
}, true);
window.addEventListener('pointerup', e => {
  if (e.button !== 0) return;
  if (movePicking) {             // 移動：離した所にカーソルを残し、確定のタップを待つ
    movePicking = false; movePickAwait = true;
    const r = window.__originPickCursor ? window.__originPickCursor(e.clientX, e.clientY) : null;
    if (r && r.p) movePickParked = r.p.clone();

    return;
  }
  if (movePickCursorShown) {     // 起点選びの十字を片付ける（ドラッグ中はガイド側が上書きする）
    movePickCursorShown = false;
    if (!dirDrag && !movingPart && window.__originPickClear) window.__originPickClear();
  }
  clearTimeout(freeHoldTimer);   // 長押し（自由移動切替）の待ちを解除
  if (touchSelOnly) {            // 選択のみタッチ：視点を戻して終了（移動しない）
    touchSelOnly = false; controls.enabled = true;
    // 「移動」を先に押していたら、選んだ直後に起点選びへ進む（2026-07-28 社長指摘）
    if (moveMode && !movePickOrigin && !movingPart && selectedParts.size > 0) beginMovePickOrigin();
    return;
  }
  if (movingPart && movingByDrag) {
    // 長押しで自由移動に入り、そのまま動かさず離した＝「タップで確定」モードへ（すぐ確定しない）
    if (moveHoldTap && !moveStarted) { moveHoldTap = false; movingByDrag = false; if (window.__toast) window.__toast('移動：置きたい位置をタップで確定'); return; }
    dropMovingPart(); return;                                     // ドラッグして離した＝確定
  }
  if (pipeEndDrag) {                                  // 伸縮確定 or 端クリックで起点選択
    if (!pipeEndDrag.moved) { pipeEndSel = (pipeEndSel === pipeEndDrag.grabbedEnd) ? null : pipeEndDrag.grabbedEnd; resetPipeRotState(); clearSelPivot(); pipeLenSticky = false; }   // クリック＝この端を起点に（COP/傾け）。長さモードは解除
    else { pipeLenSticky = true; }                    // スライド(ドラッグ)した＝離してもCOPに戻さず「長さ」入力モードを維持
    pipeEndDrag = null; controls.enabled = true; _idleSig = null; updateForm();
    return;
  }
  if (!dirDrag) return;
  if (dirDrag.hover) { dirDrag.touching = false; if (dirDrag.started) dirDrag.slid = true; return; }   // スライド式の直線移動＝離しても確定しない（位置は据え置き。タップで確定する）
  controls.enabled = true;
  if (dirDrag.annFollow) window.__annMoveEnd();                    // 追従した線を現在位置で確定（スナップ解放）
  if (dirDrag.started) { dirDrag.locked = true; updateForm(); finishMoveCommand(); }   // 方向ロック→距離入力可。移動1回で「移動」コマンド終了（距離入力は続けて使える）
  else {
    dirDrag = null; clearMarkers(); _idleSig = null;               // ドラッグせず＝選択のみ（補助線消去・端表示は再判定・コマンドは継続）
    // 「移動」を先に押して、あとからオブジェクトを選んだ場合も起点選びへ進む
    //（選択済みで押した時と手順を揃える。2026-07-28 社長指摘）
    const nSel = selectedParts.size + (window.__annSelCount ? window.__annSelCount() : 0);
    if (moveMode && !movePickOrigin && !movingPart && nSel > 0) beginMovePickOrigin();
  }
});

// iPad：3Dビューに触れたら、開いている入力欄を確定してフォーカスを外す（＝キーボードを閉じる）。
// フローティング/テンキーのキーボードには改行(Enter)キーが無いため、画面タップで閉じられるようにする。
// blur で change が発火し、入力値もそのまま確定される。（captureで最初に実行）
renderer.domElement.addEventListener('pointerdown', () => {
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && typeof ae.blur === 'function') ae.blur();
}, true);

// ビュー上のクリック：配置中は配置／移動中は確定／それ以外は選択。
// いずれも視点ドラッグと区別するため移動量をみる。
let viewDown = null;
// 配置・移動の最中か（＝画面タップが「確定」の意味を持つ状態）。
// この間はCtrlのタップ処理（個別トグル）と取り合いにならないよう、両方でこの判定を使う。
function inPlaceOrMove() { return !!(followTool || movingPart || annPlaceMode || (dirDrag && dirDrag.locked)); }
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0) { viewDown = null; return; }   // 左ボタンのみ（右=切替/中=パン は対象外）
  // Ctrl中は原則ここを通さない（窓選択／個別トグル側で一括処理）。
  // ただし「配置追従中」「移動中」「方向移動の確定待ち」は、Ctrlが点いていてもタップで確定できるようにする。
  // ※Ctrlボタンを点けたまま複数選択→移動すると、タップが記録されず確定できなかった（2026-07-27 社長報告）
  if (!inPlaceOrMove() && (e.ctrlKey || e.metaKey || touchCtrl)) { viewDown = null; return; }
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
    const px = (e.pointerType !== 'mouse' && followParked) ? followParked.x : e.clientX;   // 離した位置（プレビューが止まった所）に設置
    const py = (e.pointerType !== 'mouse' && followParked) ? followParked.y : e.clientY;
    followParked = null;
    const obj = placeToolAt(followTool.tool, px, py);  // 仮配置
    if (obj) {
      // 単品で置いたパイプの端が母管の途中に乗っていたら被り付きにする（2026-08-03 社長指示）
      if (typeof applyBranchIfOnPipe === 'function' && applyBranchIfOnPipe(obj) && window.__toast)
        window.__toast('被り付きにしました（母管の内面でカット・母管は貫通）');
      stopFollow(); selectPart(obj);   // 追従終了→選択して高さ入力フォームを出す
    }
  } else if (movingPart) {
    if (moveHoldTap && !moveStarted) return;   // 長押し直後の離し＝ここでは確定しない（次のタップで確定）
    // タップで確定：タッチにはホバーが無いので、タップした位置へ置いてから確定する（2026-07-20 社長要望）
    if (!movingByDrag) moveExistingPart(e.clientX, e.clientY);
    dropMovingPart();                    // 移動モード：タップで確定（選択は継続）
  } else if (annPlaceMode) {
    clearTimeout(freeHoldTimer);
    if (!annPlaceMode.free && !annPlaceMode.moved) return;   // まだ動かしていない＝確定しない（ダブルタップ／長押しを待つ）
    if (annPlaceMode.free) moveAnnPlace(e.clientX, e.clientY);   // 自由移動はタップした位置へ置いてから確定
    dropAnnPlace();
    if (typeof finishMoveCommand === 'function') finishMoveCommand();
  } else if (dirDrag && dirDrag.locked) {
    // まだ一度も動かしていない＝確定するものが無い。ここで終わらせないので、
    // 続けてダブルタップ／長押しで「自由移動」へ移れる（2026-07-28 社長指摘）
    if (dirDrag.hover && !dirDrag.started) return;
    // 方向移動の確定待ち：タップで確定（位置はそのまま・距離入力は閉じる）。2026-07-20 社長要望
    const moved = dirDrag.part;
    const wasHover = dirDrag.hover;
    dirDrag = null; clearMarkers(); _idleSig = null; updateForm();
    autoInsertGasket(moved);   // 確定した位置でフランジ面どうしならガスケットを挟む
    clearSelPivot();           // 決めていた起点（オレンジの玉）は移動が終わったら片付ける
    if (window.__originPickClear) window.__originPickClear();
    if (typeof applyBranchIfOnPipe === 'function' && applyBranchIfOnPipe(moved) && window.__toast)
      window.__toast('被り付きにしました（母管の内面でカット・母管は貫通）');   // 直線移動で母管の上へ動かした時
    if (wasHover) {            // 起点を決めて行う直線移動＝自由移動と同じ後始末（2026-07-28 社長指摘）
      finishMoveCommand();     // 移動コマンドを終了（リボンの光を消す）
      selectPart(null);        // 選択も解除
    }
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
    if (!p.userData.faceLocal || p.userData.hidden) continue;
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
  clearSelPivot();                                                     // 窓で選び直したら起点（回転の中心）も決め直す
  if (window.__annSelectInRect) window.__annSelectInRect(x0, y0, x1, y1);   // 線分も同じ矩形で選択
  refreshItemList();
}
// Ctrl中の操作割当て（2026-07-20 社長案）：
//   ドラッグ＝空間移動（視点操作。選択があっても動く）／タップ＝個別トグル選択／
//   ダブルタップ→そのままドラッグ＝窓選択
let _ctrlTapLast = { t: -1e9, x: 0, y: 0 };   // ダブルタップ検出（窓選択の起動）
let _ctrlClickDown = null;                     // シングルタップの個別トグル用
renderer.domElement.addEventListener('pointerdown', e => {
  // 配置・移動の最中はタップ＝確定なので、Ctrlの個別トグルは動かさない（確定タップと取り合わない）
  if (e.button !== 0 || inPlaceOrMove()) return;
  if (!(e.ctrlKey || e.metaKey || touchCtrl)) return;
  const isDbl = (e.timeStamp - _ctrlTapLast.t < 350) && Math.hypot(e.clientX - _ctrlTapLast.x, e.clientY - _ctrlTapLast.y) < 12;
  _ctrlTapLast = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  if (isDbl) {                                 // ダブルタップ＝窓選択を開始
    boxSel = { sx: e.clientX, sy: e.clientY, moved: false };
    controls.enabled = false;                  // 窓ドラッグ中は視点回転させない
    e.stopPropagation();                       // オービット開始を抑止
  } else {
    _ctrlClickDown = { x: e.clientX, y: e.clientY };   // タップならトグル／ドラッグなら視点操作（オービットへ委ねる）
  }
}, true);
window.addEventListener('pointermove', e => {
  if (!boxSel) return;
  if (!boxSel.moved && Math.hypot(e.clientX - boxSel.sx, e.clientY - boxSel.sy) > 4) boxSel.moved = true;
  if (boxSel.moved) drawSelBox(boxSel.sx, boxSel.sy, e.clientX, e.clientY);
});
window.addEventListener('pointerup', e => {
  if (_ctrlClickDown) {                        // Ctrl+シングル：タップ＝個別トグル（ドラッグは視点操作なので何もしない）
    const d = Math.hypot(e.clientX - _ctrlClickDown.x, e.clientY - _ctrlClickDown.y);
    _ctrlClickDown = null;
    if (!boxSel && d <= 6) {
      if (!(window.__annToggleAt && window.__annToggleAt(e.clientX, e.clientY)))
        pickPartAt(e.clientX, e.clientY, true);   // Ctrl+タップ＝線が無ければ部品をトグル
    }
  }
  if (!boxSel) return;
  const moved = boxSel.moved;
  const x0 = Math.min(boxSel.sx, e.clientX), x1 = Math.max(boxSel.sx, e.clientX);
  const y0 = Math.min(boxSel.sy, e.clientY), y1 = Math.max(boxSel.sy, e.clientY);
  boxSel = null;
  selBoxEl.style.display = 'none';
  controls.enabled = true;
  if (moved) selectPartsInRect(x0, y0, x1, y1);            // 窓選択（ダブルタップ→ドラッグ）
});
// iPadのシステムジェスチャ等で pointerup が来ずに取り消された時の後始末。
// ドラッグ状態と controls.enabled=false が残り「たまに操作できなくなる」不具合の対策（2026-07-19 社長報告）
window.addEventListener('pointercancel', () => {
  clearTimeout(freeHoldTimer);       // 長押し（自由移動切替）の待ちも解除
  if (pipeEndDrag) cancelPipeEndDrag();
  if (dirDrag && !dirDrag.locked) cancelDirDrag();
  if (movingPart && movingByDrag) dropMovingPart();
  if (annPlaceMode) dropAnnPlace();
  if (boxSel) { boxSel = null; selBoxEl.style.display = 'none'; }
  _ctrlClickDown = null;             // Ctrlタップ判定も残さない
  touchSelOnly = false;              // 「選択のみタッチ」も残さない（pointerupが来ないと次のタップが1回空振りする）
  controls.enabled = true;
});
// Esc=移動取消/追従解除/選択解除、Delete・Backspace=選択部品の削除
window.addEventListener('keydown', e => {
  if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
    if (e.key === 'Escape') e.target.blur();   // 入力欄でEsc＝入力モード解除（フォーカスを外す）
    // iPad保険：個別ハンドラの無い入力欄（パイプ長さ・図面欄・材質欄など）も Enter で確定＆キーボードを閉じる。
    // 専用ハンドラを持つ欄は e.stopPropagation() するためここへ来ない（各自で blur 済み）。
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
    return;                                     // それ以外は入力優先で無視
  }
  if (e.key === 'Escape') {
    // スピナー表示中＝取消して閉じるだけ（選択は保つ）。キーボードレス（タッチ）起動時は入力欄に
    // フォーカスが無く rotAInput のEscハンドラを通らないので、ここで受ける（取消ボタン経由もここ）
    if (nudgeActive()) { endRotSpin(false); return; }
    if (hideArmed) { setHideArmed(false); if (window.__toast) window.__toast('非表示：取り消しました'); return; }   // Esc＝「非表示」コマンド取消
    if (window.__trimActive && window.__trimActive()) { window.__trimEnd(); if (window.__toast) window.__toast('部分削除：取り消しました'); return; }   // Esc＝「部分削除」取消
    // 「複製・鏡・回転」を押して選択待ちの状態＝取消（進行中の操作より先に受ける）
    if (window.__hasPendingCmd && window.__hasPendingCmd()) { window.__clearPendingCmd(); if (window.__toast) window.__toast('取り消しました'); return; }
    if (pipeEndDrag) cancelPipeEndDrag();
    else if (dirDrag) cancelDirDrag();
    else if (movingPart) cancelMovePart();
    else if (annPlaceMode) cancelAnnPlace();
    else if (moveReady) { moveReady = false; clearSelPivot(); if (window.__originPickClear) window.__originPickClear(); }
    else if (movePickOrigin || movePicking) { movePicking = false; movePickAwait = false; endMovePickOrigin(); }
    else { stopFollow(); selectPart(null); if (window.__annClearSel) window.__annClearSel(); }
    if (moveMode) setMoveMode(false);   // Esc＝「移動」コマンドも取消（進行中の移動は上で取消済み）
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (nudgeActive()) endRotSpin(false);   // スピナー中の削除＝回転を取り消してから対象を削除
    deleteSelected();
  }
});
// 右クリック＝向きの送り（追従中／移動中／配置済み選択中）。右ドラッグ(パン)は回転しない。
// 線を選択して右クリック「長押し」＝角度スピナーで任意角度回転。
let rDownPos = null, rLongTimer = null, rLongFired = false;
function clearRLong() { if (rLongTimer) { clearTimeout(rLongTimer); rLongTimer = null; } }
// 角度スピナーの対象を「選択中パイプ」か「選択中の線」に振り分ける
function pipeRotTarget() { return isSpinRotPart(selectedPart); }   // 長押しスピナーの対象（パイプ・エルボ・フランジ）
function rotSpinStart(mode) { return pipeRotTarget() ? pipeRotateSpinStart(mode) : !!(window.__annRotateSpinStart && window.__annRotateSpinStart(rotModeOf(mode) !== 'az')); }
// スピナーの初期表示角（絶対角で表示する部品＝フランジ等の回転。無ければ0＝従来の相対表示）
function rotSpinBaseDeg() { return (pipeRotateSpinActive() && _pipeSpin.baseDeg) || 0; }
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
    if (hYInput) focusSelectAll(hYInput);
  }, 60);
}
function nudgeApply(v) {
  if (_nudgeMode === 'move') { if (window.__annMoveSpinApply) window.__annMoveSpinApply(v); }
  else if (_nudgeMode === 'heading') { if (window.__annHeadingSpinApply) window.__annHeadingSpinApply(v); }
  else if (_nudgeMode === 'dimdir') { if (window.__dimDirSpinApply) window.__dimDirSpinApply(v); }
  else if (_nudgeMode === 'dimoff') { if (window.__dimOffSpinApply) window.__dimOffSpinApply(v); }
  else if (_nudgeMode === 'dimskew') { if (window.__dimSkewSpinApply) window.__dimSkewSpinApply(v); }
  else if (_nudgeMode === 'dimroll') { if (window.__dimRollSpinApply) window.__dimRollSpinApply(v); }
  else rotSpinApply(v - rotSpinBaseDeg());   // 絶対角表示（フランジの回転等）＝初期角との差分だけ回す
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
  focusSelectAll(rotAInput);
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
  focusSelectAll(rotAInput);
  if (typeof updateForm === 'function') updateForm();
}
// 寸法線スピナーの連鎖対象。next='dir'（配置直後：立面なら方位スピナーへ）／'el'（再選択：EL調整へ）
let _dimChainRec = null, _dimChainNext = null;
// スピナーをタッチで開く時は true：自動フォーカスせずキーボードを出さない（▲▼ボタンで操作・3D画面タップで確定）。
// 逃げ量→方位の連鎖でも引き継ぐので、立面寸法の再調整も通してキーボードレスになる。endNudge の最後で false に戻す。
let _spinNoKbd = false;
// 寸法線の逃げ量スピナー（配置確定直後・再選択時に呼ばれる）
function startDimOffSpin(rec, next, noKbd) {
  if (!(window.__dimOffSpinStart && window.__dimOffSpinStart(rec))) return;
  _spinNoKbd = !!noKbd;
  _nudgeMode = 'dimoff';
  _dimChainRec = rec;
  _dimChainNext = next || 'dir';
  setNudgeLabel();
  rotAInput.value = window.__dimOffSpinStartMm ? String(window.__dimOffSpinStartMm()) : '0';
  positionRotForm(0, 0);
  rotForm.style.display = 'flex';
  if (!_spinNoKbd) focusSelectAll(rotAInput);   // タッチ再選択時はキーボードを出さない
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
  if (!_spinNoKbd) focusSelectAll(rotAInput);   // 逃げ量からの連鎖がタッチなら方位もキーボードレス
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
function startRotSpin(mode, cx, cy, noKbd) {
  const m = rotModeOf(mode), shiftLike = (m !== 'az');   // 旧boolean互換：false='az'／true='roll'
  // 寸法線（単独選択）の長押し＝数値フォーム：回転＝逃げ回転／それ以外＝逃げ量
  //（タップ・45°送りではフォームを出さない＝長押しの時だけ・2026-07-19 社長要望）
  if (!selectedPart && window.__annSelIsSingleDim && window.__annSelIsSingleDim()) {
    const recD = window.__dimValueSel ? window.__dimValueSel() : null;
    if (recD) {
      if (m === 'roll') { _spinNoKbd = !!noKbd; startDimRollSpin(recD); }
      else startDimOffSpin(recD, 'none', noKbd);
      return;
    }
  }
  // 構築線を選択中：方位角＝1mm平行移動スピナー（従来の無Shift）、立面角・回転＝方位角スピナー（従来のShift）
  const xlineSel = !selectedPart && window.__annSelIsXline && window.__annSelIsXline();
  if (xlineSel) _nudgeMode = shiftLike ? 'heading' : 'move';
  else _nudgeMode = 'angle';
  let ok;
  if (_nudgeMode === 'move') ok = !!(window.__annMoveSpinStart && window.__annMoveSpinStart());
  else if (_nudgeMode === 'heading') ok = !!(window.__annHeadingSpinStart && window.__annHeadingSpinStart());
  else ok = rotSpinStart(m);
  if (!ok) { _nudgeMode = 'angle'; return; }
  _spinNoKbd = !!noKbd;   // タッチ起動＝キーボードを出さず▲▼で操作（3D画面タップで確定）
  setNudgeLabel();
  rotAInput.value = _nudgeMode === 'heading' ? (window.__annHeadingSpinStartDeg ? window.__annHeadingSpinStartDeg().toFixed(1) : '0')
    : (rotSpinBaseDeg() ? String(rotSpinBaseDeg()) : '0');   // フランジ等の回転＝プロパティの角度から開始（2026-07-19 社長要望）
  positionRotForm(cx, cy);
  rotForm.style.display = 'flex';
  if (!_spinNoKbd) focusSelectAll(rotAInput);
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
    const r = _dimChainRec, chainNext = _dimChainNext;
    _dimChainRec = null; _dimChainNext = null;
    if (commit && wasDimOff) {
      const dx = r.b.x - r.a.x, dz = r.b.z - r.a.z;
      // 立面寸法は逃げ量の後に方位スピナーへ連鎖（作成時のみ）。
      // 再選択での足の長さ調整は next='none' で連鎖させない＝逃げ方向（＝元の平行）を保ったまま長さだけ変える。
      if (chainNext !== 'none' && dx * dx + dz * dz < 1e-9 && r.style.dimOff && r.style.dimDir) {
        startDimDirSpin(r);
        _dimChainRec = r;   // 方位スピナーの確定後にも「値」フォームへつなぐ
        return;
      }
      if (window.__annSelectRec) window.__annSelectRec(r);   // 確定後＝選択して「値」フォームを出す
    } else if (commit && wasDimDir) {
      if (window.__annSelectRec) window.__annSelectRec(r);
    }
  }
  _spinNoKbd = false;   // 連鎖が終わってスピナーが閉じた＝次回は通常どおり（方位へ連鎖する時は上で return 済みなのでここは通らない）
  if (typeof updateForm === 'function') updateForm();   // スピナーを閉じたらEL入力等を出し直す
}
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 2) return;
  rDownPos = { x: e.clientX, y: e.clientY }; rLongFired = false; clearRLong();
  if (canRotSpin()) {                          // 線またはパイプを選択中＝長押しで角度スピナー
    const sh = e.shiftKey || touchShift, cx = e.clientX, cy = e.clientY;
    rLongTimer = setTimeout(() => { rLongFired = true; startRotSpin(sh ? 'roll' : 'az', cx, cy); }, 350);   // 右長押し＝方位角／Shift＋長押し＝回転
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
  orientStep((e.shiftKey || touchShift) ? 'el' : 'az');   // 右クリック＝方位角45°／Shift+右＝立面角45°（回転は左下ボタン・長押し・プロパティ）
});
// 3軸45°送りの入口（mode='az'|'el'|'roll'。旧booleanも可）。右クリック＝方位角／Shift+右＝立面角。
// タッチの左下ボタン（方位角・立面角・回転）からも同じ処理を呼ぶ（2026-07-29 社長要望で3軸に分離）。
function orientStep(mode) {
  const m = rotModeOf(mode);
  if (followTool) cycleFollowOrientation(m);
  else if (movingPart) cycleMoveOrientation(m);
  else if (selectedPart && selectedPart.userData.faceLocal) pipeRotate(m);   // 全部品共通の3軸送り
  else if (window.__annHasSel && window.__annHasSel()) {
    // 複数選択（または起点を決めた時）＝部品と同じ3軸で、決めた起点（無ければ選択の中心）を
    // 中心にまとめて回す。方位角＝鉛直軸／立面角＝並びに直交する水平軸／回転＝並びの軸
    // （2026-08-02 社長「寸法を複数選択した時、回転・方位角・立面角が正しく行われていない」）
    const nAnn = window.__annSelCount ? window.__annSelCount() : 0;
    const pivot = selPivot ? selPivot.clone() : (nAnn > 1 && window.__annSelCenter ? window.__annSelCenter() : null);
    if (pivot && window.__annRotateSelBy) {
      const d = (window.__annSelDir && window.__annSelDir()) || new THREE.Vector3(1, 0, 0);
      let axis, ang = Math.PI / 4;
      if (m === 'az') { axis = new THREE.Vector3(0, 1, 0); ang = -Math.PI / 4; }
      else if (m === 'el') {
        axis = new THREE.Vector3(-d.z, 0, d.x);
        if (axis.lengthSq() < 1e-9) axis.set(1, 0, 0);
        axis.normalize();
      } else axis = d.clone().normalize();
      consumeMoveArm();
      window.__annRotateSelBy(pivot, new THREE.Quaternion().setFromAxisAngle(axis, ang));
      return;
    }
    // 寸法線（単独選択）：回転＝逃げ方向をAB軸まわりに45°／方位角・立面角＝スライド寸法の切替
    if (window.__annSelIsSingleDim && window.__annSelIsSingleDim()) {
      if (m === 'roll') { window.__dimRollStep && window.__dimRollStep(); }
      else { window.__dimSkewToggle && window.__dimSkewToggle(); }
    }
    // 線・構築線：方位角＝水平45°／立面角・回転＝従来のShift挙動（鉛直へ）
    else window.__annRotate(m !== 'az');
  }
  else if (window.__toast) window.__toast('回すアイテムを選んでください（部品または線）');   // 空押し＝案内（無反応に見えないように）
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
    // タッチコントローラー上のタップは自動確定しない（取消=Esc・削除=Delはキー合成で各自処理／
    // 向き・ひねりボタンは自ハンドラで確定／ズーム等はスピナーを保ったまま操作できる）
    const tc = document.getElementById('touchCtrl');
    if (tc && tc.contains(e.target)) return;
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
  // 向き/ひねり：タップ＝押した瞬間に45°送り（従来の応答性）／長押し(0.6秒)＝角度スピナー。
  // 部品選択中の長押しは「押下時に回った45°を元へ戻してから」スピナーを開く＝タップと長押しが両立する。
  // ※タップの実行を離した時(pointerup)に遅らせる方式は、指でしっかり押す(0.35秒超の)タップが全部
  //   長押し扱いになり「ひねりが効かない」と誤認される（2026-07-12 iPad指摘）ため廃止。
  const ORIENT_HOLD_MS = 600;   // リボンのアイコン長押し(500ms)より長め＝タップ意図を長押しに誤判定しない
  const bindOrientHold = (id, mode) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    let to = null, tapOnUp = false;
    const clear = () => { if (to) { clearTimeout(to); to = null; } tapOnUp = false; };
    btn.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      if (nudgeActive()) { endRotSpin(true); return; }   // スピナー表示中にタップ＝確定して閉じる（画面タップと同じ）
      const part = (pipeRotTarget() && selectedPart) ? selectedPart : null;   // 部品のスピナー対象＝即送り＋長押しで巻き戻し
      const r = btn.getBoundingClientRect();
      if (part) {
        const snap = { pos: part.position.clone(), quat: part.quaternion.clone(), orient: part.userData.orient || 0, roll: part.userData.roll || 0 };
        orientStep(mode);                                // まず即45°送り（タップの体感は従来どおり）
        tapOnUp = false;
        to = setTimeout(() => {                          // 押し続けた＝長押し：45°を戻してからスピナーへ
          to = null;
          if (selectedPart === part) {
            part.position.copy(snap.pos); part.quaternion.copy(snap.quat);
            part.userData.orient = snap.orient; part.userData.roll = snap.roll;
            _idleSig = null;
            if (typeof updateForm === 'function') updateForm();
            startRotSpin(mode, r.right, r.top, true);
          }
        }, ORIENT_HOLD_MS);
      } else if (canRotSpin()) {                         // 線・寸法の選択中：従来どおり離した時にタップ判定
        tapOnUp = true;
        to = setTimeout(() => { to = null; tapOnUp = false; startRotSpin(mode, r.right, r.top, true); }, ORIENT_HOLD_MS);
      } else orientStep(mode);                           // 追従中・移動中など＝即送り
    });
    btn.addEventListener('pointerup', () => { if (to) { const tap = tapOnUp; clear(); if (tap) orientStep(mode); } });
    btn.addEventListener('pointerleave', clear);
    btn.addEventListener('pointercancel', clear);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  };
  bindOrientHold('tcAz',   'az');    // 方位角：水平に45°（長押し＝方位角スピナー）
  bindOrientHold('tcElev', 'el');    // 立面角：起こす・寝かす45°（長押し＝立面角スピナー）
  bindOrientHold('tcRoll', 'roll');  // 回転：フェイス法線まわり45°（長押し＝回転スピナー）
  // 取消＝完全リセット（2026-07-20 社長指示：シフト・コントロール・コマンド選択も全部クリア）
  // Escは段階的（スピナー→描画中の点→モード→選択）なので3回叩いて確実に空へ戻し、修飾トグルも消灯する
  function tcCancelAll() {
    for (let i = 0; i < 3; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    touchShift = false; touchCtrl = false;
    const bs = document.getElementById('tcShift'), bc = document.getElementById('tcCtrl');
    if (bs) bs.classList.remove('on');
    if (bc) bc.classList.remove('on');
    if (window.__syncTouchOrbit) window.__syncTouchOrbit();
  }
  // 取消ボタン＝タップ:完全リセット／長押し(0.5秒):ボタン列を1個にたたむ（2026-07-20 社長要望）。
  // たたみ中＝名前「操作」・タップで展開（名前は「取消」に戻る）。状態は記憶（p3d_tc_fold）。
  {
    const wrap = document.getElementById('touchCtrl');
    const btn = document.getElementById('tcEsc');
    if (wrap && btn) {
      const lb = btn.querySelector('.lb'), ic = btn.querySelector('.ic');
      let folded = false;
      try { folded = localStorage.getItem('p3d_tc_fold') !== '0'; } catch (e) {}   // 既定＝たたむ（2026-07-20 社長要望）
      const applyFold = () => {
        wrap.classList.toggle('collapsed', folded);
        if (lb) lb.textContent = folded ? '操作' : '取消';
        if (ic) ic.textContent = folded ? '≡' : '⎋';
        btn.title = folded ? 'タップでボタンを展開（方位角・立面角・回転・Shift・Ctrl・削除・取消）'
                           : '取消・選択解除（長押しでボタンをたたむ）';
        try { localStorage.setItem('p3d_tc_fold', folded ? '1' : '0'); } catch (e) {}
      };
      let t = null, fired = false;
      btn.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation(); fired = false;
        clearTimeout(t);
        t = setTimeout(() => {
          fired = true;
          folded = !folded;
          if (folded) tcCancelAll();   // たたむ時は状態も全部クリア（隠れたShift等が残らないように）
          applyFold();
        }, 500);
      });
      const up = e => {
        clearTimeout(t);
        if (e.type !== 'pointerup' || fired) return;
        if (folded) { folded = false; applyFold(); }   // たたみ中のタップ＝展開のみ
        else tcCancelAll();                            // 通常タップ＝完全リセット
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', () => clearTimeout(t));
      btn.addEventListener('contextmenu', e => e.preventDefault());
      applyFold();
    }
  }
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
  // 視点ロック（透視投影時）：コマンド/アイテム挿入時と同様、選択中・配置/移動中は3D空間を固定。
  // 何も選択していない空き状態のときだけ視点操作を許可（空きスペースのドラッグで回せる）。
  if (!useOrtho && !tween) {
    // Ctrl中は選択があっても視点操作を許可（2026-07-20 社長案：Ctrl＋ドラッグ＝空間移動・窓選択はダブルタップ→ドラッグ）
    const ctrlFree = touchCtrl || kbCtrl;
    const modal = (window.__detailFrameActive && window.__detailFrameActive())
               || (window.__rotateActive && window.__rotateActive())
               || (window.__mirrorActive && window.__mirrorActive())
               || (window.__trimActive && window.__trimActive());   // 枠囲み・回転・鏡・部分削除の最中は視点固定
    // 起点を決めている間は Ctrl中でも視点を固定する（2026-08-02 社長指摘：複数選択は
    // Ctrlを点けたまま行うので、起点をタップしようとすると画面が回ってしまっていた）
    const pickingOrigin = movePickOrigin || movePicking || movePickAwait || moveReady;
    const lock = modal || followTool || movingPart || dirDrag || pipeEndDrag || pickingOrigin
              || ((selectedPart || (selectedParts && selectedParts.size)
                   || (window.__annHasSel && window.__annHasSel())) && !ctrlFree);
    controls.enabled = !lock && !boxSel;
  }
  updateIdleMarkers();         // 選択中パイプの両端センターを表示（アイドル時）
  renderer.clear();
  renderer.render(scene, activeCam());
  // 部品の外形線と、くぼみの陰を重ねる。ビューキューブ・座標軸より前に描く＝ギズモは縁取らない。
  if (showEdges && screenSilhouette && placedParts.length) screenSilhouette(activeCam());
  renderGizmo();
  positionHeightForm();        // 選択部品の脇に高さ入力フォームを追従させる
  positionLegInputs();         // 方向移動中、三角形の脚に距離入力欄を追従させる
  if (window.__updateDimTextFacing) window.__updateDimTextFacing();   // 寸法文字の裏表をカメラに合わせて補正
  if (window.__positionDimValueForm) window.__positionDimValueForm(); // 選択中の寸法線の「値」フォームを追従
  if (window.__posLineGuide) window.__posLineGuide();   // 線分描画中、三角形の脚にX/Z/Y入力欄を追従
  if (window.__updateScaleLabel) window.__updateScaleLabel();   // 現在の表示尺度を右上に表示
  // パレットのサムネイル（静止表示）。共用レンダラで描き各タイルの2Dキャンバスへ転写。非表示の部品は省略。
  if (palRenderer) {
    for (const t of palThumbs) {
      if (t.tile && t.tile.style.display === 'none') continue;
      if (!t.ctx) continue;
      palRenderer.render(t.scene, t.cam);
      t.ctx.clearRect(0, 0, t.cv.width, t.cv.height);
      t.ctx.drawImage(palRenderer.domElement, 0, 0, t.cv.width, t.cv.height);   // 2倍描画→縮小転写
    }
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
['optSize', 'optType', 'optClass', 'optFace', 'optSch', 'optRdfSize', 'optEcc'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => onOptChange(id));
});
// フランジの「枚数」（片／合い）＝パイプ挿入時の構成にだけ効く（配管化②）
{ const el = document.getElementById('optPair'); if (el) { el.value = flangeOpts.pair; el.addEventListener('change', () => { flangeOpts.pair = el.value; }); } }
syncOptionsUI();   // 起動時：アクティブ部品(フランジ)で初期化
buildPipeOptions();   // パイプのオプション欄も用意（初期は非表示）
buildGasketOptions(); // ガスケットのオプション欄も用意（初期は非表示）
buildEquipOptions();  // フレキシブル・サイドグラスのオプション欄（初期は非表示）
buildPgOptions();     // PGのオプション欄（初期は非表示）
buildPartSelect();    // 部品種別ドロップダウンを用意
setActivePart('flange');   // 初期表示はフランジ1つのみ
refreshThumbs();      // パレットの絵を「挿入時の姿勢」で描き直す（読み込み途中は向きの表が未初期化のため）
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
  const SPEC_FIELD = { flange: 'flange', gasket: 'gasket', pipe: 'pipe', bentpipe: 'bent', elbow: 'elbow', cap: 'cap', tee: 'tee', reducer: 'reducer', sw: 'sw', valve: 'valve', flex: 'flex', sight: 'sight', spool: 'spool', pg: 'pg' };
  function buildFromSpec(u) {
    switch (u.partType) {
      case 'flange':  return makeFlange(u.flange);
      case 'gasket':  return makeGasket(u.gasket);
      case 'pipe':    return makePipe(u.pipe);
      case 'bentpipe': return makeBentPipe(u.bent);
      case 'elbow':   return makeElbow(u.elbow);
      case 'cap':     return makeCap(u.cap);
      case 'tee':     return makeTee(u.tee);
      case 'reducer': return makeReducer(u.reducer);
      case 'sw':      return makeSW(u.sw);
      case 'valve':   return makeValve(u.valve);
      case 'flex':    return makeFlex(u.flex);
      case 'spool':   return makeSpool(u.spool);
      case 'sight':   return makeSightGlass(u.sight);
      case 'pg':      return makePG(u.pg);
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
  // ===== 「選択してからコマンド」も「コマンドを押してから選択」もできるようにする =====
  // 移動コマンドと同じ使い勝手にする（2026-07-27 社長要望）。何も選ばずに押したらボタンを点灯して待ち、
  // そのあとアイテムを選んだ時点で実行する。判定は選択処理が全部終わってから（末尾の pointerup で呼ぶ）。
  let pendingCmd = null;                          // 'dup' | 'mirror' | 'rotate' | 'sweep' | null
  const PENDING_BTN = { dup: 'cmdDup', mirror: 'cmdMirror', rotate: 'cmdRotate', sweep: 'cmdSweep' };
  // リボンの光り方は「実行中」も「待ち受け中」も光る＝移動ボタンと同じ扱いにする（2026-07-28 社長指摘）
  function syncCmdLights() {
    const on = { dup: pendingCmd === 'dup',
                 mirror: !!mirrorMode || pendingCmd === 'mirror',
                 rotate: !!rotateMode || pendingCmd === 'rotate',
                 sweep: !!sweepMode || pendingCmd === 'sweep' };
    for (const k of Object.keys(PENDING_BTN)) {
      const b = $(PENDING_BTN[k]); if (b) b.classList.toggle('active', !!on[k]);
    }
  }
  window.__syncCmdLights = syncCmdLights;
  function setPendingCmd(name, msg) {
    if (name && typeof clearOtherCommands === 'function') clearOtherCommands('pending');   // 他のコマンドは解除
    pendingCmd = name || null;
    syncCmdLights();
    // 案内トーストは出さない（2026-07-31 社長指示：操作の補足はヘルプのキーワード検索に集約）
  }
  window.__clearPendingCmd = () => { if (pendingCmd) setPendingCmd(null); };
  window.__hasPendingCmd = () => !!pendingCmd;
  window.__runPendingCmd = () => {
    if (!pendingCmd) return false;
    const n = selectedParts.size + selAnns.size;
    if (!n) return false;                          // まだ選ばれていない＝待ち続ける
    const c = pendingCmd;
    setPendingCmd(null);
    if (c === 'dup') duplicate(); else if (c === 'mirror') mirror(); else if (c === 'rotate') rotateCmd(); else if (c === 'sweep') sweepCmd();
    return true;
  };

  function duplicate() {
    const src = [...selectedParts];
    const annSrc = [...selAnns];                  // 線分・構築線・寸法線も複製対象（2026-06-13 社長指示）
    if (!src.length && !annSrc.length) { setPendingCmd('dup', '複製：複製するアイテムをタップで選んでください'); return; }
    setPendingCmd(null);
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
    // 複製した物は「その場に置く」のではなく、掴んだ状態にして置き場所を決めてもらう
    //（2026-07-27 社長要望：複製されたものは先ずフリーで移動でき、タップで位置決め）。
    // startMovePart に掴んだ座標を渡さない＝指を動かした時点で追従が始まり、タップで確定する。
    // 選択された線分もそのまま一緒に動く（annFollowMove）。
    if (copies.length) {
      startMovePart(copies[0], null, null);
      movingByDrag = false; moveHoldTap = false;   // ドラッグ確定ではなく「タップで確定」の流れにする
      if (window.__toast) window.__toast('複製：置きたい位置をタップで確定（Escで取消）');
    } else if (annCopies.length && startAnnPlace()) {
      // 線分・構築線・円・寸法・文字だけを複製した場合＝掴む部品が無いので注釈だけを掴んで置く
      if (window.__toast) window.__toast('複製：置きたい位置をタップで確定（Escで取消）');
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
    syncCmdLights();                          // コマンド終了＝ボタンの光を消す
  }
  window.__mirrorActive = () => !!mirrorMode;   // 鏡モード中は各種入力フォームを隠す用
  window.__mirrorCancel = () => { if (mirrorMode) endMirrorMode(); };   // 他コマンドへ切替える時の取消
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
  // ===== 回転コマンド（2026-07-21 社長要望：書いた方角を間違えたときに向きを直す） =====
  // 操作は鏡と同じ流れ：①回転の中心をタップ（機点・端点・交点へ吸着）②角度を決めてタップで確定。
  // 角度はカーソル方向の45°刻み（Shift＝5°刻み）、または画面の入力欄に数値を入れてEnter。
  // 鏡と違い複製はせず、選択中のアイテムそのものを回す（＝方角の直し）。軸は鉛直(Y)＝方位角の修正。
  let rotateMode = null;   // { parts, anns, p1, ang }
  const rotBox = document.createElement('div');
  rotBox.id = 'rotCmdBox';
  rotBox.style.cssText = 'position:fixed;z-index:90;display:none;align-items:center;gap:6px;padding:5px 8px;font:12px Meiryo,sans-serif;' +
    'color:#33405c;background:rgba(248,250,253,.97);border:1px solid #7fa8e8;border-radius:8px;box-shadow:0 4px 14px rgba(20,40,80,.20);white-space:nowrap';
  rotBox.innerHTML = '<span>角度</span><input id="rotCmdA" type="number" step="5" style="width:62px;background:#fff;color:#2a3550;border:1px solid #c4ccda;border-radius:5px;padding:3px 5px;font-size:12px"><span>°</span>';
  document.body.appendChild(rotBox);
  const rotCmdA = rotBox.querySelector('#rotCmdA');
  function rotYMatrix(p, deg) {
    const m = new THREE.Matrix4().makeRotationY(deg * Math.PI / 180);
    return new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(m)
      .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  }
  function endRotateMode() {
    rotateMode = null; clearMirrorGuide(); rotBox.style.display = 'none';
    renderer.domElement.style.cursor = '';
    syncCmdLights();                          // コマンド終了＝ボタンの光を消す
  }
  window.__rotateActive = () => !!rotateMode;
  window.__rotateCancel = endRotateMode;
  function rotateCmd() {
    if (rotateMode) { endRotateMode(); return; }           // もう一度押す＝取消
    if (pendingCmd === 'rotate') { setPendingCmd(null); return; }   // 待ち受け中にもう一度押す＝取消
    const parts = [...selectedParts], anns = [...selAnns];
    if (!parts.length && !anns.length) { setPendingCmd('rotate', '回転：回すアイテムをタップで選んでください'); return; }
    setPendingCmd(null);
    if (typeof clearOtherCommands === 'function') clearOtherCommands('rotate');   // 他のコマンドは解除
    rotateMode = { parts, anns, p1: null, ang: 0 };
    syncCmdLights();                          // 実行中はボタンを光らせる
    renderer.domElement.style.cursor = DRAW_CURSOR;

  }
  function rotAngleFrom(cx, cy, shift) {
    const p1 = rotateMode.p1;
    const hit = planeHitAt(cx, cy, p1.y);
    if (!hit) return null;
    const vx = hit.x - p1.x, vz = hit.z - p1.z;
    if (Math.hypot(vx, vz) < 1e-6) return null;
    let deg = -Math.atan2(vz, vx) * 180 / Math.PI - rotateMode.base;   // 起点方向からの相対角
    const step = shift ? 5 : 45;
    deg = Math.round(deg / step) * step;
    while (deg > 180) deg -= 360;
    while (deg <= -180) deg += 360;
    return deg;
  }
  function buildRotatePreview(deg) {
    clearMirrorGuide();
    const M = rotYMatrix(rotateMode.p1, deg);
    for (const s of rotateMode.parts) {
      s.updateMatrixWorld(true);
      const g = s.clone(true);
      const m = new THREE.Matrix4().multiplyMatrices(M, s.matrix);
      const pos = new V3(), quat = new THREE.Quaternion(), scl = new V3();
      m.decompose(pos, quat, scl);
      g.position.copy(pos); g.quaternion.copy(quat); g.scale.copy(scl);
      g.traverse(o => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.45;
          o.material.depthWrite = false;
          if (o.material.color) o.material.color.lerp(new THREE.Color(0x4d8fff), 0.5);
        }
      });
      mirrorGuide.add(g);
    }
    for (const r of rotateMode.anns) {
      const a2 = r.a.clone().applyMatrix4(M), b2 = r.b.clone().applyMatrix4(M);
      const st = Object.assign({}, r.style);
      if (st.dimDir) { const d2 = new V3(st.dimDir.x, st.dimDir.y, st.dimDir.z).transformDirection(M); st.dimDir = { x: d2.x, y: d2.y, z: d2.z }; }
      if (st.angP2) { const p2 = new V3(st.angP2[0], st.angP2[1], st.angP2[2]).applyMatrix4(M); st.angP2 = [p2.x, p2.y, p2.z]; }
      const g = buildAnn(r.type, a2, b2, st);
      g.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = Math.min(o.material.opacity != null ? o.material.opacity : 1, 0.45); } });
      mirrorGuide.add(g);
    }
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff8a3c, depthTest: false, transparent: true }));
    dot.position.copy(rotateMode.p1); dot.renderOrder = 998;
    mirrorGuide.add(dot);
  }
  function showRotBox() {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = modelGroup.localToWorld(rotateMode.p1.clone()).project(activeCam());
    const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    rotBox.style.display = 'flex';
    rotBox.style.left = Math.round(Math.min(Math.max(sx + 16, rect.left + 8), rect.right - 150)) + 'px';
    rotBox.style.top = Math.round(Math.min(Math.max(sy - 44, rect.top + 8), rect.bottom - 44)) + 'px';
  }
  function execRotate(deg) {
    if (!rotateMode || !rotateMode.p1) return;   // 起点が未確定なら何もしない（画面外から値だけ入った時の保険）
    const M = rotYMatrix(rotateMode.p1, deg);
    for (const s of rotateMode.parts) {
      s.updateMatrixWorld(true);
      const m = new THREE.Matrix4().multiplyMatrices(M, s.matrix);
      const pos = new V3(), quat = new THREE.Quaternion(), scl = new V3();
      m.decompose(pos, quat, scl);
      s.position.copy(pos); s.quaternion.copy(quat); s.scale.copy(scl);
      s.userData.orient = 0; s.userData.roll = 0;      // 送り角の基準は作り直す（見た目の姿勢が正）
    }
    for (const r of rotateMode.anns) {
      r.a.applyMatrix4(M); r.b.applyMatrix4(M);
      if (r.style && r.style.dimDir) {
        const d2 = new V3(r.style.dimDir.x, r.style.dimDir.y, r.style.dimDir.z).transformDirection(M);
        r.style.dimDir = { x: d2.x, y: d2.y, z: d2.z };
      }
      if (r.style && r.style.angP2) {
        const p2 = new V3(r.style.angP2[0], r.style.angP2[1], r.style.angP2[2]).applyMatrix4(M);
        r.style.angP2 = [p2.x, p2.y, p2.z];
      }
      rebuildAnn(r);
    }
    updateXlinePts();
    if (typeof refreshItemList === 'function') refreshItemList();
    if (typeof updateForm === 'function') updateForm();
    if (typeof _idleSig !== 'undefined') _idleSig = null;
    refreshHandles(); refreshAnnHi();
    if (window.__recordHistory) window.__recordHistory();
    if (window.__toast) window.__toast(`${deg > 0 ? '＋' : ''}${deg}° 回転しました`);
    endRotateMode();
  }
  rotCmdA.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); const v = parseFloat(rotCmdA.value); if (isFinite(v)) execRotate(v); }
    if (e.key === 'Escape') { e.preventDefault(); endRotateMode(); }
  });
  rotCmdA.addEventListener('input', () => {
    const v = parseFloat(rotCmdA.value);
    if (rotateMode && rotateMode.p1 && isFinite(v)) { rotateMode.ang = v; buildRotatePreview(v); }
  });
  ['pointerdown', 'click'].forEach(ev => rotBox.addEventListener(ev, e => e.stopPropagation()));
  // 回転モード中のポインタ操作（他のハンドラより先に捕捉）
  // 起点を選ぶ間は十字カーソルを出す（どこに吸着するか見える）。2026-07-27 社長要望
  window.addEventListener('pointermove', e => {
    if (!rotateMode || rotateMode.p1) return;
    if (e.pointerType !== 'mouse' && !rotateMode.picking) return;   // 指が触れている間だけ（確定のタップで起点が飛ばないように）
    const r = window.__originPickCursor ? window.__originPickCursor(e.clientX, e.clientY) : null;
    if (r && r.p) rotateMode.parked = r.p.clone();
  });
  window.addEventListener('pointerdown', e => {
    if (!rotateMode || e.button !== 0) return;
    if (e.target !== renderer.domElement) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (!rotateMode.p1) {                                  // ①回転の中心
      // ①指でカーソルの位置を決める（押す→動かす→離す。離した所にカーソルは残る）
      // ②もう一度タップで起点を確定（2026-07-28 社長指示）
      if (rotateMode.await) { commitRotateOrigin(e.clientX, e.clientY); return; }
      rotateMode.picking = true;
      const r = window.__originPickCursor ? window.__originPickCursor(e.clientX, e.clientY) : null;
      if (r && r.p) rotateMode.parked = r.p.clone();
    } else if (!rotateMode.aiming) {                       // ②最初のタッチ＝角度を決め始める（まだ実行しない）
      rotateMode.aiming = true; rotateMode.touching = true;

    } else {                                               // ③タップで確定
      // 決めた角度で回す。タップした位置から角度を取り直すと、確定のタップの方向へ回ってしまう
      //（2026-07-28 社長指摘）
      const deg = isFinite(rotateMode.ang) ? rotateMode.ang : (parseFloat(rotCmdA.value) || 0);
      execRotate(deg);
    }
  }, true);
  // 起点＝カーソルを離した所に残し、次のタップで確定する
  function commitRotateOrigin(cx, cy) {
    const p = rotateMode.parked ? rotateMode.parked.clone() : null;
    if (!p) return;
    rotateMode.await = false; rotateMode.picking = false;
    rotateMode.p1 = p;
    if (window.__originPickClear) window.__originPickClear();
    const hit = planeHitAt(cx, cy, p.y);
    rotateMode.base = hit ? -Math.atan2(hit.z - p.z, hit.x - p.x) * 180 / Math.PI : 0;   // この向きを0°とする
    rotateMode.ang = 0;
    rotCmdA.value = '0';
    buildRotatePreview(0);
    showRotBox();
    if (window.__toast) window.__toast('回転：角度を決めてタップ（45°刻み・Shiftで5°／数値入力も可）');
  }
  window.addEventListener('pointerup', e => {
    if (!rotateMode || e.button !== 0) return;
    rotateMode.touching = false;                           // 指を離した＝角度はこの値で据え置き
    if (rotateMode.p1 || !rotateMode.picking) return;
    rotateMode.picking = false; rotateMode.await = true;
    const r = window.__originPickCursor ? window.__originPickCursor(e.clientX, e.clientY) : null;
    if (r && r.p) rotateMode.parked = r.p.clone();

  }, true);
  window.addEventListener('pointermove', e => {
    if (!rotateMode || !rotateMode.p1) return;
    if (e.pointerType !== 'mouse' && !rotateMode.touching) return;   // 指が触れている間だけ角度を変える
    if (document.activeElement === rotCmdA) return;        // 数値入力中はカーソルで上書きしない
    const deg = rotAngleFrom(e.clientX, e.clientY, e.shiftKey || touchShift);
    if (deg == null || deg === rotateMode.ang) return;
    rotateMode.ang = deg; rotCmdA.value = String(deg);
    buildRotatePreview(deg);
    showRotBox();
  }, true);
  window.addEventListener('keydown', e => {
    if (!rotateMode) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); endRotateMode(); }
  }, true);

  // ===== 配管化コマンド（2026-07-29 社長要望）＝線分ルートをパイプ＋エルボへ自動展開（スイープ） =====
  // 線分で描いた芯線ルートを選んで実行すると、呼び径・Schを指定してパイプとエルボを一括配置する。
  // ・線分1本だけ選ぶと、端点がつながる線分（1mm以内）を自動でたどってルート全体を対象にする。
  // ・角＝90°/45°は規格エルボ（ロング既定）。その他の角度は実際の施工と同じく母材を切った「切断エルボ」
  //   （45°以下→45°母材、90°まで→90°母材、90°超→180°ベンド母材。165°超は中止）。
  // ・エルボが入らない短い区間は自動でショートエルボへ切替。それでも入らなければ中止して理由を出す。
  // ・パイプ長＝芯々からエルボの中心-端(cE=R·tan(角/2))を差し引いた値＝線分の寸法がそのまま芯々寸法。
  // ・線分（芯線）は消さずに残す（採寸の記録。不要なら選んで削除）。
  let sweepMode = null;   // { pts:V3[], lineCount, branches }
  let sweepBrSize = null;   // 枝管の呼び径（被り付き）
  let sweepBox = null, sweepSize = null, sweepSch = null, sweepJoint = null;
  const SWEEP_TOL = 0.001;        // 端点一致 1mm（構築線交点の endTol と同じ）
  const SWEEP_ANG_TOL = 0.25;     // 90°/45°ちょうどとみなす角度差
  function endSweepMode() {
    sweepMode = null;
    if (sweepBox) sweepBox.style.display = 'none';
    syncCmdLights();
  }
  window.__sweepActive = () => !!sweepMode;
  window.__sweepCancel = endSweepMode;
  // 選んだ線分からルート（点列）を組み立てる。1本選択なら全線分から連結をたどる。
  function sweepTrace(seed) {
    const pool = seed.length >= 2 ? seed : annStore.filter(r => r.type === 'line' && !r.hidden);
    // 端点どうしが合っている＝つながり。端点がもう1本の「途中」に乗っている＝枝（被り付き）。
    const onMid = (p2, u) => {                       // p2 が線uの途中に乗っていれば その最寄り点、無ければ null
      const v = u.b.clone().sub(u.a), L2 = v.lengthSq();
      if (L2 < 1e-12) return null;
      const t = p2.clone().sub(u.a).dot(v) / L2;
      if (t < 0.001 || t > 0.999) return null;       // 端の近くは「つながり」側で見る
      const q = u.a.clone().addScaledVector(v, t);
      return q.distanceTo(p2) < SWEEP_TOL ? q : null;
    };
    const touches = (r, u) =>
      u.a.distanceTo(r.a) < SWEEP_TOL || u.a.distanceTo(r.b) < SWEEP_TOL ||
      u.b.distanceTo(r.a) < SWEEP_TOL || u.b.distanceTo(r.b) < SWEEP_TOL ||
      !!onMid(r.a, u) || !!onMid(r.b, u) || !!onMid(u.a, r) || !!onMid(u.b, r);
    const used = new Set([seed[0]]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of pool) {
        if (used.has(r)) continue;
        for (const u of used) if (touches(r, u)) { used.add(r); grew = true; break; }
        if (grew) break;
      }
    }
    if (seed.length >= 2) {
      const miss = seed.filter(r => !used.has(r));
      if (miss.length) return { err: `スイープ：選んだ線分がつながっていません（${miss.length}本が離れています。端点は1mm以内で合わせてください）` };
    }
    // 途中に取り付いている線＝枝（被り付き）として取り分ける。本管のたどりからは外す
    const branches = [];
    const midRecs = new Set();
    for (const r of used) {
      for (const u of used) {
        if (u === r || midRecs.has(u)) continue;
        const qa = onMid(r.a, u), qb = onMid(r.b, u);
        if (!qa && !qb) continue;
        branches.push({ at: (qa || qb).clone(), to: (qa ? r.b : r.a).clone(), rec: r });
        midRecs.add(r);
        break;
      }
    }
    // 端点をノードにまとめ、枝分かれ・輪を検査してから端から順にたどる
    const nodes = [];
    const nodeOf = (p) => {
      for (const n of nodes) if (n.p.distanceTo(p) < SWEEP_TOL) return n;
      const n = { p: p.clone(), edges: [] };
      nodes.push(n); return n;
    };
    for (const r of used) {
      if (midRecs.has(r)) continue;                                  // 枝は本管のたどりに入れない
      if (r.a.distanceTo(r.b) < SWEEP_TOL) continue;                 // ゼロ長は無視
      const na = nodeOf(r.a), nb = nodeOf(r.b);
      if (na === nb) continue;
      na.edges.push({ rec: r, to: nb }); nb.edges.push({ rec: r, to: na });
    }
    // 枝分かれ（被り付き）＝いちばん真っ直ぐ続く2辺を本管、残りを枝として取り分ける（2026-08-02 社長要望）。
    // 旧＝枝分かれはエラーだったので、T字に描いても1本の連なりにしかできなかった。
    for (const n of nodes) {
      if (n.edges.length <= 2) continue;
      const dirOf = (e) => e.to.p.clone().sub(n.p).normalize();
      let best = null, bs = -2;
      for (let i = 0; i < n.edges.length; i++) for (let j = i + 1; j < n.edges.length; j++) {
        const d = dirOf(n.edges[i]).dot(dirOf(n.edges[j]));   // −1に近いほど真っ直ぐ（＝本管）
        if (-d > bs) { bs = -d; best = [n.edges[i], n.edges[j]]; }
      }
      for (const e of n.edges) {
        if (best && (e === best[0] || e === best[1])) continue;
        branches.push({ at: n.p.clone(), to: e.to.p.clone(), rec: e.rec });   // 枝＝母管の芯から先端へ
      }
      n.edges = best ? best.slice() : n.edges.slice(0, 2);    // 本管だけ残してたどる
      for (const b2 of branches) {                            // 枝側のノードからも本管の辺を外す
        const nb = nodes.find(x => x.p.distanceTo(b2.to) < SWEEP_TOL);
        if (nb) nb.edges = nb.edges.filter(x => x.rec !== b2.rec);
      }
    }
    const ends = nodes.filter(n => n.edges.length === 1);
    if (ends.length !== 2) return { err: 'スイープ：ルートが輪になっています。始点と終点のあるルートにしてください' };
    const pts = [ends[0].p.clone()];
    let cur = ends[0], prevRec = null;
    while (true) {
      const e = cur.edges.find(x => x.rec !== prevRec);
      if (!e) break;
      pts.push(e.to.p.clone());
      prevRec = e.rec; cur = e.to;
      if (cur.edges.length === 1) break;
    }
    // まっすぐ続く継ぎ目（角度0.5°未満）は間引く＝1本の直管として扱う
    for (let i = pts.length - 2; i >= 1; i--) {
      const d1 = pts[i].clone().sub(pts[i - 1]).normalize();
      const d2 = pts[i + 1].clone().sub(pts[i]).normalize();
      if (d1.angleTo(d2) * 180 / Math.PI < 0.5) pts.splice(i, 1);
    }
    return { pts, count: used.size, lines: [...used], branches };
  }
  // 点列→部品割り付け（エルボの種類・切断角・パイプ長）。err か {elbows, pipes} を返す。
  function sweepPlan(pts, sizeA, joint) {
    const D2R = Math.PI / 180;
    const corners = [];
    for (let i = 1; i < pts.length - 1; i++) {
      const dIn = pts[i].clone().sub(pts[i - 1]).normalize();
      const dOut = pts[i + 1].clone().sub(pts[i]).normalize();
      const th = dIn.angleTo(dOut) * 180 / Math.PI;
      if (th > 165) return { err: `スイープ：${Math.round(th)}°曲がる角があります（対応は165°まで。折返しは配管化できません）` };
      const base = th <= 45 + SWEEP_ANG_TOL ? '45' : th <= 90 + SWEEP_ANG_TOL ? '90' : '180';
      const exact = base !== '180' && Math.abs(th - (base === '45' ? 45 : 90)) <= SWEEP_ANG_TOL;
      corners.push({ i, th, base, exact, short: false, dIn, dOut });
    }
    // SW（差込み溶接・50Aまで）＝規格の90°/45°だけ。切断・ショート切替は無し（2026-07-31 社長要望）。
    // 機点＝ソケット底なので cE＝中心→ソケット底（L−C）。パイプは底まで届き、切寸でクリアランスを引く。
    if (joint === 'SW') {
      if (SW_S[sizeA] == null) return { err: `スイープ：SW継手は50Aまでです（${sizeA}は規格外）` };
      for (const c of corners) {
        if (c.base === '180' || !c.exact) return { err: `スイープ：SWエルボは90°と45°だけです（${Math.round(c.th * 10) / 10}°の角は切断できません。BWをお使いください）` };
      }
      const elbows = corners.map(c => ({
        i: c.i, th: c.th, dIn: c.dIn, dOut: c.dOut, sw: true, cutAngle: 0,
        kind: c.base === '45' ? '45E' : '90E',
        cE: (c.base === '45' ? SW_L_45[sizeA] - SW_C_45[sizeA] : SW_L_90[sizeA] - SW_C_E[sizeA]) / 1000,
      }));
      for (let s = 0; s < pts.length - 1; s++) {
        const cP = elbows.find(c => c.i === s), cN = elbows.find(c => c.i === s + 1);
        const L = pts[s].distanceTo(pts[s + 1]) - (cP ? cP.cE : 0) - (cN ? cN.cE : 0);
        if (L < -1e-6) return { err: `スイープ：区間${s + 1}が短すぎてSWエルボが入りません（あと${Math.ceil(-L * 1000)}mm）` };
      }
      const pipes = [];
      for (let s = 0; s < pts.length - 1; s++) {
        const cP = elbows.find(c => c.i === s), cN = elbows.find(c => c.i === s + 1);
        const a = pts[s].clone(), b = pts[s + 1].clone();
        const d = b.clone().sub(a).normalize();
        if (cP) a.addScaledVector(d, cP.cE);
        if (cN) b.addScaledVector(d, -cN.cE);
        const L = a.distanceTo(b) * 1000;
        if (L >= 0.5) pipes.push({ a, b, d, L });
      }
      return { elbows, pipes };
    }
    // 中心-端 cE(m)＝母材の曲げ半径R×tan(角/2)。規格表に無い径は null。
    function cEof(c) {
      let R;
      if (c.base === '180') { const tb = c.short ? RETURN_180S : RETURN_180L; if (tb[sizeA] == null) return null; R = tb[sizeA] / 2 / 1000; }
      else {
        const tb = { '45L': ELBOW_45L, '45S': ELBOW_45S, '90L': ELBOW_90L, '90S': ELBOW_90S }[c.base + (c.short ? 'S' : 'L')];
        if (!tb || tb[sizeA] == null) return null;
        R = tb[sizeA] / 1000 / Math.tan((c.base === '45' ? 45 : 90) / 2 * D2R);
      }
      return R * Math.tan(c.th / 2 * D2R);
    }
    for (const c of corners) if (cEof(c) == null) return { err: `スイープ：${sizeA} の ${c.base}°エルボは規格表にありません` };
    // 各区間に収まるか。収まらない区間は両端の角をショートへ→それでも駄目なら中止
    for (let pass = 0; ; pass++) {
      let bad = null;
      for (let s = 0; s < pts.length - 1 && !bad; s++) {
        const cPrev = corners.find(c => c.i === s), cNext = corners.find(c => c.i === s + 1);
        const ceP = cPrev ? cEof(cPrev) : 0, ceN = cNext ? cEof(cNext) : 0;
        if (ceP == null || ceN == null) return { err: `スイープ：${sizeA} のショートエルボは規格表にありません（区間${s + 1}が短すぎます）` };
        const L = pts[s].distanceTo(pts[s + 1]) - ceP - ceN;
        if (L < -1e-6) bad = { s, L, cPrev, cNext };
      }
      if (!bad) break;
      let changed = false;
      for (const c of [bad.cPrev, bad.cNext]) if (c && !c.short) { c.short = true; changed = true; }
      if (!changed || pass >= 3) return { err: `スイープ：区間${bad.s + 1}（${Math.round(pts[bad.s].distanceTo(pts[bad.s + 1]) * 1000)}mm）が短すぎてエルボが入りません（あと${Math.ceil(-bad.L * 1000)}mm）` };
    }
    const elbows = corners.map(c => ({
      i: c.i, th: c.th, dIn: c.dIn, dOut: c.dOut,
      kind: c.base + (c.short ? 'S' : 'L'),
      cutAngle: c.exact ? 0 : Math.round(c.th * 100) / 100,
      cE: cEof(c),
    }));
    const pipes = [];
    for (let s = 0; s < pts.length - 1; s++) {
      const cPrev = elbows.find(c => c.i === s), cNext = elbows.find(c => c.i === s + 1);
      const a = pts[s].clone(), b = pts[s + 1].clone();
      const d = b.clone().sub(a).normalize();
      if (cPrev) a.addScaledVector(d, cPrev.cE);
      if (cNext) b.addScaledVector(d, -cNext.cE);
      const L = a.distanceTo(b) * 1000;
      if (L >= 0.5) pipes.push({ a, b, d, L });   // 0.5mm未満＝エルボどうしの直付け（パイプなし）
    }
    return { elbows, pipes };
  }
  // 円/円弧のスイープ＝R曲げパイプ（継手なし・2026-07-30 社長要望）。
  // 実際のR曲げ加工と同じく、細い径しか曲がらない：曲げ半径R＜外径×3 は「無理」と断る。
  function execSweepCircle(sizeA, sch) {
    const rec = sweepMode.circle;
    const { rx, rz } = circleRadii(rec.style, rec.a, rec.b);
    if (Math.abs(rx - rz) > 0.0001) { if (window.__toast) window.__toast('楕円はR曲げできません（真円のみ対応）'); return; }
    const R = rx;
    const od = (FLG_BORE[sizeA] || 114) / 1000;   // 管外径(m)
    if (R < od * 3) {
      if (window.__toast) window.__toast(`${sizeA}はR${Math.round(R * 1000)}mmに曲げられません（目安：曲げ半径は外径の3倍＝${Math.ceil(od * 3 * 1000)}mm以上）`);
      return;   // 箱は開けたまま＝径を変えて再実行できる
    }
    const rr = arcRange(rec.style), span = rr.a1 - rr.a0;
    const o = makeBentPipe({ sizeA, sch, R, angleDeg: span * 180 / Math.PI });
    computeConns(o);
    // 曲げローカル（XY平面・始端180°・角度を減らす向き）→ 円ローカル（XZ平面・θ=a0から+θ回り）へ：
    // X軸まわり−90°でXY→XZ（向きが+θ回りに反転）、Y軸まわり−(π+a0)で始端をθ=a0へ合わせる。
    const M = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), -Math.PI - rr.a0)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), -Math.PI / 2));
    o.quaternion.copy(quatFromStyle(rec.style)).multiply(M);
    o.position.copy(rec.a);
    o.userData.orient = 0; o.userData.roll = 0;
    registerPart(o);
    if (window.__annClearSel) window.__annClearSel();
    selectPart(null);
    refreshItemList();
    if (typeof updateForm === 'function') updateForm();
    if (typeof _idleSig !== 'undefined') _idleSig = null;
    if (window.__recordHistory) window.__recordHistory();
    if (window.__toast) window.__toast(`スイープ：R曲げパイプを配置しました（${sizeA} ${sch}・R${Math.round(R * 1000)}mm・${Math.round(span * 180 / Math.PI)}°・展開${Math.round(R * span * 1000)}mm）`);
    endSweepMode();
  }
  // 実行＝計画どおりに一括配置（Undoは1回でまとめて戻る）
  function execSweep() {
    if (!sweepMode) return;
    const sizeA = sweepSize.value, sch = sweepSch.value;
    if (sweepMode.circle) { execSweepCircle(sizeA, sch); return; }
    const joint = (sweepJoint && sweepJoint.value) || 'BW';
    const plan = sweepPlan(sweepMode.pts, sizeA, joint);
    if (plan.err) { if (window.__toast) window.__toast(plan.err); return; }   // 箱は開けたまま＝径を変えて再実行できる
    const yAxis = new V3(0, 1, 0);
    for (const e of plan.elbows) {
      const o = e.sw ? makeSW({ kind: e.kind, sizeA, sch: 'Sch80' })   // SW＝Sch80固定（アプリの規約）
                     : makeElbow(Object.assign({ sizeA, sch, kind: e.kind }, e.cutAngle ? { cutAngle: e.cutAngle } : {}));
      computeConns(o);
      // 向き＝ローカルの背脚(0,-1,0)を入り側の逆へ、面脚(sinθ,cosθ,0)を出側へ。
      // ローカル法線(0,0,-1)が世界の dIn×dOut に対応するので、基底 y=dIn / z=-(dIn×dOut) / x=y×z で決まる。
      const n = e.dIn.clone().cross(e.dOut).normalize();
      const y = e.dIn.clone(), z = n.clone().negate(), x = y.clone().cross(z);
      o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      o.userData.orient = 0; o.userData.roll = 0;
      setPartByOrigin(o, sweepMode.pts[e.i]);      // 起点＝工作点(角)を線分の折れ点へ
      registerPart(o);
    }
    // 枝分かれ＝**ティー**を使う（2026-08-03 社長指示。旧v0802-Nは被り付きの枝管にしていた）。
    // 本管はティーの分だけ2本に割り、枝管はティーの枝端から先端までにする。
    const brs = sweepMode.branches || [];
    const bSize = (sweepBrSize && sweepBrSize.value) || sizeA;
    const teeC = (TEE_C[sizeA] || 38) / 1000;
    const teeM = ((bSize !== sizeA && TEE_RT_M[sizeA] && TEE_RT_M[sizeA][bSize] != null)
                  ? TEE_RT_M[sizeA][bSize] : (TEE_C[sizeA] || 38)) / 1000;
    let pipesOut = plan.pipes.slice();
    const tees = [], brPipes = [];
    for (const b of brs) {
      const bd = b.to.clone().sub(b.at);
      if (bd.length() < 1e-4) continue;
      bd.normalize();
      let hit = null;
      for (const q of pipesOut) {                       // 分岐点を含む本管の区間を探す
        const v = q.b.clone().sub(q.a), L2 = v.lengthSq();
        if (L2 < 1e-12) continue;
        const t = b.at.clone().sub(q.a).dot(v) / L2;
        if (t <= 0.001 || t >= 0.999) continue;
        if (q.a.clone().addScaledVector(v, t).distanceTo(b.at) > 0.004) continue;
        hit = q; break;
      }
      if (!hit) { if (window.__toast) window.__toast('スイープ：枝の付け根が本管の上にありません'); continue; }
      const runDir = hit.d.clone();
      if (Math.abs(runDir.dot(bd)) > 0.09) {            // 直角から±5°以上ずれている＝ティーにできない
        if (window.__toast) window.__toast('スイープ：ティーは直角の枝だけです（斜めの枝は単品の被り付きでどうぞ）');
        continue;
      }
      // 規格にない組合せはティーにしない（2026-08-03 社長指示）
      if (TEE_C[sizeA] == null || (bSize !== sizeA && !(TEE_RT_M[sizeA] && TEE_RT_M[sizeA][bSize] != null))) {
        if (window.__toast) window.__toast(`スイープ：${sizeA}×${bSize} のティーは規格にありません（枝の呼び径を選び直してください）`);
        continue;
      }
      pipesOut = pipesOut.filter(q => q !== hit);
      const mk = (a3, b3) => { const L = a3.distanceTo(b3) * 1000; if (L >= 0.5) pipesOut.push({ a: a3, b: b3, d: runDir.clone(), L }); };
      mk(hit.a.clone(), b.at.clone().addScaledVector(runDir, -teeC));
      mk(b.at.clone().addScaledVector(runDir, teeC), hit.b.clone());
      const bs = b.at.clone().addScaledVector(bd, teeM);
      const bL = bs.distanceTo(b.to) * 1000;
      if (bL >= 0.5) brPipes.push({ a: bs, b: b.to.clone(), d: bd.clone(), L: bL });
      tees.push({ at: b.at.clone(), run: runDir, br: bd });
    }
    for (const t of tees) {                             // ティー（run=ローカルY・枝=ローカル+Z）
      const o = makeTee({ sizeA, sizeB: bSize, sch });
      computeConns(o);
      const y2 = t.run.clone(), z2 = t.br.clone(), x2 = y2.clone().cross(z2).normalize();
      o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x2, y2, z2));
      o.userData.orient = 0; o.userData.roll = 0;
      setPartByOrigin(o, t.at);                         // 起点＝工作点（中心）
      registerPart(o);
    }
    // 同じ径のパイプがもうその場所にあるなら作らない（2026-08-03 社長指示）。
    // 径が違えばそのまま作る＝ジャケット管のように二重に走らせる使い方があるため。
    let skipped = 0;
    const alreadyThere = (a4, b4, size) => {
      for (const q of placedParts) {
        const u = q.userData;
        if (u.hidden || !u.placed || u.partType !== 'pipe' || !u.pipe) continue;
        if (u.pipe.sizeA !== size) continue;                       // 径が違う＝別物（ジャケット管など）
        const qa = connModelPos(q, u.backLocal), qb = connModelPos(q, u.faceLocal);
        const qd = qb.clone().sub(qa); const qL = qd.length();
        if (qL < 1e-6) continue;
        qd.multiplyScalar(1 / qL);
        const d4 = b4.clone().sub(a4).normalize();
        if (Math.abs(qd.dot(d4)) < 0.999) continue;                // 向きが違う
        const off = a4.clone().sub(qa); off.addScaledVector(qd, -off.dot(qd));
        if (off.length() > 0.004) continue;                        // 芯線が別
        const t0 = a4.clone().sub(qa).dot(qd), t1 = b4.clone().sub(qa).dot(qd);
        const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
        if (hi < 0.002 || lo > qL - 0.002) continue;               // 区間が重なっていない
        return true;
      }
      return false;
    };
    for (const p of pipesOut.concat(brPipes)) {
      const psize = brPipes.indexOf(p) >= 0 ? bSize : sizeA;
      if (alreadyThere(p.a, p.b, psize)) { skipped++; continue; }
      const o = makePipe({ sizeA: psize, sch, length: p.L });
      computeConns(o);
      o.quaternion.setFromUnitVectors(yAxis, p.d);
      o.position.copy(p.a).add(p.b).multiplyScalar(0.5);   // 中心＝区間の中点
      o.userData.orient = 0; o.userData.roll = 0;
      registerPart(o);
    }
    if (window.__annClearSel) window.__annClearSel();
    selectPart(null);
    refreshItemList();
    if (typeof updateForm === 'function') updateForm();
    if (typeof _idleSig !== 'undefined') _idleSig = null;
    if (window.__recordHistory) window.__recordHistory();
    if (window.__toast) window.__toast(`スイープ：パイプ${pipesOut.length + brPipes.length - skipped}本・エルボ${plan.elbows.length}個${tees.length ? `・ティー${tees.length}個` : ''}を配置しました（${sizeA} ${sch}）${skipped ? `／同じ径の配管が既にある${skipped}区間は作りませんでした` : ''}`);
    endSweepMode();
  }
  function ensureSweepBox() {
    if (sweepBox) return;
    sweepBox = document.createElement('div');
    sweepBox.id = 'sweepCmdBox';
    sweepBox.style.cssText = 'position:fixed;z-index:90;display:none;align-items:center;gap:6px;padding:6px 9px;font:12px Meiryo,sans-serif;' +
      'color:#33405c;background:rgba(248,250,253,.97);border:1px solid #7fa8e8;border-radius:8px;box-shadow:0 4px 14px rgba(20,40,80,.20);white-space:nowrap';
    const sel = 'background:#fff;color:#2a3550;border:1px solid #c4ccda;border-radius:5px;padding:3px 5px;font-size:12px';
    const btn = 'border:none;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer';
    sweepBox.innerHTML =
      '<span style="font-weight:bold">スイープ</span><span id="swpInfo" style="opacity:.72"></span>' +
      `<select id="swpJoint" title="継手の形式（BW=突合せ溶接／SW=差込み溶接・50Aまで・90°/45°のみ）" style="${sel}"><option value="BW">BW</option><option value="SW">SW</option></select>` +
      `<select id="swpSize" title="呼び径" style="${sel}"></select>` +
      `<select id="swpBrSize" title="枝管の呼び径（被り付き。母管より細いものを選ぶ）" style="${sel};display:none"></select>` +
      `<select id="swpSch" title="スケジュール" style="${sel}"></select>` +
      `<button id="swpGo" style="${btn};background:#2f6fd8;color:#fff">実行</button>` +
      `<button id="swpNo" style="${btn};background:#e2e7f0;color:#33405c">取消</button>`;
    document.body.appendChild(sweepBox);
    sweepSize = sweepBox.querySelector('#swpSize');
    sweepBrSize = sweepBox.querySelector('#swpBrSize');
    if (sweepBrSize) sweepBrSize.onchange = () => { sweepBrSize._touched = true; };   // 一度選んだら母管に追従させない
    sweepSch = sweepBox.querySelector('#swpSch');
    sweepJoint = sweepBox.querySelector('#swpJoint');
    for (const s of FLANGE_SIZES) if (ELBOW_90L[s] != null) sweepSize.add(new Option(s, s));
    if (sweepBrSize) for (const s of FLANGE_SIZES) if (ELBOW_90L[s] != null) sweepBrSize.add(new Option(`枝 ${s}`, s));
    for (const s of PIPE_SCHEDULES) sweepSch.add(new Option(s, s));
    // リストの連動（2026-07-31 社長指摘）：SW選択中＝呼び径は50Aまで／65A以上選択中＝SWの選択肢を出さない
    sweepJoint.onchange = () => {
      const cur = sweepSize.value;
      while (sweepSize.options.length) sweepSize.remove(0);
      for (const s of FLANGE_SIZES) {
        if (ELBOW_90L[s] == null) continue;
        if (sweepJoint.value === 'SW' && SW_S[s] == null) continue;
        sweepSize.add(new Option(s, s));
      }
      sweepSize.value = [...sweepSize.options].some(op => op.value === cur) ? cur : '50A';
    };
    sweepSize.onchange = () => {
      const cur = sweepJoint.value;
      while (sweepJoint.options.length) sweepJoint.remove(0);
      sweepJoint.add(new Option('BW', 'BW'));
      if (SW_S[sweepSize.value] != null) sweepJoint.add(new Option('SW', 'SW'));
      sweepJoint.value = [...sweepJoint.options].some(op => op.value === cur) ? cur : 'BW';
    };
    sweepBox.querySelector('#swpGo').onclick = execSweep;
    sweepBox.querySelector('#swpNo').onclick = endSweepMode;
    ['pointerdown', 'click'].forEach(ev => sweepBox.addEventListener(ev, e => e.stopPropagation()));
  }
  function showSweepBox() {
    ensureSweepBox();
    if (ELBOW_90L[pipeOpts.sizeA] != null) sweepSize.value = pipeOpts.sizeA;   // パレットのパイプ設定を既定にする
    if (PIPE_SCHEDULES.includes(pipeOpts.sch)) sweepSch.value = pipeOpts.sch;
    sweepSize.onchange();   // 65A以上ならSWの選択肢を出さない（リスト連動の初期同期）
    let c;
    if (sweepMode.circle) {   // 円/円弧＝R曲げパイプ
      const rec = sweepMode.circle, { rx } = circleRadii(rec.style, rec.a, rec.b);
      const rr = arcRange(rec.style), span = rr.a1 - rr.a0;
      sweepBox.querySelector('#swpInfo').textContent =
        `円弧 R${Math.round(rx * 1000)}mm・${Math.round(span * 180 / Math.PI)}°・展開${Math.round(rx * span * 1000)}mm`;
      c = rec.a.clone();
    } else {
      let total = 0;
      for (let i = 1; i < sweepMode.pts.length; i++) total += sweepMode.pts[i].distanceTo(sweepMode.pts[i - 1]);
      sweepBox.querySelector('#swpInfo').textContent = `線分${sweepMode.lineCount}本・曲り${sweepMode.pts.length - 2}箇所・芯々${Math.round(total * 1000)}mm`;
      c = sweepMode.pts.reduce((s, p) => s.add(p), new V3()).multiplyScalar(1 / sweepMode.pts.length);
    }
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = modelGroup.localToWorld(c.clone()).project(activeCam());
    const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
    if (sweepBrSize) {
      const hasBr = !!(sweepMode && sweepMode.branches && sweepMode.branches.length);
      sweepBrSize.style.display = hasBr ? '' : 'none';
      if (hasBr && !sweepBrSize._touched) sweepBrSize.value = sweepSize.value;
    }
    sweepBox.style.display = 'flex';
    sweepBox.style.left = Math.round(Math.min(Math.max(sx - 210, rect.left + 8), Math.max(rect.left + 8, rect.right - 430))) + 'px';
    sweepBox.style.top = Math.round(Math.min(Math.max(sy - 52, rect.top + 8), rect.bottom - 46)) + 'px';
  }
  function sweepCmd() {
    if (sweepMode) { endSweepMode(); return; }             // もう一度押す＝取消
    if (pendingCmd === 'sweep') { setPendingCmd(null); return; }   // 待ち受け中にもう一度押す＝取消
    const seed = [...selAnns].filter(r => r.type === 'line' && !r.hidden);
    const seedC = [...selAnns].filter(r => r.type === 'circle' && !r.hidden);
    if (!seed.length && seedC.length) {   // 円/円弧＝R曲げパイプのスイープ（2026-07-30 社長要望）
      setPendingCmd(null);
      if (typeof clearOtherCommands === 'function') clearOtherCommands('sweep');
      sweepMode = { circle: seedC[0] };
      selectLine(seedC[0]);
      syncCmdLights();
      showSweepBox();

      return;
    }
    if (!seed.length) { setPendingCmd('sweep', 'スイープ：ルートの線分か円をタップで選んでください（線分は1本選べば、つながった線分を自動でたどります）'); return; }
    setPendingCmd(null);
    if (typeof clearOtherCommands === 'function') clearOtherCommands('sweep');   // 他のコマンドは解除
    const tr = sweepTrace(seed);
    if (tr.err) { if (window.__toast) window.__toast(tr.err); return; }
    if (tr.pts.length < 2) { if (window.__toast) window.__toast('スイープ：ルートの長さがありません'); return; }
    sweepMode = { pts: tr.pts, lineCount: tr.count, branches: tr.branches || [] };
    // たどったルート全体を選択表示＝どこまで配管化されるかが青く見える（2026-07-29 社長要望）。
    // selectLineは冒頭でselectPart(null)＝選択クリアが走るため、1本目だけ通して残りは直接足す
    const rl = tr.lines || [];
    if (rl.length) {
      selectLine(rl[0]);
      for (let i = 1; i < rl.length; i++) selAnns.add(rl[i]);
      refreshAnnHi(); refreshHandles();
    }
    syncCmdLights();
    showSweepBox();

  }
  window.addEventListener('keydown', e => {
    if (!sweepMode) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); endSweepMode(); }
  }, true);
  // e2e検証用フック
  window.__sweepCmd = sweepCmd;
  window.__sweepExec = execSweep;
  window.__sweepSet = (sizeA, sch, joint) => {
    ensureSweepBox();
    if (sizeA) { sweepSize.value = sizeA; sweepSize.onchange(); }
    if (sch) sweepSch.value = sch;
    if (joint && sweepJoint) { sweepJoint.value = joint; if (sweepJoint.value === joint) sweepJoint.onchange(); }
  };
  window.__sweepState = () => sweepMode
    ? (sweepMode.circle ? { circle: true } : { pts: sweepMode.pts.map(p => p.toArray()), lines: sweepMode.lineCount })
    : null;
  window.__sweepPlanFor = (sizeA) => {
    if (!sweepMode) return null;
    const pl = sweepPlan(sweepMode.pts, sizeA);
    if (pl.err) return { err: pl.err };
    return { elbows: pl.elbows.map(e => ({ i: e.i, th: e.th, kind: e.kind, cutAngle: e.cutAngle, cE: e.cE })), pipes: pl.pipes.map(p => ({ L: p.L })) };
  };

  function mirror() {
    if (mirrorMode) { endMirrorMode(); return; }          // もう一度押す＝取消
    if (pendingCmd === 'mirror') { setPendingCmd(null); return; }   // 待ち受け中にもう一度押す＝取消
    const parts = [...selectedParts], anns = [...selAnns];
    if (!parts.length && !anns.length) { setPendingCmd('mirror', '鏡：反転するアイテムをタップで選んでください'); return; }
    setPendingCmd(null);
    if (typeof clearOtherCommands === 'function') clearOtherCommands('mirror');   // 他のコマンドは解除
    mirrorMode = { parts, anns, p1: null };
    syncCmdLights();                          // 実行中はボタンを光らせる
    renderer.domElement.style.cursor = DRAW_CURSOR;
    // 次に何をすればよいか分かるように案内する（2026-07-27 社長要望：起点を選ぶワンタップを明示）

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
  // 見た目は他の入力フォームに合わせる（2026-07-27 社長要望：濃い紺色をやめる）
  mirrorAsk.className = 'valForm';
  mirrorAsk.style.cssText = 'position:fixed;z-index:90;display:none;flex-direction:column;gap:6px;';
  const mirrorAskText = document.createElement('div');
  mirrorAskText.textContent = 'オブジェクトを削除しますか？';
  mirrorAsk.appendChild(mirrorAskText);
  const mirrorAskBtns = document.createElement('div');
  mirrorAskBtns.style.cssText = 'display:flex;gap:8px;justify-content:center';
  const mkAskBtn = (label) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'valBtn';
    b.style.cssText = 'min-width:56px;';
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
  window.addEventListener('pointermove', e => {
    if (!mirrorMode || mirrorMode.p1) return;
    if (e.pointerType !== 'mouse' && !mirrorMode.picking) return;   // 指が触れている間だけ（確定のタップで起点が飛ばないように）
    const r = window.__originPickCursor ? window.__originPickCursor(e.clientX, e.clientY) : null;
    if (r && r.p) mirrorMode.parked = r.p.clone();
  });
  window.addEventListener('pointerdown', e => {
    if (!mirrorMode || e.button !== 0) return;
    if (e.target !== renderer.domElement) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (!mirrorMode.p1) {                                  // ①起点（位置決め → もう一度タップで確定）
      if (mirrorMode.await) { commitMirrorOrigin(); return; }
      mirrorMode.picking = true;
      const r = window.__originPickCursor ? window.__originPickCursor(e.clientX, e.clientY) : null;
      if (r && r.p) mirrorMode.parked = r.p.clone();
    } else if (!mirrorMode.aiming) {                       // ②最初のタッチ＝方向を決め始める（まだ実行しない）
      mirrorMode.aiming = true; mirrorMode.touching = true;

    } else {                                               // ③タップで確定
      // 決めた方向で返す。タップした位置から取り直すと、確定のタップの方向へ返ってしまう
      //（2026-07-28 社長指摘）
      const M = mirrorMode.aimM || (mirrorXformFrom(e.clientX, e.clientY) || {}).M;
      if (M) execMirror(M);
    }
  }, true);
  function commitMirrorOrigin() {
    const p = mirrorMode.parked ? mirrorMode.parked.clone() : null;
    if (!p) return;
    mirrorMode.await = false; mirrorMode.picking = false;
    mirrorMode.p1 = p;
    if (window.__originPickClear) window.__originPickClear();
    clearMirrorGuide();
    mirrorMode.previewKey = 'mir:1.000,0.000';
    buildMirrorPreview(reflectMatrixAbout(p, new V3(1, 0, 0)));   // 初期＝X方向へ反転

  }
  window.addEventListener('pointerup', e => {
    if (!mirrorMode || e.button !== 0) return;
    mirrorMode.touching = false;                           // 指を離した＝方向はこの値で据え置き
    if (mirrorMode.p1 || !mirrorMode.picking) return;
    mirrorMode.picking = false; mirrorMode.await = true;
    const r = window.__originPickCursor ? window.__originPickCursor(e.clientX, e.clientY) : null;
    if (r && r.p) mirrorMode.parked = r.p.clone();

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
    if (e.pointerType !== 'mouse' && !mirrorMode.touching) return;   // 指が触れている間だけ方向を変える
    const r = mirrorXformFrom(e.clientX, e.clientY);
    if (r) mirrorMode.aimM = r.M;                          // 離しても確定まで保つ（タップで返す向き）
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
    const targets = selectedParts.size ? [...selectedParts] : placedParts.filter(p => !p.userData.hidden);   // 範囲ズームは見えている物だけ
    if (!targets.length) { resetView(); return; }
    const box = new THREE.Box3();
    for (const p of targets) box.expandByObject(p);
    // 寸法・引出し・文字も画面に入れる（選択ズームのときは選択物だけ）。
    // ＝自動採寸の値がホーム＋範囲ズームで画面の外に出ない（2026-08-02 社長指示）。
    if (!selectedParts.size) {
      for (const r of annStore) {
        if (r.hidden || !r.obj || !r.obj.visible) continue;
        r.obj.traverse(n => {
          if (n.isSprite || !n.geometry) return;               // 値の札は画面サイズ固定＝箱に入れると尺度が暴れる
          if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
          if (n.geometry.boundingBox) box.union(n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld));
        });
      }
    }
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
    ['dwgRev', 'rev'], ['dwgCompany', 'company'],
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
  // ---- 円弧（部分削除で口が開いた円）の共通ヘルパ（2026-07-30 社長要望） ----
  // 円は style.arcA0/arcA1（離心角・rad・arcA1>arcA0）があれば、その範囲だけを描く「円弧」になる。
  // 起動時の自動保存復元（applyData→buildAnn）でも使うため、宣言はこの位置（restore より前）に置く。
  const TAU = Math.PI * 2;
  const norm2pi = x => ((x % TAU) + TAU) % TAU;
  function arcRange(style) {   // 描かれている角度範囲。円弧でなければ全周
    if (!style || style.arcA0 == null || style.arcA1 == null) return { a0: 0, a1: TAU, full: true };
    return { a0: style.arcA0, a1: style.arcA1, full: false };
  }
  function circPt(rec, th) {   // 離心角θ→円周上の点（modelローカル）
    const { rx, rz } = circleRadii(rec.style, rec.a, rec.b), q = quatFromStyle(rec.style);
    return rec.a.clone().add(new V3(Math.cos(th) * rx, 0, Math.sin(th) * rz).applyQuaternion(q));
  }
  function circleThetaAt(rec, cx, cy) {   // カーソル光線→円の面との交点の離心角（0..2π）。面と平行なら null
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    pickRay.setFromCamera({ x: ((cx - rect.left) / rect.width) * 2 - 1, y: -((cy - rect.top) / rect.height) * 2 + 1 }, cam);
    const O = modelGroup.worldToLocal(pickRay.ray.origin.clone());
    const D = modelGroup.worldToLocal(pickRay.ray.origin.clone().addScaledVector(pickRay.ray.direction, 1)).sub(O).normalize();
    const { rx, rz } = circleRadii(rec.style, rec.a, rec.b), q = quatFromStyle(rec.style);
    const n = new V3(0, 1, 0).applyQuaternion(q);
    const denom = D.dot(n); if (Math.abs(denom) < 1e-9) return null;
    const t = rec.a.clone().sub(O).dot(n) / denom; if (t <= 0) return null;
    const local = O.clone().addScaledVector(D, t).sub(rec.a).applyQuaternion(q.clone().invert());
    return norm2pi(Math.atan2(local.z / rz, local.x / rx));
  }

  // 詳細図の記憶域（宣言は serialize/applyData より前＝起動時の自動保存復元でも参照できる位置に置く）
  const detailAreas = [];   // [{ id, name, key, rect, aspect, url, parts:[], anns:[] }]
  const detailPhotos = new Map();   // key→写真dataURL（アンドゥ履歴の文字列を重くしないための側持ち）
  let _detailSeq = 0;
  function serialize(o) {
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
        hidden: p.userData.hidden ? 1 : undefined,   // 非表示状態（undefined はJSONに載らない）
      })),
      annotations: annStore.map(a => ({ type: a.type, a: a.a.toArray(), b: a.b.toArray(), style: a.style, groupId: a.groupId != null ? a.groupId : null, hidden: a.hidden ? 1 : undefined })),
      // 詳細図の登録＝「押さえた瞬間の写真」を記憶する（2026-07-29 社長要望：後から表示/非表示を
      // 変えても・アプリが再起動しても、詳細図は登録時の画像のまま印刷される）。
      // 写真(dataURL)は大きいので、ファイル保存・自動保存にだけ埋める（o.photos）。
      // アンドゥ履歴は毎編集で文字列を積むため key だけを載せ、写真はメモリ(detailPhotos)から引く。
      details: detailAreas.map(d => ({
        id: d.id, name: d.name, renamed: d.renamed ? 1 : undefined,
        rect: d.rect, aspect: d.aspect, key: d.key,
        url: (o && o.photos) ? d.url : undefined,
        parts: d.parts.map(p => placedParts.indexOf(p)).filter(i => i >= 0),
        anns: d.anns.map(a => annStore.indexOf(a)).filter(i => i >= 0),
      })),
    };
  }
  // ---- 保存：新規保存／上書き保存（2026-07-12 社長要望） ----
  // PC(Chrome/Edge)は File System Access API のハンドルを保持して真の上書きができる。
  // iPad Safari は API が無いため従来のダウンロード（同名ファイル）にフォールバックする。
  let _saveTarget = null;   // { handle: FileSystemFileHandle|null, name: string } ＝上書き保存の対象
  function defaultSaveName() {
    let nm = ($('dwgNo').value || $('dwgName').value || '配管図').trim() || '配管図';
    return nm.replace(/[\\/:*?"<>|]/g, '_') + '.p3d.json';
  }
  function downloadBlob(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  // 保存先を最初に選ばせて書き出す共通処理（2026-07-20 社長「どこに保存か最初に確認して」）：
  // ① iPad等のタッチ機＝共有シート（「ファイルに保存」で保存先フォルダを選択。画像なら「画像を保存」で写真アプリへ・LINE等へも送れる）
  // ② PCのChrome/Edge＝保存ダイアログでフォルダとファイル名を指定
  // ③ どちらも使えない環境＝従来どおりダウンロード
  // 戻り値：'shared'|'picker'|'download'＝書き出した／null＝ユーザーがキャンセル
  async function saveWithLocationChoice(name, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    if (IS_TOUCH_DEV || window.__forceShare) {
      try {
        const file = new File([blob], name, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
          await navigator.share({ files: [file] });
          return 'shared';
        }
      } catch (err) { if (err && err.name === 'AbortError') return null; }   // キャンセル＝中止。他エラーは次の手段へ
    }
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        return 'picker';
      } catch (err) { if (err && err.name === 'AbortError') return null; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    return 'download';
  }
  // 画面上部に短く出す通知（上書き保存は画面変化が無いので完了を明示する）
  let _toastEl = null, _toastTimer = null;
  function toast(msg) {
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.id = '__toast';
      // 案内（トースト）は詳細図のヒントと同じ配色に統一（2026-07-27 社長要望）。色は .hintBox に任せる
      _toastEl.className = 'hintBox';
      _toastEl.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:120;display:none;';
      document.body.appendChild(_toastEl);
    }
    _toastEl.textContent = msg;
    _toastEl.style.display = 'block';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { _toastEl.style.display = 'none'; }, 2400);
  }
  async function writeHandle(handle, text) {
    const w = await handle.createWritable();
    await w.write(text); await w.close();
  }
  // ---- 端末内の図面保存（2026-07-20 社長：上書き保存で「次の方法で開く」を出さない） ----
  // iPad Safari は同名ファイルへ書き戻す手段が無く、ダウンロードすると必ず確認シートが出る。
  // そこで上書き保存はブラウザ内（この端末内）へ即時保存し、ダイアログを一切出さない。
  // 端末内の図面は「開く」から一覧で選べる（ファイルからの読込も従来どおり可能）。
  const DEVFILES_KEY = 'haikan3d.files';
  function devFilesGet() { try { return JSON.parse(localStorage.getItem(DEVFILES_KEY) || '{}'); } catch (e) { return {}; } }
  function devFileSave(name, text) {
    try {
      const all = devFilesGet();
      all[name] = { t: Date.now(), data: text };
      localStorage.setItem(DEVFILES_KEY, JSON.stringify(all));
      return true;
    } catch (e) { return false; }   // 容量超過など
  }
  function devFileDelete(name) {
    try { const all = devFilesGet(); delete all[name]; localStorage.setItem(DEVFILES_KEY, JSON.stringify(all)); } catch (e) {}
  }
  window.__devFiles = devFilesGet;   // テスト・保守用
  async function saveAsNew() {
    const text = JSON.stringify(serialize({ photos: true }), null, 2);
    const name = defaultSaveName();
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: '配管3D図面', accept: { 'application/json': ['.json'] } }] });
        await writeHandle(h, text);
        _saveTarget = { handle: h, name: h.name };
        toast('保存しました：' + h.name);
        return;
      } catch (err) { if (err && err.name === 'AbortError') return; }   // キャンセル＝中止。他エラーは保存先選択へ
    }
    // iPad等＝共有シートで保存先を選ぶ（「ファイルに保存」→フォルダ選択）。キャンセルなら何もしない
    const r = await saveWithLocationChoice(name, text, 'application/json');
    if (r === null) return;
    _saveTarget = { handle: null, name };
    devFileSave(name, text);        // 以後の「上書き保存」用に端末内へも控える（ダイアログ無しで上書きできる）
    toast('保存しました：' + name);
  }
  async function saveOverwrite() {
    if (!_saveTarget) { saveAsNew(); return; }
    const text = JSON.stringify(serialize({ photos: true }), null, 2);
    if (_saveTarget.handle) {
      try {
        await writeHandle(_saveTarget.handle, text);
        toast('上書き保存しました：' + _saveTarget.name);
        return;
      } catch (err) { if (err && err.name === 'AbortError') return; }   // 権限拒否等は保存先選択で続行
    }
    // iPad等：端末内へ即時上書き（社長指示：確認シートも「次の方法で開く」も出さない）。
    // ファイルとして書き出したい時は「新規保存」を使う（保存先を選べる）
    if (devFileSave(_saveTarget.name, text)) toast('上書き保存しました：' + _saveTarget.name);
    else alert('端末内の空き容量が足りず上書きできませんでした。「新規保存」でファイルに保存してください。');
  }
  window.__toast = toast;   // トップレベルの機能（干渉チェック等）からも通知を出せるように
  // ---- 自動保存（ブラウザ内バックアップ・事故防止・2026-07-14 社長要望） ----
  // 20秒ごと＋画面が隠れる時に、図面全体を localStorage へ保存。起動時に残っていれば復元を提案する。
  const AUTOSAVE_KEY = 'haikan3d.autosave';
  let _autoLast = '';
  function autosaveTick() {
    try {
      const s = JSON.stringify(serialize({ photos: true }));
      if (s === _autoLast) return;                      // 変化なしは書かない
      _autoLast = s;
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ t: Date.now(), name: ($('dwgNo').value || $('dwgName').value || ''), data: s }));
    } catch (err) { /* 容量超過等は諦める（次回また試す） */ }
  }
  setInterval(autosaveTick, 20000);
  window.addEventListener('pagehide', autosaveTick);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosaveTick(); });
  // 起動時：前回の作業内容が残っていれば復元を提案（テンプレート適用の後に実行される）
  setTimeout(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const rec = JSON.parse(raw);
      const data = JSON.parse(rec.data);
      if (!data || !Array.isArray(data.parts)) return;
      if (!data.parts.length && !(data.annotations && data.annotations.length)) return;   // 空図面は提案しない
      const w = new Date(rec.t);
      const label = `${w.getMonth() + 1}/${w.getDate()} ${String(w.getHours()).padStart(2, '0')}:${String(w.getMinutes()).padStart(2, '0')}`;
      if (confirm(`前回の作業内容（${rec.name || '無題'}・${label}時点の自動保存）が残っています。復元しますか？\n（キャンセル＝まっさらな状態から始める）`)) {
        applyData(data); resetHistory();
      } else {
        localStorage.removeItem(AUTOSAVE_KEY);          // 断られたら次回は聞かない
      }
    } catch (err) {}
  }, 400);
  // ---- 図面情報テンプレート（既定値の記憶・2026-07-14 社長要望） ----
  // 設計仕様・場所・社名を既定として記憶し、起動時と「新規」時に自動で入れる（名称・図番・年月日は図面ごとなので対象外）
  const TPL_KEY = 'haikan3d.dwgTemplate';
  function saveDwgTemplate() {
    try {
      localStorage.setItem(TPL_KEY, JSON.stringify({ spec: gatherSpec(), place: $('dwgPlace').value, company: $('dwgCompany').value }));
      toast('図面情報を既定として記憶しました（新規図面に自動で入ります）');
    } catch (err) { alert('記憶できませんでした：' + err.message); }
  }
  function applyDwgTemplate() {
    try {
      const raw = localStorage.getItem(TPL_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o.spec) applySpec(o.spec);
      if (o.place != null) $('dwgPlace').value = o.place;
      if (o.company != null) $('dwgCompany').value = o.company;
    } catch (err) {}
  }
  applyDwgTemplate();   // 起動時に既定値を適用（自動保存の復元があれば、その内容で上書きされる）
  // 保存メニュー（新規保存／上書き保存）。一度も保存していなければメニューを出さず新規保存
  const saveMenu = document.createElement('div');
  saveMenu.id = 'saveMenu';
  saveMenu.style.display = 'none';
  saveMenu.innerHTML = '<button id="svOver" type="button"></button><button id="svNew" type="button">新規保存（別ファイル）</button>';
  document.body.appendChild(saveMenu);
  function hideSaveMenu() { saveMenu.style.display = 'none'; }
  function openSaveMenu() {
    if (saveMenu.style.display !== 'none') { hideSaveMenu(); return; }   // 再押下＝閉じる
    if (!_saveTarget) { saveAsNew(); return; }
    const ov = document.getElementById('svOver');
    if (ov) ov.textContent = '上書き保存：' + _saveTarget.name;
    const btn = document.getElementById('cmdSave');
    const r = btn ? btn.getBoundingClientRect() : { left: 20, top: window.innerHeight - 60 };
    saveMenu.style.left = Math.max(8, Math.round(r.left)) + 'px';
    if (r.top < window.innerHeight / 2) { saveMenu.style.top = Math.round(r.bottom + 8) + 'px'; saveMenu.style.bottom = 'auto'; }   // 右上バー＝下へ開く
    else { saveMenu.style.top = 'auto'; saveMenu.style.bottom = Math.round(window.innerHeight - r.top + 8) + 'px'; }
    saveMenu.style.display = 'flex';
  }
  document.getElementById('svOver').onclick = () => { hideSaveMenu(); saveOverwrite(); };
  document.getElementById('svNew').onclick = () => { hideSaveMenu(); saveAsNew(); };
  document.addEventListener('pointerdown', e => {   // メニュー外タップ＝閉じる
    if (saveMenu.style.display === 'none') return;
    if (saveMenu.contains(e.target)) return;                                    // メニュー内＝各ボタンのclickに任せる
    if (e.target && e.target.closest && e.target.closest('#cmdSave')) return;   // 保存ボタン自身＝onclick側でトグル
    hideSaveMenu();
  }, true);
  // 新規図面：追従・移動を解除し、確認のうえ全消去（部品・注釈・図面情報・仕様欄）。
  // applyData の空データで一括初期化＝「開く」と同じ経路。履歴には残すので直後は「元に戻す」で復元できる。
  function newDrawing() {
    if (placedParts.length || annStore.length) {
      if (!confirm('現在の図面を消して新規作成します。よろしいですか？\n（保存していない内容は失われます。直後なら「元に戻す」で復元できます）')) return;
    }
    if (movingPart) cancelMovePart();
    stopFollow();
    applyData({ app: '配管3D', version: 1, parts: [], annotations: [], drawing: {} });
    _saveTarget = null;   // 新規図面＝上書き先も忘れる（前の図面ファイルを誤って上書きしない）
    applyDwgTemplate();   // 既定の図面情報（設計仕様・場所・社名）を自動で入れる
    scheduleHistory();
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
      // 起点(grip)の復元。過去の不具合（180°エルボの工作点が数百m彼方に計算されていた）で保存された
      // ゴミ起点は取り込まない（部品ローカルで10m超の機点は実在しない）
      if (rec.grip) { const gv = new V3().fromArray(rec.grip); if (gv.length() < 10) obj.userData.gripLocal = gv; }
      obj.userData.orient = rec.orient || 0;
      obj.userData.roll = rec.roll || 0;
      if (rec.mat) obj.userData.mat = rec.mat;
      if (rec.groupId != null) obj.userData.groupId = rec.groupId;
      if (rec.hidden) { obj.userData.hidden = true; obj.visible = false; }
      obj.userData.placed = true;
      modelGroup.add(obj);
      placedParts.push(obj);
    }
    const d = data.drawing || {};
    $('dwgDate').value = d.date || ''; $('dwgPlace').value = d.place || '';
    $('dwgName').value = d.name || ''; $('dwgNo').value = d.no || '';
    applySpec(d.spec);
    if (Array.isArray(data.annotations)) {
      for (const a of data.annotations) {
        addAnnotation(a.type, new V3().fromArray(a.a), new V3().fromArray(a.b), a.style);
        const r = annStore[annStore.length - 1];
        if (a.groupId != null) r.groupId = a.groupId;
        if (a.hidden) { r.hidden = true; r.obj.visible = false; }
      }
      if (data.annotations.some(a => a.hidden && (a.type === 'xline' || a.type === 'line')) && window.__annXptsRefresh) window.__annXptsRefresh();   // 隠した構築線の交点を消す
    }
    let maxG = 0;
    for (const p of placedParts) if (p.userData.groupId > maxG) maxG = p.userData.groupId;
    for (const a of annStore) if (a.groupId > maxG) maxG = a.groupId;
    if (window.__bumpGroupSeq) window.__bumpGroupSeq(maxG);
    // 詳細図の復元＝登録時の写真ごと戻す（写真は rec.url（ファイル/自動保存）または detailPhotos（履歴）から）。
    // details の無い古いファイルでは空になる＝前の図面の詳細図が新しい図面に紛れ込まない。
    detailAreas.length = 0;
    for (const rec of (data.details || [])) {
      const url = rec.url || detailPhotos.get(rec.key);
      if (!url || !rec.rect) continue;
      const key = rec.key || ('k' + (++_detailSeq));
      detailPhotos.set(key, url);
      detailAreas.push({ id: rec.id, name: rec.name || ('詳細' + rec.id), renamed: !!rec.renamed,
        rect: rec.rect, aspect: rec.aspect, key, url,
        parts: (rec.parts || []).map(i => placedParts[i]).filter(Boolean),
        anns: (rec.anns || []).map(i => annStore[i]).filter(Boolean) });
    }
    try { updateDetailBtn(); } catch (e) {}   // 起動時の自動保存復元ではボタン類が未初期化のことがある
    selectPart(null); refreshItemList();
  }
  window.__serializeForTest = o => serialize(o);      // e2e検証用
  window.__applyDataForTest = d => applyData(d);      // e2e検証用
  window.__recordHistoryForTest = () => recordHistory();   // e2e検証用（基準スナップショットを積む）
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
  // 端末内に保存した図面の一覧から開く／削除する画面。端末内が空なら出さず、そのままファイル選択へ進む
  function showDeviceFileList() {
    const all = devFilesGet();
    const names = Object.keys(all).sort((a, b) => (all[b].t || 0) - (all[a].t || 0));
    if (!names.length) return false;
    const ov = document.createElement('div');
    ov.id = '__devFileList';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(8,12,24,.72);display:flex;align-items:center;justify-content:center;font:13px Meiryo,sans-serif;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#f6f9fd;color:#26324a;border:1px solid #c4ccda;border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.45);min-width:320px;max-width:min(560px,92vw);max-height:80vh;display:flex;flex-direction:column;overflow:hidden;';
    const hd = document.createElement('div');
    hd.textContent = 'この端末に保存した図面';
    hd.style.cssText = 'padding:10px 14px;font-weight:700;color:#1f6fd0;border-bottom:1px solid #d7dee9;';
    const list = document.createElement('div');
    list.style.cssText = 'overflow:auto;padding:6px 8px;';
    const close = () => ov.remove();
    for (const nm of names) {
      const d = new Date(all[nm].t || 0);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 6px;border-bottom:1px solid #e6ebf3;';
      const lab = document.createElement('button');
      lab.type = 'button';
      lab.innerHTML = `<b>${esc(nm)}</b><br><span style="color:#6b7a99;font-size:11px">${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</span>`;
      lab.style.cssText = 'flex:1;text-align:left;background:none;border:0;cursor:pointer;font:inherit;color:inherit;padding:4px;';
      lab.onclick = () => {
        try {
          applyData(JSON.parse(all[nm].data)); resetHistory();
          _saveTarget = { handle: null, name: nm };   // 続けて上書き保存できる
          close(); toast('開きました：' + nm);
        } catch (err) { alert('読込に失敗しました：' + err.message); }
      };
      const del = document.createElement('button');
      del.type = 'button'; del.textContent = '削除';
      del.style.cssText = 'flex:none;padding:4px 10px;border:1px solid #d0b0b0;border-radius:6px;background:#fff;color:#a33;cursor:pointer;font:inherit;';
      del.onclick = () => { if (confirm(nm + ' を端末内から削除しますか？')) { devFileDelete(nm); row.remove(); if (!list.children.length) close(); } };
      row.append(lab, del);
      list.appendChild(row);
    }
    const ft = document.createElement('div');
    ft.style.cssText = 'display:flex;gap:8px;padding:10px 14px;border-top:1px solid #d7dee9;';
    const mk = (t, primary) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.style.cssText = `padding:7px 14px;border:1px solid ${primary ? '#2f7bff' : '#c4ccda'};border-radius:7px;background:${primary ? '#2f7bff' : '#fff'};color:${primary ? '#fff' : '#33405c'};cursor:pointer;font:inherit;`; return b; };
    const fromFile = mk('ファイルから開く', true), cancel = mk('取消');
    fromFile.style.marginLeft = 'auto';
    fromFile.onclick = () => { close(); loadFromFile(); };
    cancel.onclick = close;
    ft.append(cancel, fromFile);
    box.append(hd, list, ft); ov.appendChild(box); document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    return true;
  }
  async function load() {
    if (showDeviceFileList()) return;   // 端末内に図面があれば一覧から選ぶ（無ければ従来どおりファイル選択）
    return loadFromFile();
  }
  async function loadFromFile() {
    // PC(Chrome/Edge)：File System Access API で開くとハンドルが取れ、そのまま「上書き保存」で書き戻せる
    if (window.showOpenFilePicker) {
      let h = null, f = null, text = null;
      try {
        [h] = await window.showOpenFilePicker({ multiple: false });
        f = await h.getFile();
        text = await f.text();
      } catch (err) { if (err && err.name === 'AbortError') return; text = null; }   // キャンセル＝中止。失敗＝従来input へ
      if (text != null) {
        try {
          applyData(JSON.parse(text)); resetHistory();
          _saveTarget = { handle: h, name: f.name };   // 開いたファイル＝上書き保存の対象
        } catch (err) { alert('読込に失敗しました：' + err.message); }
        return;
      }
    }
    const inp = document.createElement('input');
    inp.type = 'file';
    // iPad対策：accept で拡張子を絞ると「ファイル」で .p3d.json がグレーアウトして選べないことがあるので絞らない
    //（中身は applyData が検証する）。また一部iOSは input をDOMに入れないとピッカーが開かないため body に追加する。
    inp.style.position = 'fixed'; inp.style.left = '-10000px'; inp.style.top = '0';
    document.body.appendChild(inp);
    const cleanup = () => { if (inp.parentNode) inp.parentNode.removeChild(inp); };
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) { cleanup(); return; }
      const r = new FileReader();
      r.onload = () => {
        cleanup();
        try {
          applyData(JSON.parse(r.result)); resetHistory();
          _saveTarget = { handle: null, name: f.name };   // 名前だけ記憶（上書きは同名ダウンロード）
        } catch (err) { alert('読込に失敗しました：' + err.message); }
      };
      r.onerror = () => { cleanup(); alert('ファイルを読み込めませんでした。'); };
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
  const PRINT_XLINE_COLOR = 0x9aa4b4;   // 印刷での構築線＝薄いグレー（実線・寸法と区別・2026-07-21 社長要望）
  // 印刷用の線画マテリアル（白地に黒い輪郭線・陰影なし・隠線は消える）
  let _printFillMat = null, _printEdgeMat = null;
  function _printMats() {
    if (!_printFillMat) {
      _printFillMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      _printEdgeMat = new THREE.LineBasicMaterial({ color: 0x111111 });
    }
    return { fill: _printFillMat, edge: _printEdgeMat };
  }
  // ===== 外形（シルエット）線：深度バッファから輪郭を抽出する =====
  // 部品を深度テクスチャへ描き、隣の画素と深度差が大きい所＝物の縁を1画素の黒線で描く。
  // 面を膨らませる方式（インバーテッドハル）は見る角度で太さが変わり途切れるため採用しない（2026-07-21 社長指摘）
  let _edgeRT = null, _edgeScene = null, _edgeCam = null, _edgeQuad = null;
  function ensureEdgePass(w, h) {
    if (!_edgeRT) {
      _edgeRT = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat, stencilBuffer: false, depthBuffer: true,
      });
      _edgeRT.depthTexture = new THREE.DepthTexture(w, h);
      _edgeRT.depthTexture.type = THREE.UnsignedIntType;      // 深度の精度を確保
      _edgeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      _edgeScene = new THREE.Scene();
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          tDepth: { value: _edgeRT.depthTexture },
          texel: { value: new THREE.Vector2(1 / w, 1 / h) },
          cnear: { value: 0.1 }, cfar: { value: 100 },
          isOrtho: { value: 0 }, rel: { value: 0.012 }, spread: { value: 1.0 },
          edgeCol: { value: new THREE.Color(0x0f0f0f) }, edgeA: { value: 1.0 },
          aoK: { value: 0.0 }, aoR: { value: 5.0 },   // 陰の濃さ / 拾う半径(px)。0＝陰なし（印刷はこちら）
        },
        vertexShader: 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: [
          'uniform sampler2D tDepth; uniform vec2 texel; uniform float cnear, cfar, isOrtho, rel, spread;',
          'uniform vec3 edgeCol; uniform float edgeA, aoK, aoR;',
          'varying vec2 vUv;',
          'float lin(vec2 uv){',
          '  float z = texture2D(tDepth, uv).x;',
          '  if (isOrtho > 0.5) return cnear + z * (cfar - cnear);',        // 平行投影は線形
          '  float ndc = z * 2.0 - 1.0;',
          '  return (2.0 * cnear * cfar) / (cfar + cnear - ndc * (cfar - cnear));',
          '}',
          'void main(){',
          '  if (texture2D(tDepth, vUv).x > 0.99995) discard;',             // 部品が写っていない画素（空・地面）は触らない
          '  vec2 t = texel * spread;',
          '  float c = lin(vUv);',
          '  float l = lin(vUv - vec2(t.x, 0.0));',
          '  float r = lin(vUv + vec2(t.x, 0.0));',
          '  float u = lin(vUv + vec2(0.0, t.y));',
          '  float d = lin(vUv - vec2(0.0, t.y));',
          '  float m = max(max(abs(c - l), abs(c - r)), max(abs(c - u), abs(c - d)));',
          '  if (m / max(c, 1e-4) >= rel) {',                               // 深度差が大きい＝物の縁
          '    gl_FragColor = vec4(edgeCol, edgeA);',
          '    return;',
          '  }',
          // くぼみの陰（キャビティAO）：まわりが自分より手前にあるほど暗くする。
          // 法線を使う本式のSSAOではなく深度差だけの安価な方式＝溶接部・ボルト穴・部品の合わせ目が締まる。
          '  if (aoK <= 0.0) discard;',
          '  vec2 a = texel * aoR;',
          '  float occ = 0.0;',
          '  for (int i = 0; i < 8; i++) {',
          '    float ang = float(i) * 0.7853982;',                          // 45°ずつ8方向
          '    vec2 o = vec2(cos(ang), sin(ang)) * a;',
          '    float dz = c - lin(vUv + o);',                               // 正＝まわりの方が手前＝遮蔽
          '    occ += clamp(dz / (c * 0.014), 0.0, 1.0);',                  // 視距離に対する相対量で見る
          '  }',
          '  occ = occ / 8.0;',
          '  occ = occ * occ * (3.0 - 2.0 * occ);',                         // なめらかに（急に暗くならない）
          '  float al = occ * aoK;',
          '  if (al < 0.004) discard;',
          '  gl_FragColor = vec4(0.0, 0.0, 0.0, al);',                      // 黒を薄く重ねる＝掛け算で暗くなる
          '}',
        ].join('\n'),
        transparent: true, depthTest: false, depthWrite: false,
      });
      _edgeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      _edgeQuad.frustumCulled = false;
      _edgeScene.add(_edgeQuad);
    } else if (_edgeRT.width !== w || _edgeRT.height !== h) {
      _edgeRT.setSize(w, h);
      _edgeQuad.material.uniforms.texel.value.set(1 / w, 1 / h);
    }
    return _edgeQuad.material;
  }
  // 部品だけを深度へ描いて輪郭線（と陰）を canvas に重ねる。
  // opt = { edgeColor, edgeAlpha, ao, aoRadius }。省略時は印刷用＝真っ黒の線・陰なし。
  function drawSilhouette(cam, opt) {
    const w = renderer.domElement.width, h = renderer.domElement.height;
    let mat;
    try { mat = ensureEdgePass(w, h); } catch (e) { return false; }   // 深度テクスチャ非対応なら輪郭線なしで続行
    // 部品の縁だけを拾う＝注釈・マーカー・グリッド・地面は深度に入れない
    // （入れると寸法線や吸着点の緑玉まで縁取りされる）
    const hidden = [];
    for (const g of [annGroup, markerGroup, grid, groundGroup, xptGroup, lineGuideGroup, lineSelGroup, _clashGroup]) {
      if (g && g.visible) { g.visible = false; hidden.push(g); }
    }
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(_edgeRT);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    for (const g of hidden) g.visible = true;
    const o = opt || {};
    mat.uniforms.cnear.value = cam.near; mat.uniforms.cfar.value = cam.far;
    mat.uniforms.isOrtho.value = cam.isOrthographicCamera ? 1 : 0;
    mat.uniforms.edgeCol.value.setHex(o.edgeColor === undefined ? 0x0f0f0f : o.edgeColor);
    mat.uniforms.edgeA.value = o.edgeAlpha === undefined ? 1.0 : o.edgeAlpha;
    mat.uniforms.aoK.value = o.ao === undefined ? 0.0 : o.ao;
    mat.uniforms.aoR.value = o.aoRadius === undefined ? 5.0 : o.aoRadius;
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(_edgeScene, _edgeCam);
    renderer.autoClear = prevAuto;
    return true;
  }
  // 画面用の外形線＋陰（2026-07-26）。印刷でしか使っていなかったこのパスを描画ループでも回す。
  // 紙より軽い墨色＋薄い陰＝「品よく締まる」程度に留め、図面（印刷）の真っ黒な線とは別物にする。
  // 描画ループは app.js の前半にあり、この関数はまだ定義されていないので変数に入れて渡す。
  screenSilhouette = (cam) => drawSilhouette(cam, SCREEN_EDGE_OPT);
  // 画面1px相当のワールド長さ（外形線の太さを紙の上で一定に保つ）。
  // 印刷は高解像度で描くので、実際の描画バッファの高さを渡すこと（線が太く・鉛筆書きのようになるのを防ぐ）
  function pixelWorldSize(hPx) {
    const cam = activeCam(), h = hPx || renderer.domElement.clientHeight || 800;
    if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / (cam.zoom || 1) / h;
    const tgt = (typeof controls !== 'undefined' && controls.target) ? controls.target : new THREE.Vector3();
    const dist = cam.position.distanceTo(tgt);
    return 2 * Math.tan(cam.fov * Math.PI / 360) * dist / h;
  }
  // 印刷用：白背景・グリッド非表示・線画化して撮る（参考の手書き図面に寄せる）
  function snapshotForPrint(hideParts) {   // hideParts=true：部品を隠して注釈だけ撮る（単線図のラスタ層用）
    // 印刷は紙に引き伸ばされるので、画面解像度のまま撮ると線がぼやけて鉛筆書きのように見える。
    // 一時的に高解像度（3倍）で描画してから撮る（2026-07-21 社長指摘）
    const prevPR = renderer.getPixelRatio();
    renderer.setPixelRatio(3);
    const prevBg = scene.background;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevGrid = grid ? grid.visible : null;
    const prevSheen = floorSheen ? floorSheen.visible : null;
    const prevGround = groundGroup ? groundGroup.visible : null;
    // 選択中の起点・機点マーカーやカーソルの補助表示は図面に出さない（2026-07-21）
    const hideForPrint = [];
    for (const g of [markerGroup, xptGroup, lineGuideGroup]) if (g && g.visible) { g.visible = false; hideForPrint.push(g); }
    // 単線図モード＝部品は描かない（SVGの単線・記号で別層に描く）。寸法・線分・文字だけ撮る
    const partsHidden = [];
    if (hideParts) for (const p of placedParts) if (p.visible) { p.visible = false; partsHidden.push(p); }
    scene.background = new THREE.Color(0xffffff);
    renderer.setClearColor(0xffffff, 1);
    if (grid) grid.visible = false;
    if (floorSheen) floorSheen.visible = false;     // 床の艶も図面には出さない
    if (groundGroup) groundGroup.visible = false;   // 地面スラブは図面（印刷）には出さない
    // 寸法値の背景マスクを白（紙色）で作り直す（作り直すと文字の向き・サイズが初期化されるので合わせ直す）
    if (window.__dimMaskPrint) { window.__dimMaskPrint(true); if (window.__updateDimTextFacing) window.__updateDimTextFacing(); }

    // 各部品メッシュ：陰影なしの淡い面に差し替え＋黒い稜線(EdgesGeometry)を重ねる。
    const { fill, edge } = _printMats();
    const matBackup = [];   // [mesh, 元material]
    const overlays = [];    // [親mesh, 追加したobject, 破棄するgeometry|null]
    // 先に対象メッシュを集める（走査中に子メッシュを足すと再帰してしまうため）
    const printMeshes = [];
    if (!hideParts) for (const p of placedParts) p.traverse(o => { if (o.isMesh && o.geometry) printMeshes.push(o); });
    for (const o of printMeshes) {
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

    // 注釈（寸法線・補助線・矢印・線分・構築線）は加算合成の発光色だと白地で飛ぶ。
    // 印刷は黒の通常合成で確実に見えるようにする（文字スプライトは対象外＝色そのまま）。
    // 構築線は「作図の補助」なので、印刷では薄いグレーにして実線・寸法と区別する（2026-07-21 社長要望）
    const xlineObjs = new Set();
    if (window.__annXlineObjs) for (const o of window.__annXlineObjs()) o.traverse(c => xlineObjs.add(c));
    const annBackup = [];
    const annSeen = new Set();   // 破線・一点鎖線はセグメント群が1材質を共有＝二重に控えると
    annGroup.traverse(o => {     // 「黒くした後の色」を控えてしまい復元で黒が残る（2026-07-30 社長報告の真因）
      const m = o.material;
      if ((o.isMesh || o.isLine || o.isLineSegments) && m && m.color && !annSeen.has(m)) {
        annSeen.add(m);
        annBackup.push([m, m.color.getHex(), m.blending, m.opacity]);
        m.color.setHex(xlineObjs.has(o) ? PRINT_XLINE_COLOR : 0x1a1a1a);
        m.blending = THREE.NormalBlending;
        m.needsUpdate = true;   // 光暈の不透明度は上げない（細い線のまま黒で出す）
      }
    });

    renderer.setViewport(0, 0, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.render(scene, activeCam());
    if (!hideParts) drawSilhouette(activeCam());   // 部品の外形（シルエット）を1画素の細線で重ねる
    const url = renderer.domElement.toDataURL('image/png');

    // 後始末：注釈の色/合成/不透明度を戻す → 稜線を外して元のマテリアルへ戻す
    for (const [m, c, b, op] of annBackup) { m.color.setHex(c); m.blending = b; m.opacity = op; m.needsUpdate = true; }
    for (const [o, ob, eg] of overlays) { o.remove(ob); if (eg) eg.dispose(); }   // hullは元ジオメトリの使い回しなのでdisposeしない
    for (const [o, m] of matBackup) o.material = m;
    scene.background = prevBg;
    renderer.setClearColor(prevClear, prevAlpha);
    if (grid) grid.visible = prevGrid;
    if (floorSheen) floorSheen.visible = prevSheen;
    if (groundGroup) groundGroup.visible = prevGround;
    for (const g of hideForPrint) g.visible = true;
    for (const p of partsHidden) p.visible = true;
    if (window.__dimMaskPrint) { window.__dimMaskPrint(false); if (window.__updateDimTextFacing) window.__updateDimTextFacing(); }   // マスクを画面用に戻す
    renderer.setPixelRatio(prevPR);   // 画面用の解像度へ戻す
    renderer.clear();
    renderer.render(scene, activeCam());
    return url;
  }
  window.__printSnapForTest = () => snapshotForPrint();   // 印刷イメージの検証用フック
  async function exportPng() {
    const url = snapshot();
    let nm = ($('dwgNo').value || '配管図').trim().replace(/[\\/:*?"<>|]/g, '_') || '配管図';
    const blob = await (await fetch(url)).blob();
    // 保存先を最初に選ぶ（iPad＝共有シート：「画像を保存」で写真アプリ・「ファイルに保存」でフォルダ選択）
    const r = await saveWithLocationChoice(nm + '.png', blob, 'image/png');
    if (r) toast('画像を書き出しました：' + nm + '.png');
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
    const rows = groups.map((g, i) => ({ no: i + 1, kind: g.c.kind, type: g.c.type, size: g.c.size, cls: g.c.cls, mat: g.mat, qty: g.qty }));
    // 付属品・溶接・パイプ合計の自動集計も部品表（印刷・CSV）へ載せる
    for (const r of accessoryRows()) rows.push({ no: rows.length + 1, kind: r.kind, type: r.type, size: r.size, cls: r.cls, mat: '', qty: r.qty });
    return rows;
  }
  // ---- 部品表CSV（Excel向け・BOM付きUTF-8） ----
  function buildCsvLines() {
    const esc = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [];
    lines.push(['図番', $('dwgNo').value, '名称', $('dwgName').value, '年月日', $('dwgDate').value, '社名', $('dwgCompany').value].map(esc).join(','));
    lines.push('');
    lines.push(['#', '種別', 'タイプ', 'サイズ', 'クラス', '数量', '材質'].join(','));
    for (const r of partsRows()) lines.push([r.no, r.kind, r.type, r.size, r.cls, r.qty, r.mat || ''].map(esc).join(','));
    lines.push('');
    lines.push(esc('※ガスケット・ボルト・溶接口・パイプ合計は機点の接続から自動集計した参考値'));
    // ---- パイプ切寸表（配管化③）：BWギャップ・SOP/SW差込みを加減した、現場でそのまま切れる寸法 ----
    const pipes = placedParts.filter(p => p.userData.partType === 'pipe' && !p.userData.hidden);
    if (pipes.length) {
      const lbl = e => e.kind === 'BW' ? `BW(${e.with || ''})`
                    : e.kind === 'SOP' ? `${e.with || 'SOP'}(${e.depth != null ? Math.round(e.depth * 10) / 10 : ''})`
                    : e.kind === 'SW' ? `SW差込${e.depth != null ? Math.round(e.depth * 10) / 10 : ''}`
                    : e.kind === 'none' ? '突き当て' : '—';
      lines.push('');
      lines.push(esc('パイプ切寸表（面基準：切寸＝図面長さ−SOP控え−BWルートギャップ÷2。ギャップ0は+0.5。⚙設定→溶接・切寸の設定で調整可）'));
      lines.push(['#', '呼び径', 'Sch', '図面長さ(mm)', '端A', '端B', '切寸(mm)', 'ギャップ(mm)', 'SOP控え(mm)'].join(','));
      pipes.forEach((p, i) => {
        const c = pipeCutInfo(p);
        lines.push([i + 1, p.userData.pipe.sizeA, p.userData.pipe.sch, Math.round(p.userData.pipe.length * 10) / 10,
                    lbl(c.ends[0]), c.branch ? `被り付き(母管${c.branchSide === 'outer' ? '外面' : '内面'})` : (c.slant ? '斜め切り' : lbl(c.ends[1])),
                    (c.branch || c.slant) ? `${c.cut}〜${c.cutMax}` : c.cut, c.gap, c.sop].map(esc).join(','));
      });
    }
    // ---- 溶接一覧（図面に溶接番号 W1,W2… が入っている時だけ）----
    const wrecs = (window.__annStoreForTest ? window.__annStoreForTest() : [])
      .filter(r => r.type === 'dim' && !r.hidden && r.style && r.style.weldTag);
    if (wrecs.length) {
      const joints = collectWeldJoints();
      lines.push('');
      lines.push(esc('溶接一覧（番号＝図面のW表記。形式・呼び径は機点から自動推定した参考値。F/S＝図面の注記から・検査欄は現場で記入）'));
      lines.push(['番号', '形式', '呼び径', 'Sch', 'F/S', '検査'].join(','));
      const noOf = r => { const m = /W(\d+)/.exec(String(r.style.dimText || '')); return m ? +m[1] : 9999; };
      for (const r of wrecs.slice().sort((a, b) => noOf(a) - noOf(b))) {
        const j = joints.find(jj => jj.pt.distanceTo(r.a) < 0.002);
        const txt = String(r.style.dimText || '');
        const fs = /[（(]F[）)]/i.test(txt) ? 'F' : (/[（(]S[）)]/i.test(txt) ? 'S' : '');
        lines.push([txt.replace(/[（(].*$/, ''), j ? (j.sw ? 'SW' : 'BW') : '', j ? j.size : '', j ? (j.sch || '') : '', fs, ''].map(esc).join(','));
      }
    }
    return lines;
  }
  window.__csvText = () => buildCsvLines().join('\n');   // e2e検証用（切寸表の内容確認）
  function exportCsv() {
    const lines = buildCsvLines();
    const name = (($('dwgNo').value || $('dwgName').value || '部品表').trim() || '部品表').replace(/[\\/:*?"<>|]/g, '_') + '.csv';
    // 保存先を最初に選ぶ（BOM付きUTF-8＝Excelで文字化けしない）
    saveWithLocationChoice(name, '\ufeff' + lines.join('\r\n'), 'text/csv')
      .then(r => { if (r) toast('部品表CSVを書き出しました：' + name); });
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
  // 地面(XZ平面)に乗った3Dコンパス：視点に合わせて傾く楕円リング＋赤い北磁針＋N/E/S/W＋上方向ヒント。
  // 北＝ワールド -Z。現在ビューの向きで投影して描くので、視点を回すとコンパスも傾く。
  // 印刷の左上＝格子舞台（新キューブ）のモノクロ縮刷（2026-07-30 社長指示。方位指針は廃止）。
  // X/Zの矢・文字は出さない。鉛直の矢1本だけ「上」表記（モノクロ）。方位文字は北南東西、
  // 正対でこちら/向こうへ潰れるものは省く。現在の視点の向きで描く。
  function buildAxisGlyph() {
    const C = 40, Rt = 21;
    try {
      const cam = activeCam(); cam.updateMatrixWorld();
      // カメラの向きだけを使った平行投影＝透視の歪みなく、画面と同じ向きの整った舞台を刷る
      const right = new V3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
      const upv = new V3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
      const proj = v => { const p = new V3(v[0], v[1], v[2]); return { x: p.dot(right), y: -p.dot(upv) }; };  // SVGはy下向き
      const E1 = proj([1, 0, 0]), S1 = proj([0, 0, 1]);
      const mag = Math.max(Math.hypot(E1.x, E1.y), Math.hypot(S1.x, S1.y), 1e-6);
      const f = Rt / mag;
      const P = v => { const p = proj(v); return { x: C + p.x * f, y: C + p.y * f }; };
      const viewDir = new V3().setFromMatrixColumn(cam.matrixWorld, 2).normalize();   // 注視点→カメラの向き
      let body = '';
      // 舞台＝5×5の格子（外枠も同じ太さ）
      for (let i = 0; i <= 4; i++) {
        const t = -1 + (2 / 4) * i;
        const a1 = P([t, 0, -1]), b1 = P([t, 0, 1]);
        const a2 = P([-1, 0, t]), b2 = P([1, 0, t]);
        body += `<line x1="${a1.x.toFixed(1)}" y1="${a1.y.toFixed(1)}" x2="${b1.x.toFixed(1)}" y2="${b1.y.toFixed(1)}" stroke="#6b7280" stroke-width="0.55"/>`;
        body += `<line x1="${a2.x.toFixed(1)}" y1="${a2.y.toFixed(1)}" x2="${b2.x.toFixed(1)}" y2="${b2.y.toFixed(1)}" stroke="#6b7280" stroke-width="0.55"/>`;
      }
      // 鉛直の矢（モノクロ）＋「上」。真上/真下の正対では潰れるので省く
      const O2 = P([0, 0, 0]), T2 = P([0, 1.15, 0]);
      let ux = T2.x - O2.x, uy = T2.y - O2.y; const L2 = Math.hypot(ux, uy);
      if (L2 > 3) {
        ux /= L2; uy /= L2;
        const bx = T2.x - ux * 4, by = T2.y - uy * 4;
        body += `<line x1="${O2.x.toFixed(1)}" y1="${O2.y.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#111" stroke-width="1.3" stroke-linecap="round"/>`;
        body += `<polygon points="${(T2.x + ux * 2).toFixed(1)},${(T2.y + uy * 2).toFixed(1)} ${(bx - uy * 2.6).toFixed(1)},${(by + ux * 2.6).toFixed(1)} ${(bx + uy * 2.6).toFixed(1)},${(by - ux * 2.6).toFixed(1)}" fill="#111"/>`;
        body += `<text x="${(T2.x + ux * 8).toFixed(1)}" y="${(T2.y + uy * 8 + 3).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#111">上</text>`;
      }
      // 方位の文字（北は太字）
      for (const [t, d] of [['北', [0, 0, -1]], ['南', [0, 0, 1]], ['東', [1, 0, 0]], ['西', [-1, 0, 0]]]) {
        if (Math.abs(d[0] * viewDir.x + d[2] * viewDir.z + 0 * viewDir.y) > 0.985 * Math.max(Math.hypot(viewDir.x, viewDir.z), 1e-6) && Math.abs(viewDir.y) < 0.2) continue;   // 真横正対＝中央に重なる方位は省く
        const q = P([d[0] * 1.45, 0.02, d[2] * 1.45]);
        body += `<text x="${q.x.toFixed(1)}" y="${(q.y + 3).toFixed(1)}" text-anchor="middle" font-size="8.5" ${t === '北' ? 'font-weight="700"' : ''} fill="#333">${t}</text>`;
      }
      return `<svg class="north" viewBox="0 0 80 80">${body}</svg>`;
    } catch (e) {
      return `<svg class="north" viewBox="0 0 80 80"></svg>`;
    }
  }
  // ===== 詳細図（部分拡大）＝2026-07-21 社長要望 =====
  // 込み入った所を選んで登録すると、印刷の左上に「詳細A」として拡大図を載せ、本図には丸印とAを付ける。
  // ルートが長くて実寸では細部が読めない問題への、製図の定番の対処。モデルは何も変えない。
  const DETAIL_IDS = ['A', 'B', 'C'];
  // （detailAreas 等の実体は serialize/applyData から使うため、その直前で宣言している）
  window.__detailCount = () => detailAreas.length;
  window.__detailClear = () => { detailAreas.length = 0; };
  window.__addDetailArea = () => addDetailArea();
  function detailBox(d) {                       // 登録した対象の現在の範囲（編集に追従）
    const box = new THREE.Box3();
    for (const p of d.parts) if (placedParts.includes(p) && !p.userData.hidden) box.expandByObject(p);
    for (const r of d.anns) if (annStore.includes(r) && !r.hidden) { box.expandByPoint(r.a); box.expandByPoint(r.b); }
    return box.isEmpty() ? null : box;
  }
  function relabelDetails() { detailAreas.forEach((d, i) => { d.id = DETAIL_IDS[i] || String(i + 1); if (!d.renamed) d.name = `詳細${d.id}`; }); }   // A/B/C・名前を詰め直す
  function sameSet(d, parts, anns) {   // 同じアイテムの組み合わせか（＝登録済みを選び直した）
    if (d.parts.length !== parts.length || d.anns.length !== anns.length) return false;
    return d.parts.every(p => parts.includes(p)) && d.anns.every(a => anns.includes(a));
  }
  // 画面の矩形内にあるアイテム（部品・線/寸法）を、選択を変えずに集める
  function itemsInRect(x0, y0, x1, y1) {
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const lo = Math.min, hi = Math.max;
    const rx0 = lo(x0, x1), rx1 = hi(x0, x1), ry0 = lo(y0, y1), ry1 = hi(y0, y1);
    const inRect = w => { const n = modelGroup.localToWorld(w.clone()).project(cam); if (n.z >= 1) return false;
      const sx = rect.left + (n.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-n.y * 0.5 + 0.5) * rect.height;
      return sx >= rx0 && sx <= rx1 && sy >= ry0 && sy <= ry1; };
    const parts = placedParts.filter(p => p.userData.faceLocal && !p.userData.hidden && inRect(originModelPos(p)));
    const anns = annStore.filter(r => !r.hidden && (inRect(r.a) || inRect(r.b)));
    return { parts, anns };
  }
  // 詳細図ボタンの点灯＝枠モード中だけ（登録して枠モードを抜けたら消える・2026-07-21 社長仕様）
  function updateDetailBtn() {
    const b = document.getElementById('cmdDetail');
    if (b) b.classList.toggle('active', !!detailFrame);
  }
  window.__detailBtnState = () => { const b = document.getElementById('cmdDetail'); return b && b.classList.contains('active'); };
  window.__detailNames = () => detailAreas.map(d => d.name);
  // 窓の中身を「そのまま切り取った写真」にする（2026-07-21 社長：フィット拡大でなく実際に見えている大きさのまま）。
  // 印刷スタイルで全体を撮り、指定した画面矩形(0..1正規化)だけを切り出す。
  async function captureDetailCrop(nx, ny, nw, nh) {
    const url = snapshotForPrint();
    const img = new Image();
    await new Promise(r => { img.onload = r; img.onerror = r; img.src = url; });
    const sx = nx * img.width, sy = ny * img.height, sw = Math.max(1, nw * img.width), sh = Math.max(1, nh * img.height);
    // 写真は保存データ（自動保存・ファイル）にも記憶するので、長辺を抑えて容量を軽くする（印刷86mm幅には十分な精細さ）
    const MAXL = 1600, k = Math.min(1, MAXL / Math.max(sw, sh));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(sw * k)); cv.height = Math.max(1, Math.round(sh * k));
    cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png');
  }
  // 部品・注釈の集合を、画面上の外接矩形（正規化・少し余白）にする
  function screenRectOf(parts, anns) {
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9, any = false;
    const add = w => { const n = modelGroup.localToWorld(w.clone()).project(cam); if (n.z >= 1) return; any = true;
      const u = n.x * 0.5 + 0.5, v = -n.y * 0.5 + 0.5; uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, v); vMax = Math.max(vMax, v); };
    for (const p of parts) { const b = new THREE.Box3().setFromObject(p); const cs = [b.min, b.max];
      for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 2; zi++) add(new THREE.Vector3(cs[xi].x, cs[yi].y, cs[zi].z)); }
    for (const r of anns) { add(r.a); add(r.b); }
    if (!any) return null;
    const pad = 0.03;
    return { nx: Math.max(0, uMin - pad), ny: Math.max(0, vMin - pad),
             nw: Math.min(1, uMax + pad) - Math.max(0, uMin - pad), nh: Math.min(1, vMax + pad) - Math.max(0, vMin - pad) };
  }
  // 枠ドラッグで詳細図を登録する（2026-07-21 社長案：ボタン→枠で囲む→窓の中身を写真として拡大図に）
  async function registerDetailRect(x0, y0, x1, y1) {
    const { parts, anns } = itemsInRect(x0, y0, x1, y1);
    if (!parts.length && !anns.length) { if (window.__toast) window.__toast('枠の中にアイテムがありません'); return; }
    // 同じ範囲でも重ねて登録できる（2026-08-04 社長指示：「登録済みです」の弾きは不要）
    if (detailAreas.length >= DETAIL_IDS.length) { if (window.__toast) window.__toast(`詳細図は${DETAIL_IDS.length}箇所までです`); return; }
    const rc = renderer.domElement.getBoundingClientRect();
    const nx = (Math.min(x0, x1) - rc.left) / rc.width, ny = (Math.min(y0, y1) - rc.top) / rc.height;
    const nw = Math.abs(x1 - x0) / rc.width, nh = Math.abs(y1 - y0) / rc.height;
    const id = DETAIL_IDS[detailAreas.length];
    const url = await captureDetailCrop(nx, ny, nw, nh);
    const key = 'k' + (++_detailSeq); detailPhotos.set(key, url);
    detailAreas.push({ id, name: `詳細${id}`, key, parts, anns, rect: { nx, ny, nw, nh }, aspect: nw * rc.width / Math.max(nh * rc.height, 1), url });
    updateDetailBtn();
    recordHistory();   // 登録＝図面の状態（保存・アンドゥの対象）
    if (window.__toast) window.__toast(`詳細${id} を登録しました（長押しで一覧・編集）`);
  }
  // 従来の「選択して押す」も残す（選択があればそれを写真として登録／無ければ枠モードへ）
  async function addDetailArea() {
    const parts = [...selectedParts], anns = [...selAnns];
    if (parts.length || anns.length) {
      // 同じ範囲でも重ねて登録できる（2026-08-04 社長指示：「登録済みです」の弾きは不要）
      if (detailAreas.length >= DETAIL_IDS.length) { if (window.__toast) window.__toast(`詳細図は${DETAIL_IDS.length}箇所までです`); return; }
      const nr = screenRectOf(parts, anns);
      if (!nr) { if (window.__toast) window.__toast('画面に映っていません（対象が見える向きにしてから登録してください）'); return; }
      const id = DETAIL_IDS[detailAreas.length];
      const url = await captureDetailCrop(nr.nx, nr.ny, nr.nw, nr.nh);
      const key = 'k' + (++_detailSeq); detailPhotos.set(key, url);
      detailAreas.push({ id, name: `詳細${id}`, key, parts, anns, rect: nr, aspect: nr.nw / Math.max(nr.nh, 0.001), url });
      updateDetailBtn();
      recordHistory();
      if (window.__toast) window.__toast(`詳細${id} を登録しました`);
      return;
    }
    startDetailFrame();   // 選択が無ければ枠ドラッグモードへ
  }
  window.__registerDetailRect = registerDetailRect;
  // ===== 詳細図の一覧・プレビュー（長押しで開く／名前の編集・削除）2026-07-21 社長要望 =====
  function closeDetailPanels() {
    for (const id of ['__detailList', '__detailPrev']) { const el = document.getElementById(id); if (el) el.remove(); }
  }
  window.__detailPanelsOpen = () => !!(document.getElementById('__detailList') || document.getElementById('__detailPrev'));
  function openDetailList() {
    closeDetailPanels();
    if (!detailAreas.length) { if (window.__toast) window.__toast('詳細図はまだありません（押して枠で囲むと登録）'); return; }
    const ov = document.createElement('div'); ov.id = '__detailList';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(8,12,24,.55);display:flex;align-items:center;justify-content:center;font:13px Meiryo,sans-serif;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#f6f9fd;color:#26324a;border:1px solid #c4ccda;border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.4);width:min(360px,92vw);max-height:80vh;display:flex;flex-direction:column;overflow:hidden;';
    const hd = document.createElement('div'); hd.textContent = '詳細図の一覧'; hd.style.cssText = 'padding:10px 14px;font-weight:700;color:#1f6fd0;border-bottom:1px solid #d7dee9;';
    const list = document.createElement('div'); list.style.cssText = 'overflow:auto;padding:6px;';
    detailAreas.forEach((d, i) => {
      const row = document.createElement('button'); row.type = 'button';
      row.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:#fff;border:1px solid #e0e6ef;border-radius:8px;padding:7px 8px;margin-bottom:6px;cursor:pointer;font:inherit;color:inherit;';
      const th = document.createElement('img'); th.src = d.url; th.style.cssText = 'width:56px;height:40px;object-fit:contain;background:#fff;border:1px solid #dde3ec;border-radius:4px;flex:none;';
      const nm = document.createElement('div'); nm.innerHTML = `<b>${esc(d.name)}</b><br><span style="color:#6b7a99;font-size:11px">記号 ${d.id}</span>`;
      row.append(th, nm); row.onclick = () => openDetailPreview(i);
      list.appendChild(row);
    });
    const ft = document.createElement('div'); ft.style.cssText = 'display:flex;justify-content:flex-end;padding:10px 14px;border-top:1px solid #d7dee9;';
    const cl = document.createElement('button'); cl.type = 'button'; cl.textContent = '閉じる';
    cl.style.cssText = 'padding:7px 14px;border:1px solid #c4ccda;border-radius:7px;background:#fff;color:#33405c;cursor:pointer;font:inherit;';
    cl.onclick = closeDetailPanels; ft.appendChild(cl);
    box.append(hd, list, ft); ov.appendChild(box); document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) closeDetailPanels(); });
  }
  function openDetailPreview(i) {
    closeDetailPanels();
    const d = detailAreas[i]; if (!d) return;
    const ov = document.createElement('div'); ov.id = '__detailPrev';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(8,12,24,.6);display:flex;align-items:center;justify-content:center;font:13px Meiryo,sans-serif;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#f6f9fd;color:#26324a;border:1px solid #c4ccda;border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.45);width:min(440px,94vw);display:flex;flex-direction:column;overflow:hidden;';
    const hd = document.createElement('div'); hd.textContent = 'プレビュー'; hd.style.cssText = 'padding:10px 14px;font-weight:700;color:#1f6fd0;border-bottom:1px solid #d7dee9;';
    const img = document.createElement('img'); img.src = d.url; img.style.cssText = 'display:block;max-width:100%;max-height:52vh;object-fit:contain;margin:10px auto;background:#fff;border:1px solid #dde3ec;';
    const nmRow = document.createElement('div'); nmRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:0 14px 6px;';
    const nmLb = document.createElement('label'); nmLb.textContent = '名前'; nmLb.style.cssText = 'color:#4a5a74;';
    const nmIn = document.createElement('input'); nmIn.type = 'text'; nmIn.value = d.name;
    nmIn.className = 'val-input'; nmIn.style.cssText = 'flex:1;padding:5px 7px;font:inherit;';   // 色・枠は共通指定
    nmIn.addEventListener('input', () => { d.name = nmIn.value.trim() || `詳細${d.id}`; d.renamed = true; scheduleHistory(); });
    nmIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') nmIn.blur(); });
    nmRow.append(nmLb, nmIn);
    const ft = document.createElement('div'); ft.style.cssText = 'display:flex;gap:8px;padding:10px 14px;border-top:1px solid #d7dee9;';
    const mk = (t, primary, danger) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
      b.style.cssText = `padding:7px 14px;border-radius:7px;cursor:pointer;font:inherit;border:1px solid ${danger ? '#d0a0a0' : (primary ? '#2f7bff' : '#c4ccda')};background:${primary ? '#2f7bff' : '#fff'};color:${danger ? '#a33' : (primary ? '#fff' : '#33405c')};`; return b; };
    const del = mk('削除', false, true), back = mk('一覧へ'), cl = mk('閉じる', true);
    del.onclick = () => { detailAreas.splice(i, 1); relabelDetails(); updateDetailBtn(); recordHistory(); if (window.__toast) window.__toast('詳細図を削除しました'); openDetailList(); };
    back.onclick = () => openDetailList();
    cl.onclick = closeDetailPanels;
    ft.append(del, back); ft.style.justifyContent = 'flex-start'; const spacer = document.createElement('div'); spacer.style.flex = '1'; ft.append(spacer, cl);
    box.append(hd, img, nmRow, ft); ov.appendChild(box); document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) closeDetailPanels(); });
  }
  window.__detailOpenList = openDetailList;
  window.__detailOpenPreview = openDetailPreview;
  // ===== 枠ドラッグモード：画面に矩形を描いて範囲を囲む =====
  let detailFrame = null;   // { down:{x,y}, box:DOM }
  const detailBoxEl = document.createElement('div');
  detailBoxEl.style.cssText = 'position:fixed;z-index:88;display:none;border:1.5px dashed #2f7bff;background:rgba(47,123,255,.10);pointer-events:none';
  document.body.appendChild(detailBoxEl);
  const detailHint = document.createElement('div');
  detailHint.className = 'hintBox';
  detailHint.style.cssText = 'position:fixed;z-index:88;display:none;left:50%;top:54px;transform:translateX(-50%);';
  detailHint.textContent = 'ダブルタップしてから、拡大したい所を枠で囲んでください（囲んだ形が拡大図になります）';
  document.body.appendChild(detailHint);
  function startDetailFrame() {
    if (typeof clearOtherCommands === 'function') clearOtherCommands('detail');   // 他のコマンドは解除
    if (detailFrame) { endDetailFrame(); return; }
    detailFrame = { down: null };
    // ヒント（中央上の帯）は出さない（2026-07-31 社長指示：使い方はヘルプで「詳細図」を検索）
    renderer.domElement.style.cursor = 'crosshair';
    controls.enabled = false;   // 枠を囲む間は視点を固定（社長要望：詳細を押したら画面が回らない）
    updateDetailBtn();          // ボタンを点灯（社長要望）
  }
  function endDetailFrame() {
    detailFrame = null;
    renderer.domElement.style.cursor = '';
    detailBoxEl.style.display = 'none';
    detailHint.style.display = 'none';
    controls.enabled = true;
    updateDetailBtn();
  }
  window.__detailFrameActive = () => !!detailFrame;
  window.__detailFrameEnd = () => { if (detailFrame) endDetailFrame(); };   // 他コマンドへ切替える時の取消
  window.addEventListener('pointerdown', e => {
    if (!detailFrame || e.button !== 0) return;
    if (e.target !== renderer.domElement) return;
    e.stopImmediatePropagation(); e.preventDefault();
    // 枠はダブルタップから始める（2026-07-28 社長要望）。1回目のタップでは枠を作らず、
    // 続けて素早くもう一度触れた時だけ枠のドラッグを始める＝視点操作と取り違えない。
    const isDbl = (e.timeStamp - (detailFrame.tapT || -1e9) < 350)
               && Math.hypot(e.clientX - (detailFrame.tapX || 0), e.clientY - (detailFrame.tapY || 0)) < 12;
    detailFrame.tapT = e.timeStamp; detailFrame.tapX = e.clientX; detailFrame.tapY = e.clientY;
    if (!isDbl) return;   // 案内トーストは出さない（2026-07-31 社長指示）
    detailFrame.down = { x: e.clientX, y: e.clientY };
    Object.assign(detailBoxEl.style, { display: 'block', left: e.clientX + 'px', top: e.clientY + 'px', width: '0px', height: '0px' });
  }, true);
  window.addEventListener('pointermove', e => {
    if (!detailFrame || !detailFrame.down) return;
    const d = detailFrame.down;
    Object.assign(detailBoxEl.style, {
      left: Math.min(d.x, e.clientX) + 'px', top: Math.min(d.y, e.clientY) + 'px',
      width: Math.abs(e.clientX - d.x) + 'px', height: Math.abs(e.clientY - d.y) + 'px',
    });
  }, true);
  window.addEventListener('pointerup', async e => {
    if (!detailFrame) return;
    const d = detailFrame.down; detailFrame.down = null;
    detailBoxEl.style.display = 'none';
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) { endDetailFrame(); return; }   // ほぼ動かず＝取消
    const x0 = d.x, y0 = d.y, x1 = e.clientX, y1 = e.clientY;
    endDetailFrame();                       // 先にモードを閉じてから撮影（印刷スタイルの一瞬の切替を隠す）
    await registerDetailRect(x0, y0, x1, y1);
  }, true);
  window.addEventListener('keydown', e => {
    if (detailFrame && e.key === 'Escape') { e.stopImmediatePropagation(); endDetailFrame(); }
  }, true);
  // 指定範囲が画面いっぱいに入るようカメラを寄せて印刷用スナップを撮り、元の視点へ戻す。
  // 向き（見る方角）は本図と同じにする＝拡大しても同じ姿勢で読める
  function snapshotDetail(box, margin, aspect) {   // aspect＝囲んだ枠の形。拡大図の枠はこの比で作る（画像はobject-fitで中央寄せ）
    const cam = activeCam();
    const savePos = cam.position.clone(), saveZoom = cam.zoom, saveTarget = controls.target.clone();
    const c = box.getCenter(new THREE.Vector3());
    const sph = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sph.radius, 0.01) * (margin || 1.25);
    const dir = savePos.clone().sub(saveTarget).normalize();
    if (cam.isOrthographicCamera) {
      const h = (cam.top - cam.bottom) / 2, w = (cam.right - cam.left) / 2;
      cam.zoom = Math.min(h, w) / r;
      cam.position.copy(c).addScaledVector(dir, Math.max(savePos.distanceTo(saveTarget), r * 4));
    } else {
      const vFov = cam.fov * Math.PI / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
      const dist = r / Math.sin(Math.min(vFov, hFov) / 2);
      cam.position.copy(c).addScaledVector(dir, dist);
    }
    controls.target.copy(c);
    cam.updateProjectionMatrix(); cam.lookAt(c);
    const url = snapshotForPrint();
    cam.position.copy(savePos); cam.zoom = saveZoom; controls.target.copy(saveTarget);
    cam.updateProjectionMatrix(); cam.lookAt(saveTarget);
    renderer.clear(); renderer.render(scene, activeCam());
    return url;
  }
  // ===== 単線アイソメ図（提案1・第1段 2026-07-29）＝部品をJIS風の単線・記号でベクトル描画 =====
  // 現在の視点で canvas と同じ座標系（クライアントpx）へ投影した SVG を作る。
  // 寸法線・線分・文字は snapshotForPrint(true)（部品を隠した従来描画）のラスタ層をそのまま重ねる＝位置が完全一致。
  function buildSingleLineSVG() {
    const cam = activeCam(); cam.updateMatrixWorld();
    const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
    const view = new V3(); cam.getWorldDirection(view);
    const el = [];
    const prj = (v) => { const p = modelGroup.localToWorld(v.clone()).project(cam); return [(p.x * 0.5 + 0.5) * W, (-p.y * 0.5 + 0.5) * H]; };
    const XY = (v) => { const a = prj(v); return `${a[0].toFixed(1)},${a[1].toFixed(1)}`; };
    const line = (a, b, w) => { const A = prj(a), B = prj(b); el.push(`<line x1="${A[0].toFixed(1)}" y1="${A[1].toFixed(1)}" x2="${B[0].toFixed(1)}" y2="${B[1].toFixed(1)}"${w ? ` stroke-width="${w}"` : ''}/>`); };
    const poly = (pts, close) => el.push(`<${close ? 'polygon' : 'polyline'} points="${pts.map(XY).join(' ')}"/>`);
    // 軸に直交し視線にも直交する向き＝紙の上で長さが縮まない方向（記号の幅出しに使う）
    const perpView = (axis, lenM) => {
      let v = axis.clone().cross(view);
      if (v.lengthSq() < 1e-9) v = axis.clone().cross(new V3(0, 1, 0));
      if (v.lengthSq() < 1e-9) v.set(1, 0, 0);
      return v.normalize().multiplyScalar(lenM);
    };
    const circle = (c, rM) => {
      const C = prj(c), E = prj(c.clone().add(perpView(view, rM)));
      const r = Math.max(Math.hypot(E[0] - C[0], E[1] - C[1]), 2);
      el.push(`<circle cx="${C[0].toFixed(1)}" cy="${C[1].toFixed(1)}" r="${r.toFixed(1)}"/>`);
    };
    const wc = (p, l) => connModelPos(p, l);
    const axisOf = (p) => {
      const a = wc(p, p.userData.backLocal), b = wc(p, p.userData.faceLocal);
      const d = b.clone().sub(a);
      return { a, b, d: d.lengthSq() > 1e-12 ? d.normalize() : new V3(0, 1, 0), c: a.clone().add(b).multiplyScalar(0.5) };
    };
    for (const p of placedParts) {
      if (p.userData.hidden || !p.userData.faceLocal) continue;
      const u = p.userData, t = u.partType;
      if (t === 'pipe') { const s = axisOf(p); line(s.a, s.b); continue; }
      if (t === 'elbow') {                                        // 工作点で折れる2本の線
        const s = axisOf(p);
        if (u.cornerLocal) { const c = wc(p, u.cornerLocal); line(s.a, c); line(c, s.b); }
        else line(s.a, s.b);
        continue;
      }
      if (t === 'tee') {                                          // 中心から各口へ
        const c = wc(p, new V3(0, 0, 0));
        for (const l of connsOf(p)) { if (u.boltLocals && u.boltLocals.includes(l)) continue; line(c, wc(p, l)); }
        continue;
      }
      if (t === 'flange') {                                       // フェイス位置の太めティック
        const o = u.flange || {};
        const s = axisOf(p);
        let D = 0.1;
        try { D = (flangeDim(o.cls, o.sizeA).D || 100) / 1000; } catch (e) {}
        const v = perpView(s.d, D / 2);
        line(s.b.clone().add(v), s.b.clone().sub(v), 2.6);
        continue;
      }
      if (t === 'gasket') continue;                               // 単線図ではフランジ2本のティックで表す
      if (t === 'valve') {                                        // 蝶ネジ（ボウタイ）
        const s = axisOf(p);
        const w = perpView(s.d, s.a.distanceTo(s.b) * 0.35);
        poly([s.a.clone().add(w), s.a.clone().sub(w), s.c, s.b.clone().sub(w), s.b.clone().add(w), s.c], true);
        continue;
      }
      if (t === 'flex') {                                         // 線＋波の目印3つ
        const s = axisOf(p);
        line(s.a, s.b);
        const v = perpView(s.d, 0.012);
        for (const k of [-0.25, 0, 0.25]) {
          const m = s.a.clone().lerp(s.b, 0.5 + k);
          el.push(`<path d="M ${XY(m.clone().sub(v))} Q ${XY(m.clone().add(s.d.clone().multiplyScalar(0.01)))} ${XY(m.clone().add(v))}"/>`);
        }
        continue;
      }
      if (t === 'sight') { const s = axisOf(p); line(s.a, s.b); circle(s.c, s.a.distanceTo(s.b) * 0.22); continue; }
      if (t === 'reducer') {                                      // 大端→小端の台形（コーン）
        const s = axisOf(p);
        const wA = perpView(s.d, (FLG_BORE[(u.reducer || {}).sizeA] || 60) / 2000);
        const wB = perpView(s.d, (FLG_BORE[(u.reducer || {}).sizeB] || 30) / 2000);
        poly([s.a.clone().add(wA), s.b.clone().add(wB), s.b.clone().sub(wB), s.a.clone().sub(wA)], true);
        continue;
      }
      if (t === 'cap') {
        const s = axisOf(p);
        const v = perpView(s.d, (FLG_BORE[(u.cap || {}).sizeA] || 60) / 2000);
        line(s.a, s.b);
        line(s.b.clone().add(v), s.b.clone().sub(v));
        continue;
      }
      if (t === 'sw') {                                           // SW継手：ボス＝基部ティック＋枝線／他＝中心から各口
        if ((u.sw || {}).kind === 'BOSS') {
          const s = axisOf(p);
          const v = perpView(s.d, (SW_O_FC[(u.sw || {}).sizeA] || 40) / 2000);
          line(s.a, s.b);
          line(s.a.clone().add(v), s.a.clone().sub(v));
          continue;
        }
        const c = wc(p, new V3(0, 0, 0));
        for (const l of connsOf(p)) line(c, wc(p, l));
        continue;
      }
      if (t === 'pg') { const s = axisOf(p); line(s.a, s.b); circle(s.b, ((u.pg || {}).dia || 100) / 2000); continue; }
      const s = axisOf(p); line(s.a, s.b);                        // その他＝軸線のみ
    }
    return `<svg class="sl" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">` +
      `<g stroke="#111" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round">${el.join('')}</g></svg>`;
  }
  window.__printSingleSVG = () => buildSingleLineSVG();          // e2e検証用
  window.__printSnapSLForTest = () => snapshotForPrint(true);    // e2e検証用（部品を隠した注釈層）

  function printSheet(mode) {
    const single = mode === 'single';   // 単線図＝部品はSVGの単線・記号／寸法等は部品を隠したラスタ
    const img = snapshotForPrint(single);   // 白地・グリッドなしの線画
    const slSvg = single ? buildSingleLineSVG() : '';
    // ---- 詳細図（部分拡大）：登録があれば拡大画像と、本図に付ける丸印の位置を用意する ----
    const DW = 420, DH = 297, INSET = 7.6;                     // A3横(mm)と図面枠の内側
    const cw = DW - INSET * 2, ch = DH - INSET * 2;
    const cvW = renderer.domElement.clientWidth, cvH = renderer.domElement.clientHeight;
    const ca = cvW / cvH, co = cw / ch;                        // 画像と枠の縦横比（object-fit:contain の余白を計算）
    const iw = ca > co ? cw : ch * ca, ih = ca > co ? cw / ca : ch;
    const ox = INSET + (cw - iw) / 2, oy = INSET + (ch - ih) / 2;
    const details = [];
    for (const d of detailAreas) {
      // 拡大図＝登録時に切り取った写真（窓の中身をそのままの大きさで）。印は登録時の窓の位置に四角で。
      const r = d.rect;
      const mx = ox + r.nx * iw, my = oy + r.ny * ih, mw = r.nw * iw, mh = r.nh * ih;
      details.push({ id: d.id, name: d.name || ('詳細' + d.id), url: d.url, aspect: d.aspect,
        mx, my, mw: Math.max(mw, 6), mh: Math.max(mh, 6), inView: true });
    }
    const axisSvg = buildAxisGlyph();   // 3D方位コンパス（現在の向き）
    const date = esc($('dwgDate').value), place = esc($('dwgPlace').value),
      name = esc($('dwgName').value), no = esc($('dwgNo').value);
    const scale = (typeof fmtScaleF === 'function' && typeof currentScaleF === 'function') ? esc(fmtScaleF(currentScaleF())) : '';
    const sp = gatherSpec();
    const sv = k => esc(sp[k] || '');
    // アイテムリスト（画面と同じ列）
    const rows = partsRows();
    let ilRows = rows.map(r => `<tr><td class="n">${r.no}</td><td>${esc(r.kind)}</td><td>${esc(r.type)}</td><td>${esc(r.size)}</td><td>${esc(r.cls)}</td><td class="q">${r.qty}</td><td>${esc(r.mat) || '—'}</td></tr>`).join('');
    if (!ilRows) ilRows = `<tr><td colspan="7" style="text-align:center;color:#888;padding:calc(var(--u)*3)">（部品なし）</td></tr>`;
    const specPairs = [
      ['法規', sv('law')], ['クラス', sv('cls')], ['設計温度℃', sv('tempD')], ['常用温度℃', sv('tempN')],
      ['設計圧力', sv('presD')], ['常用圧力', sv('presN')], ['試験 耐圧', sv('testP')], ['気密', sv('testA')],
      ['非破壊検査', sv('rt')], ['非破壊検査', sv('pt')], ['熱処理', sv('heat')], ['洗浄', sv('wash')], ['塗装', sv('paint')],
      ['保温', sv('insul')], ['設計', sv('design')], ['製図', sv('draw')], ['検図', sv('check')], ['承認', sv('approve')],
    ];
    // キー値を2組/行のテーブル行に。端数は空セルで埋め、罫線が必ず閉じるようにする。
    const kvRows = pairs => {
      let html = '', row = '';
      pairs.forEach((p, i) => {
        row += `<td class="k">${p[0]}</td><td>${p[1] || ''}</td>`;
        if (i % 2 === 1) { html += `<tr>${row}</tr>`; row = ''; }
      });
      if (row) html += `<tr>${row}<td class="k"></td><td></td></tr>`;
      return html;
    };
    const specHtml = kvRows(specPairs);
    // 図面情報（24分割グリッド）：ラベル列は狭め(colspan3)。上=図番|改訂(狭)／中=名称|場所／下=年月日|社名(広)。尺度は無し
    const infoHtml =
      `<colgroup>${'<col>'.repeat(24)}</colgroup>` +
      `<tr><td class="k" colspan="3">図番</td><td colspan="16">${no}</td><td class="k" colspan="3">改訂</td><td colspan="2">${sv('rev')}</td></tr>` +
      `<tr><td class="k" colspan="3">名称</td><td colspan="9">${name}</td><td class="k" colspan="3">場所</td><td colspan="9">${place}</td></tr>` +
      `<tr><td class="k" colspan="3">年月日</td><td colspan="9">${date}</td><td class="k" colspan="3">社名</td><td colspan="9" class="company">${sv('company')}</td></tr>`;
    // 印刷に載せる欄は設定で選ぶ（2026-07-31 社長指示：画面の折りたたみ状態とは切り離す。既定＝すべて載せる）
    const lsGet = k => { try { return localStorage.getItem(k) !== '0'; } catch (e) { return true; } };
    const prIl = lsGet('p3d_print_il'), prSpec = lsGet('p3d_print_spec'), prInfo = lsGet('p3d_print_info');
    const specCollapsed = !prSpec;
    const ilCollapsed = !prIl;
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>配管図 ${no || name || ''}</title>
<style>
  /* 寸法はぜんぶ「紙の幅の1/420」を1単位（--u）にした相対値で書く（2026-08-04 社長報告への対策）。
     旧＝mm直書きだと、iPadのAirPrintは@pageの用紙指定(A3)を無視して実際の用紙に刷るため、
     A4に刷るとアイテムリスト・詳細図・図面情報だけが（絶対mmのまま＝）倍近く大きく崩れていた。
     --u基準ならA3でも A4でも、プレビューどおりの割合で紙いっぱいに縮小印刷される。
     プレビュー（iframe幅1587px）では --u≒1mm@96dpi なので見た目は従来と同一。 */
  *{box-sizing:border-box;margin:0;padding:0;}
  html{--u:calc(100vw / 420);}
  html,body{height:100%;background:#fff;}
  body{font-family:"Meiryo","Hiragino Kaku Gothic ProN",sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .pg{position:relative;width:100%;height:100%;overflow:hidden;background:#fff;}
  /* 図面は外枠の内側に収める＝構築線など長い線が枠から飛び出さない（2026-07-21 社長指摘） */
  .dwg{position:absolute;inset:calc(var(--u)*7.6);overflow:hidden;}
  .dwg>img{width:100%;height:100%;object-fit:contain;display:block;}
  .dwg>svg.sl{position:absolute;inset:0;width:100%;height:100%;}
  .frame{position:absolute;inset:calc(var(--u)*7);border:calc(var(--u)*0.5) solid #111;border-radius:calc(var(--u)*2.5);pointer-events:none;}
  .north{position:absolute;left:calc(var(--u)*10);top:calc(var(--u)*9);width:calc(var(--u)*24);height:calc(var(--u)*24);}
  /* 詳細図（部分拡大）：左上に積む。本図には丸印＋記号を重ねる（2026-07-21 社長要望） */
  .detail{position:absolute;width:calc(var(--u)*86);background:#fff;border:calc(var(--u)*0.3) solid #111;border-radius:calc(var(--u)*1);overflow:hidden;}
  .detail .dttl{font-size:calc(var(--u)*3);font-weight:700;text-align:center;background:#f0f0f0;padding:calc(var(--u)*0.8);border-bottom:calc(var(--u)*0.2) solid #111;}
  .detail img{display:block;width:100%;height:calc(var(--u)*52);object-fit:fill;}
  .dmark{position:absolute;border:calc(var(--u)*0.4) solid #111;border-radius:calc(var(--u)*1);pointer-events:none;}
  .dmarkt{position:absolute;font-size:calc(var(--u)*4);font-weight:700;color:#111;}
  /* アイテムリスト・図面仕様・図面情報（右下） */
  .panel{position:absolute;right:calc(var(--u)*9);bottom:calc(var(--u)*9);width:calc(var(--u)*124);max-height:calc(100% - var(--u)*19);background:#fff;border:calc(var(--u)*0.12) solid #111;border-radius:calc(var(--u)*1) calc(var(--u)*1) calc(var(--u)*2.5) calc(var(--u)*1);overflow:hidden;display:flex;flex-direction:column;}
  .panel .hd{font-size:calc(var(--u)*3);font-weight:700;text-align:center;background:#f0f0f0;padding:calc(var(--u)*1);letter-spacing:calc(var(--u)*.5);border-bottom:calc(var(--u)*0.12) solid #111;}
  .panel .sc{overflow:hidden;border-bottom:calc(var(--u)*0.12) solid #111;}
  .panel table{width:100%;border-collapse:collapse;font-size:calc(var(--u)*2.7);}
  .panel table.items{border-style:hidden;}   /* 外枠はパネル枠に任せ二重線を防ぐ */
  .panel td{border:calc(var(--u)*0.12) solid #111;padding:calc(var(--u)*0.7) calc(var(--u)*1.4);white-space:nowrap;}
  .panel td.hcell{background:#f0f0f0;font-weight:700;text-align:left;}
  .panel td.n{text-align:right;color:#555;} .panel td.q{text-align:right;}
  table.kv.info td.k{width:auto;}   /* 情報表は colgroup(12分割)で幅を決める */
  table.kv td.company{font-weight:700;font-size:calc(var(--u)*3.2);text-align:center;}
  .sec{padding:calc(var(--u)*1.6) calc(var(--u)*2.5);}
  .sec .t{font-size:calc(var(--u)*2.9);font-weight:700;margin-bottom:calc(var(--u)*1.2);}
  table.kv{width:100%;border-collapse:collapse;font-size:calc(var(--u)*2.6);table-layout:fixed;}
  table.kv td{border:calc(var(--u)*0.12) solid #111;padding:calc(var(--u)*0.7) calc(var(--u)*1.4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  table.kv td.k{background:#f4f4f4;color:#333;width:calc(var(--u)*22);}
  /* 余白は目一杯（margin:0）。ブラウザが余白に入れるURL・日付・ページ番号もこれで出なくなる */
  @media print{@page{size:A3 landscape;margin:0;}}
</style></head><body>
  <div class="pg">
    <div class="dwg"><img src="${img}">${slSvg}</div>
    ${(() => { let bot = 10; return details.map(d => {   /* 詳細図＝左下から上へ積み上げ（2026-07-30 社長指示） */
        const dw = 86, dih = Math.max(34, Math.min(70, dw / (d.aspect || 1.4)));
        const html = `<div class="detail" style="left:calc(var(--u)*${INSET + 2});bottom:calc(var(--u)*${bot});width:calc(var(--u)*${dw})">
      <div class="dttl">${esc(d.name)}</div><img src="${d.url}" style="height:calc(var(--u)*${dih.toFixed(0)})">
    </div>`;
        bot += dih + 14; return html; }).join(''); })()}
    ${axisSvg}
    ${(prIl || prSpec || prInfo) ? `<div class="panel">
      ${ilCollapsed ? '' : `<div class="hd">アイテムリスト</div>
      <div class="sc"><table class="items">
        <tr><td class="hcell n">#</td><td class="hcell">種別</td><td class="hcell">タイプ</td><td class="hcell">サイズ</td><td class="hcell">クラス</td><td class="hcell q">数量</td><td class="hcell">材質</td></tr>
        ${ilRows}
      </table></div>`}
      ${specCollapsed ? '' : `<div class="sec"><div class="t">設計仕様</div><table class="kv">${specHtml}</table></div>`}
      ${prInfo ? `<div class="sec"><table class="kv info">${infoHtml}</table></div>` : ''}
    </div>` : ''}
    <div class="frame"></div>
  </div>
</body></html>`;
    showPrintPreview(html);
  }
  // 画面内のズーム可能な印刷プレビュー（＋/−・全体表示・印刷・閉じる）。印刷ボタンで実際に印刷する。
  function showPrintPreview(html) {
    const old = document.getElementById('__printPreview'); if (old) old.remove();
    const PW = 1587, PH = 1122;   // A3横 @96dpi（420×297mm）
    const ov = document.createElement('div'); ov.id = '__printPreview';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(8,12,24,.82);display:flex;flex-direction:column;font:13px Meiryo,sans-serif;';
    const bar = document.createElement('div');
    bar.style.cssText = 'flex:none;display:flex;align-items:center;gap:8px;padding:8px 12px;background:#141c33;color:#dbe4f3;border-bottom:1px solid #36436b;';
    const mkbtn = (t, bg) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = `padding:5px 12px;border:1px solid #41538a;border-radius:6px;background:${bg || '#22305a'};color:#e8eef7;cursor:pointer;font:13px Meiryo,sans-serif;`; return b; };
    const title = document.createElement('b'); title.textContent = '印刷プレビュー'; title.style.marginRight = 'auto';
    const zo = mkbtn('－'), zlabel = document.createElement('span'), zi = mkbtn('＋'), fit = mkbtn('全体表示'), pr = mkbtn('印刷', '#2f7bff'), cl = mkbtn('閉じる');
    zlabel.style.cssText = 'min-width:52px;text-align:center;';
    bar.append(title, zo, zlabel, zi, fit, pr, cl);
    const scroll = document.createElement('div');
    scroll.style.cssText = 'flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:18px;';
    const holder = document.createElement('div');
    holder.style.cssText = 'flex:none;box-shadow:0 6px 30px rgba(0,0,0,.55);background:#fff;';
    const ifr = document.createElement('iframe');
    ifr.style.cssText = `width:${PW}px;height:${PH}px;border:0;background:#fff;display:block;transform-origin:top left;`;
    holder.appendChild(ifr); scroll.appendChild(holder);
    ov.append(bar, scroll); document.body.appendChild(ov);
    const idoc = ifr.contentWindow.document; idoc.open(); idoc.write(html); idoc.close();
    let z = 0.7;   // 既定は70%表示（社長指示）
    const applyZoom = () => { ifr.style.transform = `scale(${z})`; holder.style.width = (PW * z) + 'px'; holder.style.height = (PH * z) + 'px'; zlabel.textContent = Math.round(z * 100) + '%'; };
    const fitW = () => { z = Math.max(0.1, Math.min(2, (scroll.clientWidth - 40) / PW)); applyZoom(); };
    zo.onclick = () => { z = Math.max(0.1, z / 1.2); applyZoom(); };
    zi.onclick = () => { z = Math.min(5, z * 1.2); applyZoom(); };
    fit.onclick = fitW;
    pr.onclick = () => { try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) { alert('印刷に失敗しました：' + (e && e.message || e)); } };
    const close = () => { ov.remove(); document.removeEventListener('keydown', onkey); };
    cl.onclick = close;
    const onkey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onkey);
    applyZoom();   // 既定は70%表示（全体表示ボタンで幅に合わせる）
  }
  // （未使用・保険）ポップアップを使わず非表示iframeで直接印刷
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
  // 線種ごとの固定色（色は線種で決まるので色選択は不要）：実線=濃スレート・破線=黒・点線=青・一点鎖線=赤
  // （実線は旧・白＝ハイトーン背景で薄くなるため濃色へ。2026-07-20。保存済み図面の白線は色を保持したまま）
  const LTYPE_COLOR = { solid: 0x2b323d, dashed: 0x000000, dotted: 0x4a9bff, dashdot: 0xff5a5a, dashdotdot: 0x000000 };
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
  let dimKind = 'linear';   // 既定＝長さ寸法（2026-07-19 社長要望。CADのDIMLINEAR相当）
  const DIM_KIND_LABEL = { linear: '長さ', parallel: '平行', angle: '角度', radius: '半径', diameter: '直径', leader: '引出' };
  // 文字の既定書式（リボン「文字」右クリックで設定）。色＝シアン／飾り＝枠なし
  const textOpts = { color: 0x4a9bff, deco: 'none' };   // deco: none/box/underline/double（既定色＝線の青と統一・2026-07-20 社長）
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
    // 白モードは加算合成だと色が白く飛ぶので通常合成＋不透明寄りにして本来の色を保つ。
    // ※寸法線・構築線は solid=true で常に通常合成＝両モード同色。
    // solid=true（構築線）はモードに依らず常に通常合成・同一不透明度＝ダーク／ホワイトで同じ色・同じ見え方。
    // 統一グレー背景（2026-07-19）＝加算合成は色が飛ぶため常に通常合成・光暈は不透明度を上げて発色を保つ
    const useNormal = true;
    const op = solid ? opacity : Math.min(1, opacity * 1.8);
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
    meas.font = `${fs}px Meiryo, sans-serif`;
    const tw = Math.ceil(meas.measureText(text).width);
    const cv = document.createElement('canvas');
    cv.width = tw + pad * 2; cv.height = fs + pad * 2;
    const c = cv.getContext('2d');
    c.font = `${fs}px Meiryo, sans-serif`;
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
  // ダーク(0x141c33)・ホワイト(0xd2dbe8)どちらの背景でも見え、既存の固定色
  // （一点鎖線=赤／構築線=オレンジ／点線=青／文字=シアン／値=赤）と混同しない緑に統一
  // （2026-07-12 社長要望。旧: 黄色→ホワイトで不可視、オレンジ→赤・構築線と紛らわしい）
  const DIM_COLOR = 0x22aa55;         // 補助線・寸法線本体・矢印＝緑（両モード同色）
  const DIM_TEXT_CSS = '#ff4040';     // 寸法文字＝赤
  // 寸法文字：枠・背景なしの赤文字スプライト。常にカメラ正対なので裏表・潰れが起きない。
  // 向きと位置は毎フレーム __updateDimTextFacing が画面投影に合わせて調整する
  // （画面上で寸法線と平行に回転し、画面で見て線の「上側」に出る）。
  const DIM_TEXT_PAPER_MM = 3.5;   // 尺度（平行投影）表示・印刷時の数字の紙上高さ(mm)
  const DIM_TEXT_MIN_PX = 12;      // 透視ビューでの数字の最小画面高(px)＝ズームアウトしても読める
  let _dimMaskPrint = false;       // 印刷スナップショット中＝背景マスクを白で描く
  function dimTextSprite(text, A2, B2, vUp, opt) {
    let col = (opt && opt.color != null) ? opt.color : DIM_TEXT_CSS;   // 文字色（既定＝寸法の赤）
    if (typeof col === 'number') col = '#' + ('000000' + (col >>> 0).toString(16)).slice(-6);
    const deco = (opt && opt.deco) || 'none';                    // none / box / underline / double
    const fs = 44, pad = (deco === 'box') ? 9 : 6;
    const extra = deco === 'double' ? 9 : (deco === 'underline' ? 5 : 0);   // 下線ぶんの下余白
    // 数値の寸法値は小数部(.X)を少し小さく描く。例：123.4 → 「123」大 ＋「.4」小
    const fm = /^([Rφ]?)(\d+)(\.\d+)(°?)$/.exec(text);
    const sfs = Math.round(fs * 0.66);                 // 小数部の文字サイズ（約2/3）
    let segs;
    if (fm) {
      segs = [];
      const head = fm[1] + fm[2];                      // 接頭(R/φ)＋整数部
      if (head) segs.push({ t: head, size: fs });
      segs.push({ t: fm[3], size: sfs });              // 小数部(.X)＝小さく
      if (fm[4]) segs.push({ t: fm[4], size: fs });    // 単位(°)
    } else {
      segs = [{ t: text, size: fs }];
    }
    const meas = document.createElement('canvas').getContext('2d');
    let tw = 0;
    for (const s of segs) { meas.font = `${s.size}px Meiryo, sans-serif`; s.w = Math.ceil(meas.measureText(s.t).width); tw += s.w; }
    const cv = document.createElement('canvas');
    cv.width = tw + pad * 2; cv.height = fs + pad * 2 + extra;
    const c = cv.getContext('2d');
    // 背景マスク：画面では透明（2026-07-20 社長要望「四角い枠を透明に」）。
    // 印刷スナップショット中だけ白の下地＝紙で線が値を突き抜けないように従来どおり。
    if (!(opt && opt.noMask) && _dimMaskPrint) {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, cv.width, cv.height);
    }
    if (deco === 'box') { c.strokeStyle = col; c.lineWidth = 3; c.strokeRect(1.5, 1.5, cv.width - 3, cv.height - 3); }
    c.fillStyle = col; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    const baseY = pad + fs * 0.82 + 2;                 // 大サイズ文字のベースライン（縦中央寄せ）。小数部は同じベースラインで下揃え
    let x = pad;
    for (const s of segs) { c.font = `${s.size}px Meiryo, sans-serif`; c.fillText(s.t, x, baseY); x += s.w; }
    if (deco === 'underline' || deco === 'double') {
      const yb = pad + fs + 2; c.strokeStyle = col; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(pad, yb); c.lineTo(cv.width - pad, yb); c.stroke();
      if (deco === 'double') { c.beginPath(); c.moveTo(pad, yb + 5); c.lineTo(cv.width - pad, yb + 5); c.stroke(); }
    }
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter;
    const s = 0.0011;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(cv.width * s, cv.height * s, 1);
    sp.userData.dimText = { a: A2.clone(), b: B2.clone(), vUp: vUp.clone(), h: cv.height * s,
                            sw: cv.width * s, sh: cv.height * s, fsFrac: fs / cv.height,   // 基準スケールと数字部の高さ比（画面サイズ制御用）
                            textOff: (opt && opt.textOff) ? { t: opt.textOff.t, n: opt.textOff.n } : null };
    const mid0 = A2.clone().add(B2).multiplyScalar(0.5);
    if (opt && opt.textOff) {   // 値の移動（textOff）：線方向t・逃げ方向nのオフセット位置が文字の中心
      const u0 = B2.clone().sub(A2); if (u0.lengthSq() > 1e-12) u0.normalize(); else u0.set(1, 0, 0);
      sp.position.copy(mid0).addScaledVector(u0, opt.textOff.t).addScaledVector(vUp, opt.textOff.n);
    } else {
      sp.position.copy(mid0).addScaledVector(vUp, (cv.height * s) / 2 + 0.004);
    }
    sp.renderOrder = 1000;
    return sp;
  }
  window.__dimMaskPrint = on => {   // 印刷スナップショット用：マスクを白に切替えて寸法を作り直す
    _dimMaskPrint = !!on;
    for (const r of annStore) if (r.type === 'dim') rebuildAnn(r);
  };
  // 文字の表示倍率k：透視＝最小px保証／平行投影(尺度)＝紙上mm固定。値のオフセット(textOff)も
  // このkを掛けて表示する＝ズーム・尺度を変えても「文字何個ぶんずらした」という見た目が保たれる。
  // 値の引出線（寸法線→動かした値）。端点は __updateDimTextFacing が毎フレーム合わせる
  function mkTextLeader(sp) {
    const g = new THREE.BufferGeometry().setFromPoints([sp.position.clone(), sp.position.clone()]);
    const lm = new THREE.Line(g, new THREE.LineBasicMaterial({ color: DIM_COLOR, transparent: true, opacity: 0.9, depthTest: false }));
    lm.renderOrder = 997; lm.userData.baseColor = DIM_COLOR;
    sp.userData.dimLeader = lm;
    return lm;
  }
  function dimTextScaleK(dt, atLocal) {
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const camUpW = new V3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const w0 = modelGroup.localToWorld(atLocal.clone()).project(cam);
    const w1 = modelGroup.localToWorld(atLocal.clone()).add(camUpW.multiplyScalar(dt.sh || dt.h)).project(cam);
    const px = Math.hypot((w1.x - w0.x) * rect.width, (w1.y - w0.y) * rect.height) / 2;
    if (!(px > 1e-6) || !dt.fsFrac) return 1;
    const digitPx = px * dt.fsFrac;
    if (useOrtho) {
      const kPaper = (DIM_TEXT_PAPER_MM * PX_PER_M / 1000) / digitPx;
      if (_dimMaskPrint) return kPaper;                       // 印刷は紙上mm固定のまま
      return Math.max(kPaper, DIM_TEXT_MIN_PX / digitPx);     // 画面では最小px保証＝キューブで尺度表示にしても値が小さくなり過ぎない（2026-07-20 社長）
    }
    return digitPx < DIM_TEXT_MIN_PX ? DIM_TEXT_MIN_PX / digitPx : 1;
  }
  // 毎フレーム：寸法文字を「画面上で寸法線と平行・線の上側」に合わせる（常に読める向き）
  window.__updateDimTextFacing = () => {
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const scr = p => { const n = modelGroup.localToWorld(p.clone()).project(cam); return { x: (n.x * 0.5 + 0.5) * rect.width, y: (-n.y * 0.5 + 0.5) * rect.height }; };
    const _minv = new THREE.Matrix4().copy(modelGroup.matrixWorld).invert();   // カメラ右/上（モデルローカル方向）
    const camRightL = new V3().setFromMatrixColumn(cam.matrixWorld, 0).transformDirection(_minv);
    const camUpL = new V3().setFromMatrixColumn(cam.matrixWorld, 1).transformDirection(_minv);
    // 文字の画面サイズ制御：透視＝最小px保証（ズームアウトしても読める）／平行投影(尺度)＝紙上mm固定（印刷で狙いの大きさ）
    const scaleK = (o, dt, at) => {
      if (dt.sw == null) { dt.sw = o.scale.x; dt.sh = o.scale.y; }
      const k = dimTextScaleK(dt, at);
      o.scale.set(dt.sw * k, dt.sh * k, 1);
      return k;
    };
    for (const rec of annStore) {
      if (rec.type !== 'dim') continue;
      const isText = rec.style && rec.style.dimKind === 'text';
      rec.obj.traverse(o => {
        const dt = o.userData.dimText;
        if (!dt || !o.material) return;
        if (isText) {                                        // 文字：配置点に置き、style.textRot で画面内回転（正立は0°）
          o.material.rotation = (rec.style.textRot || 0) * Math.PI / 180;
          const k = scaleK(o, dt, dt.a);
          const pm = scr(dt.a), pu = scr(dt.a.clone().addScaledVector(dt.vUp, 0.01));
          const s = (pu.y <= pm.y) ? 1 : -1;
          o.position.copy(dt.a).addScaledVector(dt.vUp, s * ((dt.h * k) / 2 + 0.004));
          return;
        }
        const pa = scr(dt.a), pb = scr(dt.b);
        let ang = Math.atan2(-(pb.y - pa.y), pb.x - pa.x);   // 画面上の寸法線の向き
        if (ang > Math.PI / 2) ang -= Math.PI;               // 上下逆さにならない範囲（±90°）へ折返し
        else if (ang < -Math.PI / 2) ang += Math.PI;
        o.material.rotation = ang;
        const mid = dt.a.clone().add(dt.b).multiplyScalar(0.5);
        const k = scaleK(o, dt, mid);
        // 値の配置は「画面基底」で行う（2026-07-18 社長指摘「矢印の線が見切れる」対応）。
        // 従来の vUp×半高（世界オフセット）だと vUp が視線方向に近い構図で画面上の離れが0になり、
        // 不透明マスクが寸法線と矢印を覆い隠していた。基底＝線の画面方向(ex,ey)と直交(px2,py2・逃げ側が正)。
        const pm = scr(mid), pu = scr(mid.clone().addScaledVector(dt.vUp, 0.01));
        const ph = scr(mid.clone().addScaledVector(camUpL, dt.sh || dt.h));
        const pxPerM = Math.hypot(ph.x - pm.x, ph.y - pm.y) / (dt.sh || dt.h);   // この奥行きでの画面px/モデルm
        if (!(pxPerM > 1e-6)) {                              // 退避：従来の世界オフセット
          const sgn = (pu.y <= pm.y) ? 1 : -1;
          o.position.copy(mid).addScaledVector(dt.vUp, sgn * ((dt.h * k) / 2 + 0.004));
          return;
        }
        const ex = Math.cos(ang), eyv = Math.sin(ang);       // 線の画面方向（数学系y=上）
        let px2 = -eyv, py2 = ex;                            // 直交。正の向き＝逃げ(vUp)側（ビューを変えても同じ側）
        const ux2 = pu.x - pm.x, uy2 = -(pu.y - pm.y);
        if (ux2 * px2 + uy2 * py2 < 0) { px2 = -px2; py2 = -py2; }
        if (dt.textOff) {                                    // 動かした値：画面基底で t(線方向)・n(直交) を適用（×k）
          const ox = (ex * dt.textOff.t + px2 * dt.textOff.n) * k;
          const oy = (eyv * dt.textOff.t + py2 * dt.textOff.n) * k;
          o.position.copy(mid).addScaledVector(camRightL, ox).addScaledVector(camUpL, oy);
          const lm = o.userData.dimLeader;                   // 引出線も文字に追従（両端を毎フレーム更新）
          if (lm) {
            // 付け根は寸法線（矢印の付いた線）のセンター固定（2026-07-19 社長要望）
            const pa2 = lm.geometry.attributes.position;
            pa2.setXYZ(0, mid.x, mid.y, mid.z); pa2.setXYZ(1, o.position.x, o.position.y, o.position.z);
            pa2.needsUpdate = true;
          }
          return;
        }
        // 既定位置：画面上で寸法線から半文字高＋余白3pxだけ直交（逃げ側）に離す＝線と矢印を覆わない
        const offM = ((dt.sh || dt.h) * k) / 2 + 3 / pxPerM;
        o.position.copy(mid).addScaledVector(camRightL, px2 * offM).addScaledVector(camUpL, py2 * offM);
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
  // 小数第1位まで。ちょうど「.0」になる時は整数で表示（例 123.4 / 120。2026-07-18 社長要望）
  const fmtDim1 = v => { const s = v.toFixed(1); return s.endsWith('.0') ? s.slice(0, -2) : s; };
  function dimMeasuredStr(a, b, style) {
    const kind = (style && style.dimKind) || 'parallel';
    const mm = fmtDim1(a.distanceTo(b) * 1000);   // 小数第1位まで表示（.0は省略）
    if (kind === 'angle') {
      const V = a, P1 = b, P2 = (style && style.angP2) ? new V3(style.angP2[0], style.angP2[1], style.angP2[2]) : b;
      const d1 = P1.clone().sub(V), d2 = P2.clone().sub(V);
      let deg = (d1.lengthSq() > 1e-12 && d2.lengthSq() > 1e-12) ? d1.angleTo(d2) * 180 / Math.PI : 0;
      if (style && style.angReflex) deg = 360 - deg;
      return fmtDim1(deg) + '°';
    }
    if (kind === 'radius') return 'R' + mm;
    if (kind === 'diameter') return 'φ' + mm;
    if (kind === 'leader' || kind === 'text') return '';   // 引出・文字は既定文字なし（入力した文字だけ表示）
    if (style && style.dimFixDir && style.dimDir) {   // リニア寸法は逃げ方向に垂直な成分の長さ＝寸法線の実長（足を下ろした水平/垂直の寸法値）
      const dn = new V3(style.dimDir.x, style.dimDir.y, style.dimDir.z);
      if (dn.lengthSq() > 1e-9) { dn.normalize(); const ab = b.clone().sub(a); return fmtDim1(ab.addScaledVector(dn, -ab.dot(dn)).length() * 1000); }
    }
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
          new THREE.MeshBasicMaterial({ color: DIM_COLOR, depthTest: false, transparent: true, opacity: 0.95 }));
        cone.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.clone().negate());   // 円錐の頂点を tip 側へ
        cone.position.copy(tip.clone().addScaledVector(dir, len / 2));
        cone.userData.baseColor = DIM_COLOR;
        cone.renderOrder = 998;
        grp.add(cone);
      };
      // 補助線・寸法線本体＝緑（にじみ＋芯）。構築線と同じく solid=true（常に通常合成・同一不透明度）で
      // 描くことで、ダーク／ホワイトどちらのモードでも完全に同じ色・同じ見え方になる。
      const glowSeg = (p0, p1) => {
        const g = new THREE.Group();
        g.add(laserTube(p0, p1, 0.0008, DIM_COLOR, 0.22, true));    // 外側のにじみ（細め）
        g.add(laserTube(p0, p1, 0.00026, DIM_COLOR, 1.0, true));    // 芯（極細・不透明）
        return g;
      };
      if (isText) {
        // 文字：a=配置点。線は引かず、点aに常に正立した文字だけを置く（空なら何も描かない）。色・飾りはstyle。
        if (shown !== '') grp.add(dimTextSprite(shown, a, a.clone(), new V3(0, 1, 0), { color: style.textColor, deco: style.textDeco, noMask: true }));
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
        grp.add(dimTextSprite(shown, Tp.clone().addScaledVector(tan, -0.004), Tp.clone().addScaledVector(tan, 0.004), outward, { textOff: style.textOff }));
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
        grp.add(dimTextSprite(shown, P.clone().addScaledVector(dir, -eps), P.clone().addScaledVector(dir, eps), vUp, { textOff: style.textOff }));
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
        const sp = dimTextSprite(shown, A2, B2, vUp, { textOff: style.textOff });
        grp.add(sp);
        if (style.textOff) grp.add(mkTextLeader(sp));   // 値を離してある＝寸法線→値の引出線（毎フレーム追従）
      } else {
        grp.add(glowSeg(a, b));
        mkArrow(a, b); if (!isLeader) mkArrow(b, a);          // 直書きでも両端に矢印（引出は片側のみ）
        const uN = b.clone().sub(a);
        if (uN.lengthSq() > 1e-12) uN.normalize(); else uN.set(1, 0, 0);
        let vUp = new V3(0, 1, 0).addScaledVector(uN, -uN.y);   // uに直交する上向き
        if (vUp.lengthSq() < 1e-6) vUp.set(-uN.z, 0, uN.x);     // 垂直線はクロス水平方向
        if (vUp.lengthSq() < 1e-6) vUp.set(1, 0, 0);
        vUp.normalize();
        const sp2 = dimTextSprite(shown, a, b, vUp, { textOff: style.textOff });
        grp.add(sp2);
        if (style.textOff) grp.add(mkTextLeader(sp2));
      }
      }
    } else if (type === 'circle') {
      // 円/楕円：a=中心。半径(rx=X半径, rz=Z半径)＋向き(quat)で配置。真円は rx=rz・既定は水平。
      // 線種・色は線分と同じ書式（style.ltype/color）に従う。
      const { rx, rz } = circleRadii(style, a, b);
      const q = quatFromStyle(style);
      const mat = new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.98 });
      const rr = arcRange(style);   // 部分削除された円＝円弧はその範囲だけ描く
      const N = Math.max(8, Math.ceil(160 * (rr.a1 - rr.a0) / (Math.PI * 2))), pts = [];
      for (let i = 0; i <= N; i++) {
        const t = rr.a0 + ((rr.a1 - rr.a0) * i) / N;
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
    // リニア寸法：寸法線を固定方向(dimFixDir)・固定基準(dimFixPt)に保ち、測定点a/bをその線へ投影する。
    // ＝測定点を動かしても寸法線は元の向き(水平/垂直)のまま傾かない。逃げ(dimOff)は基準点からの距離で従来どおり調整可。
    if (style && style.dimFixDir && style.dimFixPt) {
      const fp = new V3(style.dimFixPt.x, style.dimFixPt.y, style.dimFixPt.z);
      const dn = dd ? new V3(dd.x, dd.y, dd.z) : new V3(0, -1, 0);
      if (dn.lengthSq() < 1e-9) dn.set(0, -1, 0); else dn.normalize();
      // 各測定点から逃げ方向(dimDir)に沿って、固定レベル((P-dimFixPt)·dimDir=off)まで下ろした足元をA2/B2に。
      // ＝補助線(足)は常に逃げ方向(例:鉛直)のまま傾かず、寸法線は同じ高さ(レベル)を保つ。測定点を動かすと足が伸縮しながら追従する。
      const A2 = a.clone().addScaledVector(dn, off - a.clone().sub(fp).dot(dn));
      const B2 = b.clone().addScaledVector(dn, off - b.clone().sub(fp).dot(dn));
      return { A2, B2 };
    }
    if (!off || !dd) return null;
    const dv = new V3(dd.x, dd.y, dd.z).multiplyScalar(off);
    const ab = b.clone().sub(a), l = ab.length();
    const u = l > 1e-9 ? ab.multiplyScalar(1 / l) : new V3(1, 0, 0);
    const skew = ((style.dimSkew || 0) * Math.PI) / 180;
    const k = Math.abs(skew) > 1e-6 ? Math.abs(off) * Math.tan(skew) : 0;   // 斜めの分だけAB方向へ滑らせる
    return { A2: a.clone().add(dv).addScaledVector(u, k), B2: b.clone().add(dv).addScaledVector(u, k) };
  }
  // 逃げ量スライド中：他の寸法線の矢印（寸法線の両端A2/B2）と揃う逃げ量へ吸着（2026-07-18 社長要望）。
  // 候補点Pに寸法線が乗る逃げ量＝(P−基準)·逃げ方向。今の量との差を画面pxに換算し SNAP_PX 以内、かつ
  // その逃げ量で寸法線（無限直線）が実際にPをほぼ通る（残差1.5mm以内＝同一平面・同一レベル）ものだけ吸着する。
  function dimOffArrowSnap(rec, off) {
    if (!snapOn) return null;                           // 設定でスナップOFF＝吸着しない
    const st = rec.style || {};
    if (!st.dimDir) return null;
    const dn = new V3(st.dimDir.x, st.dimDir.y, st.dimDir.z);
    if (dn.lengthSq() < 1e-9) return null;
    dn.normalize();
    const base = (st.dimFixDir && st.dimFixPt) ? new V3(st.dimFixPt.x, st.dimFixPt.y, st.dimFixPt.z) : rec.a;
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    const scr = p => { const n = modelGroup.localToWorld(p.clone()).project(cam); return n.z < 1 ? { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height } : null; };
    const s0 = scr(base), s1 = scr(base.clone().addScaledVector(dn, 0.1));
    if (!s0 || !s1) return null;
    const pxPerM = Math.hypot(s1.x - s0.x, s1.y - s0.y) * 10;   // 0.1m の画面距離×10＝1mあたりpx
    if (pxPerM < 1e-6) return null;
    let best = null, bestPx = SNAP_PX;
    for (const r of annStore) {
      if (r === rec || r.hidden || r.type !== 'dim' || !r.style || r.style.dimKind === 'text') continue;
      const ends = dimLineEnds(r.a, r.b, r.style);
      if (!ends) continue;
      for (const P of [ends.A2, ends.B2]) {
        const offP = P.clone().sub(base).dot(dn);
        const dpx = Math.abs(offP - off) * pxPerM;
        if (dpx >= bestPx) continue;
        const e2 = dimLineEnds(rec.a, rec.b, Object.assign({}, st, { dimOff: offP }));   // その逃げ量で実際にPを通るか
        if (!e2) continue;
        const dl = e2.B2.clone().sub(e2.A2), L = dl.length();
        const resid = L > 1e-9 ? P.clone().sub(e2.A2).cross(dl.multiplyScalar(1 / L)).length() : P.distanceTo(e2.A2);
        if (resid > 0.0015) continue;   // 平面・レベルが違う矢印には吸着しない
        bestPx = dpx; best = { off: offP, pt: P.clone() };
      }
    }
    return best;
  }
  function addAnnotation(type, a, b, style) {
    const st = style ? { color: style.color, ltype: style.ltype, width: style.width, dimOff: style.dimOff, dimDir: style.dimDir, dimSkew: style.dimSkew, dimText: style.dimText, dimKind: style.dimKind, dimLead: style.dimLead, dimFixDir: style.dimFixDir ? { x: style.dimFixDir.x, y: style.dimFixDir.y, z: style.dimFixDir.z } : undefined, dimFixPt: style.dimFixPt ? { x: style.dimFixPt.x, y: style.dimFixPt.y, z: style.dimFixPt.z } : undefined, angP2: style.angP2 ? style.angP2.slice() : undefined, arcR: style.arcR, angReflex: style.angReflex, angReach: style.angReach ? style.angReach.slice() : undefined, textColor: style.textColor, textDeco: style.textDeco, textRot: style.textRot, rx: style.rx, rz: style.rz, quat: style.quat, arcA0: style.arcA0, arcA1: style.arcA1, textOff: style.textOff ? { t: style.textOff.t, n: style.textOff.n } : undefined, weldTag: style.weldTag || undefined } : styleFor(type);
    const grp = buildAnn(type, a, b, st);
    annGroup.add(grp);
    annStore.push({ type, a: a.clone(), b: b.clone(), style: st, obj: grp });
    if (type === 'xline' || type === 'line') updateXlinePts();
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
    // 構築線どうしに加え、線分×線分・線分×構築線の交点も表示・スナップ対象（2026-07-19 社長要望）。
    // 3Dの最近接点間距離が0.5mm以内＝実際に交差している所だけ（高さ違い・ねじれは対象外）。
    // 線分の端点どうしが繋がる角（連鎖の継ぎ目）は交点扱いしない（端点スナップと重複するだけのため）
    const els = annStore.filter(r => (r.type === 'xline' || r.type === 'line') && !r.hidden);
    const out = [];
    const XR = 12, tol = 0.0005, endTol = 0.001;   // 構築線の描画範囲±12m／交差許容0.5mm／端点判定1mm
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const r1 = els[i], r2 = els[j];
      const u1 = r1.b.clone().sub(r1.a), L1 = u1.length();
      const u2 = r2.b.clone().sub(r2.a), L2 = u2.length();
      if (L1 < 1e-9 || L2 < 1e-9) continue;
      u1.multiplyScalar(1 / L1); u2.multiplyScalar(1 / L2);
      const w0 = r1.a.clone().sub(r2.a);
      const b = u1.dot(u2), d = u1.dot(w0), e = u2.dot(w0);
      const denom = 1 - b * b;
      if (Math.abs(denom) < 1e-9) continue;                 // 平行
      const s = (b * e - d) / denom;                        // r1上の符号付き距離
      const t = (e - b * d) / denom;                        // r2上の符号付き距離
      const s0 = r1.type === 'xline' ? -XR : 0, s1 = r1.type === 'xline' ? XR : L1;
      const t0 = r2.type === 'xline' ? -XR : 0, t1 = r2.type === 'xline' ? XR : L2;
      if (s < s0 - 1e-6 || s > s1 + 1e-6 || t < t0 - 1e-6 || t > t1 + 1e-6) continue;   // 範囲外＝交差していない
      const P1 = r1.a.clone().addScaledVector(u1, s), P2 = r2.a.clone().addScaledVector(u2, t);
      if (P1.distanceTo(P2) > tol) continue;                // 高さ違い・ねじれ
      const nearEnd1 = r1.type === 'line' && (s < endTol || s > L1 - endTol);
      const nearEnd2 = r2.type === 'line' && (t < endTol || t > L2 - endTol);
      if (nearEnd1 && nearEnd2) continue;                   // 角（端点どうしの継ぎ目）
      out.push(P1.add(P2).multiplyScalar(0.5));
    }
    return out;
  }
  function updateXlinePts() {
    // 交点の常時表示は廃止（2026-07-20 社長：設定「交点」はスナップのON/OFF。点はスナップ接近時のみ黄で表示）
    while (xptGroup.children.length) { const c = xptGroup.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
    xlinePts = xlineIntersections();
  }
  window.__xpts = () => xlinePts;                       // snapPtKind（交点判定）用

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
    if (window.__resetDrawPointers) window.__resetDrawPointers();   // タッチ本数カウンタも必ずリセット（残留＝フリーズ）
    renderer.domElement.style.cursor = '';
    updateDrawButtons();
  }
  window.__exitDrawMode = () => { if (drawActive()) cancelDraw(); };   // 外部（部品配置開始時）から描画モードを解除
  function setDrawMode(mode) {
    const turningOff = (drawState.mode === mode);
    drawState.mode = null;
    if (typeof clearDrawTemp === 'function') clearDrawTemp();
    if (window.__resetDrawPointers) window.__resetDrawPointers();   // 開始/終了とも本数カウンタを白紙に（残留＝フリーズ）
    if (!turningOff) {
      if (typeof clearOtherCommands === 'function') clearOtherCommands('draw');   // 他のコマンドは解除（同時に光らせない）
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
  // タッチ操作：作図モード中は1本指の視点回転を無効化（1本指＝作図。2本指＝パン・ズームは維持）。
  // Ctrl中の1本指は視点回転OK（窓選択はダブルタップ→ドラッグに変更・2026-07-20 社長案）
  function syncTouchOrbit() { if (controls && controls.touches) controls.touches.ONE = (drawActive() || followTool) ? null : THREE.TOUCH.ROTATE; }
  window.__syncTouchOrbit = syncTouchOrbit;
  // ---- 描画用スナップ＆点決め ----
  // 注釈レコードのスナップ点（起点）。線分＝端点＋中点／円＝中心＋四半円点(±X,±Z)／寸法ほか＝両端。
  // 構築線は対象外（交点のみ別途）。
  function annSnapPoints(rec) {
    if (rec.type === 'xline') return [];
    if (rec.type === 'circle') {
      const c = rec.a, { rx, rz } = circleRadii(rec.style, rec.a, rec.b), q = quatFromStyle(rec.style);
      const P = (lx, lz) => c.clone().add(new V3(lx, 0, lz).applyQuaternion(q));
      const rr = arcRange(rec.style);
      if (rr.full) return [c.clone(), P(rx, 0), P(-rx, 0), P(0, rz), P(0, -rz)];   // 中心＋四半円点(±X,±Z・向き込み)
      // 円弧：中心＋両端点（起点として吸着・掴める）＋描かれている範囲内の四半円点
      const pts = [c.clone(), circPt(rec, rr.a0), circPt(rec, rr.a1)];
      [[0, P(rx, 0)], [Math.PI / 2, P(0, rz)], [Math.PI, P(-rx, 0)], [Math.PI * 1.5, P(0, -rz)]]
        .forEach(([th, p]) => { if (norm2pi(th - rr.a0) <= rr.a1 - rr.a0) pts.push(p); });
      return pts;
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
  function lineReach(rec, V, dir, ends) {
    const e = ends || annPickEnds(rec);   // 部品（フランジ軸）は拾った時の両端(ends)を使う（recはObject3Dでannではない）
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
      const reach = [lineReach(ang.lines[0], V, d1, ang.ends && ang.ends[0]),
                     lineReach(ang.lines[1], V, d2, ang.ends && ang.ends[1])];   // 補助線で重なりを隠す境界
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
    if (!snapOn) return null;                           // 設定でスナップOFF＝吸着しない
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
      if (!p.userData.faceLocal || p.userData.hidden) continue;
      for (const local of snapLocalsOf(p)) test(connModelPos(p, local));
    }
    if (showOriginPts) for (const r of annStore) { if (r === drawState.editRec || r.hidden) continue; for (const sp of annSnapPoints(r)) test(sp); }   // 線分=端点+中点／円=中心+四半円点／寸法=両端（構築線は交点のみ）。設定「起点」でOFF可
    if (showXpts) for (const p of xlinePts) test(p);   // 線どうしの交点（CADの交点スナップ。設定でOFF可）
    if (!best && nearSnapOn) {
      // 2点目の位置決め中＝起点からの「垂線の足（直角点）」を最優先（直角がぴったり出る）。無ければ一般の線上へ
      if (drawState.first) best = nearestPerpFoot(drawState.first, clientX, clientY, SNAP_PX, r => r === drawState.editRec);
      if (!best) best = nearestOnLine(clientX, clientY, NEAR_SNAP_PX, r => r === drawState.editRec);
      // 起点のすぐ近く（画面12px以内）へ潰れる線上吸着は捨てる＝起点が線上にある時に短い線分が
      // 起点へ張り付いて引けなくなるのを防ぐ（点スナップは対象外＝端点への吸着はそのまま）
      if (best && drawState.first) {
        const s1 = modelGroup.localToWorld(drawState.first.clone()).project(cam);
        const s2 = modelGroup.localToWorld(best.clone()).project(cam);
        const d12 = Math.hypot((s2.x - s1.x) * rect.width, (s2.y - s1.y) * rect.height) / 2;
        if (d12 < 12) best = null;
      }
    }
    return best;
  }
  // 作図中はスナップで近づいた点だけを表示する（2026-07-20 社長：候補点の常時表示は廃止）。
  // snapPoint＝現在吸着中の点。マーカーの消去は clearDrawTemp（確定・取消・ツール終了）で行う。
  function showDrawSnapMarkers(snapPoint) {
    clearMarkers();
    if (snapPoint) addSnapMarker(snapPoint, markerRadiusFor(null, true));   // 吸着点＝緑（四半円点=赤◇・ボルト穴=赤＋・交点=黄）
  }
  // 「起点をタップして選ぶ」時の十字カーソルと吸着印（鏡・回転・移動から使う。2026-07-27 社長要望）。
  // 作図の1点目と同じ見え方＝どこに吸着するかが動かしている最中に分かる。戻り値 {p, snapped}
  // 起点選びでは、選んでいる部品自身の機点を優先して拾う。
  // エルボの工作点は面の点と画面上で数pxしか離れておらず、指で隠れると狙えないため、
  // 半径を広げ、その部品の既定の起点（エルボなら工作点）に少し優先を与える（2026-07-28 社長指摘）
  function originOwnPoint(cx, cy) {
    const part = (typeof selectedPart !== 'undefined') ? selectedPart : null;
    if (!part || !snapOn || !part.userData || !part.userData.faceLocal) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const cam = activeCam();
    const home = part.userData.cornerLocal || null;    // エルボ等の工作点＝いつもの起点
    let best = null, bestScore = SNAP_PX * 1.8;
    for (const local of connsOf(part)) {
      const ndc = modelGroup.localToWorld(connModelPos(part, local)).project(cam);
      if (ndc.z >= 1) continue;
      const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
      const score = Math.hypot(sx - cx, sy - cy) - (local === home ? SNAP_PX : 0);
      if (score < bestScore) { bestScore = score; best = connModelPos(part, local); }
    }
    return best;
  }
  window.__originPickCursor = (cx, cy) => {
    clearLineGuide();
    let r = pickFirstPoint(cx, cy);
    const own = originOwnPoint(cx, cy);
    if (own) r = { p: own, snapped: true };
    showDrawSnapMarkers(r.snapped ? r.p : null);
    if (r.p) guideCross(r.p, r.snapped ? 0x39ff8a : 0x49c5ff);
    if (r.p && r.snapped) snapDot(r.p);
    return r;
  };
  window.__originPickClear = () => { clearLineGuide(); clearMarkers(); };
  // 決めた起点（回転の中心）に印だけ残す＝どこを中心に回るのかが見える（2026-08-02 社長指示）。
  // 十字カーソルは出さない＝「まだ起点を選んでいる最中」と紛らわしいので、玉ひとつにする。
  window.__originPickMark = (pt) => { clearLineGuide(); if (pt) guideDot(pt, 0xff8a3c, 0.005); };
  window.__originPickMarkCount = () => lineGuideGroup.children.length;   // 検証用
  window.__lineGuideCount = () => lineGuideGroup.children.length;   // 検証用：十字カーソル等が出ているか
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
    const t = resolveTarget(clientX, clientY, null, defaultElY(), true);   // noNear＝近接の再判定はしない（drawSnapPoint で済み）。高さ＝既定EL
    return { p: t ? t.point.clone() : null, snapped: false };
  }
  // 2点目：スナップ最優先 → Shiftでvert(Y方向) → 水平面+角度スナップ
  function pickSecondPoint(clientX, clientY, P1, vert) {
    const snap = drawSnapPoint(clientX, clientY);
    if (snap) return { p: snap, snapped: true };
    if (vert) return { p: vertPoint(clientX, clientY, P1), snapped: false };
    const t = resolveTarget(clientX, clientY, null, P1.y, true);   // noNear＝同上
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
  // 吸着印：四半円点・ボルト穴＝赤い起点マーク／交点＝黄点／その他＝緑ドット（2026-07-20 社長）
  function snapDot(p) {
    const k = snapPtKind(p);
    if (k === 'xpt') guideDot(p, 0xffd84d, 0.0045);
    else if (k) guideDot(p, SNAP_RED, 0.0048);
    else guideDot(p, 0x39ff8a, 0.0042);
  }
  // 画面に正対する十字（クロス）カーソル。modelGroup は無変換なのでローカル＝ワールド。
  // 大きさはカメラ距離/ズームに比例させ、見た目をほぼ一定に保つ。
  function guideCross(p, color) {
    // 明るい背景で見やすいよう濃色へ差し替え＋中心にブルズアイ（白地＋色玉）を重ねる（2026-07-20 社長「カーソルが見にくい」）
    if (color === 0x49c5ff) color = 0x1256c8;        // 通常＝濃青
    else if (color === 0x39ff8a) color = 0x0b9648;   // 吸着＝濃緑
    const cam = activeCam();
    const right = new V3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const up = new V3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const s = cam.isOrthographicCamera
      ? (cam.top - cam.bottom) / (cam.zoom || 1) * 0.034
      : cam.position.distanceTo(p) * 0.027;
    const g = new THREE.BufferGeometry().setFromPoints([
      p.clone().addScaledVector(right, -s), p.clone().addScaledVector(right, s),
      p.clone().addScaledVector(up,    -s), p.clone().addScaledVector(up,    s),
    ]);
    const ln = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 1 }));
    ln.renderOrder = 999; lineGuideGroup.add(ln);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(s * 0.16, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
    halo.position.copy(p); halo.renderOrder = 999; lineGuideGroup.add(halo);
    const core = new THREE.Mesh(new THREE.SphereGeometry(s * 0.09, 12, 10),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 1 }));
    core.position.copy(p); core.renderOrder = 1000; lineGuideGroup.add(core);
  }
  // 起点 a→終点 b の補助線。成分(X→Z→Y)を段状に分け、存在する脚ごとに補助線＋斜辺を引く。
  // これで X/Z/Y/L の入力欄に対応した補助線（X脚・Z脚・Y脚）がそれぞれ出る。
  function drawTriangle3D(a, b, vert, snapped) {
    clearLineGuide();
    if (snapped && b) snapDot(b);                 // 吸着中＝緑で強調（四半円点=赤◇・穴=赤＋）
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
  // 見た目は入力フォームと共通（2026-07-27 社長要望）。色・枠は index.html の .valLabel に任せる
  xlineAngleEl.className = 'valLabel';
  xlineAngleEl.style.cssText = 'position:fixed;z-index:60;display:none;';
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
  dimOffEl.className = 'valLabel';
  dimOffEl.style.cssText = 'position:fixed;z-index:60;display:none;';
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
  circleREl.className = 'valLabel';
  circleREl.style.cssText = 'position:fixed;z-index:60;display:none;';
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
    if (lineDrag && lineDrag.mode === 'arcend') {       // 円弧の端点伸縮中：小窓は出さない
      [lnXBox, lnZBox, lnYBox, lnDBox].forEach(b => { if (b) b.style.display = 'none'; }); hideXlineAngle(); hideDimOffLabel();
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
    const isLineNow = drawState.mode === 'line' || (drawState.editRec && drawState.editRec.type === 'line');
    // 線分：軸方向のみ（X/Y/Zの1軸に沿う）は「長さL」1欄だけ＝値を消しても別軸の欄が出ず、方向が変わらない。
    // 斜め（45°等・2軸以上に成分がある）は下の汎用処理へ抜けて X/Z/Y の脚欄＋L を並べる（2026-07-12 社長要望。
    // 以前はL欄のみだったが「XやZの入力フォームも出してほしい」との指摘）。
    // 方向は「現在の向き」、長さ0に潰れたら「保持中の editDir」を使い、欄と方向を保つ。
    if (isLineNow && !isXlineNow) {
      const a0 = drawState.first;
      const dlen = a0.distanceTo(drawState.cur);
      const dir = dlen >= 1e-6 ? drawState.cur.clone().sub(a0).normalize() : (drawState.editDir ? drawState.editDir.clone() : null);
      if (!dir) { hideLineBoxes(); return; }   // まだ方向が無い＝出さない
      const nAx = (Math.abs(dir.x) > 1e-3 ? 1 : 0) + (Math.abs(dir.y) > 1e-3 ? 1 : 0) + (Math.abs(dir.z) > 1e-3 ? 1 : 0);
      if (nAx <= 1 || dlen < 0.003) {          // 軸方向のみ・潰れて向き保持中＝L欄のみ（従来どおり）
        if (lnXBox) lnXBox.style.display = 'none';
        if (lnZBox) lnZBox.style.display = 'none';
        if (lnYBox) lnYBox.style.display = 'none';
        const bShown = dlen >= 0.003 ? drawState.cur : a0.clone().addScaledVector(dir, 0.001);
        placeDistanceBox(a0, bShown);   // 距離 L のみ（方向は固定）
        return;
      }
      // 斜め＝この下の汎用処理で X/Z(/Y) の脚欄＋斜辺L を表示（脚の値入力は applyLineLegs が処理）
    }
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
    if (rec.type === 'xline' || rec.type === 'line') updateXlinePts();   // 構築線・線分が動いたら交点を引き直す
  }
  window.__rebuildAllAnns = () => { for (const r of annStore) rebuildAnn(r); refreshAnnHi(); };   // テーマ切替で合成方式を反映
  function clearDrawTemp() {    // 描画途中の状態を全消去（線は残す）
    drawState.first = null; drawState.cur = null; drawState.vert = false;
    drawState.locked = false; drawState.editRec = null; drawState.snapped = false;
    drawState.editDir = null;   // 端点編集用に保持していた向きを解除
    drawParked = null;          // パーク位置（離した所）も解除
    drawState.dimAdjust = null; drawState.dimOff = 0; drawState.dimDir = null;   // 寸法線の逃げ調整状態も解除
    drawState.circDim = null;   // 半径/直径：ロック中の円も解除
    drawState.dimReadjust = null;   // 寸法の逃げ再調整も解除
    if (drawState.angle && drawState.angle.lines) for (const ln of drawState.angle.lines) {   // 角度の選択ハイライト(緑)を戻す
      if (ln && ln.isObject3D && ln.userData && ln.userData.placed) {   // 部品（フランジ軸）＝発光を選択状態へ戻す
        if (typeof setEmissive === 'function') setEmissive(ln, (typeof selectedParts !== 'undefined' && selectedParts.has(ln)) ? SEL_COLOR : 0x000000);
      } else paintAnn(ln, selAnns.has(ln));
    }
    drawState.angle = null;     // 角度：収集中の点/直線も解除
    clearPreview();
    if (typeof clearLineGuide === 'function') clearLineGuide();
    if (typeof hideLineBoxes === 'function') hideLineBoxes();
    if (typeof clearMarkers === 'function') clearMarkers();   // 作図中の機点マーカーも消す
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
  // 脚入力 → 終点を更新。確定済みレコード(editRec)があればそれを、無ければ作図プレビュー(first→cur)を編集。
  // finalize=Enter：editRecなら編集終了、プレビューなら「2点目を決める前でも」その値で線を確定する。
  function applyLineLegs(finalize) {
    const rec = drawState.editRec;
    const preview = !rec && drawState.mode === 'line' && drawState.first && drawState.cur;   // 2点目未確定のプレビュー段階
    if (!rec && !preview) return;
    const a = rec ? rec.a : drawState.first;
    const cur = rec ? rec.b : drawState.cur;    // 向き・符号の基準（現在の終点/プレビュー先）
    let b;
    if (drawState.vert) {                       // 鉛直：水平脚(X か Z) ＋ Y脚
      const dxs = cur.x - a.x, dzs = cur.z - a.z, useX = Math.abs(dxs) >= Math.abs(dzs);
      const yv = (Math.abs(parseFloat(lnY.value)) || 0) / 1000 * (Math.sign(cur.y - a.y) || 1);
      if (useX) b = new V3(a.x + (Math.abs(parseFloat(lnX.value)) || 0) / 1000 * (Math.sign(dxs) || 1), a.y + yv, a.z);
      else      b = new V3(a.x, a.y + yv, a.z + (Math.abs(parseFloat(lnZ.value)) || 0) / 1000 * (Math.sign(dzs) || 1));
    } else {                                    // 水平：X脚 ＋ Z脚（＋3D斜め線ならY脚も）
      const sx = Math.sign(cur.x - a.x) || 1, sz = Math.sign(cur.z - a.z) || 1;
      const dyNow = cur.y - a.y;
      const yv = Math.abs(dyNow) > 1e-4 ? (Math.abs(parseFloat(lnY.value)) || 0) / 1000 * (Math.sign(dyNow) || 1) : 0;
      b = new V3(a.x + (Math.abs(parseFloat(lnX.value)) || 0) / 1000 * sx, a.y + yv, a.z + (Math.abs(parseFloat(lnZ.value)) || 0) / 1000 * sz);
    }
    if (rec) { rec.b.copy(b); rebuildAnn(rec); drawState.cur = rec.b.clone(); }
    else { drawState.cur = b.clone(); }
    drawTriangle3D(a, b, drawState.vert, false);
    if (rec && lineSel === rec) { showLineHandles(rec); refreshAnnHi(); }
    if (finalize) { if (rec) finishGuide(); else { commitGuide(); finishGuide(); } }   // プレビューなら線を作成して確定
  }
  // 距離入力 → 現在の向きを保ったまま、その長さに終点を伸縮（editRecが無ければプレビューを確定）
  function applyLineDistance(finalize) {
    const rec = drawState.editRec;
    const preview = !rec && drawState.mode === 'line' && drawState.first && drawState.cur;
    if (!rec && !preview) return;
    const a = rec ? rec.a : drawState.first;
    const cur = rec ? rec.b : drawState.cur;
    let dir = cur.clone().sub(a); const len = dir.length();
    if (len >= 1e-9) {
      dir.divideScalar(len);
      drawState.editDir = dir.clone();          // 有効な向きを保持（0に潰れた後の復元用）
    } else if (drawState.editDir) {
      dir = drawState.editDir.clone();          // 長さ0でも直前の向きで伸ばし直せる
    } else {
      return;                                   // 向きが全く無い時のみ何もしない
    }
    if (preview) {   // プレビューはほぼ軸に沿っていれば主要軸へスナップ（Z方向の線がきれいにZになる）
      const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z), mx = Math.max(ax, ay, az);
      if (mx > 0.97) dir = new V3(ax === mx ? Math.sign(dir.x) : 0, ay === mx ? Math.sign(dir.y) : 0, az === mx ? Math.sign(dir.z) : 0);
      drawState.editDir = dir.clone();   // 固定方向として保持（値を消しても同じ向きで引き直せる）
    }
    const D = Math.max(0, (parseFloat(lnD.value) || 0) / 1000);
    const b = a.clone().addScaledVector(dir, D);
    if (rec) { rec.b.copy(b); rebuildAnn(rec); drawState.cur = rec.b.clone(); }
    else { drawState.cur = b.clone(); }
    drawTriangle3D(a, b, drawState.vert, false);
    if (rec && lineSel === rec) { showLineHandles(rec); refreshAnnHi(); }
    if (finalize) { if (rec) finishGuide(); else { commitGuide(); finishGuide(); } }
  }
  [lnX, lnZ, lnY].forEach(inp => {
    if (!inp) return;
    // 空欄の間は適用しない（全消去しても線を潰さず＝消さず、続けて打ち直せる）
    inp.addEventListener('input', () => { if (inp.value.trim() === '') return; applyLineLegs(false); });    // スピナー長押し・連続増減でも追従
    inp.addEventListener('change', () => { if (inp.value.trim() === '') return; applyLineLegs(false); });
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); applyLineLegs(true); }   // 値を確定（blurはしない＝iPadで巻き戻る不具合回避。キーボードは3D画面タップで閉じる）
      else if (e.key === 'Escape') { e.preventDefault(); inp.blur(); }
    });
  });
  if (lnD) {
    // 空欄の間は適用しない（全消去でも線を残し、続けて入力できる）
    lnD.addEventListener('input', () => { if (lnD.value.trim() === '') return; applyLineDistance(false); });   // スピナー長押しでも追従
    lnD.addEventListener('change', () => { if (lnD.value.trim() === '') return; applyLineDistance(false); });
    lnD.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); applyLineDistance(true); }   // 値を確定（blurはしない＝iPadで巻き戻る不具合回避。キーボードは3D画面タップで閉じる）
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
  // タッチ/ペンの作図：1本指でドラッグ＝十字カーソルの位置決め（離してもまだ確定しない）、
  // タップ＝その点を確定。2本指は視点パン/ズーム（その間は点を打たない）。
  const drawPointers = new Set();   // 現在キャンバスに触れているタッチ/ペンの本数を数える
  let drawMulti = false;            // 2本指以上＝視点操作中（その間は点を打たない）
  const TAP_MOVE = 10;              // 離すまでの移動が この距離(px)以内なら「タップ」＝確定。超えたら位置決めのみ
  let drawParked = null;            // 直近にドラッグして離した位置(client座標)。タップ確定はこの位置で打つ（タップ座標に引っ張られない）
  // 本数カウンタの残留＝1本指でも「2本指」誤判定→stopImmediatePropagationで作図も視点も遮断＝フリーズ
  // （文字/角度/半径の確定などpointerdown内でcancelDraw()するとpointerupが作図モード外になり減算されずに残る）。
  // コマンドの開始/終了で必ずリセットする（2026-07-19 社長報告「コマンドが使えない・画面が固まる」の根本対策）
  window.__resetDrawPointers = () => { drawPointers.clear(); drawMulti = false; drawDown = null; drawParked = null; };
  // ---- 寸法線の「逃げ」（補助線の長さ）調整 ----
  // 2点目確定後、カーソル移動で寸法線を起点から離す距離を決め、3回目のクリックで確定する。
  function startDimAdjust() {
    if (!drawState.first || !drawState.cur || drawState.cur.distanceTo(drawState.first) <= 1e-6) { abortDrawPoint(); return; }
    drawState.dimAdjust = { a: drawState.first.clone(), b: drawState.cur.clone() };
    drawState.dimOff = 0; drawState.dimDir = null;
    hideLineBoxes(); clearLineGuide(); clearMarkers();   // 逃げ調整中は機点マーカーを出さない
  }
  // カーソル位置 → 逃げ量(off, m)と方向(dir)。
  //  平面の寸法（ABに水平成分あり）：通常＝ABの水平直交へ／Shift＝縦（上下）へ
  //  立面の寸法（ABが垂直）       ：水平へ逃がす。通常＝方向45°刻み／Shift＝斜め（自由角度）
  function dimOffsetFromCursor(cx, cy, A, B, shift) {
    if (dimKind === 'linear') return dimLinearFromCursor(cx, cy, A, B, shift);   // 長さ寸法＝軸方向固定（下の専用関数）
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
  // 長さ寸法（CADのDIMLINEAR相当・2026-07-19 社長要望）：寸法線を軸方向に固定し、その軸成分の距離を測る。
  // カーソルを動かした軸（X/Z、Shift＝Y）へ逃がす＝AutoCADと同じ操作感。逃げ量は2点の中点（＝dimFixPt）基準。
  // 測定値は dimMeasuredStr のリニア寸法分岐＝「逃げ方向に垂直な成分の長さ」＝寸法線の実長。
  function dimLinearFromCursor(cx, cy, A, B, shift) {
    const ab = B.clone().sub(A);
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const isVertAB = ab.x * ab.x + ab.z * ab.z < 1e-9;
    if (!isVertAB && shift) {                     // Shift＝縦（上下）へ逃がす＝水平距離の寸法（寸法線は水平のまま）
      const rect = renderer.domElement.getBoundingClientRect();
      placeNdc.x = ((cx - rect.left) / rect.width) * 2 - 1;
      placeNdc.y = -((cy - rect.top) / rect.height) * 2 + 1;
      placeRay.setFromCamera(placeNdc, activeCam());
      const Mw = modelGroup.localToWorld(mid.clone());
      const n = new V3().subVectors(activeCam().position, Mw); n.y = 0;
      if (n.lengthSq() < 1e-9) n.set(0, 0, 1);
      n.normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, Mw);
      const hitV = new V3();
      if (!placeRay.ray.intersectPlane(plane, hitV)) return null;
      modelGroup.worldToLocal(hitV);
      return { off: hitV.y - mid.y, dir: { x: 0, y: 1, z: 0 } };
    }
    const hit = planeHitAt(cx, cy, A.y);
    if (!hit) return null;
    const vx = hit.x - mid.x, vz = hit.z - mid.z;
    let useX = Math.abs(vx) >= Math.abs(vz);
    if (!isVertAB) {                              // その軸へ逃がすと寸法線が潰れる（測る成分が無い）軸は避ける
      const okX = (ab.y * ab.y + ab.z * ab.z) > 1e-8;   // dir=X の時に寸法線へ残る成分
      const okZ = (ab.x * ab.x + ab.y * ab.y) > 1e-8;
      if (useX && !okX) useX = false;
      if (!useX && !okZ) useX = true;
    }
    return useX ? { off: vx, dir: { x: 1, y: 0, z: 0 } } : { off: vz, dir: { x: 0, y: 0, z: 1 } };
  }
  // 長さ寸法の起票フィールド：寸法線の向き(dimFixDir)と基準点(dimFixPt＝2点の中点)を固定（リニア寸法と同じ表現）
  // 向きは必ず「軸そのもの」（X/Y/Zの主成分）へ丸める＝長さ寸法は水平/垂直だけで、斜めの平行寸法の
  // 見た目には決してならない（平行が要るなら種別「平行」を使う。2026-07-31 社長指摘）
  function linearFixFields(a, b, dd) {
    const dn = new V3(dd.x, dd.y, dd.z);
    if (dn.lengthSq() > 1e-9) dn.normalize(); else dn.set(0, 1, 0);
    const u = b.clone().sub(a); u.addScaledVector(dn, -u.dot(dn));
    if (u.lengthSq() > 1e-12) u.normalize(); else u.set(1, 0, 0);
    const ax = Math.abs(u.x), ay = Math.abs(u.y), az = Math.abs(u.z);
    if (ax >= ay && ax >= az) u.set(Math.sign(u.x) || 1, 0, 0);
    else if (ay >= az) u.set(0, Math.sign(u.y) || 1, 0);
    else u.set(0, 0, Math.sign(u.z) || 1);
    const m = a.clone().add(b).multiplyScalar(0.5);
    return { dimFixDir: { x: u.x, y: u.y, z: u.z }, dimFixPt: { x: m.x, y: m.y, z: m.z } };
  }
  // 新規寸法の値が既存の値と重なる時だけ、逃げ側へ1段ずつ積んで自動回避（新規作成時のみ。既存は動かさない）
  // 判定は「画面上の見た目」で行う：facing更新後の実表示位置・実表示サイズ（×k）を画面へ投影して比較する
  function autoShiftDimText(rec) {
    if (window.__updateDimTextFacing) window.__updateDimTextFacing();   // 全値を表示位置に整えてから測る
    let sp = null; rec.obj.traverse(o => { if (!sp && o.userData.dimText) sp = o; });
    if (!sp) return;
    const dt = sp.userData.dimText;
    const mid = dt.a.clone().add(dt.b).multiplyScalar(0.5);
    const cam2 = activeCam(), rect2 = renderer.domElement.getBoundingClientRect();
    const scr2 = p => { const n2 = modelGroup.localToWorld(p.clone()).project(cam2); return { x: rect2.left + (n2.x * 0.5 + 0.5) * rect2.width, y: rect2.top + (-n2.y * 0.5 + 0.5) * rect2.height }; };
    const minv2 = new THREE.Matrix4().copy(modelGroup.matrixWorld).invert();
    const camUp2 = new V3().setFromMatrixColumn(cam2.matrixWorld, 1).transformDirection(minv2);
    const pm1 = scr2(mid), ph1 = scr2(mid.clone().addScaledVector(camUp2, dt.sh || dt.h));
    const pxPerM = Math.hypot(ph1.x - pm1.x, ph1.y - pm1.y) / (dt.sh || dt.h);
    if (!(pxPerM > 1e-6)) return;
    const k = dimTextScaleK(dt, mid) || 1;
    const others = [];
    for (const r of annStore) {
      if (r === rec || r.type !== 'dim' || r.hidden || (r.style && r.style.dimKind === 'text')) continue;
      r.obj.traverse(o => { if (o.userData.dimText) others.push(o); });
    }
    if (!others.length) return;
    for (let tries = 0; tries < 4; tries++) {
      const c = scr2(sp.position);
      const halfW = (dt.sw * k * pxPerM) / 2, halfH = (dt.sh * k * pxPerM) / 2;
      let clash = false;
      for (const o of others) {
        const oc = scr2(o.position);   // 相手も facing 済＝実表示位置・実表示スケール
        if (Math.abs(oc.x - c.x) < (halfW + (o.scale.x * pxPerM) / 2) * 0.9 &&
            Math.abs(oc.y - c.y) < (halfH + (o.scale.y * pxPerM) / 2) * 0.9) { clash = true; break; }
      }
      if (!clash) break;
      const cur = rec.style.textOff || { t: 0, n: dt.h / 2 };   // 既定位置相当から1.25文字高ずつ逃げ側へ（k=1基準で保存）
      rec.style.textOff = { t: cur.t, n: cur.n + dt.h * 1.25 };
      rebuildAnn(rec);
      sp = null; rec.obj.traverse(o => { if (!sp && o.userData.dimText) sp = o; });
      if (!sp) return;
      if (window.__updateDimTextFacing) window.__updateDimTextFacing();
    }
  }
  function commitDimWithOffset() {                      // 3回目クリック＝逃げを確定して寸法線を作る
    clearMarkers();                                     // 矢印整列吸着の緑マーカーを消す
    const a = drawState.dimAdjust.a, b = drawState.dimAdjust.b;
    const st = Object.assign({}, styleFor('dim'), { dimOff: drawState.dimOff || 0, dimDir: drawState.dimDir || null });
    if (dimKind === 'linear' && !st.dimDir) {   // 軸が未定のまま確定された保険＝ABの大きい水平成分が寸法線に残る軸へ
      const ab = b.clone().sub(a);
      st.dimDir = Math.abs(ab.x) >= Math.abs(ab.z) ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    }
    if (dimKind === 'linear' && st.dimDir) Object.assign(st, linearFixFields(a, b, st.dimDir));   // 長さ寸法＝軸固定で起票
    addAnnotation('dim', a, b, st);
    const rec = annStore[annStore.length - 1];
    autoShiftDimText(rec);                              // 既存の値と重なるなら値を1段ずつ上へ逃がす
    clearDrawTemp();
    cancelDraw();   // ツールを抜ける（構築線と同様、以後クリックや窓で再選択できる）
    // 逃げ位置を決めた3回目クリックで確定とする＝ここでフォーム/キーボードは出さない（社長要望）。
    // 逃げの微調整は、後から再選択してタップ＝スピナー／本体ドラッグで行える。
  }
  function commitLeader() {                             // 引出：a=矢印先端(1点目)・b=肘(2点目)で確定。棚と文字はbから自動生成
    if (!drawState.first || !drawState.cur || drawState.cur.distanceTo(drawState.first) <= 1e-6) { clearDrawTemp(); return; }
    const P = drawState.first.clone();                  // 矢の先（1点目）
    const st = Object.assign({}, styleFor('dim'), { dimKind: 'leader' });
    addAnnotation('dim', drawState.first.clone(), drawState.cur.clone(), st);
    const rec = annStore[annStore.length - 1];
    cancelDraw();   // ツールを抜ける
    // 矢の先が部品を指していたら、その名称・仕様を注記の初期値に（編集可。2026-07-31 社長要望）
    let label = null;
    try {
      let best = null, bd = 0.002;
      for (const q of placedParts) {
        if (q.userData.hidden || !q.userData.faceLocal) continue;
        for (const l of connsOf(q)) { const d2 = connModelPos(q, l).distanceTo(P); if (d2 < bd) { bd = d2; best = q; } }
        if (typeof quadLocalsOf === 'function') for (const l of quadLocalsOf(q)) { const d2 = connModelPos(q, l).distanceTo(P); if (d2 < bd) { bd = d2; best = q; } }
      }
      if (!best) {   // 機点で見つからなければ外形の箱で判定（部品の胴を指した時）
        for (const q of placedParts) {
          if (q.userData.hidden || !q.userData.faceLocal) continue;
          const bb = new THREE.Box3().setFromObject(q).expandByScalar(0.002);
          if (bb.containsPoint(P)) { best = q; break; }
        }
      }
      if (best && typeof partColumns === 'function') {
        const c = partColumns(best);
        label = [c.kind, c.type, c.size, c.cls].filter(Boolean).join(' ');
      }
    } catch (err) {}
    if (label) { rec.style.dimText = label; rebuildAnn(rec); }
    // そのまま注記の入力へ：初期値がある時は「編集」として開く（値が入った状態・書き換え可）
    selectLine(rec);
    if (window.__openDimValueForm) window.__openDimValueForm(!!label);
    if (window.__focusDimValueInput) window.__focusDimValueInput();
  }
  // ===== 自動生成（自動採寸・溶接番号）＝下書きを一括提示→タップで除外→確定（2026-07-31 社長採用） =====
  // 機械はあくまで下書き。確定後はふつうの寸法・引出しになるので、消す・直す・動かすは人が自由にできる。
  let autoGen = null;   // { items:[{a,b,st,obj,excluded}], label, box }
  function autoGenClear() {
    if (!autoGen) return;
    for (const it of autoGen.items) {
      if (!it.obj) continue;
      annGroup.remove(it.obj);
      it.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
    }
    if (autoGen.box) autoGen.box.remove();
    autoGen = null;
  }
  function autoGenSetOpacity(it) {
    it.obj.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = it.excluded ? 0.12 : 0.55; } });
  }
  function autoGenCount() {
    if (!autoGen) return;
    const n = autoGen.items.filter(i => !i.excluded).length;
    const el = autoGen.box.querySelector('.agN'); if (el) el.textContent = `${autoGen.label}：${n}件`;
  }
  function autoGenStart(items, label) {
    cancelDraw(); autoGenClear();
    if (!items.length) { if (window.__toast) window.__toast(`${label}：追加できるものがありません（既に記入済みか、対象がありません）`); return; }
    autoGen = { items, label, box: null };
    for (const it of items) { it.obj = buildAnn('dim', it.a, it.b, it.st); annGroup.add(it.obj); autoGenSetOpacity(it); }
    const box = document.createElement('div');
    box.id = 'autoGenBox';
    box.style.cssText = 'position:fixed;z-index:96;left:50%;transform:translateX(-50%);top:12px;display:flex;align-items:center;gap:8px;' +
      'padding:6px 10px;font:12px Meiryo,sans-serif;color:#1d2c4f;background:rgba(248,250,253,.97);border:1px solid #7fa8e8;border-radius:8px;box-shadow:0 2px 8px rgba(20,40,80,.18)';
    box.innerHTML = '<span class="agN"></span><span style="color:#5a6a88">タップで除外/戻す</span>' +
      '<button id="agOk" style="border:0;border-radius:5px;padding:4px 12px;background:#2f6fd8;color:#fff;font:inherit">確定</button>' +
      '<button id="agNo" style="border:0;border-radius:5px;padding:4px 12px;background:#e2e7f0;color:#33405c;font:inherit">取消</button>';
    document.body.appendChild(box);
    autoGen.box = box;
    box.querySelector('#agOk').addEventListener('click', autoGenConfirm);
    box.querySelector('#agNo').addEventListener('click', autoGenClear);
    ['pointerdown', 'click'].forEach(ev => box.addEventListener(ev, e => e.stopPropagation()));
    autoGenCount();
  }
  function autoGenConfirm() {
    if (!autoGen) return;
    const keep = autoGen.items.filter(i => !i.excluded);
    autoGenClear();
    const made = [];
    for (const it of keep) { addAnnotation('dim', it.a.clone(), it.b.clone(), Object.assign({}, it.st)); made.push(annStore[annStore.length - 1]); }
    // 値は寸法線（矢印の付いた補助線）から離さない＝自動のずらしはしない（2026-08-02 社長指示）
    if (window.__toast) window.__toast(`${made.length}件を記入しました`);
  }
  window.addEventListener('pointerdown', e => {           // 下書きのタップ＝除外/復帰
    if (!autoGen) return;
    if (autoGen.box && e.target && e.target.nodeType && autoGen.box.contains(e.target)) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const scr = p => { const n = modelGroup.localToWorld(p.clone()).project(cam); return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height, z: n.z }; };
    let best = null, bd = 30;
    for (const it of autoGen.items) {
      const dd = it.st.dimDir, off = it.st.dimOff || 0;   // 逃がした寸法線の実表示位置で当てる
      const ov = dd ? new V3(dd.x, dd.y, dd.z).multiplyScalar(off) : new V3();
      const A = scr(it.a.clone().add(ov)), B = scr(it.b.clone().add(ov));
      if (A.z >= 1 && B.z >= 1) continue;
      const vx = B.x - A.x, vy = B.y - A.y, L2 = vx * vx + vy * vy;
      let t = L2 > 1e-9 ? ((e.clientX - A.x) * vx + (e.clientY - A.y) * vy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(e.clientX - (A.x + vx * t), e.clientY - (A.y + vy * t));
      if (d < bd) { bd = d; best = it; }
    }
    if (best) { best.excluded = !best.excluded; autoGenSetOpacity(best); autoGenCount(); }
  }, true);
  window.addEventListener('keydown', e => { if (autoGen && e.key === 'Escape') { e.stopImmediatePropagation(); autoGenClear(); } }, true);
  // ---- 自動採寸：芯々（工作点間）・端面・EL・ボス位置を一括で下書き ----
  function autoDimStart() {
    const TOL = 0.0015;
    const near = (p, q) => p.distanceTo(q) < TOL;
    const oldDims = annStore.filter(r => r.type === 'dim' && !r.hidden && r.style && ['linear', 'parallel'].includes(r.style.dimKind || 'parallel'));
    const dimExists = (a, b) => oldDims.some(r => (near(r.a, a) && near(r.b, b)) || (near(r.a, b) && near(r.b, a)));
    const oldLeads = annStore.filter(r => r.type === 'dim' && !r.hidden && r.style && r.style.dimKind === 'leader');
    // 同じ値のEL表記は図面全体で1つ（2026-07-31 社長指示）＝既存・今回の下書きの両方と重複させない
    const elTaken = (txt) => oldLeads.some(r => String(r.style.dimText || '') === txt);
    const items = [];
    // ---- 逃げ（寸法線・引出しを外へ出す向き）＝ホーム＋範囲ズームの視点で見やすい向きを選ぶ（2026-08-02 社長指示） ----
    // ホームの視線の向きは範囲ズームでも変わらない＝いつも同じ見え方で下書きできる。
    // 選び方＝①画面でつぶれない向き（視線と平行な逃げは点になって読めない）②配管の外側へ出る向き。
    const camC = HOME.pos.clone().sub(HOME.target).normalize();     // 注視点→カメラ（ホーム視点の向き）
    const camX = new V3(0, 1, 0).cross(camC); if (camX.lengthSq() < 1e-9) camX.set(1, 0, 0); camX.normalize();
    const camY = camC.clone().cross(camX).normalize();
    const bMin = new V3(1e9, 1e9, 1e9), bMax = new V3(-1e9, -1e9, -1e9);
    for (const p of placedParts) {
      if (p.userData.hidden || !p.userData.placed) continue;
      const pts = [p.position].concat(connsOf(p).map(l => connModelPos(p, l)));
      for (const q of pts) { bMin.min(q); bMax.max(q); }
    }
    const bC = bMin.x > bMax.x ? new V3() : bMin.clone().add(bMax).multiplyScalar(0.5);
    const bH = bMin.x > bMax.x ? new V3(1, 1, 1) : bMax.clone().sub(bMin).multiplyScalar(0.5);
    const AXES6 = [new V3(1, 0, 0), new V3(-1, 0, 0), new V3(0, 1, 0), new V3(0, -1, 0), new V3(0, 0, 1), new V3(0, 0, -1)];
    const bestDirAmong = (cands, pt) => {
      let best = null, bs = -1e9;
      for (const n of cands) {
        const scr = Math.hypot(n.dot(camX), n.dot(camY));           // 画面での伸び（1=正面・0=視線と平行でつぶれる）
        const half = Math.abs(n.x) * bH.x + Math.abs(n.y) * bH.y + Math.abs(n.z) * bH.z;
        const out = half > 1e-6 ? Math.max(-1, Math.min(1, n.dot(pt.clone().sub(bC)) / half)) : 0;
        const up = n.y > 0.5 ? 0.35 : (n.y < -0.5 ? -0.35 : 0);      // 迷ったら上へ出す（2026-08-02 社長「上出しの方がよい」）
        const s = scr + 0.6 * out + up;
        if (s > bs) { bs = s; best = n; }
      }
      return best || new V3(0, 1, 0);
    };
    const pushDim = (a, b, lvl) => {
      // 短い区間も入れる（ガスケットの3mmなど。2026-08-02 社長指示。旧＝20mm未満は捨てていた）
      if (a.distanceTo(b) < 0.0015 || dimExists(a, b)) return;
      if (items.some(it => it.st.dimKind !== 'leader' && ((near(it.a, a) && near(it.b, b)) || (near(it.a, b) && near(it.b, a))))) return;
      const d = b.clone().sub(a).normalize();
      const axis = Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)) > 0.9999;
      let dir;
      if (axis) {
        const n = bestDirAmong(AXES6.filter(n2 => Math.abs(n2.dot(d)) < 0.5), a.clone().add(b).multiplyScalar(0.5));
        dir = { x: n.x, y: n.y, z: n.z };
      } else { const u2 = new V3(-d.z, 0, d.x); if (u2.lengthSq() < 1e-9) u2.set(1, 0, 0); u2.normalize(); dir = { x: u2.x, y: u2.y, z: u2.z }; }
      // 逃げは基本500以上（2026-07-31 社長指示）。区間の寸法は手前・総長は一段外（重ならない・読み違えない）。
      // ただしガスケットのような短い区間は手前に寄せる＝主寸法の列を乱さない（2026-08-02 社長指示）
      const short = a.distanceTo(b) < 0.01;
      const st = Object.assign({}, styleFor('dim'), { dimKind: axis ? 'linear' : 'parallel',
        dimOff: short ? 0.22 : ((lvl || 1) >= 2 ? 0.9 : 0.5), dimDir: dir });
      if (axis) Object.assign(st, linearFixFields(a, b, dir));
      items.push({ a: a.clone(), b: b.clone(), st });
    };
    // ---- ランの基準点（ステーション）＝寸法の起点・終点になる面 ----
    // ラン両端のキーポイント（エルボの工作点・ティーの芯・母管中心・管端）に加えて、
    // **フランジはフェイス面**・バルブ／仮管／ガスケット／フレキ／サイドグラス／レデューサは両端の面を基準にする。
    // 隣り合う基準どうしで寸法を入れる＝端から積み上げず、フランジ面を基準に測れる（2026-08-02 社長指示）。
    // 拾い方は「つながり」ではなく「ランの芯線の上に乗っているか」で見る（2026-08-02 社長指摘への対策）。
    // 継手のつながりだけを頼りにすると、ほんの少しの隙間・角度ずれで端のフランジが仲間から外れ、
    // 寸法が管端（溶接側）で止まって基準がバラバラになっていた。芯線基準なら必ずフェイス面まで届く。
    const STATION_ENDS = ['valve', 'gasket', 'spool', 'flex', 'sight', 'reducer'];
    const LINE_TOL = 0.004;   // 芯線からのずれ（4mm以内＝このランの部品）
    const SPAN_GAP = 0.004;   // 区間のつながり（4mmまでの隙間はつながっているとみなす）
    const stationsOf = (rk) => {
      const A = rk.KA.pt, B = rk.KB.pt;
      const d = B.clone().sub(A);
      if (d.lengthSq() < 1e-6) return [];
      d.normalize();
      const tOf = (p) => p.clone().sub(A).dot(d);
      const perpOf = (p) => { const v = p.clone().sub(A); return v.addScaledVector(d, -v.dot(d)).length(); };
      const tB = tOf(B);
      // ①このランの芯線に乗っている部品を拾う（フランジ＝フェイス面だけ／繋ぎ物＝両端の面）
      const cand = [];
      for (const q of placedParts) {
        const u = q.userData;
        if (u.hidden || !u.placed || !u.faceLocal || !u.backLocal) continue;
        const isFlange = u.partType === 'flange';
        if (!isFlange && !STATION_ENDS.includes(u.partType)) continue;
        const f = connModelPos(q, u.faceLocal), b = connModelPos(q, u.backLocal);
        if (perpOf(f) > LINE_TOL || perpOf(b) > LINE_TOL) continue;      // 芯線から外れている＝別のラン
        const tf = tOf(f), tb = tOf(b);
        cand.push({ lo: Math.min(tf, tb), hi: Math.max(tf, tb), pts: isFlange ? [{ t: tf, pt: f }] : [{ t: tf, pt: f }, { t: tb, pt: b }] });
      }
      // ②ランの範囲に触れているものから順に取り込み、範囲を広げる（端のフランジのフェイス面まで伸ばす）
      let lo = Math.min(0, tB), hi = Math.max(0, tB);
      const taken = new Set();
      for (let grew = true; grew;) {
        grew = false;
        for (const c of cand) {
          if (taken.has(c) || c.hi < lo - SPAN_GAP || c.lo > hi + SPAN_GAP) continue;
          taken.add(c); lo = Math.min(lo, c.lo); hi = Math.max(hi, c.hi); grew = true;
        }
      }
      // ③基準点＝ランの端（工作点・管端）＋取り込んだ部品の面。範囲が伸びた側は端の代わりに面が基準になる
      const list = [];
      const keepA = rk.KA.kind !== 'end' || lo > -0.0005;   // 工作点（エルボの角・ティー芯・母管中心）は必ず残す
      const keepB = rk.KB.kind !== 'end' || hi < tB + 0.0005;
      if (keepA) list.push({ t: 0, pt: A.clone() });
      if (keepB) list.push({ t: tB, pt: B.clone() });
      for (const c of taken) for (const s of c.pts) list.push({ t: s.t, pt: s.pt.clone() });
      // ④ボス（枝）の取り付け位置も同じ連なりの基準にする＝枝の位置が端からの積み上げにならない
      for (const p of placedParts) {
        const u = p.userData;
        if (u.hidden || u.partType !== 'sw' || (u.sw || {}).kind !== 'BOSS' || !u.placed) continue;
        const host = bossHostPipe(p);
        if (!host || perpOf(host.axisPt) > LINE_TOL) continue;
        const t = tOf(host.axisPt);
        if (t > lo - SPAN_GAP && t < hi + SPAN_GAP) list.push({ t, pt: host.axisPt.clone() });
      }
      list.sort((x, y) => x.t - y.t);
      // ⑤重なった基準（フランジ面とガスケット面など）だけをひとつにまとめる。
      //   ガスケットの3mmは基準として残す＝ガスケット・バルブにも寸法が入る（2026-08-02 社長指示）
      const out = [];
      for (const s of list) if (!out.length || s.t - out[out.length - 1].t > 0.0005) out.push(s);
      return out;
    };
    const runs = autoDimRuns();
    const runsK = runs.map(r => ({ r, KA: runEndKeyPoint(r.A), KB: runEndKeyPoint(r.B) }));
    // 同じ芯線に乗っていて区間が触れているランは、ひとつの連なりにまとめる（2026-08-02 社長指摘）。
    // ＝継手の所でランが2本に割れていると、総長が「半分ずつ2本」になってしまう（写真の251.5×2）。
    const chains = [];
    for (const rk of runsK) {
      const sts = stationsOf(rk);
      if (sts.length < 2) continue;
      const A = sts[0].pt, B = sts[sts.length - 1].pt;
      const d = B.clone().sub(A).normalize();
      let g = null;
      for (const c of chains) {
        if (Math.abs(c.d.dot(d)) < 0.999) continue;                        // 向きが違う
        const v = A.clone().sub(c.ref);
        if (v.addScaledVector(c.d, -v.dot(c.d)).length() > LINE_TOL) continue;   // 芯線が別
        const ts = sts.map(s => c.d.dot(s.pt.clone().sub(c.ref)));
        if (Math.max(...ts) < c.lo - 0.01 || Math.min(...ts) > c.hi + 0.01) continue;   // 離れている
        g = c; break;
      }
      if (!g) { g = { d: d.clone(), ref: A.clone(), lo: 1e9, hi: -1e9, pts: [], runs: [] }; chains.push(g); }
      for (const s of sts) {
        const t = g.d.dot(s.pt.clone().sub(g.ref));
        g.pts.push({ t, pt: s.pt.clone() });
        g.lo = Math.min(g.lo, t); g.hi = Math.max(g.hi, t);
      }
      g.runs.push(rk);
    }
    const HORZ4 = AXES6.filter(n => Math.abs(n.y) < 0.5);
    const pushEl = (pt, txt, perp) => {
      if (elTaken(txt) || items.some(it => it.st.dimKind === 'leader' && it.st.dimText === txt)) return;
      // ELは逃げを長くとる＝配管や寸法の列から離して読みやすく（2026-08-02 社長指示）
      items.push({ a: pt.clone(), b: pt.clone().addScaledVector(perp, 1.2), st: Object.assign({}, styleFor('dim'), { dimKind: 'leader', dimText: txt }) });
    };
    for (const g of chains) {
      // 区間ごとの寸法＝基準（工作点・フランジのフェイス面・バルブ/仮管/ガスケットの面）の隣どうし。
      // これでバルブ・仮管・ガスケットにも必ず寸法が付き、フランジのある所はフェイス面が基準になる。
      g.pts.sort((a, b) => a.t - b.t);
      const sts = [];
      for (const s of g.pts) if (!sts.length || s.t - sts[sts.length - 1].t > 0.0005) sts.push(s);
      if (sts.length < 2) continue;
      for (let i = 0; i + 1 < sts.length; i++) pushDim(sts[i].pt, sts[i + 1].pt, 1);
      const P0 = sts[0].pt, P1 = sts[sts.length - 1].pt;
      pushDim(P0, P1, sts.length > 2 ? 2 : 1);                            // 総長（区間があるときは一段外へ）
      if (Math.abs(g.d.y) < 0.02) {
        // 水平＝COP EL。引出しは**管に平行**（芯線の延長上へ出す。2026-08-02 社長指示・写真2枚目が正解）
        const elMm = Math.round(P0.y * 1000);
        const dBack = g.d.clone().negate(), dFwd = g.d.clone();
        const chosen = bestDirAmong([dBack, dFwd], P0.clone().add(P1).multiplyScalar(0.5));
        const at = chosen === dBack ? P0 : P1;                             // 選んだ向き側の端から、管の延長線上へ出す
        pushEl(at, `COP EL${elMm >= 0 ? '+' : ''}${elMm}`, chosen);
      } else if (Math.abs(g.d.y) > 0.98) {
        // 立面＝**フランジのフェイス面だけ**にEL（2026-08-02 社長指示）。
        // 管端・ボスの取り付け位置・フランジの逆面（溶接側）には付けない＝余分なELを出さない。
        const faceYs = [];
        for (const q of placedParts) {
          const u = q.userData;
          if (u.hidden || !u.placed || u.partType !== 'flange' || !u.faceLocal) continue;
          const f = connModelPos(q, u.faceLocal);
          if (Math.hypot(f.x - P0.x, f.z - P0.z) > LINE_TOL) continue;    // この連なりの芯線上のフランジだけ
          const t = g.d.dot(f.clone().sub(P0)), span = g.d.dot(P1.clone().sub(P0));
          if (t < -SPAN_GAP || t > span + SPAN_GAP) continue;
          faceYs.push(f);
        }
        // フランジが1枚も無い立面ラン（ボスから立ち上げた裸の管など）だけは、端面にELを入れる
        if (!faceYs.length) for (const rk of g.runs) for (const K of [rk.KA, rk.KB]) if (K.kind === 'end') faceYs.push(K.pt);
        for (const pt of faceYs) {
          const elMm = Math.round(pt.y * 1000);
          pushEl(pt, `EL${elMm >= 0 ? '+' : ''}${elMm}`, bestDirAmong(HORZ4, pt));
        }
      }
    }
    autoGenStart(items, '自動採寸');
  }
  // ---- 溶接番号：溶接口へ W1,W2… の引出しを一括で下書き（確定後は文字も番号も編集可） ----
  function weldNumStart() {
    const joints = collectWeldJoints();
    const tagged = annStore.filter(r => r.type === 'dim' && r.style && r.style.weldTag);
    let no = 0;
    for (const r of tagged) { const m = /W(\d+)/.exec(String(r.style.dimText || '')); if (m) no = Math.max(no, +m[1]); }
    const items = [];
    for (const j of joints) {
      if (tagged.some(r => r.a.distanceTo(j.pt) < 0.002)) continue;   // 既に番号が付いている口は保持（振り直さない）
      no++;
      const knee = j.pt.clone().add(new V3(0.3, 0.35, 0.2));   // 逃げは基本500以上（2026-07-31 社長指示）
      items.push({ a: j.pt.clone(), b: knee, st: Object.assign({}, styleFor('dim'), { dimKind: 'leader', dimText: `W${no}`, weldTag: 1 }) });
    }
    autoGenStart(items, '溶接番号');
  }
  window.__autoDimStart = autoDimStart;   // e2e検証用
  window.__weldNumStart = weldNumStart;
  window.__autoGenState = () => autoGen ? { n: autoGen.items.length, kept: autoGen.items.filter(i => !i.excluded).length, label: autoGen.label } : null;
  window.__autoGenConfirm = autoGenConfirm;
  window.__autoGenCancel = autoGenClear;
  window.__autoGenItemScreen = (i) => {   // i番目の下書きの実表示位置（タップ除外のe2e用）
    if (!autoGen || !autoGen.items[i]) return null;
    const it = autoGen.items[i];
    const cam = activeCam(), rect = renderer.domElement.getBoundingClientRect();
    const dd = it.st.dimDir, off = it.st.dimOff || 0;
    const ov = dd ? new V3(dd.x, dd.y, dd.z).multiplyScalar(off) : new V3();
    const mid = it.a.clone().add(it.b).multiplyScalar(0.5).add(ov);
    const n = modelGroup.localToWorld(mid).project(cam);
    return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height };
  };
  function commitGuide() {                              // first→cur を確定
    const rec = commitGuideToStore();
    if (rec) {
      // 2点目で完全に確定する（2026-07-21 社長指示）。描いた線を選択したまま残すと視点が固定され、
      // 解除のためだけに3回目のタップが要る＝「まだ確定していない」感になるため、選択せずに終える。
      // 線分・構築線・円とも1本（1個）描いたら終了＝基本コマンドは1回きり（2026-07-30 社長指示で円も統一）
      cancelDraw();
      deselectLine();
    }
    return rec;
  }
  // ---- タッチ/ペン：ドラッグで十字カーソルを位置決め（離してもまだ確定しない）、タップでその点を確定 ----
  function placeTouchPoint(e) {
    const px = drawParked ? drawParked.x : e.clientX;   // 離した位置（カーソルが止まった所）で確定。タップ座標には引っ張られない
    const py = drawParked ? drawParked.y : e.clientY;
    if (!drawState.first) {                              // タップ1回目＝起点を確定
      const r = pickFirstPoint(px, py);
      if (r.p) {
        drawState.first = r.p; drawState.cur = r.p.clone();
        drawState.vert = (e.shiftKey || touchShift) && drawState.mode !== 'xline' && drawState.mode !== 'circle';
        drawState.snapped = r.snapped; drawState.locked = false; drawState.editRec = null;
        clearPreview();
        if (drawState.mode !== 'circle') drawTriangle3D(drawState.first, drawState.cur, drawState.vert, drawState.snapped);
        else clearLineGuide();
        guideCross(drawState.first, drawState.snapped ? 0x39ff8a : 0x49c5ff);   // 1点目確定後もカーソル（十字）を残す（マウスでも表示）
      }
    } else {                                             // タップ2回目＝終点を確定
      const sh = (e.shiftKey || touchShift) && drawState.mode !== 'xline' && drawState.mode !== 'circle';
      const shx = (e.shiftKey || touchShift) && drawState.mode === 'xline';   // 構築線＋シフト＝鉛直（Y軸）の構築線（2026-07-19 社長要望）
      const r = pickSecondPoint(px, py, drawState.first, sh || shx);
      if (r.p && drawState.mode === 'xline') {
        if (shx) { r.p.x = drawState.first.x; r.p.z = drawState.first.z; }   // 鉛直＝XZを起点に固定（方向は真上下のみ）
        else r.p.y = drawState.first.y;
      }
      if (r.p) { drawState.cur = r.p; drawState.vert = sh; drawState.snapped = r.snapped; }
      if (drawState.mode === 'dim' && dimKind === 'leader') commitLeader();   // 引出＝肘で確定（2点）
      else if (drawState.mode === 'dim') startDimAdjust();                    // 平行寸法は確定せず逃げ調整へ
      else {
        // タッチ＝2点目確定で即完了。確定待ち(locked)に残さず、十字カーソルと同時に長さフォームも閉じる
        // （2026-07-12 iPad指摘）。長さの数値入力は、確定タップの前（位置決め中）に従来どおり行える。
        const rec = commitGuide();
        if (rec && drawState.locked) finishGuide();
      }
      clearLineGuide();                                  // 残った十字カーソルを消す
    }
    drawParked = null;                                   // 使ったら解除（次の点は新しいドラッグで決める）
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
    if (e.pointerType !== 'mouse') {                     // タッチ/ペン：本数を数え、2本目が触れたら視点操作＝作図しない
      drawPointers.add(e.pointerId);
      if (drawPointers.size >= 2) { drawMulti = true; drawDown = null; clearPreview(); clearLineGuide(); e.stopImmediatePropagation(); return; }
    }
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
    if (drawState.mode === 'dim' && dimKind === 'angle') {   // 角度：直線（または部品の軸）を2つ選択して測る
      // 対象＝線分/構築線に加え、フランジ等の部品もクリック可＝背面→フェイスの軸線として扱う（2026-07-19 社長要望：
      // 「フランジの面と線分の角度」＝フランジ軸（面の法線）と配管センターの角度を測れる）
      const pickAngleEdge = (cx, cy) => {
        const ln = pickAnnLineAt(cx, cy);
        if (ln) return { obj: ln, rec: ln, ends: annPickEnds(ln) };
        const part = (typeof pickPlacedAt === 'function') ? pickPlacedAt(cx, cy) : null;
        if (part && part.userData.faceLocal && part.userData.backLocal) {
          const A = connModelPos(part, part.userData.backLocal), B = connModelPos(part, part.userData.faceLocal);
          if (A.distanceTo(B) > 1e-6) return { obj: part, part, ends: [A, B] };
        }
        return null;
      };
      const markEdge = ed => { if (ed.rec) paintAnn(ed.rec, true, ANG_PICK_COLOR); else if (typeof setEmissive === 'function') setEmissive(ed.part, ANG_PICK_COLOR); };
      const ang = drawState.angle;
      const placing = ang && ang.V;
      if (placing) {                                    // 確定クリック（円弧位置で確定）
        if (e.pointerType !== 'mouse') {                // タッチ＝押しただけでは確定しない：ドラッグで方向・逃げを調整し、タップで確定
          drawDown = { x: e.clientX, y: e.clientY, touch: true, angPlace: true };   //（2026-07-20 社長報告「2つ目選択で確定してしまう」対策）
          e.stopImmediatePropagation();
          return;
        }
        const r = angleDimFrom(ang, e.clientX, e.clientY);
        if (r) addAnnotation('dim', r.a, r.b, r.st);
        cancelDraw();                                   // ツールを抜ける（clearDrawTempでプレビュー消去・緑ハイライト復元・状態解除）
      } else if (!ang) {                                // 1本目：直線か部品をクリックで選択（緑ハイライト）。空間クリックは何もしない
        const ed = pickAngleEdge(e.clientX, e.clientY);
        if (ed) { drawState.angle = { mode: 'obj', lines: [ed.obj], ends: [ed.ends] }; markEdge(ed); }
      } else {                                          // 2本目 → 交点（最近接点）を頂点に・各軸の向きを保持
        const ed = pickAngleEdge(e.clientX, e.clientY);
        if (ed && ed.obj !== ang.lines[0]) {
          ang.lines.push(ed.obj); ang.ends.push(ed.ends); markEdge(ed);
          const isP = [!!(ang.lines[0].isObject3D && ang.lines[0].userData && ang.lines[0].userData.placed), !!ed.part];
          let done = false;
          if (isP[0] !== isP[1]) {
            // 部品×線分＝フェイス面基準の角度（面に対して89°/91°等が測れる。2026-07-19 社長要望）。
            // 部品側の方向＝線の向きをフェイス面へ投影した面内方向・頂点＝線とフェイス面の交点。
            // 面と線の角度＝90°−(軸との角度)。カーソルの側で 89°/91°（θ/180−θ）を選べる。
            const pi = isP[0] ? 0 : 1, li = 1 - pi;
            const pe = ang.ends[pi], le = ang.ends[li];
            const n = pe[1].clone().sub(pe[0]);           // 背面→フェイス＝面の法線
            const lv = le[1].clone().sub(le[0]);
            if (n.lengthSq() > 1e-12 && lv.lengthSq() > 1e-12) {
              n.normalize();
              const dn = lv.dot(n);
              const proj = lv.clone().addScaledVector(n, -dn);   // 線の向きの面内成分
              if (proj.lengthSq() > 1e-10) {                     // 面に垂直な線＝面基準が定まらない→軸基準へ
                const F = pe[1], L0 = le[0];
                const V = Math.abs(dn) > 1e-9
                  ? L0.clone().addScaledVector(lv, F.clone().sub(L0).dot(n) / dn)   // 線とフェイス面の交点
                  : L0.clone().addScaledVector(n, -L0.clone().sub(F).dot(n));        // 平行＝線を面へ投影
                const uP = proj.normalize(), uL = lv.clone().normalize();
                ang.V = V;
                ang.u1 = pi === 0 ? uP : uL;
                ang.u2 = pi === 0 ? uL : uP;
                ang.ends[pi] = [V.clone(), V.clone()];   // 面内方向には実線が無い＝補助線の重なり隠しは無効
                done = true;
              }
            }
          }
          if (!done) {                                   // 線×線・部品×部品＝従来どおり（軸どうしの実角）
            const e0 = ang.ends[0], e1 = ang.ends[1];
            ang.V = lineLineClosest(e0[0], e0[1], e1[0], e1[1]);
            ang.u1 = e0[1].clone().sub(e0[0]).normalize();
            ang.u2 = e1[1].clone().sub(e1[0]).normalize();
          }
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
    if (drawState.mode === 'dim' && drawState.dimAdjust) {   // 寸法線：3回目＝補助線の長さ（逃げ）を確定
      if (e.pointerType === 'mouse') { commitDimWithOffset(); drawDown = null; }   // マウス＝クリックで即確定
      else drawDown = { x: e.clientX, y: e.clientY, touch: true, dimAdj: true };   // タッチ/ペン＝離してタップなら確定（スライド＝逃げ調整）
      e.stopImmediatePropagation();
      return;
    }
    if (drawState.locked) {
      finishGuide();                                    // 直前の確定待ちを終える（長さフォーム・ガイドを消す）
      // タッチ/ペン：確定待ちを終えるタップはここで消費し、次の線の起点は打たない。
      // 打ってしまうと見えない起点＋十字カーソルが残り、次のタップで極小のゴミ線が作られて
      // 長さフォームが表示されたままになる（2026-07-11 iPad指摘）。マウスは従来どおりクリック連鎖で次の線へ。
      if (e.pointerType !== 'mouse') { drawDown = null; e.stopImmediatePropagation(); return; }
    }
    if (e.pointerType !== 'mouse') {                    // タッチ/ペン：押下では決めず、ドラッグでカーソル移動／離した位置に点を打つ
      drawDown = { x: e.clientX, y: e.clientY, touch: true };
      e.stopImmediatePropagation();
      return;
    }
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
      const sh = (e.shiftKey || touchShift) && drawState.mode !== 'xline' && drawState.mode !== 'circle';   // 円はShift勾配なし
      const shx = (e.shiftKey || touchShift) && drawState.mode === 'xline';   // 構築線＋シフト＝鉛直（Y軸）の構築線（2026-07-19 社長要望）
      const r = pickSecondPoint(e.clientX, e.clientY, drawState.first, sh || shx);
      if (r.p && drawState.mode === 'xline') {
        if (shx) { r.p.x = drawState.first.x; r.p.z = drawState.first.z; }   // 鉛直＝XZを起点に固定
        else r.p.y = drawState.first.y;   // 水平＝スナップ先のELにも引っ張られず水平を保つ
      }
      if (r.p) { drawState.cur = r.p; drawState.vert = sh; drawState.snapped = r.snapped; }
    }
    drawDown = { x: e.clientX, y: e.clientY, armed: !hadFirst };   // armed=この押下で起点を立てた
    e.stopImmediatePropagation();
  }, true);
  window.addEventListener('pointerup', e => {
    if (e.pointerType !== 'mouse') drawPointers.delete(e.pointerId);   // 本数は作図モード外でも必ず減らす（残留＝2本指誤判定でフリーズ）
    if (!drawActive() || e.button !== 0) return;
    if (e.pointerType !== 'mouse') {                    // タッチ/ペン：離れた本数を反映
      if (drawMulti) {                                  // 2本指（視点操作）の指離し＝点は打たない
        if (drawPointers.size === 0) drawMulti = false; // 全部離れたら通常へ戻す
        drawDown = null; e.stopImmediatePropagation(); return;
      }
    }
    if (!drawDown) return;
    const touch = drawDown.touch, dimAdj = drawDown.dimAdj, armed = drawDown.armed, angPlace = drawDown.angPlace;
    const moved = Math.hypot(e.clientX - drawDown.x, e.clientY - drawDown.y);
    drawDown = null;
    e.stopImmediatePropagation();
    if (touch) {                                        // タッチ/ペン
      if (moved > TAP_MOVE) return;                     // ドラッグ＝位置決めのみ。十字カーソルは離した所に残り、まだ確定しない
      if (angPlace) {                                   // 角度寸法：タップ＝この位置（方向・逃げ）で確定。ドラッグ後は止まった位置で
        const px = drawParked ? drawParked.x : e.clientX, py = drawParked ? drawParked.y : e.clientY;
        const ang2 = drawState.angle;
        if (ang2 && ang2.V) { const r = angleDimFrom(ang2, px, py); if (r) addAnnotation('dim', r.a, r.b, r.st); }
        drawParked = null;
        cancelDraw();
        return;
      }
      if (dimAdj) {                                     // タップ＝寸法の逃げをこの位置で確定
        // ドラッグ無しの直タップだとpointermoveが来ず軸・逃げが未定のまま＝長さ寸法が平行寸法の見た目になる
        // → タップ位置で軸（水平/垂直）と逃げを決めてから確定（2026-07-31 社長報告）
        const rr = dimOffsetFromCursor(e.clientX, e.clientY, drawState.dimAdjust.a, drawState.dimAdjust.b, e.shiftKey || touchShift);
        if (rr) { drawState.dimOff = rr.off; drawState.dimDir = rr.dir; }
        commitDimWithOffset(); return;
      }
      placeTouchPoint(e);                               // タップ＝1点目／2点目を確定
      return;
    }
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
  window.addEventListener('pointercancel', e => {       // OSがタッチを取り消した時：本数と状態を片付ける
    if (e.pointerType === 'mouse') return;
    drawPointers.delete(e.pointerId);
    if (drawPointers.size === 0) { drawMulti = false; drawDown = null; }
  }, true);
  window.addEventListener('pointermove', e => {
    if (!drawActive()) return;
    if (drawMulti) return;                              // 2本指＝視点操作中はプレビューを動かさない
    if (e.pointerType !== 'mouse' && drawDown && drawDown.touch) {   // タッチ/ペンのジェスチャ中
      if (Math.hypot(e.clientX - drawDown.x, e.clientY - drawDown.y) <= TAP_MOVE) return;   // タップ判定中はカーソルを動かさず、離した位置を保持
      drawParked = { x: e.clientX, y: e.clientY };      // ドラッグ＝離した位置を記録（タップ確定はここで打つ）
    }
    if (overLineBox(e.clientX, e.clientY)) return;      // 脚入力欄の上ではプレビュー凍結（方向を保つ）
    if (drawState.locked) return;                       // 確定待ちは固定（脚入力で編集）
    if (drawState.mode === 'dim' && dimKind === 'angle') {   // 角度：2本目を取った後だけ円弧プレビューを出す（選択前は何も出さない）
      clearPreview(); clearLineGuide();
      const ang = drawState.angle;
      if (ang && ang.V) {
        const r = angleDimFrom(ang, e.clientX, e.clientY);
        if (r) {
          drawState.preview = buildAnn('dim', r.a, r.b, r.st); drawState.preview.traverse(o => { if (o.material) o.material.opacity = 0.6; }); annGroup.add(drawState.preview);
          if (r.snapPt) snapDot(r.snapPt);   // スナップ中＝緑印（四半円点=赤◇・穴=赤＋）
        }
      } else if (pickAnnLineAt(e.clientX, e.clientY)) {   // 直線をホバー中＝スナップ印（半径/直径と同じ操作感）
        const sp = drawSnapPoint(e.clientX, e.clientY); if (sp) snapDot(sp);
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
          if (r.snapPt) snapDot(r.snapPt);   // スナップ中＝緑印（四半円点=赤◇・穴=赤＋）
        }
      } else {                                            // ロック前：円/楕円に来たらスナップ印（中心・四半円点・機点）を出す
        if (pickCircleForDim(e.clientX, e.clientY)) {
          const snap = drawSnapPoint(e.clientX, e.clientY);
          if (snap) snapDot(snap);
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
      if (dimKind === 'linear' && drawState.dimDir) Object.assign(st, linearFixFields(a, b, drawState.dimDir));   // 長さ寸法＝プレビューも軸固定
      // 作成時の逃げ調整でも、他の寸法線の矢印と整列する逃げ量へ吸着（2026-07-20 社長要望。再選択時と同じ動き）
      if (st.dimDir) {
        const snap = dimOffArrowSnap({ a, b, style: st }, drawState.dimOff || 0);
        clearMarkers();
        if (snap) {
          drawState.dimOff = snap.off; st.dimOff = snap.off;
          addMarker(snap.pt, 0x39ff8a, markerRadiusFor(null, true));   // 吸着中＝相手の矢印を緑で強調
        }
      }
      drawState.preview = buildAnn('dim', a, b, st);
      drawState.preview.traverse(o => { if (o.material) o.material.opacity = 0.6; });
      annGroup.add(drawState.preview);
      return;
    }
    if (!drawState.first) {                             // ドラッグ中：十字カーソル（離した所に残る）とスナップ印
      clearLineGuide();
      const r = pickFirstPoint(e.clientX, e.clientY);
      showDrawSnapMarkers(r.snapped ? r.p : null);       // 部品配置と同じ機点マーカー（吸着中は緑）
      if (r.p) guideCross(r.p, r.snapped ? 0x39ff8a : 0x49c5ff);   // 十字カーソル＝マウスでも常時表示（2026-07-20 社長「カーソルは表示して」）
      if (r.p && r.snapped) snapDot(r.p);                          // 吸着印（四半円点=赤◇・穴=赤＋・交点=黄）
      return;
    }
    const sh = (e.shiftKey || touchShift) && drawState.mode !== 'xline' && drawState.mode !== 'circle';   // 円はShift勾配なし（常に水平）
    const shx = (e.shiftKey || touchShift) && drawState.mode === 'xline';   // 構築線＋シフト＝鉛直（Y軸）の構築線
    const r = pickSecondPoint(e.clientX, e.clientY, drawState.first, sh || shx);
    if (!r.p) return;
    showDrawSnapMarkers(r.snapped ? r.p : null);         // 2点目の位置決め中も機点マーカーを出す
    if (drawState.mode === 'xline') { if (shx) { r.p.x = drawState.first.x; r.p.z = drawState.first.z; } else r.p.y = drawState.first.y; }
    if (drawState.mode === 'circle') r.p.y = drawState.first.y;   // 半径点も中心の高さに合わせる（水平な円）
    drawState.cur = r.p; drawState.vert = sh; drawState.snapped = r.snapped;
    clearPreview();
    drawState.preview = buildAnn(drawState.mode, drawState.first, r.p, styleFor(drawState.mode));
    drawState.preview.traverse(o => { if (o.material) o.material.opacity = 0.6; });
    annGroup.add(drawState.preview);
    if (drawState.mode !== 'circle') drawTriangle3D(drawState.first, r.p, drawState.vert, drawState.snapped);   // 円は脚三角形を出さない
    else clearLineGuide();
    guideCross(r.p, drawState.snapped ? 0x39ff8a : 0x49c5ff);   // 2点目も十字カーソル（マウスでも表示・離した所に残る）
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
      if (r.type === 'xline' || r.type === 'line') updateXlinePts();   // 構築線・線分なら交点も引き直す
    }
  }, true);

  // ===================================================================
  //  描画後の線分：再選択 / 移動 / 端点ドラッグで長さ変更（描画モード外で動作）
  // ===================================================================
  window.__annSnapPoints = () => { const a = []; if (showOriginPts) for (const r of annStore) { if (r === drawState.editRec || r.hidden) continue; if (annMoveSnap && selAnns.has(r)) continue; for (const sp of annSnapPoints(r)) a.push(sp); } if (showXpts) for (const p of xlinePts) a.push(p); return a; };   // 線分=端点+中点／円=中心+四半円点（構築線は交点のみ）。設定「起点」「交点」でOFF可
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
  // 円弧の端点ハンドル（部分削除で開いた口）。カーソル近傍なら {which:0|1, theta} を返す
  function arcEndHandleAt(rec, cx, cy) {
    if (rec.type !== 'circle') return null;
    const rr = arcRange(rec.style);
    if (rr.full) return null;
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    let best = null, bestD = SNAP_PX + 6;
    [[0, rr.a0], [1, rr.a1]].forEach(([which, th]) => {
      const n = modelGroup.localToWorld(circPt(rec, th)).project(cam);
      if (n.z >= 1) return;
      const d = Math.hypot(rect.left + (n.x * 0.5 + 0.5) * rect.width - cx, rect.top + (-n.y * 0.5 + 0.5) * rect.height - cy);
      if (d < bestD) { bestD = d; best = { which, theta: th }; }
    });
    return best;
  }
  let dimValOpen = false;                      // 値フォームを開くのは「値クリック」時のみ（オブジェクト選択では出さない）
  let dimValEditing = false;                   // true＝既存値の編集（引出ラベル「編集」）／false＝新規入力（引出ラベル「入力」）
  function selectLine(rec, additive) {
    if (typeof hideArmed !== 'undefined' && hideArmed) { setHideArmed(false); hideAnnRec(rec); return; }   // 「非表示」実行待ち＝選択せず隠す
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
  // 選択表示＝従来どおり色変え（発光）。ハロー帯は社長指示で撤回（2026-07-20）
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
    const segHits = (Ae, Be) => {
      const seg = clipProjectSeg(Ae, Be, rect, cam, inv);
      if (!seg) return false;
      const { pa, pb } = seg;
      const inA = pa.x >= x0 && pa.x <= x1 && pa.y >= y0 && pa.y <= y1;
      const inB = pb.x >= x0 && pb.x <= x1 && pb.y >= y0 && pb.y <= y1;
      return inA || inB || segRectCross(pa.x, pa.y, pb.x, pb.y, x0, y0, x1, y1);
    };
    let added = 0;
    for (const rec of annStore) {
      if (rec.hidden) continue;                        // 非表示は窓選択に掛からない
      // 寸法は「見えている寸法線」だけでなく、測定点どうしの線・両足（補助線）でも掛かるようにする。
      // ＝窓が測定点の近くや足だけを囲んでも選択できる（2026-08-04 社長報告「寸法がらみが選択されにくい」）。
      const cand = [annPickEnds(rec)];
      if (rec.type === 'dim') {
        const ends = dimLineEnds(rec.a, rec.b, rec.style);
        if (ends) { cand.push([rec.a, rec.b]); cand.push([rec.a, ends.A2]); cand.push([rec.b, ends.B2]); }
      }
      if (cand.some(([Ae, Be]) => segHits(Ae, Be))) {
        if (!selAnns.has(rec)) { selAnns.add(rec); added++; }
      }
    }
    if (added) refreshAnnHi();
    if (added) { refreshHandles(); if (typeof updateForm === 'function') updateForm(); }
    return selAnns.size;
  };
  window.__annHasSel = () => selAnns.size > 0;
  // 選択中の注釈の中心（掴んで置く時の基準点）
  // 掴んで置く時の基準点＝選択した先頭の注釈の端点a（ここが吸着先に乗る）
  window.__annSelGrip = () => { for (const r of selAnns) return r.a.clone(); return null; };
  window.__annSelCenter = () => {
    if (!selAnns.size) return null;
    const c = new THREE.Vector3(); let n = 0;
    for (const r of selAnns) { c.add(r.a); c.add(r.b); n += 2; }
    return n ? c.multiplyScalar(1 / n) : null;
  };
  // 選択中の注釈の「並びの向き」＝各レコードのa→bを（向きを揃えて）平均した単位ベクトル。
  // 複数選択したまま3軸で回すときの「立面角＝これに直交する水平軸／回転＝この軸」に使う（2026-08-02）
  window.__annSelDir = () => {
    if (!selAnns.size) return null;
    const acc = new THREE.Vector3(); let ref = null;
    for (const r of selAnns) {
      const v = r.b.clone().sub(r.a);
      if (v.lengthSq() < 1e-12) continue;
      v.normalize();
      if (!ref) ref = v.clone(); else if (v.dot(ref) < 0) v.negate();
      acc.add(v);
    }
    return acc.lengthSq() > 1e-9 ? acc.normalize() : null;
  };
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
  // 引出し・寸法の端をつまんだ状態にする（e2e検証用。実操作と同じ lineDrag を作る）
  window.__annStartDimEnd = (rec, end) => {
    if (!annStore.includes(rec)) return false;
    selectLine(rec);
    const rc = renderer.domElement.getBoundingClientRect();
    const pt = (end === 0 ? rec.a : rec.b).clone();
    const nn = modelGroup.localToWorld(pt).project(activeCam());
    lineDrag = { mode: 'dimend', rec, end, moved: false, free: false,
                 downX: rc.left + (nn.x * 0.5 + 0.5) * rc.width, downY: rc.top + (-nn.y * 0.5 + 0.5) * rc.height };
    if (rec.style && rec.style.dimKind === 'leader') {
      clearTimeout(freeHoldTimer);
      freeHoldTimer = setTimeout(() => { if (lineDrag && lineDrag.mode === 'dimend' && !lineDrag.moved) lineDrag.free = true; }, 500);   // 実操作と同じ＝動かし始めていたら切り替えない
    }
    return true;
  };
  window.__annDimEndFree = () => !!(lineDrag && lineDrag.free);
  window.__annDimEndMoved = () => !!(lineDrag && lineDrag.moved);   // e2e検証用
  window.__annEndDimEnd = () => { clearTimeout(freeHoldTimer); lineDrag = null; };
  window.__annToggleRec = (rec) => {   // 複数選択へ出し入れ（Ctrl+クリックと同じ。e2e検証用）
    if (!annStore.includes(rec)) return false;
    if (selAnns.has(rec)) { selAnns.delete(rec); if (lineSel === rec) { lineSel = null; clearLineHandles(); } }
    else { selAnns.add(rec); lineSel = rec; showLineHandles(rec); }
    refreshAnnHi();
    if (typeof updateForm === 'function') updateForm();
    return true;
  };
  window.__annDeleteRec = (rec) => {              // 特定の注釈を1件削除（スピナー中のDelete用）
    const i = annStore.indexOf(rec); if (i < 0) return;
    annStore.splice(i, 1); annGroup.remove(rec.obj); disposeObj(rec.obj);
    if (lineSel === rec) { lineSel = null; clearLineHandles(); clearGrip(); }
    selAnns.delete(rec); refreshAnnHi(); refreshHandles();
    if (rec.type === 'xline' || rec.type === 'line') updateXlinePts();
    if (typeof updateForm === 'function') updateForm();
  };
  // ===== 線の部分削除（2026-07-30 社長要望・同日拡張） =====
  // 線分・円/円弧の指定区間を消す（構築線・寸法は対象外）。ボタン→1点目→2点目のタップで実行。
  // いつもの十字カーソル・吸着（起点・交点・四半円点など）を効かせ、1点目の後は消える区間を赤で予告する。
  // 円は残りが円弧（style.arcA0/arcA1）になり、端点をつかんで伸ばせば円に戻せる。
  let trimState = null;            // { rec, kind, t1|th1, thC, marker }（nullなら停止中）
  const TRIM_PICK_PX = 14;         // 対象を拾う画面距離
  const TRIM_END_PX = 14;          // 端点（起点）吸着の画面距離
  function trimBtnLit(on) { const b = document.getElementById('cmdTrim'); if (b) b.classList.toggle('active', on); }
  // 画面座標→対象（線分/円）とその上の点。通常の吸着点が対象上に乗ればそれを優先し、無ければ接近点。
  function trimResolve(cx, cy) {
    const cam = activeCam(); cam.updateMatrixWorld();
    const rect = renderer.domElement.getBoundingClientRect();
    const scr = p => { const n = modelGroup.localToWorld(p.clone()).project(cam);
      return n.z < 1 ? { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height } : null; };
    const segPx = (A, B) => { if (!A || !B) return 1e9;
      const vx = B.x - A.x, vy = B.y - A.y, L2 = vx * vx + vy * vy;
      let ts = L2 > 1e-9 ? ((cx - A.x) * vx + (cy - A.y) * vy) / L2 : 0;
      ts = Math.max(0, Math.min(1, ts));
      return Math.hypot(cx - (A.x + vx * ts), cy - (A.y + vy * ts)); };
    let best = null;   // { rec, kind, px }
    for (const rec of annStore) {
      if (rec.hidden) continue;
      if (rec.type === 'line') {
        const px = segPx(scr(rec.a), scr(rec.b));
        if (px <= TRIM_PICK_PX && (!best || px < best.px)) best = { rec, kind: 'line', px };
      } else if (rec.type === 'circle') {
        const rr = arcRange(rec.style);
        const N = 48; let prev = null, mn = 1e9;
        for (let i = 0; i <= N; i++) {
          const p = scr(circPt(rec, rr.a0 + ((rr.a1 - rr.a0) * i) / N));
          if (prev && p) mn = Math.min(mn, segPx(prev, p));
          prev = p;
        }
        if (mn <= TRIM_PICK_PX && (!best || mn < best.px)) best = { rec, kind: 'circle', px: mn };
      }
    }
    if (!best) return null;
    let sp = null;
    try { sp = drawSnapPoint(cx, cy); } catch (err) { sp = null; }   // いつもの吸着（起点・交点・四半円点…）
    if (best.kind === 'line') {
      const rec = best.rec, ab = rec.b.clone().sub(rec.a), L = ab.length() || 1e-9;
      let t = null, snapped = false;
      if (sp) {   // 吸着点が この線の上 に乗っていればそのまま使う
        const tt = Math.max(0, Math.min(1, sp.clone().sub(rec.a).dot(ab) / (L * L)));
        if (sp.distanceTo(rec.a.clone().addScaledVector(ab, tt / 1)) < 0.0008) { t = tt; snapped = true; }
      }
      if (t == null) {
        const A = scr(rec.a), B = scr(rec.b);
        if (A && Math.hypot(cx - A.x, cy - A.y) < TRIM_END_PX) { t = 0; snapped = true; }
        else if (B && Math.hypot(cx - B.x, cy - B.y) < TRIM_END_PX) { t = 1; snapped = true; }
        else {   // 接近点＝視線と線分の3D最接近点
          pickRay.setFromCamera({ x: ((cx - rect.left) / rect.width) * 2 - 1, y: -((cy - rect.top) / rect.height) * 2 + 1 }, cam);
          const wa = modelGroup.localToWorld(rec.a.clone()), wb = modelGroup.localToWorld(rec.b.clone());
          const dseg = new THREE.Vector3().subVectors(wb, wa);
          const w0 = new THREE.Vector3().subVectors(wa, pickRay.ray.origin);
          const a2 = dseg.dot(dseg), b2 = dseg.dot(pickRay.ray.direction);
          const d2 = dseg.dot(w0), e2 = pickRay.ray.direction.dot(w0);
          const den = a2 - b2 * b2;   // c=|ray.direction|²=1
          t = Math.abs(den) > 1e-12 ? Math.max(0, Math.min(1, (b2 * e2 - d2) / den)) : 0;
        }
      }
      return { rec, kind: 'line', t, pt: rec.a.clone().lerp(rec.b, t), snapped };
    }
    // 円/円弧：離心角で表す
    const rec = best.rec, rr = arcRange(rec.style);
    let th = null, snapped = false;
    if (sp) {
      const { rx, rz } = circleRadii(rec.style, rec.a, rec.b), q = quatFromStyle(rec.style);
      const local = sp.clone().sub(rec.a).applyQuaternion(q.clone().invert());
      if (Math.abs(local.y) < 0.0008 && Math.abs(Math.hypot(local.x / rx, local.z / rz) - 1) < 0.01) {
        th = norm2pi(Math.atan2(local.z / rz, local.x / rx)); snapped = true;
      }
    }
    if (th == null) th = circleThetaAt(rec, cx, cy);
    if (th == null) return null;
    if (!rr.full) {   // 円弧なら描かれている範囲へ入れる（範囲外は近い方の端へ）
      const rel = norm2pi(th - rr.a0), span = rr.a1 - rr.a0;
      th = rel <= span ? rr.a0 + rel : (norm2pi(th - rr.a1) < norm2pi(rr.a0 - th) ? rr.a1 : rr.a0);
    }
    return { rec, kind: 'circle', th, pt: circPt(rec, th), snapped };
  }
  // いつもの十字カーソル＋吸着印＋（1点目の後は）消える区間の赤い予告
  function trimShowCursor(cx, cy) {
    clearLineGuide();
    const r = trimResolve(cx, cy);
    if (r) {
      try { showDrawSnapMarkers(r.snapped ? r.pt : null); } catch (err) {}
      guideCross(r.pt, r.snapped ? 0x39ff8a : 0x49c5ff);
      if (r.snapped) snapDot(r.pt);
    } else {
      try { showDrawSnapMarkers(null); } catch (err) {}
      const f = pickFirstPoint(cx, cy);
      if (f.p) guideCross(f.p, 0x49c5ff);
    }
    if (trimState && trimState.rec && r && r.rec === trimState.rec) {
      const mat = new THREE.LineBasicMaterial({ color: 0xff3b30, depthTest: false, transparent: true, opacity: 0.95 });
      let g = null;
      if (trimState.kind === 'line') {
        g = new THREE.BufferGeometry().setFromPoints([trimState.rec.a.clone().lerp(trimState.rec.b, trimState.t1), r.pt.clone()]);
      } else {
        let t = r.th;   // 進行方向を連続化＝なぞった側の弧が消える
        while (t - trimState.thC > Math.PI) t -= TAU;
        while (t - trimState.thC < -Math.PI) t += TAU;
        trimState.thC = t;
        const d = trimState.thC - trimState.th1;
        const n = Math.max(2, Math.ceil(Math.abs(d) / (Math.PI / 48)));
        const pts = [];
        for (let i = 0; i <= n; i++) pts.push(circPt(trimState.rec, trimState.th1 + (d * i) / n));
        g = new THREE.BufferGeometry().setFromPoints(pts);
      }
      const ln = new THREE.Line(g, mat); ln.renderOrder = 998; lineGuideGroup.add(ln);
    }
    return r;
  }
  function trimStart() {
    if (trimState) { trimEnd(); if (window.__toast) window.__toast('部分削除：取り消しました'); return; }
    clearOtherCommands('trim');
    if (typeof selectPart === 'function') selectPart(null);
    window.__annClearSel();
    trimState = { rec: null, kind: null, t1: null, th1: null, thC: null, marker: null };
    trimBtnLit(true);
    renderer.domElement.style.cursor = DRAW_CURSOR;
    // 案内トーストは出さない（2026-07-31 社長指示：使い方はヘルプで「部分削除」を検索）
  }
  function trimEnd() {
    if (trimState && trimState.marker) { annGroup.remove(trimState.marker); disposeObj(trimState.marker); }
    trimState = null;
    trimBtnLit(false);
    renderer.domElement.style.cursor = '';
    clearLineGuide();
    try { showDrawSnapMarkers(null); } catch (err) {}
  }
  function trimTapAt(cx, cy) {
    const hit = trimShowCursor(cx, cy);   // タップ位置でも吸着・赤い予告（円の進行方向の更新）を通す
    if (!hit) { if (window.__toast) window.__toast('線分・円が見つかりません（構築線・寸法は対象外）'); return; }
    if (!trimState.rec) {
      trimState.rec = hit.rec; trimState.kind = hit.kind;
      if (hit.kind === 'line') trimState.t1 = hit.t;
      else { trimState.th1 = hit.th; trimState.thC = hit.th; }
      const world = modelGroup.localToWorld(hit.pt.clone());
      const r = Math.max(activeCam().position.distanceTo(world) * 0.008, 0.002);
      const mk = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.9, depthTest: false }));
      mk.scale.setScalar(r); mk.position.copy(hit.pt); mk.renderOrder = 9;
      annGroup.add(mk); trimState.marker = mk;
      return;
    }
    if (hit.rec !== trimState.rec) { if (window.__toast) window.__toast('2点目は同じ線・円の上をタップしてください'); return; }
    if (trimState.kind === 'line') execTrim(trimState.rec, trimState.t1, hit.t);
    else execTrimCircle(trimState.rec, trimState.th1, trimState.thC);
  }
  function execTrim(rec, ta, tb) {
    const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
    if (hi - lo < 1e-4) { if (window.__toast) window.__toast('2点が同じ場所です（別の点をタップしてください）'); return; }
    const a0 = rec.a.clone(), b0 = rec.b.clone(), st = rec.style, gid = rec.groupId;
    window.__annDeleteRec(rec);
    const EPS = 1e-4;
    const mk2 = (p, q) => { addAnnotation('line', p, q, st); const nr = annStore[annStore.length - 1]; if (gid != null) nr.groupId = gid; };
    if (lo > EPS) mk2(a0.clone(), a0.clone().lerp(b0, lo));
    if (hi < 1 - EPS) mk2(a0.clone().lerp(b0, hi), b0.clone());
    trimEnd();
    recordHistory();
    if (window.__toast) window.__toast(lo <= EPS && hi >= 1 - EPS ? '線を削除しました' : '線を部分削除しました');
  }
  function execTrimCircle(rec, th1, th2u) {
    const rr = arcRange(rec.style);
    const st = rec.style, gid = rec.groupId;
    const MIN = Math.PI / 360;   // 0.5°未満の欠片は残さない
    if (rr.full) {               // まるい円：なぞった側（th1→th2uの向き）の弧を消す→残りが円弧
      const d = th2u - th1;
      if (Math.abs(d) < 1e-4) { if (window.__toast) window.__toast('2点が同じ場所です（別の点をタップしてください）'); return; }
      if (Math.abs(d) >= TAU - MIN) {   // ほぼ一周なぞった＝丸ごと削除
        window.__annDeleteRec(rec); trimEnd(); recordHistory();
        if (window.__toast) window.__toast('円を削除しました'); return;
      }
      const a0 = d > 0 ? norm2pi(th2u) : norm2pi(th1);
      st.arcA0 = a0; st.arcA1 = a0 + (TAU - Math.abs(d));
      rebuildAnn(rec); refreshAnnHi(); refreshHandles();
      trimEnd(); recordHistory();
      if (window.__toast) window.__toast('円を部分削除しました（端はつかんで伸ばすと円に戻せます）');
      return;
    }
    // 既に円弧：範囲内の2点間を削除（端まで含めば片側だけ・全部なら削除）
    const t1c = Math.max(rr.a0, Math.min(rr.a1, th1));
    const t2c = Math.max(rr.a0, Math.min(rr.a1, th2u));
    const lo = Math.min(t1c, t2c), hi = Math.max(t1c, t2c);
    if (hi - lo < 1e-4) { if (window.__toast) window.__toast('2点が同じ場所です（別の点をタップしてください）'); return; }
    window.__annDeleteRec(rec);
    const mkArc = (p0, p1) => {
      if (p1 - p0 < MIN) return;
      const st2 = Object.assign({}, st, { arcA0: norm2pi(p0), arcA1: norm2pi(p0) + (p1 - p0) });
      addAnnotation('circle', rec.a.clone(), rec.b.clone(), st2);
      const nr = annStore[annStore.length - 1];
      if (gid != null) nr.groupId = gid;
    };
    mkArc(rr.a0, lo); mkArc(hi, rr.a1);
    trimEnd();
    recordHistory();
    if (window.__toast) window.__toast(lo - rr.a0 < MIN && rr.a1 - hi < MIN ? '円弧を削除しました' : '円弧を部分削除しました');
  }
  // タップの横取り（詳細図の枠モードと同じ流儀：モード中だけ window capture で受ける）
  let _trimDown = null;
  window.addEventListener('pointermove', e => {
    if (!trimState) return;
    trimShowCursor(e.clientX, e.clientY);   // いつもの十字カーソル・吸着印・赤い予告
  }, true);
  window.addEventListener('pointerdown', e => {
    if (!trimState || e.button !== 0 || e.target !== renderer.domElement) return;
    e.stopImmediatePropagation(); e.preventDefault();
    _trimDown = { x: e.clientX, y: e.clientY };
  }, true);
  window.addEventListener('pointerup', e => {
    if (!trimState || !_trimDown) return;
    const d0 = _trimDown; _trimDown = null;
    e.stopImmediatePropagation(); e.preventDefault();
    if (Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 8) return;   // ドラッグは無視（タップのみ）
    trimTapAt(e.clientX, e.clientY);
  }, true);
  window.__trimActive = () => !!trimState;
  window.__trimEnd = () => { if (trimState) trimEnd(); };
  window.__trimStart = () => trimStart();
  { const b = document.getElementById('cmdTrim'); if (b) b.onclick = () => trimStart(); }

  // 部品選択時などの線選択全解除。lineSel も必ず消す（残っているとパイプ端クリックを
  // 寸法線の起点掴みが横取りする等の事故源になる・2026-06-13 修正）
  window.__annClearSel = () => {
    if (selAnns.size || lineSel) {
      lineSel = null; clearLineHandles(); clearGrip();
      selAnns.clear(); clearAnnHi(); refreshHandles();
      if (typeof updateForm === 'function') updateForm();
    }
  };
  // ---- 表示／非表示（注釈側） ----
  // 「非表示」実行待ちでタップされた注釈を隠す（グループの一員なら同グループの注釈・部品も一緒に）
  function hideAnnRec(rec) {
    const gid = rec.groupId;
    const list = gid != null ? annStore.filter(r => r.groupId === gid && !r.hidden) : [rec];
    for (const r of list) { r.hidden = true; r.obj.visible = false; selAnns.delete(r); if (lineSel === r) { lineSel = null; clearLineHandles(); } }
    let n = list.length;
    if (gid != null && typeof hidePartOnly === 'function')
      for (const p of placedParts) if (p.userData.groupId === gid && !p.userData.hidden) { hidePartOnly(p); n++; }
    if (list.some(r => r.type === 'xline' || r.type === 'line')) updateXlinePts();
    clearAnnHi(); refreshHandles();
    if (typeof updateForm === 'function') updateForm();
    if (typeof refreshItemList === 'function') refreshItemList();
    if (window.__toast) window.__toast('非表示：' + n + '件を隠しました（「再表示」で戻せます）');
  }
  // 選択中の注釈を隠して選択解除。返り値＝隠した件数（部品側 hideSelectedObjects から呼ばれる）
  window.__annHideSel = () => {
    if (!selAnns.size) return 0;
    const list = [...selAnns];
    for (const r of list) { r.hidden = true; r.obj.visible = false; }
    deselectLine();                                        // ハイライト・ハンドル・値フォームも消す
    if (list.some(r => r.type === 'xline' || r.type === 'line')) updateXlinePts();
    return list.length;
  };
  // 指定グループの注釈を隠す（部品タップからのグループ非表示用）。返り値＝隠した件数
  window.__annHideGroup = (gid) => {
    let n = 0, hadX = false;
    for (const r of annStore) if (r.groupId === gid && !r.hidden) {
      r.hidden = true; r.obj.visible = false; selAnns.delete(r);
      if (lineSel === r) { lineSel = null; clearLineHandles(); }
      if (r.type === 'xline' || r.type === 'line') hadX = true;
      n++;
    }
    if (n) { if (hadX) updateXlinePts(); clearAnnHi(); refreshHandles(); }
    return n;
  };
  // 非表示の注釈をすべて再表示。返り値＝戻した件数
  window.__annShowAll = () => {
    let n = 0, hadX = false;
    for (const r of annStore) if (r.hidden) { r.hidden = false; r.obj.visible = true; if (r.type === 'xline' || r.type === 'line') hadX = true; n++; }
    if (hadX) updateXlinePts();
    return n;
  };
  window.__annXlineObjs = () => annStore.filter(r => r.type === 'xline' && !r.hidden && r.obj).map(r => r.obj);   // 印刷で構築線だけ色を変える
  window.__annXptsRefresh = updateXlinePts;   // ファイル読込で構築線を隠した時の交点更新用
  // 直近に作った注釈を選択（e2e検証用）
  window.__annSelectLast = () => { const r = annStore[annStore.length - 1]; if (r) selectLine(r); return !!r; };
  // 直近に作った注釈の内容（読み取り専用・e2e検証用）
  window.__annLast = () => {
    const r = annStore[annStore.length - 1]; if (!r) return null;
    return { type: r.type, kind: (r.style && r.style.dimKind) || null, style: JSON.parse(JSON.stringify(r.style || {})),
             a: [r.a.x, r.a.y, r.a.z], b: [r.b.x, r.b.y, r.b.z],
             measured: r.type === 'dim' ? dimMeasuredStr(r.a, r.b, r.style) : null };
  };
  // 線分をプログラムから追加（配管化などのe2e検証用。a/b=[x,y,z]・単位m）
  window.__annAddLine = (a, b) => { addAnnotation('line', new V3(a[0], a[1], a[2]), new V3(b[0], b[1], b[2]), null); return annStore.length - 1; };
  window.__annAddDim = (a, b, st) => { addAnnotation('dim', new V3(a[0], a[1], a[2]), new V3(b[0], b[1], b[2]), Object.assign({}, styleFor('dim'), st || {})); return annStore[annStore.length - 1]; };   // e2e検証用
  window.__annStoreForTest = () => annStore;   // e2e検証用
  // ---- プロパティパネル用（単一選択の注釈の値の取得・適用。2026-07-18 社長要望） ----
  window.__annPropsGet = () => {
    if (selAnns.size !== 1 || !lineSel) return null;
    const r = lineSel, st = r.style || {};
    const o = { type: r.type, kind: st.dimKind || null, a: [r.a.x, r.a.y, r.a.z], b: [r.b.x, r.b.y, r.b.z] };
    if (r.type === 'line' || r.type === 'xline') o.len = r.a.distanceTo(r.b);
    if (r.type === 'circle') {
      const cr = circleRadii(st, r.a, r.b); o.rx = cr.rx; o.rz = cr.rz;
      const nq = new V3(0, 1, 0).applyQuaternion(quatFromStyle(st));   // 円の面の法線
      if (Math.hypot(nq.x, nq.z) < 1e-3) o.cAz = 0;
      else { let dg = Math.atan2(nq.x, -nq.z) * 180 / Math.PI; if (dg < 0) dg += 360; o.cAz = Math.round(dg * 10) / 10; }
      o.cEl = Math.round(Math.asin(Math.max(-1, Math.min(1, nq.y))) * 180 / Math.PI * 10) / 10;
    }
    if (r.type === 'dim' && st.dimKind !== 'text') {
      o.dimOff = st.dimOff || 0; o.dimSkew = st.dimSkew || 0;
      o.dimText = st.dimText || ''; o.meas = dimMeasuredStr(r.a, r.b, st);
      const k = st.dimKind || 'parallel';
      if (k !== 'angle' && k !== 'leader') {   // 実測値（mm・編集可）：長さ/リニアは軸直交成分、他は2点間距離
        if (st.dimFixDir && st.dimDir) {
          const dn = new V3(st.dimDir.x, st.dimDir.y, st.dimDir.z);
          if (dn.lengthSq() > 1e-9) { dn.normalize(); const ab = r.b.clone().sub(r.a); o.measMm = Math.round(ab.addScaledVector(dn, -ab.dot(dn)).length() * 10000) / 10; }
        }
        if (o.measMm == null) o.measMm = Math.round(r.a.distanceTo(r.b) * 10000) / 10;
      }
    }
    if (st.dimKind === 'text') { o.text = st.dimText || ''; o.textRot = st.textRot || 0; }
    return o;
  };
  window.__annPropsSet = (patch) => {
    if (selAnns.size !== 1 || !lineSel) return;
    const r = lineSel; r.style = r.style || {};
    if (patch.a) r.a.set(patch.a[0], patch.a[1], patch.a[2]);
    if (patch.b) r.b.set(patch.b[0], patch.b[1], patch.b[2]);
    if (patch.len != null && r.type === 'line') {          // 長さ変更＝a端固定で軸方向を保って伸縮
      const d = r.b.clone().sub(r.a), L = d.length();
      if (L > 1e-9 && patch.len > 0) r.b.copy(r.a).addScaledVector(d.multiplyScalar(1 / L), patch.len);
    }
    if (r.type === 'circle' && (patch.rx != null || patch.rz != null)) {
      if (patch.rx != null) r.style.rx = Math.max(0.001, patch.rx);
      if (patch.rz != null) r.style.rz = Math.max(0.001, patch.rz);
      const ax = new V3(1, 0, 0).applyQuaternion(quatFromStyle(r.style));   // bは+X四半円点に正規化（移動グリップ用）
      r.b.copy(r.a).addScaledVector(ax, r.style.rx != null ? r.style.rx : 0.01);
    }
    if (r.type === 'circle' && (patch.cAz != null || patch.cEl != null)) {
      // 円の面の向き（方位角＝北0°時計回り／立面角90°=水平置き）を法線の回転で設定
      const q0 = quatFromStyle(r.style);
      const n = new V3(0, 1, 0).applyQuaternion(q0);
      let rot = null;
      if (patch.cAz != null) {
        if (Math.hypot(n.x, n.z) >= 1e-3) {
          let az0 = Math.atan2(n.x, -n.z) * 180 / Math.PI; if (az0 < 0) az0 += 360;
          rot = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), (az0 - patch.cAz) * Math.PI / 180);
        }
      } else {
        const phi0 = Math.asin(Math.max(-1, Math.min(1, n.y)));
        const t = Math.max(-90, Math.min(90, patch.cEl)) * Math.PI / 180;
        let axis = new V3(0, 1, 0).cross(n);
        if (axis.lengthSq() < 1e-9) axis = new V3(1, 0, 0).applyQuaternion(q0);
        axis.normalize();
        rot = new THREE.Quaternion().setFromAxisAngle(axis, phi0 - t);
      }
      if (rot) {
        const cq = rot.multiply(q0);
        r.style.quat = { x: cq.x, y: cq.y, z: cq.z, w: cq.w };
        const ax = new V3(1, 0, 0).applyQuaternion(cq);
        r.b.copy(r.a).addScaledVector(ax, circleRadii(r.style, r.a, r.b).rx);
      }
    }
    if (patch.meas != null && r.type === 'dim') setDimMeasured(r, patch.meas);   // 実測値の変更＝測定点bを動かす（上書きは別行で管理＝そのまま）
    if (patch.dimOff != null) r.style.dimOff = patch.dimOff;
    if (patch.dimSkew != null) r.style.dimSkew = patch.dimSkew;
    if (patch.dimText !== undefined) r.style.dimText = (patch.dimText === '' || patch.dimText === dimMeasuredStr(r.a, r.b, r.style)) ? null : patch.dimText;
    if (patch.text !== undefined) r.style.dimText = patch.text === '' ? null : patch.text;
    if (patch.textRot != null) r.style.textRot = patch.textRot;
    rebuildAnn(r);
    if (r.type === 'xline') updateXlinePts();
    refreshAnnHi(); refreshHandles();
    if (typeof updateForm === 'function') updateForm();
  };
  // Ctrl+クリック：カーソル下の線を選択へ出し入れ（部品の個別トグルと同じ感覚）。線が無ければ false
  window.__annToggleAt = (cx, cy) => {
    const rec = pickAnnAt(cx, cy);
    if (!rec) return false;
    if (typeof hideArmed !== 'undefined' && hideArmed) { setHideArmed(false); hideAnnRec(rec); return true; }   // 「非表示」実行待ち＝隠す
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
    if ([...selAnns].some(r => r.type === 'xline')) updateXlinePts();   // 構築線を回したら交点を引き直す
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
    let pivot = (typeof selPivot !== 'undefined' && selPivot) ? selPivot.clone()
              : (selAnns.size > 1 && window.__annSelCenter ? window.__annSelCenter() : null)
              || dimRotPivot() || gripPt() || (lineSel ? lineSel.a : null);
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
    _rotSpin = { pivot: pivot.clone(), axis, snap: [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone(), quat: r.type === 'circle' ? quatFromStyle(r.style) : null, ap: (r.style && r.style.angP2) ? r.style.angP2.slice() : null, fd: (r.style && r.style.dimFixDir) ? { ...r.style.dimFixDir } : null, fp: (r.style && r.style.dimFixPt) ? { ...r.style.dimFixPt } : null })) };
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
        // 長さ寸法は寸法線を固定向き・固定基準に保つので、それも一緒に回す（2026-08-02 社長「複数選択の回転が正しくない」）
        if (s.fd) { const d2 = new V3(s.fd.x, s.fd.y, s.fd.z).applyQuaternion(q); s.r.style.dimFixDir = { x: d2.x, y: d2.y, z: d2.z }; }
        if (s.fp) { const f2 = new V3(s.fp.x, s.fp.y, s.fp.z).sub(_rotSpin.pivot).applyQuaternion(q).add(_rotSpin.pivot); s.r.style.dimFixPt = { x: f2.x, y: f2.y, z: f2.z }; }
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
    for (const s of _rotSpin.snap) { s.r.a.copy(s.a); s.r.b.copy(s.b); if (s.r.type === 'circle' && s.quat) s.r.style.quat = { x: s.quat.x, y: s.quat.y, z: s.quat.z, w: s.quat.w }; if (s.ap) s.r.style.angP2 = s.ap.slice(); if (s.fd) s.r.style.dimFixDir = { ...s.fd }; if (s.fp) s.r.style.dimFixPt = { ...s.fp }; rebuildAnn(s.r); }
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
  // ---- 実測値の変更（2026-07-19 社長要望）＝測定点を動かして実際の距離を入力値に合わせる ----
  // a（1点目）は固定し、b（2点目）を動かす。角度・引出・文字は対象外（falseを返す）。rebuildは呼び出し側で。
  function setDimMeasured(rec, mm) {
    const L = mm / 1000;
    if (!(L > 0) || rec.type !== 'dim') return false;
    const st = rec.style || {}, kind = st.dimKind || 'parallel';
    if (kind === 'angle' || kind === 'leader' || kind === 'text') return false;
    const ab = rec.b.clone().sub(rec.a);
    if (kind === 'diameter') {                    // 中心を保って両端をφ=Lへ
      const C = rec.a.clone().add(rec.b).multiplyScalar(0.5);
      const l = ab.length(); if (l < 1e-9) return false;
      const u = ab.multiplyScalar(1 / l);
      rec.a.copy(C).addScaledVector(u, -L / 2);
      rec.b.copy(C).addScaledVector(u, L / 2);
      return true;
    }
    if (st.dimFixDir && st.dimDir) {              // 長さ寸法・リニア寸法＝逃げ方向に垂直な成分だけをLへ（逃げ方向成分は保持）
      const dn = new V3(st.dimDir.x, st.dimDir.y, st.dimDir.z);
      if (dn.lengthSq() < 1e-9) return false;
      dn.normalize();
      const t = ab.dot(dn);
      const perp = ab.clone().addScaledVector(dn, -t);
      const pl = perp.length(); if (pl < 1e-9) return false;
      rec.b.copy(rec.a).addScaledVector(perp.multiplyScalar(1 / pl), L).addScaledVector(dn, t);
      return true;
    }
    const l = ab.length(); if (l < 1e-9) return false;   // 平行・半径＝bを同方向でLへ
    rec.b.copy(rec.a).addScaledVector(ab.multiplyScalar(1 / l), L);
    return true;
  }
  const DIM_MEAS_RE = /^[0-9]+(\.[0-9]+)?$/;      // 実測値として受ける入力＝正の数値のみ（それ以外は上書き文字）
  // ---- 寸法の「値」上書き（任意の値）。単独選択中の寸法線に対して hForm（値欄）で入力 ----
  window.__dimValueSel = () => (selAnns.size === 1 && lineSel && lineSel.type === 'dim') ? lineSel : null;
  window.__dimValueGet = () => {
    const r = window.__dimValueSel(); if (!r) return '';
    return (r.style.dimText != null && r.style.dimText !== '') ? r.style.dimText : dimMeasuredStr(r.a, r.b, r.style);
  };
  window.__dimValueApply = (v) => {
    const r = window.__dimValueSel(); if (!r) return;
    const s = String(v).trim();
    // モデル空間での数値入力＝実測値の変更（測定点を動かす・2026-07-19 社長要望）。数値以外＝従来の上書き文字
    if (DIM_MEAS_RE.test(s) && setDimMeasured(r, parseFloat(s))) {
      r.style.dimText = null;                                // 実測を変えたら上書きは解除（実測がそのまま表示される）
      rebuildAnn(r); refreshAnnHi(); refreshHandles();
      if (typeof updateForm === 'function') updateForm();
      return;
    }
    const meas = dimMeasuredStr(r.a, r.b, r.style);
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
  // 見た目は他の入力フォーム（高さ・角度・脚）と同じにする。色や角丸は index.html の共通指定に任せ、
  // ここでは位置と幅だけを持たせる（2026-07-27 社長要望：入力フォームの色がバラバラ）
  dimValForm.className = 'valForm';
  dimValForm.style.cssText = 'position:fixed;z-index:70;display:none;';
  const dimValLabel = document.createElement('span');
  dimValLabel.textContent = '値';
  dimValForm.appendChild(dimValLabel);
  const dimValInput = document.createElement('input');
  dimValInput.type = 'text';
  dimValInput.className = 'val-input';
  dimValInput.style.width = '96px';
  dimValForm.appendChild(dimValInput);
  document.body.appendChild(dimValForm);
  const applyDimVal = (commit) => {
    const r = window.__dimValueSel(); if (!r) return;
    const s = dimValInput.value.trim();
    // モデル空間での数値入力＝実測値の変更（測定点bを動かす・2026-07-19 社長要望）。
    // 入力途中（1→15→150…）で測定点が飛ばないよう、確定（Enter/フォーカス外し）時だけ適用する。
    const st = r.style || {}, kind = st.dimKind || 'parallel';
    const measurable = !(kind === 'angle' || kind === 'leader' || kind === 'text');
    if (measurable && DIM_MEAS_RE.test(s)) {
      if (commit && setDimMeasured(r, parseFloat(s))) {
        r.style.dimText = null;                              // 実測を変えたら上書きは解除
        rebuildAnn(r); refreshAnnHi(); refreshHandles();
        if (typeof updateForm === 'function') updateForm();
      }
      return;                                                // 数値＝入力途中はまだ触らない
    }
    const meas = dimMeasuredStr(r.a, r.b, r.style);
    r.style.dimText = (s !== '' && s !== meas) ? s : null;   // 数値以外＝従来の上書き（空欄 or 実測と同じ＝解除）
    rebuildAnn(r); refreshAnnHi();
  };
  let dimValEsc = false;   // Esc＝取消（blurで確定させない）
  dimValInput.addEventListener('input', () => applyDimVal(false));
  dimValInput.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); applyDimVal(true); dimValInput.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); dimValEsc = true; dimValInput.blur(); }
  });
  dimValInput.addEventListener('blur', () => { if (!dimValEsc) applyDimVal(true); dimValEsc = false; dimValOpen = false; });   // 確定＆編集終了（Esc＝取消。以後はDelで削除可）
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
  // 空間をタップして文字・引出を置いた直後に、そのまま打てるようにする（2026-07-27 社長要望）。
  // 要点は2つ：
  //  ・iOSは「ユーザー操作と同じ処理の中」でfocusしないとキーボードが出ない
  //    （以前は setTimeout(30) を挟んでいたため、入力欄をもう一度タップするまで出なかった）
  //  ・かといって pointerdown の最中にfocusしても、直後の既定動作でcanvasへフォーカスが移り、
  //    入力欄がblurされてしまう（blurハンドラが値フォームを閉じるので何も残らない）
  // → 指を離した時（pointerup）にフォーカスする。pointerupもユーザー操作なのでキーボードは出る。
  window.__focusDimValueInput = () => {
    dimValOpen = true;                       // 押した瞬間から値フォームは出しておく
    const onUp = () => {
      window.removeEventListener('pointerup', onUp);
      dimValOpen = true;                     // 間に選択処理が走っても閉じない
      if (window.__positionDimValueForm) window.__positionDimValueForm();
      if (dimValForm.style.display !== 'none') focusSelectAll(dimValInput);
    };
    window.addEventListener('pointerup', onUp);
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
  window.__annMoveStart = () => { annMoveSnap = [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone(), ap: (r.style && r.style.angP2) ? r.style.angP2.slice() : null, fp: (r.style && r.style.dimFixPt) ? { ...r.style.dimFixPt } : null })); };
  window.__annMoveApply = (dx, dy, dz) => {
    if (!annMoveSnap) return;
    for (const s of annMoveSnap) { s.r.a.set(s.a.x + dx, s.a.y + dy, s.a.z + dz); s.r.b.set(s.b.x + dx, s.b.y + dy, s.b.z + dz); if (s.ap) s.r.style.angP2 = [s.ap[0] + dx, s.ap[1] + dy, s.ap[2] + dz]; if (s.fp) s.r.style.dimFixPt = { x: s.fp.x + dx, y: s.fp.y + dy, z: s.fp.z + dz };   // 長さ寸法の固定基準も一緒に動かす（2026-08-02 社長「寸法の移動が上手く機能しない」）
      rebuildAnn(s.r); }
    refreshAnnHi();
    refreshHandles();   // 全選択線の端点ハンドルを現在位置へ（窓選択で lineSel 無しでも置き去りにしない）
  };
  window.__annMoveEnd = () => { annMoveSnap = null; };
  // ---- 選択中の線・寸法を、起点(pivot)まわりに q だけ回す（複数選択の方位角/立面角/回転。2026-08-02 社長指示） ----
  // 部品と一緒に回さないと、寸法だけ置き去りになる。線・寸法の「向きを持つ値」も同じ回転を掛ける。
  const annRotRec = (r, s, pivot, q) => {
    const pt = (v) => pivot.clone().add(v.clone().sub(pivot).applyQuaternion(q));
    const dir = (v) => v.clone().applyQuaternion(q);
    r.a.copy(pt(s.a)); r.b.copy(pt(s.b));
    if (s.ap) { const p = pt(new V3(s.ap[0], s.ap[1], s.ap[2])); r.style.angP2 = [p.x, p.y, p.z]; }
    if (s.dd) { const d = dir(new V3(s.dd.x, s.dd.y, s.dd.z)); r.style.dimDir = { x: d.x, y: d.y, z: d.z }; }
    if (s.fd) { const d = dir(new V3(s.fd.x, s.fd.y, s.fd.z)); r.style.dimFixDir = { x: d.x, y: d.y, z: d.z }; }
    if (s.fp) { const p = pt(new V3(s.fp.x, s.fp.y, s.fp.z)); r.style.dimFixPt = { x: p.x, y: p.y, z: p.z }; }
    rebuildAnn(r);
  };
  const annSnapOf = (r) => ({ r, a: r.a.clone(), b: r.b.clone(),
    ap: (r.style && r.style.angP2) ? r.style.angP2.slice() : null,
    dd: (r.style && r.style.dimDir) ? { ...r.style.dimDir } : null,
    fd: (r.style && r.style.dimFixDir) ? { ...r.style.dimFixDir } : null,
    fp: (r.style && r.style.dimFixPt) ? { ...r.style.dimFixPt } : null });
  window.__annRotateSelBy = (pivot, q) => {          // 45°送り＝今の姿勢から1回だけ回す
    if (!selAnns.size) return;
    for (const r of selAnns) annRotRec(r, annSnapOf(r), pivot, q);
    refreshAnnHi(); refreshHandles();
  };
  let annRotSnap = null;                              // スピナー＝押した時の姿勢から絶対角で回す
  window.__annRotSpinStart = () => { if (!selAnns.size) return false; annRotSnap = [...selAnns].map(annSnapOf); return true; };
  window.__annRotSpinApply = (pivot, q) => {
    if (!annRotSnap) return;
    for (const s of annRotSnap) annRotRec(s.r, s, pivot, q);
    refreshAnnHi(); refreshHandles();
  };
  window.__annRotSpinEnd = () => { annRotSnap = null; };
  window.__annRotSpinCancel = () => {
    if (!annRotSnap) return;
    const idq = new THREE.Quaternion();
    for (const s of annRotSnap) annRotRec(s.r, s, new V3(), idq);
    refreshAnnHi(); refreshHandles(); annRotSnap = null;
  };
  // 選択中の線をまとめて (dx,dy,dz) だけ平行移動（高さ/EL一括変更で部品と一緒に動かす用）
  window.__annShiftSelected = (dx, dy, dz) => {
    if (!selAnns.size) return;
    for (const r of selAnns) { r.a.set(r.a.x + dx, r.a.y + dy, r.a.z + dz); r.b.set(r.b.x + dx, r.b.y + dy, r.b.z + dz); if (r.style && r.style.angP2) r.style.angP2 = [r.style.angP2[0] + dx, r.style.angP2[1] + dy, r.style.angP2[2] + dz]; if (r.style && r.style.dimFixPt) r.style.dimFixPt = { x: r.style.dimFixPt.x + dx, y: r.style.dimFixPt.y + dy, z: r.style.dimFixPt.z + dz }; rebuildAnn(r); }
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
    let bestX = null, bestXD = ANN_PICK_PX;   // 構築線は別枠＝範囲内に線分・寸法・円があればそちらを優先
    // （構築線の上に重ねて描いた線分が、浮動小数の距離差で選べないことがあった。2026-07-19 社長報告。
    //   構築線は無限長で必ずはみ出し部分から選べるため、重なりでは常に譲る＝CADの構築線と同じ扱い）
    const testSeg = (rec, seg, isExt) => {
      if (!seg) return;
      const d = segPixelDist(cx, cy, seg.pa.x, seg.pa.y, seg.pb.x, seg.pb.y);
      if (rec.type === 'xline') { if (d <= bestXD) { bestXD = d; bestX = rec; } return; }
      if (d <= bestD) { bestD = d; best = rec; bestExt = !!isExt; }
    };
    for (const rec of annStore) {
      if (rec.hidden) continue;                          // 非表示はクリックで拾わない
      if (rec.type === 'circle') {                       // 円/楕円：外周をクリックで選べるよう、周を多角形に分けて当てる（円弧は描画範囲だけ）
        const { rx, rz } = circleRadii(rec.style, rec.a, rec.b), q = quatFromStyle(rec.style);
        const rr = arcRange(rec.style);
        const N = 64; let prev = null;
        for (let i = 0; i <= N; i++) {
          const t = rr.a0 + ((rr.a1 - rr.a0) * i) / N;
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
    return best || bestX;   // 有限オブジェクト優先。無ければ構築線
  }
  window.__pickAnnAt = (cx, cy) => pickAnnAt(cx, cy);   // ortho解除判定用：その位置に線/寸法があるか
  // カーソル近傍の端点（0=a,1=b）。無ければ null。
  function endpointAt(rec, cx, cy, touch, thOverride) {
    if (rec.type === 'xline') return null;   // 構築線は端点伸縮しない（中心グリップで全体移動のみ）
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    const scr = p => { const n = modelGroup.localToWorld(p.clone()).project(cam); return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height, z: n.z }; };
    const sa = scr(rec.a), sb = scr(rec.b), TH = (thOverride != null) ? thOverride : SNAP_PX + (touch ? 22 : 6);   // タッチは指が太いので端点掴みを広げる（外して視点が回るのを防ぐ）。thOverrideでこの幅を絞れる
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
  // 近接スナップの核：線分・構築線の「線上」でカーソルに最も近い点（モデルローカル）を返す。
  // レイと線の3D最近接点＝画面の見た目どおりに吸着。excludeFn(r)=true のレコードは対象外
  function nearestOnLine(cx, cy, maxPx, excludeFn) {
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    pickNdc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    pickNdc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    pickRay.setFromCamera(pickNdc, cam);
    const O = modelGroup.worldToLocal(pickRay.ray.origin.clone());
    const D = modelGroup.worldToLocal(pickRay.ray.origin.clone().add(pickRay.ray.direction)).sub(O);
    const aa = D.dot(D);
    let best = null, bestD = maxPx;
    for (const r of annStore) {
      if ((r.type !== 'line' && r.type !== 'xline') || r.hidden) continue;
      if (excludeFn && excludeFn(r)) continue;
      const u = r.b.clone().sub(r.a); const L = u.length();
      if (L < 1e-9) continue;
      u.multiplyScalar(1 / L);
      const w0 = O.clone().sub(r.a);
      const b = D.dot(u), d = D.dot(w0), e = u.dot(w0);
      const denom = aa - b * b;
      if (Math.abs(denom) < 1e-9) continue;                 // 視線と平行＝決められない
      let t = (aa * e - b * d) / denom;                     // 線上の媒介変数（aからの距離）
      t = r.type === 'xline' ? Math.max(-12, Math.min(12, t)) : Math.max(0, Math.min(L, t));
      const P = r.a.clone().addScaledVector(u, t);
      const n = modelGroup.localToWorld(P.clone()).project(cam);
      if (n.z >= 1) continue;
      const sx = rect.left + (n.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-n.y * 0.5 + 0.5) * rect.height;
      const dist = Math.hypot(sx - cx, sy - cy);
      if (dist < bestD) { bestD = dist; best = P; }
    }
    return best;
  }
  window.__annNearestOnLine = (cx, cy, maxPx) => nearestOnLine(cx, cy, maxPx, r => r === drawState.editRec || (annMoveSnap && selAnns.has(r)));
  // 直角スナップ：作図中の起点 from から各線への「垂線の足」。カーソルがその近く(maxPx)なら
  // 一般の線上吸着より優先して吸着＝線分が相手の線とぴったり直角で繋がる（2026-07-19 社長指摘）
  function nearestPerpFoot(from, cx, cy, maxPx, excludeFn) {
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    let best = null, bestD = maxPx;
    for (const r of annStore) {
      if ((r.type !== 'line' && r.type !== 'xline') || r.hidden) continue;
      if (excludeFn && excludeFn(r)) continue;
      const u = r.b.clone().sub(r.a); const L = u.length();
      if (L < 1e-9) continue;
      u.multiplyScalar(1 / L);
      let t = from.clone().sub(r.a).dot(u);              // from からの垂線の足（線上パラメータ）
      // 起点がこの線の上（1.5mm以内）に乗っている場合は対象外＝足が起点自身になり、2点目が起点へ
      // 張り付いてゼロ長で線が作れなくなる（構築線上から引き始める時の「線分が引けない」の修正）
      if (r.a.clone().addScaledVector(u, t).distanceTo(from) < 0.0015) continue;
      t = r.type === 'xline' ? Math.max(-12, Math.min(12, t)) : Math.max(0, Math.min(L, t));
      const P = r.a.clone().addScaledVector(u, t);
      const n = modelGroup.localToWorld(P.clone()).project(cam);
      if (n.z >= 1) continue;
      const sx = rect.left + (n.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-n.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < bestD) { bestD = d; best = P; }
    }
    return best;
  }
  // 掴んだ画面位置と起点の画面オフセット（差分移動用）。部品の moveGrabOff と同じ考え方＝
  // 起点から離れた所を掴んでも飛ばず、スナップは「起点が来るべき位置」で判定される（起点基準スナップ）
  function grabOffsetFor(origin, cx, cy) {
    const rect = renderer.domElement.getBoundingClientRect();
    const n = modelGroup.localToWorld(origin.clone()).project(activeCam());
    if (n.z >= 1) return { x: 0, y: 0 };
    return { x: cx - (rect.left + (n.x * 0.5 + 0.5) * rect.width), y: cy - (rect.top + (-n.y * 0.5 + 0.5) * rect.height) };
  }
  function moveSnapForGrip(cx, cy, exParts, exAnns) {
    if (!snapOn) return null;                           // 設定でスナップOFF＝吸着しない
    const rect = renderer.domElement.getBoundingClientRect(), cam = activeCam();
    let best = null, bestD = SNAP_PX;
    const test = mpos => {
      const ndc = modelGroup.localToWorld(mpos.clone()).project(cam);
      if (ndc.z >= 1) return;
      const sx = rect.left + (ndc.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < bestD) { bestD = d; best = mpos.clone(); }
    };
    for (const p of placedParts) { if (exParts.has(p) || !p.userData.faceLocal || p.userData.hidden) continue; for (const local of snapLocalsOf(p)) test(connModelPos(p, local)); }
    if (showOriginPts) for (const r of annStore) { if (exAnns.has(r) || r.hidden) continue; for (const sp of annSnapPoints(r)) test(sp); }   // 線分=端点+中点／円=中心+四半円点（構築線は交点のみ）。設定「起点」でOFF可
    if (showXpts) for (const pt of xlinePts) test(pt);   // 線どうしの交点へも吸着（設定でOFF可）
    if (!best && nearSnapOn) best = nearestOnLine(cx, cy, NEAR_SNAP_PX, r => exAnns.has(r) || r === drawState.editRec || (annMoveSnap && selAnns.has(r)));   // 近接＝線上へ
    return best;
  }
  // 移動中の起点(橙)と、スナップで近づいた点だけを表示（2026-07-20 社長：候補点の常時表示は廃止）
  function showLineMoveMarkers(gripPt, exParts, exAnns, snapPoint) {
    clearMarkers();
    addMarker(gripPt, 0xff8a3c, markerRadiusFor(null, false));
    if (snapPoint) addSnapMarker(snapPoint, markerRadiusFor(null, true));   // 吸着点＝緑（四半円点=赤◇・ボルト穴=赤＋・交点=黄）
  }
  let _lnLastT = 0, _lnLastX = 0, _lnLastY = 0, _lnLastRec = null;   // ダブルクリック検出（自由移動）
  let _lnEmptyDown = null;   // 空きスペース押下位置＝クリック（動かさず離す）でのみ線選択を解除する用
  window.addEventListener('pointerdown', e => {
    if (drawActive() || e.button !== 0) return;
    if (drawState.dimReadjust && e.target === renderer.domElement) {   // 再調整中のクリック＝確定（このクリックは消費）
      drawState.dimReadjust = null; clearLineGuide();
      e.stopImmediatePropagation(); return;
    }
    if (followTool || movingPart) return;                // 部品の配置/移動中は線分操作を横取りしない（スナップ先の線を掴んで配置を止める不具合対策）
    if (e.target !== renderer.domElement) return;        // 脚入力などUIは通す
    const ctrlish = e.ctrlKey || e.metaKey || touchCtrl;
    if (annPlaceMode) return;                            // 複製した線を置いている最中＝掴み直さない
    if (ctrlish && !moveMode) return;                    // Ctrl＝部品の複数選択へ委ねる
    const rect = renderer.domElement.getBoundingClientRect();
    if (inGizmo(e.clientX - rect.left, e.clientY - rect.top)) return;
    if (ctrlish) {   // 「移動」コマンド中のCtrl＝選択済みの線の本体を掴んだ時だけ、Ctrlのまま集団移動（2026-07-19 社長要望）
      const selForGrip = (selectedParts && selectedParts.size) ? [...selectedParts] : [];
      for (const sp of selForGrip) {                     // 選択部品の機点近く＝部品移動を優先（部品ハンドラへ譲る）
        if (sp.userData && sp.userData.faceLocal && nearestConnLocal(sp, e.clientX, e.clientY)) return;
      }
      const rec = pickAnnAt(e.clientX, e.clientY);
      if (!rec || !selAnns.has(rec)) return;             // それ以外＝従来のCtrlトグル/窓選択へ
      const info = nearestEndpointInfo(rec, e.clientX, e.clientY);
      const origin = info.pt.clone();
      lineDrag = { mode: 'sel', free: false, noMove: !moveMode, origin, planeY: origin.y, gRec: rec, gEnd: info.end, nearEnd: info.near,
                   grabOff: grabOffsetFor(origin, e.clientX, e.clientY),
                   startHit: planeHitAt(e.clientX, e.clientY, origin.y) || origin.clone(),
                   downX: e.clientX, downY: e.clientY, moved: false,
                   annSnap: [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone(), ap: (r.style && r.style.angP2) ? r.style.angP2.slice() : null, fp: (r.style && r.style.dimFixPt) ? { ...r.style.dimFixPt } : null })),
                   partSnap: window.__partSelSnapshot ? window.__partSelSnapshot() : [] };
      e.stopImmediatePropagation(); return;
    }
    if (drawState.editRec) clearDrawTemp();              // 直前の確定待ち編集を終える
    // 重なり時のアイテム起点優先：選択中アイテムの機点(起点候補)の近くを掴もうとした時は、線分より部品を優先（部品ハンドラに譲る）
    {
      const selForGrip = (selectedParts && selectedParts.size) ? [...selectedParts] : (selectedPart ? [selectedPart] : []);
      for (const sp of selForGrip) {
        if (sp.userData && sp.userData.faceLocal && nearestConnLocal(sp, e.clientX, e.clientY)) return;
      }
    }
    // 寸法の値（赤文字）・文字をクリック：シングル＝選択（文字はドラッグ移動／寸法は本体クリックと同じ逃げ調整）、
    // ダブルクリック＝値・文字の編集フォーム（2026-07-18 社長要望：寸法の値の編集もダブルクリックに統一）
    {
      let recT = pickDimTextAt(e.clientX, e.clientY);
      // 選択済みの引出し線は、文字より端点（肘・矢の先）を優先する。
      // 引出しの文字は肘のすぐ横に出るため、文字の当たりが肘を覆い隠して
      // 「文字ありの引出しだけ肘が掴めない＝置いた後に動かせない」になっていた（2026-08-04 社長報告の真因）。
      if (recT && recT.style && recT.style.dimKind === 'leader' && lineSel === recT && selAnns.has(recT) &&
          endpointAt(recT, e.clientX, e.clientY, e.pointerType !== 'mouse') !== null) recT = null;   // 下の端点処理へ譲る
      if (recT) {
        const isDbl = (e.timeStamp - _lnLastT < 350) && Math.hypot(e.clientX - _lnLastX, e.clientY - _lnLastY) < 6 && _lnLastRec === recT;
        _lnLastT = e.timeStamp; _lnLastX = e.clientX; _lnLastY = e.clientY; _lnLastRec = recT;
        if (!selAnns.has(recT)) selectLine(recT);
        if (isDbl) {
          if (nudgeActive()) endRotSpin(true);             // 1回目のタップで開いた逃げスピナーは確定して閉じる
          drawState.dimReadjust = null; clearLineGuide();  // 半径/直径/角度の再調整中なら終える
          if (window.__openDimValueForm) window.__openDimValueForm(true);
          if (window.__focusDimValueInput) window.__focusDimValueInput();
        } else if (recT.style && recT.style.dimKind !== 'text' && recT.style.dimKind !== 'leader') {
          // 寸法の値ドラッグ＝値だけを動かす（本体ドラッグ＝逃げ調整・値ダブル＝編集。2026-07-18 社長承認の割当て）
          let spr = null; recT.obj.traverse(o => { if (!spr && o.userData.dimText) spr = o; });
          lineDrag = { mode: 'dimtext', rec: recT, spr, downX: e.clientX, downY: e.clientY, moved: false };
        } else {                                            // 文字・引出はシングル＝ドラッグで全体移動できるよう sel を仕込む
          const origin = recT.a.clone();
          lineDrag = { mode: 'sel', free: false, noMove: !moveMode, origin, planeY: origin.y, gRec: recT, gEnd: 0, nearEnd: false,
                       grabOff: grabOffsetFor(origin, e.clientX, e.clientY),
                       startHit: planeHitAt(e.clientX, e.clientY, origin.y) || origin.clone(),
                       downX: e.clientX, downY: e.clientY, moved: false,
                       annSnap: [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone(), ap: (r.style && r.style.angP2) ? r.style.angP2.slice() : null, fp: (r.style && r.style.dimFixPt) ? { ...r.style.dimFixPt } : null })),
                       partSnap: window.__partSelSnapshot ? window.__partSelSnapshot() : [] };
        }
        e.stopImmediatePropagation(); return;
      }
    }
    if (lineSel && selAnns.has(lineSel)) {               // 実際に選択中の線の端点を掴む → 長さ変更/付け替え
      if (lineSel.type === 'circle') {                   // 円：四半円点ハンドルを掴む → 半径変更（Shift＝その軸だけ＝楕円）
        // 円弧の端点（部分削除で開いた口）を先に判定 → 円周に沿って伸縮。届いたらつながって円に戻る
        const ae = arcEndHandleAt(lineSel, e.clientX, e.clientY);
        if (ae) {
          lineDrag = { mode: 'arcend', rec: lineSel, which: ae.which, theta: ae.theta, downX: e.clientX, downY: e.clientY, moved: false };
          e.stopImmediatePropagation(); return;
        }
        const h = circleHandleAt(lineSel, e.clientX, e.clientY);
        if (h) {
          lineDrag = { mode: 'circleaxis', rec: lineSel, axis: h.axis, dir: h.dir.clone(), downX: e.clientX, downY: e.clientY, moved: false };
          e.stopImmediatePropagation(); return;
        }
      } else {
        const end = endpointAt(lineSel, e.clientX, e.clientY, e.pointerType !== 'mouse');   // 端点(足の起点)は広いしきい値で掴める
        if (end !== null) {
          if (lineSel.type === 'dim') {                  // 寸法線：起点をつかんで測定点を自由に動かす（機点へスナップ）
            // 単独の平行寸法は、起点ドラッグ開始時に「リニア化」＝今の向き(dimFixDir)と基準点(dimFixPt)を固定。
            // 以後は測定点を自由に動かしても寸法線はこの向き(元の水平/垂直)を保ち、2点を結ぶ向きには傾かない。
            const s = lineSel.style;
            if (s && s.dimDir && selAnns.size === 1 && !s.dimFixDir) {
              const u = lineSel.b.clone().sub(lineSel.a); const ul = u.length();
              if (ul > 1e-6) {
                u.multiplyScalar(1 / ul);
                s.dimFixDir = { x: u.x, y: u.y, z: u.z };
                const m = lineSel.a.clone().add(lineSel.b).multiplyScalar(0.5);
                s.dimFixPt = { x: m.x, y: m.y, z: m.z };
              }
            }
            lineDrag = { mode: 'dimend', rec: lineSel, end, downX: e.clientX, downY: e.clientY, moved: false, free: false };
            // 引出し線は通常「水平／垂直に伸ばし縮み」。長押し(0.5秒)で自由移動へ（2026-08-03 社長指示）
            if (lineSel.style && lineSel.style.dimKind === 'leader') {
              clearTimeout(freeHoldTimer);
              freeHoldTimer = setTimeout(() => {
                // その場で押しっぱなしの時だけ自由移動へ。動かし始めていたら切り替えない
                // （スライドの途中で勝手に自由移動になってしまうため。2026-08-03 社長指摘）
                if (lineDrag && lineDrag.mode === 'dimend' && !lineDrag.moved) {
                  lineDrag.free = true;
                  if (window.__toast) window.__toast('引出し：自由移動');
                }
              }, 500);
            }
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
      const wasSelLn = selAnns.has(rec);
      if (!wasSelLn) selectLine(rec);                      // 未選択の線を掴んだ＝単独選択。既選択ならグループ維持
      // タッチ：未選択の線は1回目は「選択のみ」。触れただけで動かさない・視点も回さない（再ドラッグで移動）。
      if (e.pointerType !== 'mouse' && !wasSelLn) { e.stopImmediatePropagation(); return; }
      const info = nearestEndpointInfo(rec, e.clientX, e.clientY);   // 起点アンカー＋端の近くを押したか
      const origin = info.pt.clone();
      lineDrag = { mode: 'sel', free: isDbl, noMove: !moveMode, origin, planeY: origin.y, gRec: rec, gEnd: info.end, nearEnd: info.near,
                   grabOff: grabOffsetFor(origin, e.clientX, e.clientY),
                   startHit: planeHitAt(e.clientX, e.clientY, origin.y) || origin.clone(),
                   downX: e.clientX, downY: e.clientY, moved: false,
                   annSnap: [...selAnns].map(r => ({ r, a: r.a.clone(), b: r.b.clone(), ap: (r.style && r.style.angP2) ? r.style.angP2.slice() : null, fp: (r.style && r.style.dimFixPt) ? { ...r.style.dimFixPt } : null })),
                   partSnap: window.__partSelSnapshot ? window.__partSelSnapshot() : [] };
      if (info.near) { gRec = rec; gEnd = info.end; _vAxis = null; _tipAxis = null; _tipMode = false; refreshHandles(); if (typeof updateForm === 'function') updateForm(); }   // 端の近くを掴んだ＝起点を選択（大きく・ELを更新・鉛直軸再計算）
      e.stopImmediatePropagation(); return;
    }
    // 何もない所＝「クリック（動かさず離す）」の時だけ線選択を解除（2026-07-20 社長：部品と同じ挙動へ）。
    // 押した瞬間に解除するとドラッグ（視点操作のつもり）で選択が飛び、次のドラッグから空間が回ってしまう。
    if ((lineSel || selAnns.size) && !pickPlacedAt(e.clientX, e.clientY)) _lnEmptyDown = { x: e.clientX, y: e.clientY };
  }, true);
  window.addEventListener('pointermove', e => {
    if (drawActive() || !lineDrag) return;
    const moveTh = (e.pointerType !== 'mouse') ? 10 : 3;   // タッチは指ブレが大きいのでしきい値を上げる（タップで移動が始まらない＝タップは確実にスピナーへ）
    if (Math.hypot(e.clientX - lineDrag.downX, e.clientY - lineDrag.downY) > moveTh) lineDrag.moved = true;
    // 単独選択の平行寸法をドラッグ＝逃げ（足の長さ）だけ調整。向き(dimDir)＝元の平行は固定し、全体は動かさない。
    // 全体移動は Ctrl で複数選択した時（annSnap が2つ以上 or 部品を含む）だけ（社長指示：単独再選択のドラッグで全体が動くのを止める）。
    if (lineDrag.mode === 'sel') {
      const dRec = lineDrag.gRec;
      if (dRec && dRec.type === 'dim' && dRec.style && dRec.style.dimDir
          && lineDrag.annSnap.length === 1 && !lineDrag.partSnap.length) {
        if (lineDrag.moved) {   // タップ(moved前)では触らずスピナーに任せる。ドラッグ＝逃げ量(足の長さ)だけ更新
          // リニア化済みは固定基準(dimFixPt)から、未リニアは2点の中点から、逃げ方向へ投影して逃げ量を出す
          const ref = dRec.style.dimFixPt ? new V3(dRec.style.dimFixPt.x, dRec.style.dimFixPt.y, dRec.style.dimFixPt.z)
                                          : dRec.a.clone().add(dRec.b).multiplyScalar(0.5);
          const off = projectOffsetAlongDir(e.clientX, e.clientY, ref, dRec.style.dimDir);   // 逃げ方向(水平/垂直)は固定し長さだけ＝元の向きをキープ
          if (off != null) {
            // 他の寸法線の矢印（寸法線の両端）と揃う逃げ量が近ければ吸着＝寸法線どうしを一直線に並べられる
            const snap = dimOffArrowSnap(dRec, off);
            dRec.style.dimOff = snap ? snap.off : off;
            rebuildAnn(dRec); refreshAnnHi(); refreshHandles();
            clearMarkers();
            if (snap) addMarker(snap.pt, 0x39ff8a, markerRadiusFor(null, true));   // 吸着中＝相手の矢印を緑で強調
            if (typeof updateForm === 'function') updateForm();
          }
        }
        e.stopImmediatePropagation();   // 全体移動の処理へは進ませない
        return;
      }
    }
    if (lineDrag.mode === 'dimtext') {                   // 寸法の値ドラッグ＝値だけを動かす（画面基底＝どの構図でも安定）
      if (!lineDrag.moved || !lineDrag.spr) { e.stopImmediatePropagation(); return; }
      const rec = lineDrag.rec, dt = lineDrag.spr.userData.dimText;
      const rect2 = renderer.domElement.getBoundingClientRect(), cam2 = activeCam();
      const scr2 = p => { const n2 = modelGroup.localToWorld(p.clone()).project(cam2); return { x: rect2.left + (n2.x * 0.5 + 0.5) * rect2.width, y: rect2.top + (-n2.y * 0.5 + 0.5) * rect2.height }; };
      const mid = dt.a.clone().add(dt.b).multiplyScalar(0.5);
      const pa1 = scr2(dt.a), pb1 = scr2(dt.b), pm1 = scr2(mid);
      let ang2 = Math.atan2(-(pb1.y - pa1.y), pb1.x - pa1.x);
      if (ang2 > Math.PI / 2) ang2 -= Math.PI; else if (ang2 < -Math.PI / 2) ang2 += Math.PI;
      const ex = Math.cos(ang2), eyv = Math.sin(ang2);
      let px2 = -eyv, py2 = ex;                          // 直交（正＝逃げ側。表示側 __updateDimTextFacing と同じ基底）
      const pu1 = scr2(mid.clone().addScaledVector(dt.vUp, 0.01));
      if ((pu1.x - pm1.x) * px2 + (-(pu1.y - pm1.y)) * py2 < 0) { px2 = -px2; py2 = -py2; }
      const minv2 = new THREE.Matrix4().copy(modelGroup.matrixWorld).invert();
      const camUp2 = new V3().setFromMatrixColumn(cam2.matrixWorld, 1).transformDirection(minv2);
      const ph1 = scr2(mid.clone().addScaledVector(camUp2, dt.sh || dt.h));
      const pxPerM = Math.hypot(ph1.x - pm1.x, ph1.y - pm1.y) / (dt.sh || dt.h);
      if (!(pxPerM > 1e-6)) { e.stopImmediatePropagation(); return; }
      const k = dimTextScaleK(dt, mid) || 1;             // 保存はk=1基準＝ズーム・尺度を変えても見た目の位置関係を維持
      const dxs = e.clientX - pm1.x, dys = -(e.clientY - pm1.y);
      const tpx = dxs * ex + dys * eyv, npx = dxs * px2 + dys * py2;
      const hpx = dt.h * k * pxPerM;                     // 文字1個ぶんの画面高
      rec.style = rec.style || {};
      if (Math.abs(tpx) < hpx && Math.abs(npx) < hpx * 1.5) delete rec.style.textOff;   // 元の位置の近く＝既定位置へ戻す
      else rec.style.textOff = { t: Math.round((tpx / (k * pxPerM)) * 10000) / 10000, n: Math.round((npx / (k * pxPerM)) * 10000) / 10000 };
      rebuildAnn(rec); refreshAnnHi(); refreshHandles();
      if (window.__updateDimTextFacing) window.__updateDimTextFacing();   // 位置・向き・サイズを即時追従（次フレームを待たない）
      e.stopImmediatePropagation();
      return;
    }
    if (lineDrag.mode === 'arcend') {                    // 円弧の端点を円周に沿って伸縮（つないでも円には戻さない＝切断のまま・2026-07-30 社長指示）
      const rec = lineDrag.rec, st = rec.style, rr = arcRange(st);
      if (rr.full) return;
      let th = circleThetaAt(rec, e.clientX, e.clientY);
      if (th == null) return;
      lineDrag.moved = true;
      while (th - lineDrag.theta > Math.PI) th -= TAU;   // 連続化＝円周をぐるっと回って伸ばせる
      while (th - lineDrag.theta < -Math.PI) th += TAU;
      // 吸着：四半円点（0/90/180/270°）ともう片方の端点。画面12px以内なら角度をそろえる（2026-07-30 社長要望）
      let snapped = false;
      {
        const rect3 = renderer.domElement.getBoundingClientRect(), cam3 = activeCam();
        let bestPx = 12;
        // 候補＝四半円点・自分のもう片方の端・同じ円（同心・同半径）の他の円弧の端点（切断相手の端。2026-07-30 社長要望）
        const candList = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, lineDrag.which === 0 ? rr.a1 : rr.a0];
        {
          const { rx: rxs } = circleRadii(st, rec.a, rec.b);
          for (const r2 of annStore) {
            if (r2 === rec || r2.type !== 'circle' || r2.hidden || !r2.style || r2.style.arcA0 == null) continue;
            if (r2.a.distanceTo(rec.a) > 0.0008) continue;
            const { rx: rx2 } = circleRadii(r2.style, r2.a, r2.b);
            if (Math.abs(rx2 - rxs) > 0.0008) continue;
            candList.push(r2.style.arcA0, r2.style.arcA1);
          }
        }
        for (const cand0 of candList) {
          let cand = cand0;
          while (cand - th > Math.PI) cand -= TAU;
          while (cand - th < -Math.PI) cand += TAU;
          const n = modelGroup.localToWorld(circPt(rec, cand)).project(cam3);
          if (n.z >= 1) continue;
          const px = Math.hypot(rect3.left + (n.x * 0.5 + 0.5) * rect3.width - e.clientX,
                                rect3.top + (-n.y * 0.5 + 0.5) * rect3.height - e.clientY);
          if (px < bestPx) { bestPx = px; th = cand; snapped = true; }
        }
      }
      lineDrag.theta = th;
      const MINSPAN = Math.PI / 90;                      // 2°より短くはしない（消す時は部分削除で）
      let a0 = rr.a0, a1 = rr.a1;
      // 最大でも一周＝端が重なっても別々の端のまま（切断された円弧として保たれる）
      if (lineDrag.which === 0) a0 = Math.min(Math.max(th, a1 - TAU), a1 - MINSPAN);
      else a1 = Math.max(Math.min(th, a0 + TAU), a0 + MINSPAN);
      const span = a1 - a0;
      st.arcA0 = norm2pi(a0); st.arcA1 = st.arcA0 + span;
      lineDrag.theta = lineDrag.which === 0 ? st.arcA0 : st.arcA1;   // 正規化後の値に基準を合わせ直す（次の連続化用）
      rebuildAnn(rec); refreshAnnHi(); refreshHandles();
      // 線分の端点編集と同じく、動かしている端に緑の起点マーカーを出す（吸着中は大きく）
      clearMarkers();
      addMarker(circPt(rec, lineDrag.which === 0 ? st.arcA0 : st.arcA1), 0x39ff8a, markerRadiusFor(null, snapped));
      e.stopImmediatePropagation(); return;
    }
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
      // 「移動」コマンド外＝本体ドラッグでは動かさない（2026-07-15 社長要望：線分等も移動コマンドで）。
      // タップ操作（起点選択・寸法スピナー・構築線EL連鎖）と、逃げ調整・端点伸縮・半径変更などの「編集」は上で処理済み＝従来どおり
      if (lineDrag.noMove) { e.stopImmediatePropagation(); return; }
      const exParts = lineDrag._exParts || (lineDrag._exParts = new Set(lineDrag.partSnap.map(s => s.p)));
      let dx = 0, dy = 0, dz = 0, snappedPt = null;
      if (lineDrag.free) {                               // 自由移動（ダブルクリックドラッグ）：起点を他アイテムの機点へスナップ
        // 差分移動：掴んだ位置と起点の画面オフセットを引いた点で追従・スナップ判定（部品の自由移動と同じ）。
        // カーソル位置で判定すると、起点から離れた所を掴んだ時に「起点以外の場所」で吸着が発火して飛ぶ。
        const gOff = lineDrag.grabOff || { x: 0, y: 0 };
        const snap = moveSnapForGrip(e.clientX - gOff.x, e.clientY - gOff.y, exParts, selAnns);
        if (snap) { dx = snap.x - lineDrag.origin.x; dy = snap.y - lineDrag.origin.y; dz = snap.z - lineDrag.origin.z; snappedPt = snap; }
        else { const hit = planeHitAt(e.clientX - gOff.x, e.clientY - gOff.y, lineDrag.planeY); if (!hit) return; dx = hit.x - lineDrag.origin.x; dz = hit.z - lineDrag.origin.z; }
      } else {                                           // 直行移動：角度を45°（または指定角）にスナップ＋投影距離
        // 移動量は「指を置いた地点(startHit)からの差分」で測る（部品の updateDirMove と同じ）。
        // 起点基準だと、起点から離れた所を掴んだ瞬間にそのオフセット分だけ飛んでしまう。
        const hit = planeHitAt(e.clientX, e.clientY, lineDrag.planeY);
        if (!hit) return;
        const base = lineDrag.startHit || lineDrag.origin;
        const vx = hit.x - base.x, vz = hit.z - base.z;
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
      for (const s of lineDrag.annSnap) { s.r.a.set(s.a.x + dx, s.a.y + dy, s.a.z + dz); s.r.b.set(s.b.x + dx, s.b.y + dy, s.b.z + dz); if (s.ap) s.r.style.angP2 = [s.ap[0] + dx, s.ap[1] + dy, s.ap[2] + dz]; if (s.fp) s.r.style.dimFixPt = { x: s.fp.x + dx, y: s.fp.y + dy, z: s.fp.z + dz };   // 長さ寸法の固定基準も一緒に動かす（2026-08-02 社長「寸法の移動が上手く機能しない」）
      rebuildAnn(s.r); }
      if (window.__partSelApply) window.__partSelApply(lineDrag.partSnap, dx, dy, dz);
      lineDrag._delta = { x: dx, z: dz };                // 直行移動のX/Z/L欄表示用
      lineDrag._translated = true;                       // 実際に動かした＝離した時に「移動」コマンドを終了する
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
      // 指が動いた＝スライド開始。以後は長押しの切替を待たない（2026-08-03 社長指摘）
      if (!lineDrag.moved && Math.hypot(e.clientX - lineDrag.downX, e.clientY - lineDrag.downY) > 6) {
        lineDrag.moved = true;
        clearTimeout(freeHoldTimer);
      }
      const cur = lineDrag.end === 0 ? rec.a : rec.b;
      const ex = new Set([rec]);
      const snap = moveSnapForGrip(e.clientX, e.clientY, new Set(), ex);
      let pos = snap;
      if (!pos) { const hit = planeHitAt(e.clientX, e.clientY, cur.y); if (!hit) return; pos = hit; }
      // 引出し線＝通常は水平／垂直だけに伸ばし縮み（長押しで自由移動に切替。2026-08-03 社長指示）。
      // 画面での動き方が縦寄りなら「垂直」＝鉛直面で拾い直す（水平面の交点だけでは上下に伸ばせない）。
      if (!lineDrag.free && rec.style && rec.style.dimKind === 'leader') {
        const fix = lineDrag.end === 0 ? rec.b : rec.a;
        const rect2 = renderer.domElement.getBoundingClientRect();
        // 「つまんだ所からどちらへ動かしたか」で水平／垂直を決める（動かし方どおりに伸びる）
        const dxs = e.clientX - lineDrag.downX, dys = e.clientY - lineDrag.downY;
        if (Math.abs(dys) > Math.abs(dxs)) {                 // 縦寄り＝上下（Y）に伸ばす
          const cam2 = activeCam();
          const nrm = new V3(); cam2.getWorldDirection(nrm); nrm.y = 0;
          if (nrm.lengthSq() < 1e-9) nrm.set(0, 0, 1);
          nrm.normalize();
          placeNdc.x = ((e.clientX - rect2.left) / rect2.width) * 2 - 1;
          placeNdc.y = -((e.clientY - rect2.top) / rect2.height) * 2 + 1;
          placeRay.setFromCamera(placeNdc, cam2);
          const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, modelGroup.localToWorld(fix.clone()));
          const hitV = new V3();
          if (placeRay.ray.intersectPlane(pl, hitV)) {
            // 高さは「ドラッグ開始からの差分」で追う。鉛直面は矢の先(fix)を通るので、
            // 離れた肘の画面位置から絶対値で拾うと視差ぶん飛ぶ（掴んだ瞬間に下へ落ちる。2026-08-04 社長確認で発覚）
            const yHit = modelGroup.worldToLocal(hitV).y;
            if (lineDrag.vBase == null) { lineDrag.vBase = yHit; lineDrag.vStartY = cur.y; }
            pos = new V3(fix.x, lineDrag.vStartY + (yHit - lineDrag.vBase), fix.z);
          } else pos = new V3(fix.x, pos.y, fix.z);
        } else {                                             // 横寄り＝水平（東西 or 南北）に伸ばす
          lineDrag.vBase = null;                             // 縦へ切り替わったら基準を取り直す
          const d = pos.clone().sub(fix);
          pos = (Math.abs(d.x) >= Math.abs(d.z)) ? new V3(pos.x, fix.y, fix.z) : new V3(fix.x, fix.y, pos.z);
        }
      }
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
  window.addEventListener('pointercancel', () => {   // ジェスチャ取消＝線ドラッグの後始末（操作不能の残留防止）
    _lnEmptyDown = null;
    if (!lineDrag) return;
    clearTimeout(freeHoldTimer);
    lineDrag = null;
    clearMarkers();
    if (typeof hideLineBoxes === 'function') hideLineBoxes();
    if (typeof updateForm === 'function') updateForm();
  });
  window.addEventListener('pointerup', e => {
    // 空きスペースは「クリック」の時だけ線選択を解除（ドラッグ＝選択保持・視点はロックのまま。部品と同じ挙動）
    if (!drawActive() && e.button === 0 && _lnEmptyDown) {
      const wasDrag = Math.hypot(e.clientX - _lnEmptyDown.x, e.clientY - _lnEmptyDown.y) > 6;
      _lnEmptyDown = null;
      if (!wasDrag) deselectLine();
    }
    if (drawActive() || e.button !== 0 || !lineDrag) return;
    clearTimeout(freeHoldTimer);   // 引出しの「長押しで自由移動」の待ちを解除
    const mode = lineDrag.mode, moved = lineDrag.moved, nearEnd = lineDrag.nearEnd;
    const translated = lineDrag._translated;
    lineDrag = null;
    if (translated) finishMoveCommand();   // 線・寸法等を1回動かしたら「移動」コマンドを自動終了（部品と同じ）
    e.stopImmediatePropagation();
    if (mode === 'arcend') {                       // 円弧の端点伸縮を確定（選択は維持）
      clearMarkers();
      refreshHandles(); refreshAnnHi();
      if (typeof updateForm === 'function') updateForm();
      if (moved) scheduleHistory();
    } else if (mode === 'circleaxis') {            // 円/楕円の半径変更を確定（選択は維持・ハンドル再表示）
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
      // 寸法線（平行/立面）の本体クリックのみ再選択＝逃げ量スピナーを開いて逃げを再調整。
      //   タッチではキーボードを出さず ▲▼ ボタンで1mm刻み→3D画面タップで確定（立面は続けて方位スピナーへ連鎖）。
      //   端点(補助線の先)の付け替えは端の近くを掴んだ時だけ(=nearEnd)なので、!nearEnd を条件にして競合させない。
      // 寸法のタップでは逃げスピナーを出さない（2026-07-19 社長要望：数値フォームは長押しの時だけ＝startRotSpin側）
      // 半径/直径/角度の再選択（クリックのみ）＝逃げ（リーダー長・円弧半径/位置）の再調整に入る
      else if (!moved && lineSel && lineSel.type === 'dim' && lineSel.style && ['radius', 'diameter', 'angle'].includes(lineSel.style.dimKind)) drawState.dimReadjust = { rec: lineSel };
    } else if (mode === 'dimtext') {                     // 値ドラッグの終了。タップ（動かしていない）＝本体タップと同じ扱い
      if (typeof updateForm === 'function') updateForm();
      // 値タップでも逃げスピナーは出さない（数値フォームは長押し時のみ）
      if (!moved && lineSel && lineSel.type === 'dim' && lineSel.style && ['radius', 'diameter', 'angle'].includes(lineSel.style.dimKind))
        drawState.dimReadjust = { rec: lineSel };
    }
  }, true);
  // 再調整中：カーソルで逃げ（リーダー長・円弧半径/位置）を更新。スナップ＝緑印
  window.addEventListener('pointermove', e => {
    if (!drawState.dimReadjust || drawActive() || lineDrag) return;
    clearLineGuide();
    const snap = dimReadjustApply(drawState.dimReadjust.rec, e.clientX, e.clientY);
    if (snap) snapDot(snap);
    refreshHandles();
  }, true);
  window.addEventListener('keydown', e => {
    if (drawActive() || !lineSel) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape' && drawState.dimReadjust) { e.stopImmediatePropagation(); drawState.dimReadjust = null; clearLineGuide(); return; }   // 再調整だけ抜ける（選択は維持）
    // 複製した線・寸法・文字を掴んで置いている最中＝置き直しを取り消す（選択解除より先に受ける）。
    // ※ここはキャプチャ段なので、外側のEsc処理より先に走る（2026-07-27）
    if (e.key === 'Escape' && annPlaceMode) { e.stopImmediatePropagation(); cancelAnnPlace(); return; }
    if (e.key === 'Escape' && typeof nudgeActive === 'function' && nudgeActive()) return;   // スピナー表示中＝グローバル側の取消に委ねる（選択は保つ）
    if (e.key === 'Escape') { e.stopImmediatePropagation(); clearDrawTemp(); deselectLine(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopImmediatePropagation();
      const rec = lineSel;
      const i = annStore.indexOf(rec);
      if (i >= 0) annStore.splice(i, 1);
      annGroup.remove(rec.obj); disposeObj(rec.obj);
      clearDrawTemp(); deselectLine();
      // 相手を失った交点を残さない（この単独Delete経路だけ引き直し漏れだった。2026-07-19 社長報告）
      if (rec.type === 'xline' || rec.type === 'line') updateXlinePts();
    }
  }, true);

  // ================= 電卓（2026-08-03 社長要望・プロパティと同じ浮きパネル） =================
  // 現場の足し引き・切寸の暗算用。式を打っても、キーを押しても計算できる。
  // eval は使わず、自前の計算（操車場アルゴリズム）で括弧・優先順位まで解く。
  (function calcPanel() {
    const panel = document.getElementById('calcPanel');
    const head = document.getElementById('calcHead'), btn = document.getElementById('cmdCalc');
    const expr = document.getElementById('calcExpr'), out = document.getElementById('calcOut');
    const keys = document.getElementById('calcKeys'), closeBtn = document.getElementById('calcClose');
    if (!panel || !expr) return;
    // 式を数と演算子に分けて、優先順位どおりに計算する（+−×÷・括弧・単項の−）
    function calc(src) {
      const t = String(src).replace(/[×✕]/g, '*').replace(/[÷]/g, '/').replace(/[−ー]/g, '-')
                           .replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/\s+/g, '');
      if (!t) return null;
      let i = 0;
      const nums = [], ops = [];
      const prec = c => (c === '+' || c === '-') ? 1 : (c === '*' || c === '/') ? 2 : 0;
      const apply = () => {
        const op = ops.pop(), b2 = nums.pop(), a2 = nums.pop();
        if (a2 == null || b2 == null) throw 0;
        nums.push(op === '+' ? a2 + b2 : op === '-' ? a2 - b2 : op === '*' ? a2 * b2
                : (b2 === 0 ? NaN : a2 / b2));
      };
      let prevNum = false;
      while (i < t.length) {
        const c = t[i];
        if (/[0-9.]/.test(c)) {
          let j = i; while (j < t.length && /[0-9.]/.test(t[j])) j++;
          const v = parseFloat(t.slice(i, j));
          if (!isFinite(v)) throw 0;
          nums.push(v); i = j; prevNum = true; continue;
        }
        if (c === '(') { ops.push(c); i++; prevNum = false; continue; }
        if (c === ')') {
          while (ops.length && ops[ops.length - 1] !== '(') apply();
          if (!ops.length) throw 0;
          ops.pop(); i++; prevNum = true; continue;
        }
        if ('+-*/'.includes(c)) {
          if (!prevNum && (c === '-' || c === '+')) { nums.push(0); }   // 単項の＋−
          while (ops.length && prec(ops[ops.length - 1]) >= prec(c)) apply();
          ops.push(c); i++; prevNum = false; continue;
        }
        throw 0;
      }
      while (ops.length) { if (ops[ops.length - 1] === '(') throw 0; apply(); }
      if (nums.length !== 1) throw 0;
      return nums[0];
    }
    function show() {
      const v = expr.value.trim();
      if (!v) { out.textContent = '0'; return; }
      let r = null;
      try { r = calc(v); } catch (e) { r = null; }
      out.textContent = (r == null || !isFinite(r)) ? '—' : (Math.round(r * 1e6) / 1e6).toString();
    }
    expr.addEventListener('input', show);
    expr.addEventListener('keydown', e => {
      e.stopPropagation();                       // 3D側のショートカット（Delete/Esc等）へ渡さない
      if (e.key === 'Enter') { e.preventDefault(); equals(); }
    });
    function equals() {
      let r = null;
      try { r = calc(expr.value); } catch (e) { r = null; }
      if (r != null && isFinite(r)) { expr.value = String(Math.round(r * 1e6) / 1e6); show(); }
    }
    if (keys) keys.addEventListener('click', e => {
      const b2 = e.target.closest('button'); if (!b2) return;
      const k = b2.dataset.k;
      if (k === 'C') { expr.value = ''; }
      else if (k === '←') { expr.value = expr.value.slice(0, -1); }
      else if (k === '=') { equals(); return; }
      else expr.value += k;
      show();   // キーを押した後もフォーカスしない＝キーボードが立ち上がらない
    });
    let open = false;
    function setOpen(on) {
      open = !!on;
      panel.style.display = open ? 'flex' : 'none';
      if (btn) btn.classList.toggle('active', open);
      try { localStorage.setItem('p3d_calc_open', open ? '1' : '0'); } catch (e) {}
      if (open) { restorePos(); show(); }   // 開いただけではフォーカスしない＝iPadのキーボードを出さない
    }
    if (btn) btn.onclick = () => setOpen(!open);
    if (closeBtn) closeBtn.addEventListener('click', e => { e.stopPropagation(); setOpen(false); });
    function applyPos(l, t) {
      const w = panel.offsetWidth || 236;
      l = Math.max(2, Math.min(l, window.innerWidth - w - 2));
      t = Math.max(2, Math.min(t, window.innerHeight - 46));
      panel.style.left = Math.round(l) + 'px'; panel.style.top = Math.round(t) + 'px';
      panel.style.bottom = 'auto'; panel.style.right = 'auto';
    }
    function restorePos() {
      let saved = null; try { saved = localStorage.getItem('p3d_calc_pos'); } catch (e) {}
      if (saved) { const [l, t] = saved.split(',').map(Number); if (isFinite(l) && isFinite(t)) applyPos(l, t); }
    }
    let hdrDrag = null;
    if (head) {
      head.addEventListener('pointerdown', e => {
        if (closeBtn && (e.target === closeBtn || closeBtn.contains(e.target))) return;
        const r = panel.getBoundingClientRect();
        hdrDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        if (head.setPointerCapture) try { head.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault(); e.stopPropagation();
      });
      head.addEventListener('pointermove', e => {
        if (!hdrDrag) return;
        applyPos(e.clientX - hdrDrag.dx, e.clientY - hdrDrag.dy);
        e.preventDefault(); e.stopPropagation();
      });
      const endDrag = () => {
        if (!hdrDrag) return;
        hdrDrag = null;
        try { localStorage.setItem('p3d_calc_pos', `${parseInt(panel.style.left, 10)},${parseInt(panel.style.top, 10)}`); } catch (e) {}
      };
      head.addEventListener('pointerup', endDrag);
      head.addEventListener('pointercancel', endDrag);
    }
    ['pointerdown', 'click', 'wheel'].forEach(ev => panel.addEventListener(ev, e => e.stopPropagation()));
    if (localStorage.getItem('p3d_calc_open') === '1') setOpen(true);
    window.__calcEval = calc;            // e2e検証用
    window.__calcOpen = (on) => setOpen(on);
    window.__calcIsOpen = () => open;
  })();

  // ================= プロパティパネル（2026-07-18 社長要望） =================
  // 選択中オブジェクト（部品・線分・構築線・円・寸法・文字）の値を左下のパネルに一覧表示し、その場で編集できる。
  // 空間上の直接編集（ドラッグ・スピナー等）は従来どおり併用可。表示は updateForm 経由で常時追従（ドラッグ中も更新）。
  (function propsPanel() {
    const panel = document.getElementById('propPanel'), body = document.getElementById('ppBody');
    const head = document.getElementById('ppHead'), btn = document.getElementById('cmdProps');
    if (!panel || !body) return;
    let open = localStorage.getItem('p3d_props_open') === '1';
    function setOpen(on) {
      open = !!on;
      panel.style.display = open ? 'flex' : 'none';
      if (btn) btn.classList.toggle('active', open);
      try { localStorage.setItem('p3d_props_open', open ? '1' : '0'); } catch (e) {}
      if (open) { sig = null; render(); }
    }
    // 位置を動かしたことが無ければ、初めて表示される時に画面中央へ（2026-07-19 社長要望。ドラッグ後は位置を記憶）
    let centered = false;
    function centerIfFresh() {
      if (centered) return;
      let saved = null; try { saved = localStorage.getItem('p3d_props_pos'); } catch (e) {}
      if (!saved) {
        const w = panel.offsetWidth || 248, h = panel.offsetHeight || 320;
        applyPos((window.innerWidth - w) / 2, (window.innerHeight - h) / 2);
      }
      centered = true;
    }
    if (btn) btn.onclick = () => setOpen(!open);
    const closeBtn = document.getElementById('ppClose');
    if (closeBtn) closeBtn.addEventListener('click', e => { e.stopPropagation(); setOpen(false); });
    // 見出しドラッグでパネルを移動（2026-07-18 社長要望）。位置は記憶し、画面内に収まるようクランプ
    function applyPos(l, t) {
      const w = panel.offsetWidth || 248;
      l = Math.max(2, Math.min(l, window.innerWidth - w - 2));
      t = Math.max(2, Math.min(t, window.innerHeight - 46));   // 最低でも見出しが画面に残る
      panel.style.left = Math.round(l) + 'px'; panel.style.top = Math.round(t) + 'px';
      panel.style.bottom = 'auto'; panel.style.right = 'auto';
    }
    let hdrDrag = null;
    head.addEventListener('pointerdown', e => {
      if (closeBtn && (e.target === closeBtn || closeBtn.contains(e.target))) return;
      const r = panel.getBoundingClientRect();
      hdrDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      if (head.setPointerCapture) try { head.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    head.addEventListener('pointermove', e => { if (hdrDrag) applyPos(e.clientX - hdrDrag.dx, e.clientY - hdrDrag.dy); });
    const endHdrDrag = () => {
      if (!hdrDrag) return;
      hdrDrag = null;
      try { const r = panel.getBoundingClientRect(); localStorage.setItem('p3d_props_pos', Math.round(r.left) + ',' + Math.round(r.top)); } catch (e) {}
    };
    head.addEventListener('pointerup', endHdrDrag);
    head.addEventListener('pointercancel', endHdrDrag);
    (function restorePos() {   // 保存済みの位置を復元
      const s = localStorage.getItem('p3d_props_pos');
      if (!s) return;
      const a = s.split(','), l = parseFloat(a[0]), t = parseFloat(a[1]);
      if (isFinite(l) && isFinite(t)) applyPos(l, t);
    })();
    window.addEventListener('resize', () => {   // iPadの縦横回転などでも画面内に収める
      if (panel.style.top && panel.style.top !== '') { const r = panel.getBoundingClientRect(); applyPos(r.left, r.top); }
    });
    const mmv = v => Math.round(v * 1000);   // m → mm（表示）
    let sig = null, fields = [];             // fields: [{inp, get}] 値の追従更新用
    function selInfo() {
      const nAnn = window.__annSelCount ? window.__annSelCount() : 0;
      if (selectedParts.size === 1 && selectedPart && !nAnn) return { kind: 'part', p: selectedPart };
      if (!selectedParts.size && nAnn === 1) { const a = window.__annPropsGet ? window.__annPropsGet() : null; if (a) return { kind: 'ann', a }; }
      const n = selectedParts.size + nAnn;
      return n ? { kind: 'multi', n } : { kind: 'none' };
    }
    function sec(t) { const d = document.createElement('div'); d.className = 'pp-sec'; d.textContent = t; body.appendChild(d); }
    function note(t) { const d = document.createElement('div'); d.className = 'pp-note'; d.textContent = t; body.appendChild(d); }
    function roRow(label, get) {
      const row = document.createElement('div'); row.className = 'pp-row';
      const lb = document.createElement('label'); lb.textContent = label; row.appendChild(lb);
      const sp = document.createElement('span'); sp.className = 'pp-ro'; sp.textContent = get(); row.appendChild(sp);
      body.appendChild(row);
      fields.push({ ro: sp, get });
    }
    // 編集行。set(値)を呼んだ後は render 側が値を追従更新する。number は unit 表示付き
    function edRow(label, opts) {
      const row = document.createElement('div'); row.className = 'pp-row';
      const lb = document.createElement('label'); lb.textContent = label; row.appendChild(lb);
      let inp;
      if (opts.options) {
        inp = document.createElement('select');
        opts.options.forEach(([v, t]) => { const o = document.createElement('option'); o.value = String(v); o.textContent = t; inp.appendChild(o); });
      } else {
        inp = document.createElement('input');
        inp.type = opts.type || 'number';
        if (inp.type === 'number' && opts.step != null) inp.step = String(opts.step);
      }
      inp.value = String(opts.get());
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { e.preventDefault(); inp.value = String(opts.get()); inp.blur(); } });
      inp.addEventListener('change', () => {
        let v = inp.value;
        if (!opts.options && inp.type === 'number') { v = parseFloat(v); if (!isFinite(v)) { inp.value = String(opts.get()); return; } }
        opts.set(v);
        inp.value = String(opts.get());
      });
      ['pointerdown', 'click'].forEach(ev => inp.addEventListener(ev, e => e.stopPropagation()));
      row.appendChild(inp);
      if (opts.unit) { const u = document.createElement('span'); u.className = 'pp-unit'; u.textContent = opts.unit; row.appendChild(u); }
      body.appendChild(row);
      fields.push({ inp, get: opts.get });
    }
    // フェイス面（部品ローカル+Y）の世界向き。方位角＝コンパス式：北0°・東90°・南180°・西270°
    // （北=Z−=ジズモ「後」、東=X+=「右」、南=Z+=「前」、西=X−=「左」）。立面角+90°=上向き
    const faceSign = p => (behType(p) === 'elbow' ? -1 : 1);   // エルボは向き表示を反転（2026-07-19 社長要望：南表示→北、西→東）
    const faceN = p => new THREE.Vector3(0, 1, 0).applyQuaternion(p.quaternion).multiplyScalar(faceSign(p));
    const azimuthOf = (x, z) => { let d = Math.atan2(x, -z) * 180 / Math.PI; if (d < 0) d += 360; return Math.round(d * 10) / 10; };
    // 方位角：上/下向きのフェイスは「ローカルX（ひねりの基準）の水平向き」で代用＝常に読める・常に編集できる
    //（従来は0固定＋編集拒否で「入力できない」となっていた。2026-07-29 社長報告）
    const faceBearing = p => {
      const n = faceN(p);
      if (Math.hypot(n.x, n.z) >= 1e-3) return azimuthOf(n.x, n.z);
      const lx = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quaternion);
      if (Math.hypot(lx.x, lx.z) < 1e-3) return 0;
      return azimuthOf(lx.x, lx.z);
    };
    const faceElev = p => { const n = faceN(p); return Math.round(Math.asin(Math.max(-1, Math.min(1, n.y))) * 180 / Math.PI * 10) / 10; };
    const faceDirText = p => {
      const el = faceElev(p);
      if (el > 60) return '上向き';
      if (el < -60) return '下向き';
      const names = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];   // 東西南北（2026-07-19 社長要望）
      const t = names[Math.round(faceBearing(p) / 45) % 8];
      return Math.abs(el) > 5 ? t + (el > 0 ? '・上り' : '・下り') : t;
    };
    const rotPartWorld = (p, q) => {
      const kl = rotGripLocalOf(p);             // ボルト穴起点でも回転はフェイス中心基準
      const kw = connModelPos(p, kl);
      p.quaternion.premultiply(q);
      p.position.add(kw.sub(connModelPos(p, kl)));   // 基準機点はその場に残す
      _idleSig = null;                           // 機点マーカーを強制再描画（起点だけのシグネチャでは回転が検知されない）
      if (selectedParts.has(p)) setEmissive(p, SEL_COLOR);
      updateForm();
    };
    const setFaceBearing = (p, v) => {
      const a = (faceBearing(p) - v) * Math.PI / 180;   // +Y回転は方位角を減らす向き（上/下向きはローカルX基準で同様に効く）
      rotPartWorld(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));
    };
    // 回転（フェイス軸まわり・旧「ひねり」）：基準＝水平フェイスなら(Y×n)、垂直フェイスなら世界X。
    // 値そのものは基準からの角度（0〜360°）。編集は差分だけフェイス軸まわりに回す＝起点は保持
    const rollRefOf = p => {
      const n = faceN(p);
      let r = new THREE.Vector3(0, 1, 0).cross(n);
      if (r.lengthSq() < 1e-9) r = new THREE.Vector3(1, 0, 0);
      return r.normalize();
    };
    const faceRoll = p => {
      const n = faceN(p), r0 = rollRefOf(p);
      const lx = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quaternion);
      const lxp = lx.sub(n.clone().multiplyScalar(lx.dot(n)));
      if (lxp.lengthSq() < 1e-9) return 0;
      lxp.normalize();
      let a = Math.atan2(n.dot(new THREE.Vector3().crossVectors(r0, lxp)), r0.dot(lxp)) * 180 / Math.PI;
      if (a < 0) a += 360;
      return Math.round(a * 10) / 10;
    };
    const setFaceRoll = (p, v) => {
      const d = ((v - faceRoll(p)) % 360) * Math.PI / 180;
      rotPartWorld(p, new THREE.Quaternion().setFromAxisAngle(faceN(p), d));
    };
    window.__partFaceRoll = faceRoll;   // 回転スピナーの初期角（プロパティの「回転」と同じ値から開始）用
    window.__partFaceBearing = faceBearing;   // 方位角スピナーの初期角（3軸ボタンの長押し用）
    window.__partFaceElev = faceElev;         // 立面角スピナーの初期角（同上）
    const setFaceElev = (p, v) => {
      const n = faceN(p);
      const phi0 = Math.asin(Math.max(-1, Math.min(1, n.y)));
      const t = Math.max(-90, Math.min(90, v)) * Math.PI / 180;
      let axis = new THREE.Vector3(0, 1, 0).cross(n);
      if (axis.lengthSq() < 1e-9) axis = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quaternion);   // 真上/真下は部品ローカルXまわりに倒す
      axis.normalize();
      rotPartWorld(p, new THREE.Quaternion().setFromAxisAngle(axis, phi0 - t));   // Y×n まわりの＋回転はフェイスを下げる向き
    };
    // 起点ラベル：起点になっている機点の「軸」が鉛直（＝面が水平）ならEL、水平ならCOP（2026-07-19 社長要望。
    // エルボ・ティ等は起点の機点ごとに変わる：例＝立ちエルボの上端面が起点ならEL、横端ならCOP）
    function partHeightLabel(p) {
      return 'EL';   // 高さ表記はELに統一（2026-07-19 社長要望。旧：起点機点の軸でEL/COP切替）
    }
    // 配置済み部品を仕様から作り替える（プロパティの仕様編集用。2026-07-29 社長指示＝パレットと切り離し）。
    // フェイス面の位置・姿勢・材質・グループ・アイテムリストの並びを保つ（旧applyPaletteToSelectedと同じ流儀）。
    function rebuildPartFromSpec(p, patch) {
      const u = p.userData, field = SPEC_FIELD[u.partType];
      if (!field || !u[field]) return null;
      const spec = Object.assign({}, u[field], patch);
      const obj = makeSpecPart({ partType: u.partType, [field]: spec });
      if (!obj) return null;
      const anchorLocal = u.faceLocal || gripLocalOf(p);
      const anchor = connModelPos(p, anchorLocal);
      obj.quaternion.copy(p.quaternion); obj.scale.copy(p.scale);
      obj.userData.placed = true;
      obj.userData.orient = u.orient || 0; obj.userData.roll = u.roll || 0;
      if (u.mat) obj.userData.mat = u.mat;
      if (u.groupId != null) obj.userData.groupId = u.groupId;
      obj.position.copy(anchor).sub((obj.userData.faceLocal || gripLocalOf(obj)).clone().applyQuaternion(obj.quaternion));
      modelGroup.add(obj);
      const i = placedParts.indexOf(p);
      if (i >= 0) placedParts[i] = obj; else placedParts.push(obj);
      modelGroup.remove(p); disposePartDeep(p);
      selectPart(obj);
      _idleSig = null;
      if (window.__scheduleHistory) window.__scheduleHistory();
      return obj;
    }
    window.__rebuildPartFromSpec = rebuildPartFromSpec;   // e2e検証用
    function buildPart(p) {
      const u = p.userData, c = partColumns(p);
      sec('部品');
      roRow('種別', () => `${c.kind} ${c.type}`.trim());
      // サイズ行は廃止（下の「仕様」と重複のため。2026-07-29 社長指摘）
      // ---- 仕様の編集（パレットとは切り離し。呼び径などはここで変える）----
      {
        const field = SPEC_FIELD[u.partType];
        if (field && u[field]) {
          const spec = () => p.userData[field];
          const selSpec = (label, key, listFn) => edRow(label, {
            options: listFn().map(x => [x, x]),
            get: () => spec()[key],
            set: v => { rebuildPartFromSpec(p, { [key]: v }); },
          });
          sec('仕様');
          switch (u.partType) {
            case 'flange':
              selSpec('タイプ', 'type', () => typesForClass(spec().cls).map(t => t.code));
              selSpec('呼び径', 'sizeA', () => flangeAvailableSizes(spec().cls, spec().type));
              selSpec('クラス', 'cls', () => classesForType(spec().type));
              // SchはWN（首の管厚）・SW（差込み）・LJ（ラップジョイント＝スタブエンド込み）に表示。SOP/BLには不要（2026-07-31 社長指摘）
              if (['WN', 'SW', 'LJ'].includes(spec().type)) selSpec('Sch', 'sch', () => SCHEDULES);
              break;
            case 'pipe':
              selSpec('呼び径', 'sizeA', () => FLANGE_SIZES);
              selSpec('Sch', 'sch', () => PIPE_SCHEDULES);
              break;
            case 'gasket':
              selSpec('呼び径', 'sizeA', () => FLANGE_SIZES);
              selSpec('クラス', 'cls', () => FLANGE_CLASSES);
              break;
            case 'elbow': case 'cap':
              selSpec('呼び径', 'sizeA', () => Object.keys(ELBOW_90L));
              selSpec('Sch', 'sch', () => FITTING_SCHEDULES);
              break;
            case 'tee':
              // 小径＝同径＋規格(TEE_RT_M)の組合せのみ。呼び径を変えたら小径も規格内へ丸める（2026-08-04 社長指示）
              edRow('呼び径', { options: Object.keys(TEE_C).map(x => [x, x]), get: () => spec().sizeA,
                set: v => { const b = spec().sizeB, list = [v, ...teeBranchSizes(v)];
                            rebuildPartFromSpec(p, { sizeA: v, sizeB: list.includes(b) ? b : v }); } });
              edRow('小径', { options: [spec().sizeA, ...teeBranchSizes(spec().sizeA).reverse()].map(x => [x, x]),
                get: () => spec().sizeB, set: v => { rebuildPartFromSpec(p, { sizeB: v }); } });
              selSpec('Sch', 'sch', () => FITTING_SCHEDULES);
              break;
            case 'reducer':
              // 呼び径・小径とも規格(REDUCER_B)の組合せのみ（2026-08-04 社長指示）
              edRow('呼び径', { options: Object.keys(REDUCER_B).map(x => [x, x]), get: () => spec().sizeA,
                set: v => { const b = spec().sizeB, list = reducerSizeBs(v);
                            rebuildPartFromSpec(p, { sizeA: v, sizeB: list.includes(b) ? b : (list[list.length - 1] || v) }); } });
              edRow('小径', { options: reducerSizeBs(spec().sizeA).slice().reverse().map(x => [x, x]),
                get: () => spec().sizeB, set: v => { rebuildPartFromSpec(p, { sizeB: v }); } });
              selSpec('Sch', 'sch', () => FITTING_SCHEDULES);
              break;
            case 'sw':
              selSpec('呼び径', 'sizeA', () => Object.keys(SW_S));
              break;
            case 'valve':
              selSpec('呼び径', 'sizeA', () => FLANGE_SIZES);
              selSpec('クラス', 'rating', () => VALVE_RATINGS);
              break;
            case 'flex': case 'sight':
              selSpec('呼び径', 'sizeA', () => EQUIP_SIZES);
              selSpec('クラス', 'cls', () => VALVE_RATINGS);
              break;
            case 'pg':
              selSpec('ネジ', 'thread', () => PG_THREADS);
              edRow('径(Φ)', { get: () => spec().dia, set: v => { rebuildPartFromSpec(p, { dia: Math.min(Math.max(v, 25), 300) }); }, unit: 'mm', step: 5 });
              edRow('サイフォン', { options: [['1', 'あり'], ['0', 'なし']], get: () => (spec().siphon === false ? '0' : '1'), set: v => { rebuildPartFromSpec(p, { siphon: v === '1' }); } });
              break;
          }
        }
      }
      sec('位置（起点）');
      edRow(partHeightLabel(p), { get: () => mmv(heightRefModelPos(p).y), set: v => { setPartByHeight(p, v / 1000); updateForm(); }, unit: 'mm', step: 1 });
      if (u.partType === 'pipe' && u.pipe) {
        sec('パイプ');
        // 長さ＝一覧・CSVと同じ「切寸」で表示・入力する（2026-08-03 社長指示：表記を統一）。
        // 切寸＝図面長さ＋端の控え（SOP控え・BWギャップ）なので、入力値からその差を引いて図面長さにする。
        const cutAdj = () => { try { return pipeCutInfo(p).cut - u.pipe.length; } catch (e) { return 0; } };
        edRow('切寸', { get: () => { try { return pipeCutInfo(p).cut; } catch (e) { return Math.round(u.pipe.length); } },
                        set: v => { const L = v - cutAdj(); if (L >= 1) rebuildPipe(p, L, 'face'); updateForm(); }, unit: 'mm', step: 1 });
        // 端末の斜め角度切り（0＝直角。±60°まで。切寸は一覧・CSVに最短〜最長で出る）
        edRow('端面角度A(背)', { get: () => Math.round((u.pipe.cutAngBack || 0) * 10) / 10,
          set: v => { u.pipe.cutAngBack = Math.max(-60, Math.min(60, v)); rebuildPipe(p, u.pipe.length, 'face'); updateForm(); }, unit: '°', step: 5 });
        edRow('端面角度B(面)', { get: () => Math.round((u.pipe.cutAngFace || 0) * 10) / 10,
          set: v => { u.pipe.cutAngFace = Math.max(-60, Math.min(60, v)); rebuildPipe(p, u.pipe.length, 'face'); updateForm(); }, unit: '°', step: 5 });
      }
      if (u.partType === 'flange' && u.flange && u.flange.type === 'RDF') {
        // レジューシング＝小径と偏心/同心をプロパティで見えるように（2026-08-03 社長指示）
        sec('レジューシング(RF)');
        const rebuildRdf = () => {
          const np = makeFlange(u.flange); computeConns(np);
          while (p.children.length) { const c = p.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
          while (np.children.length) p.add(np.children.pop());
          p.userData.faceLocal = np.userData.faceLocal; p.userData.backLocal = np.userData.backLocal;
          p.userData.extraLocals = np.userData.extraLocals; p.userData.boltLocals = np.userData.boltLocals;
          refreshItemList(); updateForm();
        };
        const all = flangeAvailableSizes(u.flange.cls, 'RDF');
        const idx = all.indexOf(u.flange.sizeA);
        const small = idx > 0 ? all.slice(0, idx) : all.filter(x => x !== u.flange.sizeA);
        edRow('小径', { options: small.map(x => [x, x]), get: () => u.flange.sizeB || small[small.length - 1],
                        set: v => { u.flange.sizeB = v; rebuildRdf(); } });
        edRow('偏心/同心', { options: [['0', '同心(CONC)'], ['1', '偏心(ECC)']], get: () => (u.flange.ecc ? '1' : '0'),
                            set: v => { u.flange.ecc = (v === '1'); rebuildRdf(); } });
        roRow('穴径(SOP同径)', () => `φ${Math.round((FLG_BORE[u.flange.sizeB] || 0) * 10) / 10}`);
      }
      if (u.partType === 'gasket' && u.gasket) {
        sec('ガスケット');
        edRow('厚み', { get: () => u.gasket.t, set: v => { if (v > 0) rebuildGasket(p, v); updateForm(); }, unit: 'mm', step: 0.5 });
      }
      // 機器類の長さ（＝フランジ面間）。パレットからも変えられるが、選んでその場で直せる方が速い。
      if ((u.partType === 'flex' || u.partType === 'sight' || u.partType === 'spool') && u[u.partType]) {
        sec(u.partType === 'flex' ? 'フレキシブル' : u.partType === 'sight' ? 'サイドグラス' : `仮管（${(u.spool && u.spool.type) || 'フランジ'}）`);
        edRow('長さ', { get: () => Math.round(u[u.partType].length), set: v => { if (v >= 1) rebuildEquipLength(p, v); updateForm(); }, unit: 'mm', step: 10 });
      }
      if (u.faceLocal) {
        sec('向き（フェイス面）');
        roRow('方角', () => faceDirText(p));
        edRow('方位角', { get: () => faceBearing(p), set: v => setFaceBearing(p, v), unit: '°', step: 1 });
        edRow('立面角', { get: () => faceElev(p), set: v => setFaceElev(p, v), unit: '°', step: 1 });
        edRow('回転', { get: () => faceRoll(p), set: v => setFaceRoll(p, v), unit: '°', step: 1 });
      }
      sec('その他');
      edRow('材質', { type: 'text', get: () => u.mat || '', set: v => { u.mat = String(v).trim(); refreshItemList(); } });
    }
    function buildAnnProps(a) {
      const label = a.type === 'line' ? '線分' : a.type === 'xline' ? '構築線' : a.type === 'circle' ? '円'
        : a.kind === 'text' ? '文字' : '寸法' + (a.kind && a.kind !== 'parallel' ? `（${DIM_KIND_LABEL[a.kind] || a.kind}）` : '');
      sec(label);
      const setPt = (key, axis, v) => { const g = window.__annPropsGet(); if (!g) return; const arr = g[key]; arr['xyz'.indexOf(axis)] = v / 1000; window.__annPropsSet({ [key]: arr }); };
      const getPt = (key, axis) => { const g = window.__annPropsGet(); return g ? mmv(g[key]['xyz'.indexOf(axis)]) : 0; };
      if (a.type === 'line' || a.type === 'xline') {
        // 起点＝絶対座標（高さはFL/COP）・編集すると線全体が平行移動（終点との相対関係を維持）。
        // 終点＝起点に対する相対（Δ）。水平角・立面角も表示・編集可（2026-07-18 社長要望）
        const g = () => window.__annPropsGet();
        const absA = i => { const gg = g(); return gg ? Math.round(gg.a[i] * 1000) : 0; };
        const moveWhole = (i, mm) => { const gg = g(); if (!gg) return; const d = mm / 1000 - gg.a[i]; const na = gg.a.slice(), nb = gg.b.slice(); na[i] += d; nb[i] += d; window.__annPropsSet({ a: na, b: nb }); };
        const delta = i => { const gg = g(); return gg ? Math.round((gg.b[i] - gg.a[i]) * 1000) : 0; };
        const setDelta = (i, mm) => { const gg = g(); if (!gg) return; const nb = gg.b.slice(); nb[i] = gg.a[i] + mm / 1000; window.__annPropsSet({ b: nb }); };
        const dvec = () => { const gg = g(); return gg ? [gg.b[0] - gg.a[0], gg.b[1] - gg.a[1], gg.b[2] - gg.a[2]] : [1, 0, 0]; };
        if (a.type === 'xline') {
          sec('高さ');   // 構築線は無限長＝起点・終点を持たない（2026-07-19 社長指摘）。高さと向きだけを編集
          edRow('EL', { get: () => absA(1), set: v => moveWhole(1, v), unit: 'mm', step: 1 });
          sec('向き');
        } else {
          sec('起点');
          edRow('EL', { get: () => absA(1), set: v => moveWhole(1, v), unit: 'mm', step: 1 });   // 起点はELのみ（2026-07-18 社長要望）
          sec('終点（起点に対して）');
          edRow('ΔX', { get: () => delta(0), set: v => setDelta(0, v), unit: 'mm', step: 1 });
          edRow('ΔY 高低差', { get: () => delta(1), set: v => setDelta(1, v), unit: 'mm', step: 1 });
          edRow('ΔZ', { get: () => delta(2), set: v => setDelta(2, v), unit: 'mm', step: 1 });
          edRow('長さ', { get: () => { const gg = g(); return gg ? Math.round(gg.len * 1000) : 0; }, set: v => { if (v >= 1) window.__annPropsSet({ len: v / 1000 }); }, unit: 'mm', step: 1 });
        }
        edRow('方位角', { get: () => { const d = dvec(); if (Math.hypot(d[0], d[2]) < 1e-9) return 0; let deg = Math.atan2(d[0], -d[2]) * 180 / Math.PI; if (deg < 0) deg += 360; return Math.round(deg * 10) / 10; },
          set: v => { const gg = g(); if (!gg) return; const d = dvec(); const hl = Math.hypot(d[0], d[2]); if (hl < 1e-9) return; const r = v * Math.PI / 180;
            window.__annPropsSet({ b: [gg.a[0] + Math.sin(r) * hl, gg.a[1] + d[1], gg.a[2] - Math.cos(r) * hl] }); }, unit: '°', step: 0.5 });
        edRow('立面角', { get: () => { const d = dvec(); return Math.round(Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180 / Math.PI * 10) / 10; },
          set: v => { const gg = g(); if (!gg) return; const d = dvec(); const L = Math.hypot(d[0], d[1], d[2]); if (L < 1e-9) return;
            const r = Math.max(-89.9, Math.min(89.9, v)) * Math.PI / 180;
            const hl0 = Math.hypot(d[0], d[2]); const ux = hl0 > 1e-9 ? d[0] / hl0 : 1, uz = hl0 > 1e-9 ? d[2] / hl0 : 0;
            const hl2 = L * Math.cos(r), dy2 = L * Math.sin(r);
            window.__annPropsSet({ b: [gg.a[0] + ux * hl2, gg.a[1] + dy2, gg.a[2] + uz * hl2] }); }, unit: '°', step: 0.5 });
        note(a.type === 'xline'
          ? '構築線は無限長のため高さ（EL）と向きだけを持ちます。方位角＝北(後Z−)0°から時計回りで東(右X+)90°。向き/回転ボタン・右クリックで45°送り、長押し＝平行移動/方位角スピナーも使えます。'
          : '起点ELを変更すると線全体が上下に平行移動します（終点は起点に対する相対を維持）。方位角＝北(後Z−)0°から時計回りで東(右X+)90°、立面角＋＝上り（全長を保って傾き変更）。');
      } else if (a.type === 'circle') {
        const gC = () => window.__annPropsGet();
        sec('中心');   // 中心はELのみ（2026-07-19 社長要望）。編集＝円全体を上下移動
        edRow('EL', { get: () => { const gg = gC(); return gg ? Math.round(gg.a[1] * 1000) : 0; },
          set: v => { const gg = gC(); if (!gg) return; const d = v / 1000 - gg.a[1]; const na = gg.a.slice(), nb = gg.b.slice(); na[1] += d; nb[1] += d; window.__annPropsSet({ a: na, b: nb }); }, unit: 'mm', step: 1 });
        sec('半径');
        edRow('X半径', { get: () => { const gg = gC(); return gg ? Math.round(gg.rx * 1000) : 0; }, set: v => { if (v >= 1) window.__annPropsSet({ rx: v / 1000 }); }, unit: 'mm', step: 1 });
        edRow('Z半径', { get: () => { const gg = gC(); return gg ? Math.round(gg.rz * 1000) : 0; }, set: v => { if (v >= 1) window.__annPropsSet({ rz: v / 1000 }); }, unit: 'mm', step: 1 });
        sec('向き（面）');
        edRow('方位角', { get: () => (gC() || {}).cAz || 0, set: v => window.__annPropsSet({ cAz: v }), unit: '°', step: 1 });
        edRow('立面角', { get: () => (gC() || {}).cEl || 0, set: v => window.__annPropsSet({ cEl: v }), unit: '°', step: 1 });
      } else if (a.kind === 'text') {
        edRow('内容', { type: 'text', get: () => (window.__annPropsGet() || {}).text || '', set: v => window.__annPropsSet({ text: String(v) }) });
        edRow('回転', { get: () => (window.__annPropsGet() || {}).textRot || 0, set: v => window.__annPropsSet({ textRot: v }), unit: '°', step: 1 });
        sec('配置点');
        for (const ax of 'xyz') edRow(ax.toUpperCase(), { get: () => getPt('a', ax), set: v => setPt('a', ax, v), unit: 'mm', step: 1 });
      } else {   // 寸法（平行/リニア/半径/直径/角度/引出）
        if ((window.__annPropsGet() || {}).measMm != null)   // 実測値＝編集可（測定点を動かして距離を変える。2026-07-19 社長要望）
          edRow('実測値', { get: () => (window.__annPropsGet() || {}).measMm || 0, set: v => { if (v > 0) window.__annPropsSet({ meas: v }); }, unit: 'mm', step: 1 });
        else roRow('実測値', () => (window.__annPropsGet() || {}).meas || '');   // 角度・引出＝読み取りのみ
        edRow('値(上書き)', { type: 'text', get: () => (window.__annPropsGet() || {}).dimText || '', set: v => window.__annPropsSet({ dimText: String(v) }) });
        if (a.dimOff != null) edRow('逃げ', { get: () => { const g = window.__annPropsGet(); return g ? Math.round((g.dimOff || 0) * 1000) : 0; }, set: v => window.__annPropsSet({ dimOff: v / 1000 }), unit: 'mm', step: 1 });
        if (a.dimOff != null) edRow('スライド角', { get: () => (window.__annPropsGet() || {}).dimSkew || 0, set: v => window.__annPropsSet({ dimSkew: Math.max(-80, Math.min(80, v)) }), unit: '°', step: 1 });
      }
    }
    function render() {
      if (!open) return;
      const info = selInfo();
      // 何も選択していない時はパネル自体を出さない（2026-07-19 社長要望）。選択したら再表示（トグルはONのまま）
      panel.style.display = info.kind === 'none' ? 'none' : 'flex';
      const s = info.kind + '|' + (info.kind === 'part' ? info.p.uuid + partHeightLabel(info.p) : info.kind === 'ann' ? (info.a.type + ':' + (info.a.kind || '')) : (info.n || 0) + '|' + (selectedPart ? selectedPart.uuid : ''));
      if (s === sig) {   // 選択が同じ＝値だけ追従（編集中の欄は上書きしない）
        for (const f of fields) {
          if (f.ro) { const v = String(f.get()); if (f.ro.textContent !== v) f.ro.textContent = v; }
          else if (f.inp && document.activeElement !== f.inp) { const v = String(f.get()); if (f.inp.value !== v) f.inp.value = v; }
        }
        if (info.kind !== 'none') centerIfFresh();
        return;
      }
      sig = s; fields = []; body.innerHTML = '';
      if (info.kind === 'none') return;   // 選択なし＝説明も出さない（パネルは上でdisplay:none済み）
      if (info.kind === 'multi') {
        sec('複数選択'); roRow('選択数', () => (selectedParts.size + (window.__annSelCount ? window.__annSelCount() : 0)) + ' 個');
        if (selectedPart) {   // 起点（主選択）部品のEL＝編集で選択全体を一括上下移動（2026-07-19 社長要望）
          edRow('EL(起点)', { get: () => mmv(heightRefModelPos(selectedPart).y), set: v => {
            const dy = v / 1000 - heightRefModelPos(selectedPart).y;
            if (!isFinite(dy) || Math.abs(dy) < 1e-9) return;
            const snap = window.__partSelSnapshot ? window.__partSelSnapshot() : [];
            if (window.__partSelApply) window.__partSelApply(snap, 0, dy, 0);
            if (window.__annHasSel && window.__annHasSel() && window.__annMoveStart) { window.__annMoveStart(); window.__annMoveApply(0, dy, 0); window.__annMoveEnd(); }
            _idleSig = null; updateForm();
          }, unit: 'mm', step: 1 });
        }
      }
      else if (info.kind === 'part') buildPart(info.p);
      else buildAnnProps(info.a);
      centerIfFresh();
    }
    window.__propsRefresh = render;
    if (open) setOpen(true);
  })();

  // ================= ボタン結線 =================
  $('cmdNew').onclick = newDrawing;
  $('cmdSave').onclick = openSaveMenu;   // 初回＝新規保存／保存済みなら 新規/上書き の選択メニュー
  $('cmdOpen').onclick = load;
  $('cmdCsv').onclick = exportCsv;       // 部品表CSV（自動集計付き）
  { const b = $('cmdClash'); if (b) b.onclick = runClashCheck; }   // 干渉チェック（2026-07-21 社長要望で一旦UIから外す。ロジックは残置）
  $('cmdMove').onclick = () => setMoveMode(!moveMode);   // 移動モードのトグル
  // 非表示／再表示。旧index.html（10分キャッシュ）と新app.jsが混在してもボタン無しで壊れないよう null 許容
  const _bHide = $('cmdHide'); if (_bHide) _bHide.onclick = hideCommand;
  const _bShow = $('cmdShow'); if (_bShow) _bShow.onclick = showAllHidden;
  // ファイルメニュー（リボン「ファイル」をクリック／長押しで開く。中身は従来のファイル系ボタン＝配線は各IDのまま）
  const _bFile = $('cmdFile'), _fileMenu = document.getElementById('fileMenu');
  if (_bFile && _fileMenu) {
    const closeFile = () => { _fileMenu.style.display = 'none'; _bFile.classList.remove('active'); };
    const openFile = () => {
      _fileMenu.style.display = 'flex';
      _bFile.classList.add('active');
      const r = _bFile.getBoundingClientRect();
      _fileMenu.style.left = Math.round(Math.max(6, Math.min(r.left, window.innerWidth - _fileMenu.offsetWidth - 6))) + 'px';
    };
    let fTimer = null, fLong = false;
    _bFile.addEventListener('pointerdown', () => { fLong = false; fTimer = setTimeout(() => { fLong = true; openFile(); }, 500); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => _bFile.addEventListener(ev, () => { if (fTimer) { clearTimeout(fTimer); fTimer = null; } }));
    _bFile.addEventListener('click', () => { if (fLong) { fLong = false; return; } if (_fileMenu.style.display === 'flex') closeFile(); else openFile(); });
    _fileMenu.addEventListener('click', e => { if (e.target.closest('button')) setTimeout(closeFile, 0); });   // 項目選択で閉じる（各ボタンのonclick実行後）
    document.addEventListener('pointerdown', e => {
      if (_fileMenu.style.display === 'flex' && !_fileMenu.contains(e.target) && !_bFile.contains(e.target)) closeFile();
    }, true);
  }
  // 設定メニュー（スナップ／近接点のON/OFF。状態は記憶。旧「近接」トグルはここへ統合）
  const _bSet = $('cmdSet'), _setMenu = document.getElementById('setMenu');
  if (_bSet && _setMenu) {
    const cbS = document.getElementById('setSnap'), cbN = document.getElementById('setNear');
    const cbO = document.getElementById('setOrigin'), cbX = document.getElementById('setXpt');
    const cbG = document.getElementById('setGround');
    const cbB = document.getElementById('setBolt'), cbQ = document.getElementById('setQuad');
    const cbAG = document.getElementById('setAutoGsk');
    const syncSet = () => { if (cbS) cbS.checked = snapOn; if (cbN) cbN.checked = nearSnapOn; if (cbO) cbO.checked = showOriginPts; if (cbX) cbX.checked = showXpts; if (cbG) cbG.checked = showGround; if (cbB) cbB.checked = showBoltPts; if (cbQ) cbQ.checked = showQuadPts; if (cbAG) cbAG.checked = autoGasket; };
    const closeSet = () => { _setMenu.style.display = 'none'; _bSet.classList.remove('active'); };
    _bSet.onclick = () => {
      const open = _setMenu.style.display !== 'block';
      if (!open) { closeSet(); return; }
      syncSet();
      _setMenu.style.display = 'block';
      _bSet.classList.add('active');
      const r = _bSet.getBoundingClientRect();
      _setMenu.style.left = Math.round(Math.max(6, Math.min(r.left, window.innerWidth - _setMenu.offsetWidth - 6))) + 'px';
      if (r.top < window.innerHeight / 2) { _setMenu.style.top = Math.round(r.bottom + 8) + 'px'; _setMenu.style.bottom = 'auto'; }   // ボタンが上＝下へ開く
      else { _setMenu.style.top = 'auto'; _setMenu.style.bottom = '52px'; }
    };
    if (cbS) cbS.addEventListener('change', () => { snapOn = cbS.checked; try { localStorage.setItem('p3d_snap', snapOn ? '1' : '0'); } catch (e) {} });
    if (cbN) cbN.addEventListener('change', () => { nearSnapOn = cbN.checked; try { localStorage.setItem('p3d_near_snap', nearSnapOn ? '1' : '0'); } catch (e) {} });
    if (cbO) cbO.addEventListener('change', () => { showOriginPts = cbO.checked; _idleSig = null; try { localStorage.setItem('p3d_show_origin', showOriginPts ? '1' : '0'); } catch (e) {} });
    if (cbX) cbX.addEventListener('change', () => { showXpts = cbX.checked; if (window.__annXptsRefresh) window.__annXptsRefresh(); try { localStorage.setItem('p3d_show_xpt', showXpts ? '1' : '0'); } catch (e) {} });
    if (cbG) cbG.addEventListener('change', () => { showGround = cbG.checked; applyGround(); });
    if (cbB) cbB.addEventListener('change', () => { showBoltPts = cbB.checked; _idleSig = null; try { localStorage.setItem('p3d_show_boltpt', showBoltPts ? '1' : '0'); } catch (e) {} });
    if (cbQ) cbQ.addEventListener('change', () => { showQuadPts = cbQ.checked; _idleSig = null; try { localStorage.setItem('p3d_show_quad', showQuadPts ? '1' : '0'); } catch (e) {} });
    if (cbAG) cbAG.addEventListener('change', () => { autoGasket = cbAG.checked; try { localStorage.setItem('p3d_auto_gasket', autoGasket ? '1' : '0'); } catch (e) {} });
    // ---- 既定EL（配置・描き始めの高さ。2026-08-02 社長指示・既定+1000mm） ----
    { const elIn = document.getElementById('setDefEl');
      if (elIn) {
        elIn.value = defaultEl;
        elIn.addEventListener('change', () => {
          const v = parseFloat(elIn.value);
          if (isFinite(v)) { defaultEl = v; try { localStorage.setItem('p3d_default_el', String(v)); } catch (e) {} }
          elIn.value = defaultEl;
          HOME.pos.y = 0.75 + defaultElY(); HOME.target.y = defaultElY();   // ホーム視点も新しい高さを見る
        });
        ['pointerdown', 'click'].forEach(ev => elIn.addEventListener(ev, e => e.stopPropagation()));
      }
    }
    // ---- 印刷に載せる欄（既定＝すべて載せる。2026-07-31 社長指示で画面の折りたたみと分離） ----
    for (const [id, key] of [['setPrintIl', 'p3d_print_il'], ['setPrintSpec', 'p3d_print_spec'], ['setPrintInfo', 'p3d_print_info']]) {
      const cb = document.getElementById(id);
      if (!cb) continue;
      try { cb.checked = localStorage.getItem(key) !== '0'; } catch (e) { cb.checked = true; }
      cb.addEventListener('change', () => { try { localStorage.setItem(key, cb.checked ? '1' : '0'); } catch (e) {} });
    }
    // ---- 溶接・切寸の設定（配管化③）：SOP控え・BWルートギャップを呼び径×Schで編集 ----
    { const bW = document.getElementById('setWeld');
      if (bW) {
        let dlg = null, schSel = null;
        const buildDlg = () => {
          if (dlg) return;
          dlg = document.createElement('div');
          dlg.id = 'weldDlg';
          dlg.style.cssText = 'position:fixed;z-index:120;left:50%;top:50%;transform:translate(-50%,-50%);display:none;flex-direction:column;' +
            'max-height:82vh;width:360px;background:rgba(248,250,253,.98);border:1px solid #7fa8e8;border-radius:10px;box-shadow:0 8px 30px rgba(20,40,80,.3);' +
            'font:12px Meiryo,sans-serif;color:#33405c;padding:10px 12px;gap:6px';
          dlg.innerHTML =
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><b>溶接・切寸の設定</b>' +
            '<select id="weldSch" style="background:#fff;border:1px solid #c4ccda;border-radius:5px;padding:2px 4px"></select>' +
            '<span style="flex:1"></span><button id="weldReset" style="border:none;border-radius:6px;padding:3px 8px;background:#e2e7f0;cursor:pointer;font:inherit">このSchを既定に戻す</button>' +
            '<button id="weldClose" style="border:none;border-radius:6px;padding:3px 10px;background:#2f6fd8;color:#fff;cursor:pointer;font:inherit">閉じる</button></div>' +
            '<div style="opacity:.75">面基準：切寸＝図面長さ−SOP控え−BWギャップ÷2（ギャップ0は+0.5）。控え既定＝肉厚×1.414+3。変えた値だけ記憶・青太字</div>' +
            '<div style="overflow:auto"><table id="weldTblUI" style="border-collapse:collapse;width:100%"></table></div>';
          document.body.appendChild(dlg);
          schSel = dlg.querySelector('#weldSch');
          for (const s of PIPE_SCHEDULES) schSel.add(new Option(s, s));
          schSel.addEventListener('change', renderTbl);
          dlg.querySelector('#weldClose').onclick = () => { dlg.style.display = 'none'; };
          dlg.querySelector('#weldReset').onclick = () => {
            for (const s of FLANGE_SIZES) { setWeldVal(s, schSel.value, 'sop', ''); setWeldVal(s, schSel.value, 'gap', ''); setWeldVal(s, schSel.value, 'swc', ''); }
            renderTbl();
          };
          ['pointerdown', 'click'].forEach(ev => dlg.addEventListener(ev, e => e.stopPropagation()));
        };
        const renderTbl = () => {
          const tb = dlg.querySelector('#weldTblUI'), sch = schSel.value;
          const cell = 'border:1px solid #d5dce8;padding:3px 6px;text-align:center';
          let h = `<tr><th style="${cell}">呼び径</th><th style="${cell}">肉厚</th><th style="${cell}">SOP控え(mm)</th><th style="${cell}">ﾙｰﾄｷﾞｬｯﾌﾟ(mm)</th><th style="${cell}">SWｸﾘｱﾗﾝｽ(mm)</th></tr>`;
          for (const s of FLANGE_SIZES) {
            const v = weldValsOf(s, sch);
            const ov = weldTbl[s + '|' + sch] || {};
            const inp = (key, val, isOv) => `<input data-size="${s}" data-key="${key}" type="number" step="0.1" min="0" value="${val}" ` +
              `style="width:56px;text-align:right;border:1px solid #c4ccda;border-radius:4px;padding:1px 3px;background:#fff;color:${isOv ? '#1d5fd0' : '#2a3550'};font-weight:${isOv ? '700' : '400'}">`;
            h += `<tr><td style="${cell}">${s}</td><td style="${cell}">${pipeWall(s, sch)}</td>` +
                 `<td style="${cell}">${inp('sop', v.sop, ov.sop != null)}</td><td style="${cell}">${inp('gap', v.gap, ov.gap != null)}</td><td style="${cell}">${inp('swc', v.swc, ov.swc != null)}</td></tr>`;
          }
          tb.innerHTML = h;
          tb.querySelectorAll('input').forEach(el => el.addEventListener('change', () => {
            setWeldVal(el.dataset.size, schSel.value, el.dataset.key, el.value);
            renderTbl();
          }));
        };
        bW.onclick = () => {
          buildDlg(); closeSet();
          schSel.value = PIPE_SCHEDULES.includes(pipeOpts.sch) ? pipeOpts.sch : 'Sch40';
          renderTbl();
          dlg.style.display = 'flex';
        };
      }
    }
    document.addEventListener('pointerdown', e => {
      if (_setMenu.style.display === 'block' && !_setMenu.contains(e.target) && !_bSet.contains(e.target)) closeSet();
    }, true);
  }
  $('cmdTplSave').onclick = saveDwgTemplate;   // 図面情報を既定として記憶
  $('cmdPrint').onclick = () => printSheet();                     // 実体図（従来）
  { const b = $('cmdPrintSL'); if (b) b.onclick = () => printSheet('single'); }   // 単線アイソメ図（2026-07-29 第1段）
  $('cmdPng').onclick = exportPng;
  $('cmdLine').onclick = () => setDrawMode('line');
  { const b = $('cmdSweep'); if (b) b.onclick = sweepCmd; }   // 配管化コマンド（2026-07-29 社長要望）
  $('cmdXline').onclick = () => setDrawMode('xline');
  $('cmdCircle').onclick = () => setDrawMode('circle');
  $('cmdDim').onclick = () => setDrawMode('dim');
  $('cmdText').onclick = () => setDrawMode('text');
  // 明暗ボタンは廃止（2026-07-19 社長決定＝統一グレーに一本化）
  $('cmdDup').onclick = duplicate;
  $('cmdMirror').onclick = mirror;
  // リボンの「回転」コマンドは廃止（2026-08-02 社長判断）。起点を決めて 方位角／立面角／回転 で3軸とも回せる
  // ようになったため、鉛直軸まわりだけの回転コマンドは役目を終えた。角度の数値入力はボタン長押しの角度スピナーで行う。
  // （rotateCmd 等の実装は内部に残置＝他コマンドの解除処理から参照されるため）
  // 詳細図：タップ＝枠モード/登録、長押し＝一覧（プレビュー・名前編集・削除）。2026-07-21 社長要望
  { const b = $('cmdDetail');
    if (b) {
      let t = null, longed = false;
      const clr = () => { if (t) { clearTimeout(t); t = null; } };
      b.addEventListener('pointerdown', () => { longed = false; clr(); t = setTimeout(() => { longed = true; if (window.__detailOpenList) window.__detailOpenList(); }, 500); });
      b.addEventListener('pointerup', clr);
      b.addEventListener('pointerleave', clr);
      b.addEventListener('click', () => { if (longed) { longed = false; return; } if (window.__addDetailArea) window.__addDetailArea(); });
    }
  }
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
  // ---- ヘルプ＝項目（h3）ごとに折りたたみ＋キーワード検索（2026-07-19 社長要望） ----
  (function helpAccordion() {
    const body = helpPanel && helpPanel.querySelector('.hp-body');
    if (!body) return;
    const sBox = document.createElement('input');
    sBox.id = 'helpSearch'; sBox.type = 'search';
    sBox.placeholder = 'キーワード検索（例：スイープ 部分削除 切寸 印刷）';
    body.prepend(sBox);
    // キーワード検索のみ＝一覧は出さない（2026-07-30 社長指示）。空欄の間は案内文だけ
    const hint = document.createElement('div');
    hint.id = 'helpHint';
    hint.style.cssText = 'color:#9fb2d6;font-size:12px;line-height:1.8;padding:4px 2px 8px;';
    hint.textContent = 'キーワードを入力すると、該当する使い方だけが表示されます。複数語はスペース区切り（AND）。例：「スイープ 円」「フランジ 挿入」「切寸 ギャップ」「印刷 詳細図」';
    sBox.after(hint);
    // h3ごとに<details>（折りたたみ）へ包み直す。既定＝すべてたたむ
    const secs = [];
    for (const h of [...body.querySelectorAll('h3')]) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = h.textContent;
      det.appendChild(sum);
      let n = h.nextSibling;
      while (n && !(n.nodeType === 1 && n.tagName === 'H3')) { const nx = n.nextSibling; det.appendChild(n); n = nx; }
      h.replaceWith(det);
      det.style.display = 'none';   // 検索のみ＝初期状態では一覧を出さない
      secs.push(det);
    }
    // 検索＝スペース区切りのAND。ヒットした行(li)だけ表示し、その項目を開く。空欄＝何も出さない（検索のみ）
    sBox.addEventListener('input', () => {
      const terms = sBox.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      hint.style.display = terms.length ? 'none' : '';
      for (const det of secs) {
        const titleHit = terms.length && terms.every(w => det.querySelector('summary').textContent.toLowerCase().includes(w));
        let secHit = titleHit;
        for (const li of det.querySelectorAll('li')) {
          const hit = titleHit || (terms.length && terms.every(w => li.textContent.toLowerCase().includes(w)));
          li.style.display = hit ? '' : 'none';
          if (hit) secHit = true;
        }
        det.style.display = (terms.length && secHit) ? '' : 'none';
        det.open = !!(terms.length && secHit);
      }
    });
    sBox.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); sBox.blur(); } });   // Escはヘルプを閉じずに検索欄だけ抜ける
  })();

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
    ['linear',   '長さ', '水平/垂直の距離'],
    ['parallel', '平行', '2点間の距離'],
    ['angle',    '角度', '水平からの傾き'],
    ['radius',   '半径', '中心→縁＝R'],
    ['diameter', '直径', '差し渡し＝⌀'],
    ['leader',   '引出', '注記の引出線'],
  ];
  const dimKindMenu = document.createElement('div');
  dimKindMenu.id = 'dimKindMenu';
  dimKindMenu.innerHTML = '<div class="dk-ttl">寸法の種別</div>' +
    DIM_KINDS.map(([k, n, d]) => `<button class="dk-bt" data-kind="${k}">${n}<small>${d}</small></button>`).join('') +
    '<div class="dk-ttl">自動（下書き→タップで除外→確定）</div>' +
    '<button class="dk-bt" data-act="autodim">自動採寸<small>芯々・端面・EL・ボス位置を一括記入</small></button>' +
    '<button class="dk-bt" data-act="weldno">溶接番号<small>溶接口へ W1,W2… を自動付番</small></button>';
  document.body.appendChild(dimKindMenu);
  function markDimKindActive() {
    dimKindMenu.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('on', b.dataset.kind === dimKind));
  }
  function updateDimBtnTitle() {
    const b = $('cmdDim'); if (b) b.title = `寸法：${DIM_KIND_LABEL[dimKind] || '長さ'}（右クリックで 長さ/平行/角度/半径/直径/引出・自動採寸・溶接番号）`;
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
    const act = e.target.closest('[data-act]');
    if (act) { closeDimKindMenu(); if (act.dataset.act === 'autodim') autoDimStart(); else weldNumStart(); return; }
    const el = e.target.closest('[data-kind]'); if (!el) return;
    dimKind = el.dataset.kind;                            // 以後に引く寸法へ適用（既存の寸法は変えない）
    markDimKindActive(); updateDimBtnTitle();
    if (drawState.mode !== 'dim') setDrawMode('dim');
    closeDimKindMenu();
  });
  updateDimBtnTitle();

  // ---- 文字の書式メニュー（リボン「文字」右クリック：色＋飾り） ----
  const TEXT_COLORS = [['青', 0x4a9bff], ['白', 0xffffff], ['黒', 0x000000], ['赤', 0xff4040]];   // 青＝線（点線）と同色（2026-07-20 社長）
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
  // ===== iPad/タッチ：右クリックが無いので「アイコン長押し」で同じメニューを開く =====
  // メニューはアイコンの上に出る＝指(ボタン上)とは重ならないので、離しても誤選択しない。
  // 長押しで開いた直後の「そのボタンへのタップ(=ツール起動)」だけを1回無効化する。
  let _lpSuppressClick = false, _lpBtn = null;
  window.addEventListener('click', e => {
    if (_lpSuppressClick && _lpBtn && (e.target === _lpBtn || _lpBtn.contains(e.target))) {
      _lpSuppressClick = false; e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
  function bindLongPress(btn, openFn) {
    if (!btn) return;
    let timer = null, sx = 0, sy = 0;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    btn.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;     // マウスは従来どおり右クリックでメニュー
      sx = e.clientX; sy = e.clientY; clear();
      timer = setTimeout(() => {
        timer = null; _lpSuppressClick = true; _lpBtn = btn;
        setTimeout(() => { _lpSuppressClick = false; }, 1000);   // 念のための自動解除（タップが来なくても残さない）
        const r = btn.getBoundingClientRect();
        openFn(r.left, r.top);
      }, 500);   // 0.5秒押し続けたら長押し成立
    });
    btn.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clear(); });
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointercancel', clear);
  }
  bindLongPress($('cmdLine'),   (x, y) => openToolFmtMenu('line', x, y));
  bindLongPress($('cmdCircle'), (x, y) => openToolFmtMenu('circle', x, y));
  bindLongPress($('cmdDim'),    (x, y) => { closeFmtMenu(); openDimKindMenu(x, y); });
  bindLongPress($('cmdText'),   (x, y) => { closeFmtMenu(); closeDimKindMenu(); openTextMenu(x, y); });
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
  let collapsed = true;   // 既定＝たたむ（2026-07-19 社長要望。開閉は記憶）
  const applyIl = () => {
    body.classList.toggle('fold', collapsed);   // 高さ補間でゆっくり開閉（display切替はしない）
    if (caret) caret.textContent = collapsed ? '▸' : '▾';
    head.title = collapsed ? 'クリックで展開' : 'クリックで折りたたみ';
    try { localStorage.setItem('p3d_il_open', collapsed ? '0' : '1'); } catch (e) {}
  };
  head.addEventListener('click', () => { collapsed = !collapsed; applyIl(); });
  try { collapsed = localStorage.getItem('p3d_il_open') !== '1'; } catch (e) {}
  applyIl();
  // 図面仕様パネル（アイテムリストの横）の開閉
  const specHead = document.getElementById('specHead');
  const specBody = document.getElementById('specBodyWrap');
  const specCaret = document.getElementById('specCaret');
  if (specHead && specBody) {
    let specCollapsed = true;   // 既定＝たたむ（2026-07-19 社長要望。開閉は記憶）
    const applySpec = () => {
      specBody.style.display = specCollapsed ? 'none' : '';
      if (specCaret) specCaret.textContent = specCollapsed ? '▸' : '▾';
      specHead.title = specCollapsed ? 'クリックで展開' : 'クリックで折りたたみ';
      try { localStorage.setItem('p3d_spec_open', specCollapsed ? '0' : '1'); } catch (e) {}
    };
    specHead.addEventListener('click', () => { specCollapsed = !specCollapsed; applySpec(); });
    try { specCollapsed = localStorage.getItem('p3d_spec_open') !== '1'; } catch (e) {}
    applySpec();
  }
  // 図面情報（年月日・場所・名称・図番・社名）の開閉（2026-07-18 社長要望：作図中は畳んで広く使う。状態を記憶）
  const dwgHead = document.getElementById('dwgHead');
  const dwgFoot = document.getElementById('dwgFoot');
  const dwgCaret = document.getElementById('dwgCaret');
  if (dwgHead && dwgFoot) {
    let dwgCollapsed = false;
    const applyDwg = () => {
      dwgFoot.style.display = dwgCollapsed ? 'none' : '';
      if (dwgCaret) dwgCaret.textContent = dwgCollapsed ? '▸' : '▾';
      dwgHead.title = dwgCollapsed ? 'クリックで展開' : 'クリックで折りたたみ';
      try { localStorage.setItem('p3d_dwg_open', dwgCollapsed ? '0' : '1'); } catch (e) {}
    };
    dwgHead.addEventListener('click', () => { dwgCollapsed = !dwgCollapsed; applyDwg(); });
    if (localStorage.getItem('p3d_dwg_open') === '0') { dwgCollapsed = true; applyDwg(); }
  }
  // アイテムパレット（左上）の開閉（同・状態を記憶）
  const palTitle = document.getElementById('palTitle');
  const palEl = document.getElementById('palette');
  const palCaret = document.getElementById('palCaret');
  if (palTitle && palEl) {
    let palCollapsed = true;   // 既定＝たたむ（2026-07-19 社長要望。開いた状態は記憶で復元）
    const applyPal = () => {
      palEl.classList.toggle('collapsed', palCollapsed);
      if (palCaret) palCaret.textContent = palCollapsed ? '▸' : '▾';
      palTitle.title = palCollapsed ? 'クリックで展開' : 'クリックで折りたたみ';
      try { localStorage.setItem('p3d_pal_open', palCollapsed ? '0' : '1'); } catch (e) {}
    };
    palTitle.addEventListener('click', () => { palCollapsed = !palCollapsed; applyPal(); });
    try { palCollapsed = localStorage.getItem('p3d_pal_open') !== '1'; } catch (e) {}
    applyPal();
  }
})();

// ===================================================================
//  「コマンドを押してから選択」の実行判定（2026-07-27 社長要望）
//  複製・鏡・回転は、何も選ばずに押すとボタンが点灯して選択待ちになる。
//  実行の判定は、部品・線の選択処理が全部終わってから行う必要があるため、
//  ・このファイルの末尾で登録（イベントの登録順＝実行順）
//  ・さらに setTimeout(0) で同期処理をすべて終わらせてから見る
//  の二段で確実に「選択が確定したあと」に評価する。
// ===================================================================
window.addEventListener('pointerup', () => {
  if (window.__hasPendingCmd && window.__hasPendingCmd()) setTimeout(() => { if (window.__runPendingCmd) window.__runPendingCmd(); }, 0);
});
