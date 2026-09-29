// Ввод. Два режима: ПК (захват мыши + WASD) и телефон (палец по левой половине = взгляд, кнопки = движение).
// W/A/S/D по взгляду, пробел — вверх, Shift — форсаж, Ctrl/C — вниз.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

export function createInput({ el, p, keys, mobile, onChat, onHelp, onSound }) {
  if (!mobile) {
    // Explicit click on the game, V or the button; never steal the pointer on load.
    const lookBtn = $('b-look');
    const toggleLook = () => {
      if (document.pointerLockElement === el) document.exitPointerLock();
      else {
        try { el.requestPointerLock()?.catch?.(() => {}); } catch {}
      }
    };
    lookBtn?.addEventListener('click', toggleLook);
    el.addEventListener('click', () => {
      if (!document.querySelector('#start') && document.pointerLockElement !== el) toggleLook();
    });
    document.addEventListener('pointerlockerror', () => {
      if (lookBtn) lookBtn.title = 'Браузер не разрешил захват мыши. Нажми ещё раз; стрелки и трекпад тоже работают.';
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === el;
      $('aim').classList.toggle('show', locked);
      lookBtn?.classList.toggle('on', locked);
      if (lookBtn) lookBtn.innerHTML = locked ? 'Мышь вкл<kbd>Esc</kbd>' : 'Мышь<kbd>V</kbd>';
    });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== el) return;
      p.yaw += e.movementX * 0.0022;   // мышь вправо — поворот вправо
      p.pitch = THREE.MathUtils.clamp(p.pitch - e.movementY * 0.0022, -1.45, 1.45);
    });
    const key = (e, down) => {
      const c = e.code;
      if (c === 'KeyW') keys.fwd = down;
      if (c === 'KeyS') keys.back = down;
      if (c === 'KeyA') keys.left = down;
      if (c === 'KeyD') keys.right = down;
      if (c === 'KeyQ') keys.strafeL = down;
      if (c === 'KeyE') keys.strafeR = down;
      if (c === 'Space') keys.jump = down;                                  // прыжок; держать — взлёт; в воздухе — полёт
      if (c === 'ShiftLeft' || c === 'ShiftRight') keys.run = down;         // бег и форсаж
      if (c === 'ControlLeft' || c === 'ControlRight' || c === 'KeyC') keys.down = down;   // вниз (C — если Ctrl занят системой)
      if (c === 'KeyX') keys.brake = down;                                  // тормоз
      if (c === 'KeyF') keys.fly = down;                                    // полёт вкл/выкл
      if (c === 'KeyR') keys.slam = down;                                   // удар в землю
      // стрелки — поворот и наклон без мыши
      if (c === 'ArrowLeft') keys.left = down;
      if (c === 'ArrowRight') keys.right = down;
      if (c === 'ArrowUp') keys.lookUp = down;
      if (c === 'ArrowDown') keys.lookDown = down;
      if (down && !e.repeat && c === 'KeyV') toggleLook();
      if (down && c === 'KeyH') onHelp?.();
      if (down && c === 'KeyN') onSound?.();
      if (down && c === 'Enter') onChat?.();
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
    };
    // Трекпад: свайп двумя пальцами крутит вид без захвата мыши — это удобнее, чем pointer lock.
    el.addEventListener('wheel', (e) => {
      if (document.pointerLockElement === el) return;
      e.preventDefault();
      p.yaw += e.deltaX * 0.0032;
      p.pitch = THREE.MathUtils.clamp(p.pitch - e.deltaY * 0.0032, -1.45, 1.45);
    }, { passive: false });

    // Залипание: на Mac система съедает отпускание Ctrl (Ctrl+стрелка, Ctrl+клик), а при потере
    // фокуса браузер не присылает keyup вовсе — игра считала клавишу нажатой навсегда.
    // Поэтому каждое событие сверяет реальное состояние модификаторов, а уход с окна отпускает всё.
    let ctrlByC = false;
    const syncMods = (e) => {
      keys.run = e.shiftKey;
      keys.down = e.ctrlKey || ctrlByC;
    };
    const releaseAll = () => { for (const k of Object.keys(keys)) keys[k] = false; ctrlByC = false; };
    addEventListener('keydown', (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (e.code === 'KeyC') ctrlByC = true;
      key(e, true); syncMods(e);
    });
    addEventListener('keyup', (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (e.code === 'KeyC') ctrlByC = false;
      key(e, false); syncMods(e);
    });
    addEventListener('mousemove', syncMods);
    addEventListener('mousedown', syncMods);
    addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
    return;
  }

  // ---- телефон: independent pointer capture for view and held buttons ----
  const look = { id: null, x: 0, y: 0 };
  const held = new Map();
  el.addEventListener('pointerdown', e => {
    if (look.id !== null) return;
    look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== look.id) return;
    p.yaw += (e.clientX - look.x) * .0055;
    p.pitch = THREE.MathUtils.clamp(p.pitch - (e.clientY - look.y) * .0055, -1.45, 1.45);
    look.x = e.clientX; look.y = e.clientY;
  });
  const endLook = e => { if (look.id === e.pointerId) look.id = null; };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(event, endLook);
  const hold = (id, key) => {
    const button = $(id); if (!button) return;
    const pointers = new Set(); held.set(button, { key, pointers });
    button.addEventListener('pointerdown', e => {
      e.preventDefault(); pointers.add(e.pointerId); button.setPointerCapture(e.pointerId);
      keys[key] = true; button.classList.add('on');
    });
    const release = e => {
      if (!pointers.delete(e.pointerId)) return;
      const finish = () => { keys[key] = pointers.size > 0; button.classList.toggle('on', keys[key]); };
      // A quick tap can begin and end between two game frames. Keep edge-triggered
      // actions through a physics tick, otherwise flight/jump/slam taps get lost.
      if (!pointers.size && ['jump', 'fly', 'slam'].includes(key) && e.type === 'pointerup') {
        requestAnimationFrame(() => requestAnimationFrame(finish));
      } else finish();
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, release);
  };
  hold('b-thrust', 'fwd'); hold('b-back', 'back'); hold('b-boost', 'run'); hold('b-brake', 'brake');
  hold('b-up', 'jump'); hold('b-down', 'down'); hold('b-slam', 'slam'); hold('b-fly', 'fly');
  const reset = () => {
    look.id = null;
    for (const key of Object.keys(keys)) keys[key] = false;
    for (const [button, state] of held) { state.pointers.clear(); button.classList.remove('on'); }
  };
  addEventListener('blur', reset); addEventListener('pagehide', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
}
