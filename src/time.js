// El sandbox del Workflow prohíbe Date.now()/new Date() (determinismo del resume), así
// que los tiempos de pared vienen de los propios agentes (corren `date +%H:%M:%S`); acá
// solo se hace aritmética de strings sobre valores HH:MM:SS que pueden venir malformados
// — un agente es texto libre, no un reloj. Componentes de 1 o 2 dígitos, con rangos
// validados: "10:75:00" no es una hora, es basura que antes se convertía en duración.
const TIME_RE = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/;

function parseHHMMSS(t) {
  const match = TIME_RE.exec(t ?? '');
  if (!match) return null;
  const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (h > 23 || m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}

export function hhmmssToSeconds(t) {
  return parseHHMMSS(t);
}

export function formatDuration(startedAt, finishedAt) {
  const start = parseHHMMSS(startedAt);
  const end = parseHHMMSS(finishedAt);
  if (start === null || end === null) return 'duration unknown';
  let secs = end - start;
  if (secs < 0) secs += 24 * 3600; // crossed midnight
  return `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`;
}
