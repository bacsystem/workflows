// El sandbox del Workflow prohíbe Date.now()/new Date() (determinismo del resume), así
// que los tiempos de pared vienen de los propios agentes (corren `date +%H:%M:%S`); acá
// solo se hace aritmética de strings sobre valores HH:MM:SS que pueden venir malformados
// — un agente es texto libre, no un reloj.
const TIME_RE = /^\d{1,2}:\d{2}:\d{2}$/;

export function hhmmssToSeconds(t) {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

export function formatDuration(startedAt, finishedAt) {
  if (!TIME_RE.test(startedAt ?? '') || !TIME_RE.test(finishedAt ?? '')) {
    return 'duration unknown';
  }
  let secs = hhmmssToSeconds(finishedAt) - hhmmssToSeconds(startedAt);
  if (secs < 0) secs += 24 * 3600; // crossed midnight
  return `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`;
}
