// Prepara un módulo de src/ para inyectarlo en el workflow autocontenido: quita imports
// y exports. Normaliza CRLF primero — en Windows con core.autocrlf=true el working copy
// llega con \r\n y los regex anclados a \n no matchearían (misma familia del bug ya
// corregido en el parser de planes).
export function inlineSource(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^import\s.*\n/gm, '')
    .replace(/^export\s+/gm, '');
}
