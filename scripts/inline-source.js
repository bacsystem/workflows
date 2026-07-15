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
  if (/^export\s*(\{|\*)/m.test(normalized)) {
    // "export { f as default };" o "export * from ..." quedarían como "{ f as default };"
    // o "* from ..." — también sintaxis inválida diferida.
    throw new Error('inlineSource cannot inline "export {...}"/"export * from" — use named declaration exports');
  }
  const stripped = normalized
    // Cubre imports de una o varias líneas (los especificadores no contienen ';'),
    // side-effect imports sin "from", y un comentario // al final de la línea.
    .replace(/^import\s+(?:[^'";]*?from\s+)?['"][^'"]*['"];?[ \t]*(?:\/\/[^\n]*)?\n/gm, '')
    .replace(/^export\s+/gm, '');
  if (/^import\s/m.test(stripped)) {
    // Cualquier forma de import que el regex no cubra debe reventar acá, no cuando el
    // sandbox sin imports cargue el artefacto generado.
    throw new Error('inlineSource left an import behind — unsupported import form in this module');
  }
  return stripped;
}
