export const IMAGE_ANALYSIS_KINDS = ['dpi', 'comprobante'] as const;

export type ImageAnalysisKind = (typeof IMAGE_ANALYSIS_KINDS)[number];

export function isImageAnalysisKind(value: string): value is ImageAnalysisKind {
  return (IMAGE_ANALYSIS_KINDS as readonly string[]).includes(value);
}

export const IMAGE_ANALYSIS_PROMPTS: Record<ImageAnalysisKind, string> = {
  dpi:
    'Esta imagen debería ser una foto de un DPI de Guatemala. ' +
    'Responde en UNA sola línea con este formato exacto, sin copiar datos personales (nombre, número CUI ni fecha de nacimiento): ' +
    'LADO=FRENTE|REVERSO|NO_ES_UN_DPI; LEGIBLE=SI|NO; AUTENTICO=SI|NO; PROBLEMAS=<texto corto o ninguno>. ' +
    'FRENTE: se ve la foto grande del titular, el nombre y el número CUI. ' +
    'REVERSO: el otro lado de la tarjeta, sin la foto grande del titular, con el logo RENAP, lugar de nacimiento y vecindad, estado civil, fecha de vencimiento y tres líneas de texto de lectura mecánica (código MRZ). ' +
    'LEGIBLE=NO solo si los datos importantes (nombre, número, fechas, código) no se pueden leer; que la foto esté girada, con los bordes cortados o con algo de reflejo no es un problema si los datos se leen. ' +
    'AUTENTICO=NO solo si hay señales claras de que no es la foto de una tarjeta física real: una captura de pantalla, una fotocopia en blanco y negro, un dibujo, un texto que diga muestra o ejemplo, o ediciones evidentes. ' +
    'Un DPI real tiene una segunda foto pequeña y translúcida del titular, patrones de seguridad y fondos con degradado: eso es normal y no es una edición. Ante la duda, AUTENTICO=SI.',
  comprobante:
    'Esta imagen debería ser el comprobante de una transferencia bancaria. ' +
    'Responde en UNA sola línea con este formato exacto: ' +
    'ES_COMPROBANTE=SI|NO; BANCO=<texto>; CUENTA_DESTINO=<número>; NOMBRE_DESTINATARIO=<texto>; MONTO=<monto con moneda>; ' +
    'FECHA=<texto>; REFERENCIA=<número>; ESTADO=<texto>; LEGIBLE=SI|NO. ' +
    'Si un dato no se ve, escribe NO_SE_VE en su lugar.',
};
