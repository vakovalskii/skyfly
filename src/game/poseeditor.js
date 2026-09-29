// Браузерная студия: клипы модели → собственные ключевые кадры → действия игры.
import { STATES, EDIT_BONES, DEFAULT_SETUP, loadSetup, saveSetup, normalizeSetup } from '../render/flypose.js';
import { CUSTOM_PREFIX, MAX_DURATION, putFrame, addFrame, previousFrame, copyPreviousFrame, reorderFrame, moveFrameTime, resizeAnimation } from '../render/animation-data.js';
import { createPoseViewport } from './poseviewport.js';
import { createFlightSuite } from '../render/flight-suite.js';
import { cycleFromFirstFrame } from '../render/animation-recipes.js';
import { createAnimationStorage } from './animation-storage.js';
import { createPoseThumbnails } from './pose-thumbnails.js';
import { clipLabel, isLibraryClip } from '../render/animation-catalog.js';
import { createReadyActions } from '../render/ready-actions.js';
import { createFlightTransitions } from '../render/flight-transitions.js';
import './poseeditor.css';

const copy = (v) => structuredClone(v);
const degrees = (v) => v * 180 / Math.PI;
const radians = (v) => v * Math.PI / 180;

export function createPoseEditor({ hero, character, animations, onToggle }) {
  let open = false, setup = loadSetup(), state = 'idle', bone = 'DEF-upper_armL';
  let panel, viewport, thumbnails, dragFrame = null, poseClipboard = null, playing = false, time = 0, raf = 0, last = 0, saveTimer;
  let gesture = false, previousFocus, previousInert = [], past = [], future = [];
  let framedState = null, framedClip = null;
  let status = 'Подключаем сохранение анимаций…', statusError = false;
  const $ = (id) => panel.querySelector(`#ped-${id}`);
  const custom = () => setup.animations[setup.clips[state]?.slice(CUSTOM_PREFIX.length)];
  const isCustom = () => setup.clips[state]?.startsWith(CUSTOM_PREFIX) && !!custom();
  const duration = () => viewport?.model.userData.getDuration(state) || 1;
  const snapshot = () => ({ setup: copy(setup), state, time });
  const launcher = document.createElement('button');
  launcher.id = 'pose-editor-launch'; launcher.innerHTML = 'Анимации<kbd>P</kbd>';
  launcher.onclick = () => api.toggle();
  const bar = document.getElementById('bar');
  if (bar) bar.insertBefore(launcher, document.getElementById('b-snd')); else document.body.append(launcher);
  const startLauncher = document.createElement('button');
  startLauncher.id = 'pose-editor-start'; startLauncher.textContent = 'Открыть студию анимаций';
  startLauncher.onclick = () => api.toggle(); document.getElementById('start')?.append(startLauncher);
  hero().userData.character = character;

  function message(text, error = false) {
    status = text; statusError = error;
    if (panel) { $('status').textContent = text; $('status').classList.toggle('error', error); }
  }
  function persist() {
    clearTimeout(saveTimer);
    try { saveSetup(setup); message(storage.enabled ? 'Записываем в проект…' : 'Сохранено в этом браузере'); storage.save(); }
    catch (error) { message(`Не удалось сохранить: ${error.message}. Скачайте JSON.`, true); }
  }
  function pushHistory() { past.push(snapshot()); if (past.length > 40) past.shift(); future = []; }
  function apply() {
    hero().userData.setSetup(setup);
    viewport?.model.userData.setSetup(setup);
    storage.markDirty();
    clearTimeout(saveTimer); saveTimer = setTimeout(persist, 450);
    message('Сохраняем…');
  }
  function change(fn, full = true) {
    const before = snapshot();
    if (!gesture) pushHistory();
    try { fn(); apply(); if (full) sync(); else syncTimeline(); }
    catch (error) { setup = before.setup; time = before.time; if (!gesture) past.pop(); sync(); message(error.message, true); }
  }
  function undo(redo = false) {
    const source = redo ? future : past, target = redo ? past : future;
    if (!source.length) return;
    target.push(snapshot());
    const old = source.pop(); setup = old.setup; state = old.state; time = old.time;
    playing = false; apply(); sync();
  }
  function sample() { if (viewport && !viewport.editing) viewport.model.userData.preview(state, time, false); }
  function pose() { return viewport.model.userData.capturePose(); }
  function stop() { playing = false; syncTimeline(); }
  function setTime(value) { stop(); time = Math.max(0, Math.min(duration(), Number(value) || 0)); sample(); syncTimeline(); syncBones(); }
  function navigateFrame(direction) {
    if (!isCustom()) return;
    const frames = custom().frames;
    const next = direction < 0 ? frames.findLast(f => f.time < time - .002) : frames.find(f => f.time > time + .002);
    if (!next) return;
    setTime(next.time);
    $('frames').querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function createAnimation(bake = false, keepTime = false) {
    const previousTime = time;
    stop(); sample();
    const originalPose = pose(), length = bake ? Math.min(MAX_DURATION, duration()) : 1;
    const frames = [];
    if (bake) {
      const count = Math.min(120, Math.max(2, Math.ceil(length * 20)));
      for (let i = 0; i <= count; i++) {
        const t = i * length / count;
        viewport.model.userData.preview(state, t, false);
        frames.push({ time: t, pose: pose() });
      }
    } else frames.push({ time: 0, pose: originalPose }, { time: length, pose: copy(originalPose) });
    {
      if (Object.keys(setup.animations).length >= 64) throw new Error('Достигнут предел: 64 анимации');
      const id = crypto.randomUUID();
      setup.animations[id] = { name: `${STATES.find(([s]) => s === state)[1]} — ${bake ? 'копия' : 'моя анимация'}`, duration: length, loop: !['jump', 'land', 'flystart', 'flystop', 'booststart'].includes(state), frames };
      setup.clips[state] = CUSTOM_PREFIX + id;
      setup.poses[state] = { tilt: 0, bones: {}, positions: {} };
      setup.speed[state] = 1; time = keepTime ? previousTime : 0;
    }
  }
  function newAnimation(bake = false, keepTime = false) {
    change(() => createAnimation(bake, keepTime));
    if (keepTime) viewport.model.userData.preview(state, time, false);
    else { $('name').focus(); $('name').select(); }
  }
  function writePose(fn) {
    if (!isCustom()) newAnimation(true, true);
    stop(); sample();
    const p = pose(); fn(p);
    change(() => putFrame(custom(), time, p), false);
    sample(); syncBones();
  }
  function makeOptions() {
    const select = $('clip'); select.replaceChildren();
    select.add(new Option('Без клипа · исходная поза', ''));
    for (const [label, entries] of [
      ['Мои анимации', Object.entries(setup.animations).map(([id, a]) => [CUSTOM_PREFIX + id, a.name])],
      ['Готовые движения · Quaternius 2', animations.filter(isLibraryClip).map(a => [a, clipLabel(a)])],
      ['Анимации модели', animations.filter(a => !isLibraryClip(a)).map((a) => [a, a])],
    ]) {
      const group = document.createElement('optgroup'); group.label = label;
      for (const [value, name] of entries) group.append(new Option(name, value));
      select.append(group);
    }
    const current = setup.clips[state] || '';
    if (current && ![...select.options].some((o) => o.value === current)) select.add(new Option(`Недоступен: ${current}`, current));
    select.value = current;
  }
  function syncTimeline() {
    if (!panel) return;
    const len = duration();
    $('scrub').max = len; $('scrub').value = time;
    $('time').textContent = `${time.toFixed(2)} / ${len.toFixed(2)} с`;
    $('play').textContent = playing ? 'Ⅱ Пауза' : '▶ Смотреть';
    const own = isCustom();
    $('add').disabled = false;
    $('copy-previous').disabled = !own || !previousFrame(custom(), time);
    $('frame-count').textContent = own ? `Кадров: ${custom().frames.length}` : '';
    $('remove-frame').disabled = !own || custom().frames.length < 2 || !custom().frames.some((f) => Math.abs(f.time - time) < 0.002);
    const selectedIndex = own ? custom().frames.findIndex(f => Math.abs(f.time - time) < .002) : -1;
    $('paste-pose').disabled = !poseClipboard;
    $('paste-pose').title = poseClipboard ? `Вставить: ${poseClipboard.label}` : 'Сначала скопируйте позу любого действия';
    $('frame-time').disabled = selectedIndex < 0;
    $('frame-time').max = len; $('frame-time').value = time.toFixed(3);
    $('frame-left').disabled = !own || !custom().frames.some(f => f.time < time - .002);
    $('frame-right').disabled = !own || !custom().frames.some(f => f.time > time + .002);
    const frames = $('frames'); thumbnails?.reset(); frames.replaceChildren();
    if (own) custom().frames.forEach((f, index) => {
      const button = document.createElement('button'); button.className = 'ped-frame-card'; button.draggable = true;
      const image = document.createElement('img'); image.alt = ''; image.draggable = false; image.width = 96; image.height = 66;
      const label = document.createElement('span'); label.textContent = `${index + 1} · ${f.time.toFixed(3)} с`;
      button.append(image, label);
      button.title = `Кадр ${index + 1}: ${f.time.toFixed(3)} с. Перетащите для перестановки.`;
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', index === selectedIndex);
      button.onclick = () => setTime(f.time);
      button.ondragstart = e => { playing = false; dragFrame = { index, animation: custom() }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(index)); };
      button.ondragover = e => { if (dragFrame?.animation === custom()) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; button.classList.add('drop-target'); } };
      button.ondragleave = () => button.classList.remove('drop-target');
      button.ondragend = () => { dragFrame = null; frames.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target')); };
      button.ondrop = e => {
        e.preventDefault(); const dragged = dragFrame; dragFrame = null;
        if (dragged?.animation === custom() && dragged.index !== index) change(() => { time = reorderFrame(custom(), dragged.index, index); });
      };
      frames.append(button); thumbnails?.observe(image, state, f.pose);
    });
    else frames.textContent = 'Готовый клип. «+ Кадр» или «Из клипа» создаст редактируемую копию.';
    $('undo').disabled = !past.length; $('redo').disabled = !future.length;
  }
  function syncBones() {
    if (!viewport) return;
    const p = pose(), body = bone === '__body__', values = (body ? p.offset : p.bones[bone]) || [0, 0, 0];
    $('rotate').disabled = body;
    $('rotate').setAttribute('aria-pressed', viewport.modeValue === 'rotate');
    $('translate').setAttribute('aria-pressed', viewport.modeValue === 'translate');
    for (const [i, axis] of [...'xyz'].entries()) {
      const value = body ? values[i] : degrees(values[i]);
      for (const kind of ['rot', 'num']) {
        const input = $(`${kind}-${axis}`);
        input.min = body ? -10 : -180; input.max = body ? 10 : 180; input.step = body ? 0.01 : 1;
        input.setAttribute('aria-label', body ? `Смещение тела ${axis.toUpperCase()}, м` : `Поворот ${axis.toUpperCase()}, °`);
      }
      $(`rot-${axis}`).value = value; $(`num-${axis}`).value = value.toFixed(body ? 3 : 1);
      $(`rot-${axis}`).disabled = $(`num-${axis}`).disabled = false;
    }
    $('tilt').value = degrees(p.tilt).toFixed(1); $('tilt').disabled = false;
    $('reset-bone').disabled = false;
    $('reset-bone').textContent = body ? 'Тело в исходное положение' : 'Исходный поворот кости';
    $('axis-caption').textContent = body ? 'Смещение всего тела, м · Y — вверх/вниз' : 'Поворот кости, °';
  }
  function sync() {
    if (!panel) return;
    for (const button of panel.querySelectorAll('[data-state]')) {
      button.setAttribute('aria-pressed', button.dataset.state === state);
      const assigned = setup.clips[button.dataset.state];
      button.querySelector('small').textContent = assigned?.startsWith(CUSTOM_PREFIX) ? 'своя' : 'клип';
    }
    makeOptions();
    const own = isCustom();
    $('name').disabled = !own; $('name').value = own ? custom().name : setup.clips[state] || 'Исходная поза';
    $('duration').disabled = !own; $('duration').value = duration().toFixed(3);
    $('loop').disabled = !own; $('loop').checked = own ? custom().loop : !['jump', 'land'].includes(state);
    $('speed').value = setup.speed[state] ?? 1;
    $('cape-enabled').checked = setup.cape?.enabled !== false;
    $('cape-strength').value = setup.cape?.strengths?.[state] ?? .4;
    $('delete').disabled = !own;
    $('delete').textContent = setup.clips[state] === 'custom:hero-flight' ? 'Восстановить базовый полёт' : 'Удалить анимацию';
    $('loop-pose').disabled = !own;
    $('first-cycle').disabled = !own;
    $('flight-suite').disabled = !own || state !== 'fly';
    $('bone').value = bone;
    time = Math.min(time, duration()); sample();
    viewport.bone(bone, $('gizmo').checked);
    syncBones(); syncTimeline();
    const clip = isCustom() ? custom() : setup.clips[state];
    if (state !== framedState || clip !== framedClip) {
      viewport.frameClip(state, time); framedState = state; framedClip = clip;
    }
  }
  function build() {
    panel = document.createElement('section'); panel.id = 'ped'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'ped-title');
    panel.innerHTML = `
      <header><div><h1 id="ped-title">Студия анимаций</h1><p class="ped-subtitle">Выберите действие → создайте анимацию → поставьте ключевые кадры</p></div>
        <div class="ped-tools"><button id="ped-undo" title="Ctrl / ⌘ Z">↶ Отменить</button><button id="ped-redo" title="Ctrl / ⌘ Shift Z">↷</button>
          <button id="ped-save">Сохранить</button><button id="ped-export">Скачать JSON</button><button id="ped-import">Загрузить JSON</button><button id="ped-close" aria-label="Закрыть редактор">✕</button></div></header>
      <div class="ped-workspace">
        <aside class="ped-actions"><h2>Действия персонажа</h2>
          <button id="ped-ready-actions" class="primary">Оживить три режима полёта</button>
          <button id="ped-flight-transitions">Создать переходы полёта</button>
          <p class="ped-hint">Готовые циклы из первых поз: зависание, полёт, форсаж. Исходники остаются в «Моих анимациях».</p>
          ${STATES.map(([s, name]) => `<button class="ped-state" data-state="${s}"><span>${name}</span><small></small></button>`).join('')}
          <div class="ped-section"><h2>Назначенная анимация</h2><label class="ped-field"><span>Клип для выбранного действия</span><select id="ped-clip"></select></label>
          <div class="ped-tools"><button id="ped-new" class="primary">Новая</button><button id="ped-bake">Из клипа</button></div>
          <p class="ped-hint">«Новая» оживляет текущую позу. «Из клипа» копирует всё движение. Выберите свою анимацию в списке, чтобы назначить её другому действию.</p>
          <label class="ped-field"><span>Название своей анимации</span><input id="ped-name" maxlength="80"></label>
          <label class="ped-field"><span>Скорость в игре и просмотре</span><input id="ped-speed" type="number" min="0" max="3" step="0.05"></label>
          <button id="ped-delete" class="ped-danger">Удалить анимацию</button>
          <div id="ped-storage-conflict" hidden><p class="ped-hint">Файл проекта и поза в браузере различаются. Обе версии сохранятся: прежний файл — в резервных копиях, прежняя поза — в истории студии.</p><div class="ped-tools"><button id="ped-keep-browser">Моя поза → в проект</button><button id="ped-load-project">Загрузить из проекта</button></div></div>
          </div></aside>
        <div id="ped-stage" class="ped-stage"><div class="ped-view-tools"><button data-view="front">Спереди</button><button data-view="side">Сбоку</button><button data-view="back">Сзади</button><button id="ped-center">Вся анимация</button></div>
          <div class="ped-stage-caption">Тяните сустав — поза · фон — обзор · колесо / два пальца — масштаб</div></div>
        <aside class="ped-inspector"><h2>Поза в текущем кадре</h2>
          <label class="ped-field"><span>Базовая поза</span><select id="ped-preset">${STATES.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}<option value="__rest__">Исходная поза модели</option></select></label>
          <button id="ped-apply-preset">Применить к кадру</button>
          <p class="ped-hint">Первый кадр выбранного действия. Меняется только текущий кадр; дальше позу можно править вручную.</p>
          <label class="ped-field"><span>Что редактируем</span><select id="ped-bone"></select></label>
          <label class="ped-field"><input id="ped-gizmo" type="checkbox" checked> Показать манипулятор</label>
          <div class="ped-tools"><button id="ped-rotate" aria-pressed="true">Крутить</button><button id="ped-translate" aria-pressed="false">Двигать</button></div><label class="ped-field"><input id="ped-skeleton" type="checkbox" checked> Скелет и точки суставов</label>
          <p id="ped-axis-caption" class="ped-hint">Поворот кости, °</p>
          ${[...'xyz'].map((a) => `<div class="ped-axis"><b>${a.toUpperCase()}</b><input id="ped-rot-${a}" aria-label="Поворот ${a.toUpperCase()}" type="range" min="-180" max="180" step="1"><input id="ped-num-${a}" aria-label="${a.toUpperCase()} в градусах" type="number" min="-180" max="180" step="1"></div>`).join('')}
          <button id="ped-reset-bone">Исходный поворот кости</button>
          <label class="ped-field"><span>Наклон всего тела, °</span><input id="ped-tilt" type="number" min="-180" max="180" step="1"></label>
          <label class="ped-field"><input id="ped-cape-enabled" type="checkbox"> Красный плащ</label>
          <label class="ped-field"><span>Колыхание плаща для этого действия</span><input id="ped-cape-strength" type="number" min="0" max="2" step="0.1"></label>
          <p class="ped-hint">0 — спокойно · 0,4 — лёгкий ветер · 0,8 — полёт · 1,3 — сильный поток. Сохраняется вместе с анимациями.</p>
          <p class="ped-hint">Тяните точку кисти или стопы — рука или нога сгибается вслед за ней. Кольца вращают выбранную кость. Первая правка готового клипа создаёт копию. Изменения записываются в кадр.</p>
          <div class="ped-section"><h2>Развить готовую позу</h2>
            <button id="ped-first-cycle" class="primary">Цикл из первого кадра</button>
            <button id="ped-flight-suite">Развить в набор полёта</button>
            <p class="ped-hint">Для действия «полёт»: создаёт из первого кадра отдельные зависание, полёт и форсаж. Исходник остаётся в библиотеке.</p>
            <p class="ped-hint">Новая анимация из твоей первой позы: лёгкое движение корпуса, без взмахов руками и ногами. Исходный клип останется в библиотеке.</p>
            <button id="ped-loop-pose">Первую позу → в конец</button>
          </div>
        </aside>
      </div>
      <section class="ped-timeline" aria-label="Шкала времени"><div class="ped-timebar">
        <button id="ped-play" class="primary">▶ Смотреть</button><button id="ped-start">В начало</button>
        <label>Длина, с <input id="ped-duration" type="number" min="0.1" max="30" step="0.1"></label>
        <label><input id="ped-loop" type="checkbox"> Повтор</label><button id="ped-add" title="Новый кадр из текущей позы; если время занято — после выбранного">+ Кадр</button><button id="ped-copy-previous" title="Скопировать позу предыдущего кадра на выбранное время">Копировать предыдущий</button><span id="ped-frame-count"></span><button id="ped-remove-frame">− Кадр</button>
      </div><div class="ped-track"><input id="ped-scrub" aria-label="Время анимации" type="range" min="0" max="1" step="0.001"><output id="ped-time"></output></div><div class="ped-frame-tools"><label>Время кадра, с <input id="ped-frame-time" type="number" min="0" step="0.01"></label><button id="ped-frame-left" title="Предыдущий кадр · ←">← Кадр</button><button id="ped-frame-right" title="Следующий кадр · →">Кадр →</button><button id="ped-copy-pose">Копировать позу</button><button id="ped-paste-pose">Вставить позу</button><span>Тяни карточки, чтобы менять порядок поз</span></div><div id="ped-frames" class="ped-frames"></div></section>
      <footer><span id="ped-status" role="status" aria-live="polite"></span><span class="ped-keyhint">← / → — кадры · Пробел — просмотр · Ctrl/⌘ Z — отмена · P / Esc — в игру</span></footer>
      <input id="ped-file" type="file" accept="application/json,.json" hidden>`;
    document.body.append(panel);
    viewport = createPoseViewport($('stage'), hero(), (event) => {
      if (event === 'start') { stop(); if (!isCustom()) newAnimation(true, true); else pushHistory(); gesture = true; }
      if (event === 'change' && isCustom()) {
        try { putFrame(custom(), time, pose()); apply(); syncBones(); syncTimeline(); }
        catch (error) { message(error.message, true); }
      }
      if (event === 'end') { gesture = false; sync(); }
    }, (name) => { bone = name; $('bone').value = bone; viewport.bone(bone, $('gizmo').checked); syncBones(); });
    viewport.model.userData.setSetup(setup);
    thumbnails = createPoseThumbnails(hero(), $('frames'));
    $('bone').add(new Option('Всё тело · перемещение', '__body__'));
    const labels = new Map(EDIT_BONES.map(([id, label]) => [id.replaceAll('.', ''), label]));
    for (const name of viewport.model.userData.bones.keys()) $('bone').add(new Option(labels.get(name) || name, name));
    if (!viewport.model.userData.bones.has(bone)) bone = viewport.model.userData.bones.keys().next().value;
    for (const b of panel.querySelectorAll('[data-state]')) b.onclick = () => { state = b.dataset.state; time = 0; playing = false; sync(); viewport.frameClip(state, time); };
    for (const b of panel.querySelectorAll('[data-view]')) b.onclick = () => { viewport.frameClip(state, time); viewport.view(b.dataset.view); };
    $('center').onclick = () => viewport.frameClip(state, time);
    $('ready-actions').onclick = () => change(() => {
      setup = createReadyActions(hero(), setup); state = 'hover'; time = 0; playing = true;
    });
    $('flight-transitions').onclick = () => change(() => {
      setup = createFlightTransitions(hero(), setup); state = 'flystart'; time = 0; playing = true;
    });
    $('clip').onchange = () => change(() => { setup.clips[state] = $('clip').value || null; setup.poses[state] = { tilt: 0, bones: {} }; time = 0; playing = false; });
    $('name').onchange = () => change(() => { custom().name = $('name').value.trim().slice(0, 80) || 'Моя анимация'; });
    $('speed').onchange = () => change(() => { setup.speed[state] = Math.max(0, Math.min(3, Number($('speed').value) || 0)); });
    $('duration').onchange = () => change(() => { resizeAnimation(custom(), Number($('duration').value)); time = Math.min(time, duration()); });
    $('loop').onchange = () => change(() => { custom().loop = $('loop').checked; });
    $('apply-preset').onclick = () => {
      stop();
      const source = $('preset').value;
      let base;
      if (source === '__rest__') base = copy(viewport.model.userData.restPose);
      else {
        const clip = setup.clips[source];
        const animation = clip?.startsWith(CUSTOM_PREFIX) ? setup.animations[clip.slice(CUSTOM_PREFIX.length)] : null;
        if (animation) base = copy(animation.frames[0].pose);
        else { viewport.model.userData.preview(source, 0, false); base = pose(); }
      }
      sample();
      change(() => {
        if (!isCustom()) createAnimation(true, true);
        putFrame(custom(), time, base);
      });
      viewport.frameClip(state, time);
    };
    $('bone').onchange = () => { bone = $('bone').value; viewport.bone(bone, $('gizmo').checked); syncBones(); };
    $('gizmo').onchange = () => viewport.bone(bone, $('gizmo').checked);
    $('skeleton').onchange = () => viewport.skeleton($('skeleton').checked);
    for (const mode of ['rotate', 'translate']) $(mode).onclick = () => {
      viewport.mode(mode); $('rotate').setAttribute('aria-pressed', mode === 'rotate'); $('translate').setAttribute('aria-pressed', mode === 'translate');
    };
    for (const [index, axis] of [...'xyz'].entries()) {
      for (const kind of ['rot', 'num']) {
        const input = $(`${kind}-${axis}`);
        input.onpointerdown = () => { if (isCustom()) { pushHistory(); gesture = true; } };
        input.onchange = () => { gesture = false; };
        input.oninput = () => {
          const value = Number(input.value); if (!Number.isFinite(value)) return;
          writePose((p) => {
            if (bone === '__body__') { p.offset ||= [0, 0, 0]; p.offset[index] = Math.max(-10, Math.min(10, value)); }
            else p.bones[bone][index] = radians(Math.max(-180, Math.min(180, value)));
          });
        };
      }
    }
    $('tilt').onchange = () => { const v = Number($('tilt').value); if (Number.isFinite(v)) writePose((p) => { p.tilt = radians(Math.max(-180, Math.min(180, v))); }); };
    $('cape-enabled').onchange = () => change(() => { setup.cape ||= copy(DEFAULT_SETUP.cape); setup.cape.enabled = $('cape-enabled').checked; });
    $('cape-strength').onchange = () => {
      const strength = Number($('cape-strength').value);
      if (Number.isFinite(strength)) change(() => { setup.cape ||= copy(DEFAULT_SETUP.cape); setup.cape.strengths[state] = Math.max(0, Math.min(2, strength)); });
    };
    $('reset-bone').onclick = () => writePose((p) => {
      if (bone === '__body__') p.offset = [0, 0, 0];
      else p.bones[bone] = copy(viewport.model.userData.restPose.bones[bone]);
    });
    $('loop-pose').onclick = () => { if (isCustom()) change(() => putFrame(custom(), duration(), custom().frames[0].pose)); };
    $('first-cycle').onclick = () => {
      if (!isCustom()) return;
      stop();
      change(() => {
        if (Object.keys(setup.animations).length >= 64) throw new Error('Достигнут предел: 64 анимации');
        const result = cycleFromFirstFrame(custom());
        const id = crypto.randomUUID(); setup.animations[id] = result;
        setup.clips[state] = CUSTOM_PREFIX + id;
        setup.poses[state] = { tilt: 0, bones: {}, positions: {} }; time = 0;
      });
      viewport.frameClip(state, time);
    };
    $('flight-suite').onclick = () => {
      if (!isCustom() || state !== 'fly') return;
      stop();
      change(() => {
        if (Object.keys(setup.animations).length > 61) throw new Error('Для набора нужны три свободных места в библиотеке');
        const suite = createFlightSuite(hero(), custom());
        for (const [action, animation] of Object.entries(suite)) {
          const id = crypto.randomUUID(); setup.animations[id] = animation;
          setup.clips[action] = CUSTOM_PREFIX + id; setup.speed[action] = 1;
          delete setup.poses[action];
        }
        time = 0;
      });
      viewport.frameClip(state, time);
    };
    $('new').onclick = () => newAnimation(); $('bake').onclick = () => newAnimation(true);
    $('delete').onclick = () => {
      if (setup.clips[state] === 'custom:hero-flight') {
        change(() => { setup.animations['hero-flight'] = copy(DEFAULT_SETUP.animations['hero-flight']); time = 0; });
        return;
      }
      if (!isCustom() || !confirm('Удалить эту анимацию? Её назначения вернутся к стандартным. Отмена доступна в студии.')) return;
      change(() => {
        const value = setup.clips[state]; delete setup.animations[value.slice(7)];
        for (const [s] of STATES) if (setup.clips[s] === value) { setup.clips[s] = DEFAULT_SETUP.clips[s]; setup.poses[s] = copy(DEFAULT_SETUP.poses[s] || { tilt: 0, bones: {} }); }
        time = 0;
      });
    };
    $('play').onclick = togglePlay;
    $('start').onclick = () => setTime(0);
    $('scrub').oninput = () => setTime($('scrub').value);
    $('add').onclick = () => {
      stop(); sample();
      const currentPose = pose();
      change(() => {
        if (!isCustom()) createAnimation(true, true);
        time = addFrame(custom(), time, currentPose);
      });
      $('frames').querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    $('copy-previous').onclick = () => {
      if (!isCustom()) return;
      stop();
      change(() => copyPreviousFrame(custom(), time));
    };
    $('copy-pose').onclick = () => {
      stop(); sample();
      const exact = isCustom() && custom().frames.find(f => Math.abs(f.time - time) < .002);
      const label = `${STATES.find(([s]) => s === state)[1]}, ${time.toFixed(3)} с`;
      poseClipboard = { pose: copy(exact ? exact.pose : pose()), label };
      syncTimeline(); message(`Скопирована поза: ${label}. Выбери кадр и нажми «Вставить позу».`);
    };
    $('paste-pose').onclick = () => {
      if (!poseClipboard) return;
      stop();
      change(() => {
        if (!isCustom()) createAnimation(true, true);
        putFrame(custom(), time, poseClipboard.pose);
      });
      viewport.frameClip(state, time);
    };
    $('frame-time').onchange = () => { const target = Number($('frame-time').value); stop(); change(() => { time = moveFrameTime(custom(), time, target); }); };
    for (const [id, delta] of [['frame-left', -1], ['frame-right', 1]]) $(id).onclick = () => navigateFrame(delta);
    $('remove-frame').onclick = () => {
      if (!isCustom() || custom().frames.length < 2) return;
      const index = custom().frames.findIndex(f => Math.abs(f.time - time) < .002);
      if (index < 0) return;
      playing = false;
      change(() => {
        const frames = custom().frames;
        frames.splice(index, 1);
        time = frames[Math.min(index, frames.length - 1)].time;
      });
      $('frames').querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    $('undo').onclick = () => undo(); $('redo').onclick = () => undo(true);
    $('save').onclick = persist; $('close').onclick = () => api.toggle();
    $('keep-browser').onclick = () => storage.keepBrowser();
    $('load-project').onclick = () => storage.loadProject();
    $('storage-conflict').hidden = !storage.conflict;
    $('export').onclick = () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(setup, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'skyfly-animations.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); message('Проект скачан. JSON можно загрузить в другом браузере.');
    };
    $('import').onclick = () => $('file').click();
    $('file').onchange = async () => {
      const file = $('file').files[0]; if (!file) return;
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error('Файл слишком большой (максимум 8 МБ)');
        const imported = normalizeSetup(JSON.parse(await file.text()));
        change(() => { setup = imported; time = 0; playing = false; });
        message('Проект загружен; предыдущее состояние доступно через «Отменить».');
      } catch (error) { message(`Не удалось загрузить: ${error.message}`, true); }
      $('file').value = '';
    };
    panel.addEventListener('pointerup', () => { gesture = false; });
    sync(); message(status, statusError);
  }
  function togglePlay() {
    if (!playing && time >= duration() - 0.001) time = 0;
    playing = !playing; syncTimeline();
  }
  function frame(now) {
    if (!open) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (playing && !viewport.editing) {
      time += dt * (setup.speed[state] ?? 1);
      if (time >= duration()) {
        if (isCustom() ? custom().loop : !['jump', 'land'].includes(state)) time %= duration();
        else { time = duration(); playing = false; }
      }
      $('scrub').value = time; $('time').textContent = `${time.toFixed(2)} / ${duration().toFixed(2)} с`;
      $('play').textContent = playing ? 'Ⅱ Пауза' : '▶ Смотреть';
    }
    sample(); viewport.render();
    raf = requestAnimationFrame(frame);
  }
  function keyboard(ev) {
    if (!open) return;
    ev.stopImmediatePropagation();
    const typing = !!ev.target?.matches?.('input, select, textarea, [contenteditable=true]');
    if (ev.code === 'Escape' || (ev.code === 'KeyP' && !typing)) { ev.preventDefault(); api.toggle(); }
    else if (!typing && (ev.code === 'ArrowLeft' || ev.code === 'ArrowRight')) { ev.preventDefault(); navigateFrame(ev.code === 'ArrowLeft' ? -1 : 1); }
    else if (ev.code === 'Space' && !typing) { ev.preventDefault(); togglePlay(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyZ' && !typing) { ev.preventDefault(); undo(ev.shiftKey); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyS') { ev.preventDefault(); persist(); }
    else if (ev.code === 'Tab') {
      const items = [...panel.querySelectorAll('button, input, select')].filter((el) => !el.disabled && el.getClientRects().length);
      const i = items.indexOf(document.activeElement);
      if ((ev.shiftKey && i <= 0) || (!ev.shiftKey && i === items.length - 1)) { ev.preventDefault(); items[ev.shiftKey ? items.length - 1 : 0]?.focus(); }
    }
  }
  const keyup = (ev) => { if (open) ev.stopImmediatePropagation(); };
  addEventListener('keydown', keyboard, true); addEventListener('keyup', keyup, true);
  const storage = createAnimationStorage({
    onStatus: (text, error, conflict) => {
      message(text, error);
      if (panel) $('storage-conflict').hidden = !conflict;
    },
    onProject: (project) => {
      if (panel) pushHistory();
      setup = project; playing = false;
      hero().userData.setSetup(setup); viewport?.model.userData.setSetup(setup);
      if (panel) sync();
    },
  });
  const api = {
    get open() { return open; },
    toggle() {
      if (!open) {
        previousFocus = document.activeElement;
        if (document.pointerLockElement) document.exitPointerLock();
        if (!panel) build();
        open = true; panel.hidden = false; launcher.hidden = true;
        previousInert = [...document.body.children].filter((el) => el !== panel).map((el) => [el, el.inert]);
        for (const [el] of previousInert) el.inert = true;
        hero().userData.setSetup(setup);
        viewport.resize(); sync(); viewport.frameClip(state, time); last = performance.now(); raf = requestAnimationFrame(frame);
        $('close').focus();
      } else {
        persist(); open = false; playing = false; cancelAnimationFrame(raf);
        panel.hidden = true; launcher.hidden = false;
        for (const [el, value] of previousInert) el.inert = value;
        previousFocus?.focus();
      }
      onToggle?.(open); return open;
    },
    dispose() {
      if (open) api.toggle(); clearTimeout(saveTimer); cancelAnimationFrame(raf);
      storage.dispose(); thumbnails?.dispose();
      removeEventListener('keydown', keyboard, true); removeEventListener('keyup', keyup, true);
      viewport?.dispose(); panel?.remove(); launcher.remove(); startLauncher.remove();
    },
  };
  storage.start(() => copy(setup));
  return api;
}
