// Records the rendered game and its final audio mix, without microphone access.
export function createRecorder({ canvas, audio, character, say }) {
  const button = document.createElement('button');
  button.id = 'b-record'; button.type = 'button'; button.textContent = '● Запись';
  document.getElementById('bar').append(button);
  const supported = typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function';
  button.disabled = !supported;
  button.title = supported ? 'Записать полёт со звуком, до 5 минут' : 'Запись не поддерживается этим браузером';
  let recorder = null, mix = null, stream = null, recordingCanvas, context, chunks = [], bytes = 0, start = 0, last = 0, timer, starting = false, lastURL;
  const result = document.createElement('div');result.id='record-result';result.hidden=true;
  result.innerHTML='<a>Скачать видео</a><button type="button" aria-label="Закрыть запись">✕</button>';
  document.body.append(result);
  result.lastChild.onclick=()=>{result.hidden=true;if(lastURL){URL.revokeObjectURL(lastURL);lastURL=null;}};
  const stop = () => { if(recorder?.state==='recording'){recorder.stop();button.disabled=true;button.textContent='Сохраняем…';} };
  function release() {
    if (recorder) recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
    clearTimeout(timer);stream?.getVideoTracks().forEach(track=>track.stop());mix?.dispose();
    recorder=null;stream=null;mix=null;context=null;recordingCanvas=null;starting=false;
    button.disabled=false;button.textContent='● Запись';button.classList.remove('on');button.setAttribute('aria-pressed','false');
  }
  button.onclick=async()=>{
    if(recorder){stop();return;}if(starting)return;starting=true;button.disabled=true;
    try {
      audio.start();await audio.ctx.resume();
      mix=audio.capture();
      const mime=['video/mp4;codecs=avc1.420028,mp4a.40.2','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
      if(!mime)throw new Error('Браузер не поддерживает запись видео');
      recordingCanvas=document.createElement('canvas');
      const scale=Math.min(1,1920/canvas.width,1080/canvas.height);
      recordingCanvas.width=Math.max(2,Math.floor(canvas.width*scale/2)*2);recordingCanvas.height=Math.max(2,Math.floor(canvas.height*scale/2)*2);
      context=recordingCanvas.getContext('2d',{alpha:false});
      stream=recordingCanvas.captureStream(30);
      for (const track of mix.stream.getAudioTracks()) stream.addTrack(track);
      recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000,audioBitsPerSecond:128000});
      chunks=[];bytes=0;start=performance.now();last=0;
      recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>200*1024*1024)stop();}};
      let failed = false;
      recorder.onerror=()=>{
        failed = true; button.disabled = true; button.textContent = 'Сохраняем…';
        say('Запись прервалась — сохраняем доступную часть.');
        // MediaRecorder delivers final dataavailable and stop after error. Keep the
        // session locked until those events, so it cannot overwrite a newer recording.
      };
      recorder.onstop=()=>{
        if (!bytes) { chunks=[]; release(); say('Не удалось записать видео. Попробуй ещё раз.'); return; }
        const blob=new Blob(chunks,{type:mime});chunks=[];
        if(lastURL)URL.revokeObjectURL(lastURL);lastURL=URL.createObjectURL(blob);
        const link=result.firstChild;link.href=lastURL;link.download=`skyfly-${new Date().toISOString().replace(/[:.]/g,'-')}.${mime.includes('mp4')?'mp4':'webm'}`;
        link.textContent=`Скачать видео · ${(blob.size/1048576).toFixed(1)} МБ`;result.hidden=false;
        release();link.click();say(failed ? 'Сохранена доступная часть видео — проверь запись.' : 'Видео готово — кнопка скачивания доступна на экране');
      };
      recorder.start(1000);timer=setTimeout(stop,300000);button.disabled=false;button.classList.add('on');button.setAttribute('aria-pressed','true');
      say(audio.on?'Запись началась — со звуком игры':'Запись началась. Звук выключен кнопкой динамика');
    }catch(error){release();say(error.message);}
  };
  return { get active() { return starting || recorder !== null; }, frame(now) {
    if(recorder?.state!=='recording'||now-last<1000/30)return;last=now;
    const w=recordingCanvas.width,h=recordingCanvas.height;
    context.fillStyle='#000';context.fillRect(0,0,w,h);
    const scale=Math.min(w/canvas.width,h/canvas.height),dw=canvas.width*scale,dh=canvas.height*scale;
    try { context.drawImage(canvas,(w-dw)/2,(h-dh)/2,dw,dh); }
    catch { stop(); say('Захват изображения прервался. Останавливаем запись.'); return; }
    const seconds=Math.floor((now-start)/1000),stamp=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    button.textContent=`■ Стоп ${stamp}`;
    context.fillStyle='rgba(8,14,26,.6)';context.fillRect(16,16,190,40);context.fillStyle='#e3edff';context.font='bold 18px sans-serif';
    context.fillText(`${Math.round(Math.hypot(...character.vel)*3.6)} км/ч · ${Math.round(character.alt)} м`,26,42);
  } };
}
