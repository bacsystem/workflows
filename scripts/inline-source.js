// Prepara un módulo de src/ para inyectarlo en el workflow autocontenido: quita imports
// y exports. Normaliza CRLF primero — en Windows con core.autocrlf=true el working copy
// llega con \r\n y los regex anclados a \n no matchearían (misma familia del bug ya
// corregido en el parser de planes).
export function inlineSource(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (/^export\s+default\b/m.test(normalized)) {
    // Quitar solo "export " dejaría "default function ..." — sintaxis inválida que
    // recién explotaría al ejecutar el workflow. Mejor reventar en el build.
    throw new Error('inlineSource cannot inline an "export default" — use named exports');
  }
  return normalized
    // Cubre imports de una o varias líneas: "import { a,\n b } from 'x';" y también
    // los side-effect imports sin "from" ("import 'x';").
    .replace(/^import\s+(?:[^'"]*?from\s+)?['"][^'"]*['"];?[ \t]*\n/gm, '')
    .replace(/^export\s+/gm, '');
}
