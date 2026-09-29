// Весь экранный интерфейс: цифры HUD, компас, полоса зарядки, поток воздуха по краям,
// лог событий и чат. Тяжёлые строки обновляем раз в 6 кадров — на телефоне это заметно.
import { jumpHeight } from '../core/character.js';
import { createMinimap } from './minimap.js';


const $ = (id) => document.getElementById(id);
const fmt = (v, d = 0) => v.toLocaleString('ru-RU', { maximumFractionDigits: d });

export function say(text) {
  const d = document.createElement('div');
  d.textContent = text;
  $('log').prepend(d);
  while ($('log').children.length > 5) $('log').lastChild.remove();
  setTimeout(() => d.classList.add('fade'), 4000);
  setTimeout(() => d.remove(), 5200);
}

// Подсказка снизу: только клавиши, которые имеют смысл прямо сейчас.
const k = (key, text) => `<span><kbd>${key}</kbd>${text}</span>`;
const ZONE = { ground: 'на земле', air: 'падение', fly: 'полёт', orbit: 'орбита · сила восстанавливается' };
const KEYS = {
  ground: k('Пробел', 'прыжок') + k('WASD', 'идти') + k('Shift', 'бежать'),
  air: k('Пробел ещё раз', 'включить полёт'),
  fly: k('WASD', 'лететь') + k('Shift', 'ускорение') + k('Пробел', 'вверх'),
  tired: k('WASD', 'рулить при падении · нет сил на полёт'),
};
const TOUCH_KEYS = {
  ground: k('Прыжок', 'нажми, чтобы прыгнуть'),
  air: k('Полёт', 'нажми ещё раз, чтобы взлететь'),
  fly: k('Вперёд', 'лететь') + k('Форсаж', 'ускорение'),
  tired: k('Нет сил', 'полёт пока недоступен'),
};
// слои атмосферы — чтобы было понятно, куда поднялся (граница космоса — линия Кармана, 100 км)
const layerOf = (alt) => alt < 2200 && alt > 1400 ? 'облака'
  : alt < 11_000 ? 'тропосфера' : alt < 50_000 ? 'стратосфера' : alt < 85_000 ? 'мезосфера'
  : alt < 100_000 ? 'термосфера' : 'космос';

export function createHud({ p, net, cities, audio, mobile = false }) {
  const minimap = createMinimap(p, net);
  let shownHint = null;
  function updateHints(character) {
    const mode = character.mode;
    const hint = mode === 'air' && character.power <= 5 ? 'tired' : mode;
    const locked = !!document.pointerLockElement;
    const state = `${hint}:${locked}`;
    if (state === shownHint) return;
    shownHint = state;
    $('keys').innerHTML = ((mobile ? TOUCH_KEYS : KEYS)[hint] || KEYS.fly)
      + (mobile ? '' : locked ? k('Мышь', 'направление') + k('Esc', 'курсор') : k('Клик / V', 'рулить мышью'));
    $('b-up').textContent = mode === 'ground' ? 'ПРЫЖОК' : mode === 'air' ? 'ПОЛЁТ' : 'ВВЕРХ';
    $('b-fly').textContent = mode === 'fly' ? 'ПАДАТЬ' : 'ПОЛЁТ';
  }
  updateHints(p);
  $('b-chat')?.addEventListener('click', openChat);
  $('b-help')?.addEventListener('click', toggleHelp);
  $('help-close')?.addEventListener('click', () => { $('help').hidden = true; });

  let muted = localStorage.getItem('skyfly-mute') === '1';
  const syncMute = () => {
    audio.mute(muted);
    $('b-snd').textContent = muted ? '🔇' : '🔊';
    localStorage.setItem('skyfly-mute', muted ? '1' : '0');
  };
  $('b-snd').addEventListener('click', () => { muted = !muted; syncMute(); });
  syncMute();

  function openChat() {
    const i = $('chat-input');
    i.hidden = false; i.focus();
    i.onkeydown = (e) => {
      if (e.key === 'Enter') { if (i.value.trim()) net.chat(i.value.trim().slice(0, 120)); i.value = ''; i.hidden = true; i.blur(); }
      if (e.key === 'Escape') { i.value = ''; i.hidden = true; i.blur(); }
      e.stopPropagation();
    };
  }
  function toggleHelp() { $('help').hidden = !$('help').hidden; }

  return {
    openChat, toggleHelp,
    toggleSound() { muted = !muted; syncMute(); },

    // каждый кадр: дешёвые индикаторы
    frame(p_, rho, speed) {
      updateHints(p_);
      const ch = $('charge');
      if (p_.charge > 0.01) {
        ch.hidden = false; $('charge-b').style.width = `${p_.charge * 100}%`;
        $('charge-h').textContent = `${Math.round(jumpHeight(p_.charge))} м`;
      }
      else ch.hidden = true;
      const rush = Math.max(0, Math.min(1, (speed - 200) / 900)) * Math.min(1, rho * 1.5);
      $('rush').style.opacity = String(rush * 0.8);
    },

    // раз в 6 кадров: текст
    stats(speed, nearest, nearestD, fps) {
      const kmh = speed * 3.6;
      $('h-alt').textContent = p.alt > 1000 ? `${fmt(p.alt / 1000, 1)} км` : `${fmt(p.alt)} м`;
      $('h-spd').textContent = `${fmt(kmh)} км/ч${speed > 340 ? ` · ${(speed / 340).toFixed(1)} Маха` : ''}`;
      const pw = Math.round(p.power);
      $('h-pow').style.width = `${pw}%`;
      $('h-pow').className = p.exhausted ? 'bar out' : pw < 25 ? 'bar low' : 'bar';
      $('h-pow-n').textContent = `${pw}%`;
      const zone = p.mode === 'ground' ? 'ground' : p.mode === 'air' ? 'air' : p.alt > 100_000 ? 'orbit' : 'fly';
      $('h-zone').textContent = zone === 'ground' || p.alt < 1500 ? ZONE[zone] : `${ZONE[zone]} · ${layerOf(p.alt)}`;
      minimap.update();
      $('h-net').textContent = net.online ? `в сети: ${net.players.size}` : 'нет связи';
      $('h-fps').textContent = `${Math.round(fps)} fps`;
    },
  };
}
