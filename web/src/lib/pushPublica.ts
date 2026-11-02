// Llave pública de las notificaciones al celular (Web Push). Pública por diseño: el navegador la necesita para
// suscribirse. Su par privado (VAPID_PRIVATE_KEY) vive solo en GitHub Actions y en tu .env. Va aparte de lib/push.ts
// para que el navegador no cargue la librería de envío.
export const VAPID_PUBLICA = 'BOR_Ml8gUEZqwl_ALwXgLBtZI2Jto0FOk_K1BKt6IUoUiUvt6x9_4KcosxsqZwe9-D_zeTugvphxGgj1LoqW-mU';
